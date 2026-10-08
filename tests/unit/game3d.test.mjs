// The 3D page (js/3d/game3d.js) on a minimal fake DOM with a fake renderer: the menus
// (ui3d.js) wired in, motion permission, control types, buttons, progress, tutorial,
// settings and the test hook. The real WebGL path is covered by
// tests/integration/proto3d.spec.js and game3d.spec.js (chromium-3d projects).
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

for (const m of ['log', 'warn']) console[m] = () => {};

class FakeStorage {
    constructor(entries = {}) { this.map = new Map(Object.entries(entries)); }
    getItem(k) { return this.map.has(k) ? this.map.get(k) : null; }
    setItem(k, v) { this.map.set(k, String(v)); }
    removeItem(k) { this.map.delete(k); }
    clear() { this.map.clear(); }
    get length() { return this.map.size; }
    key(i) { return [...this.map.keys()][i] ?? null; }
}
/** settings.js reads globalThis.localStorage, persistence.js window.localStorage. */
function installStorage(entries = {}) {
    const s = new FakeStorage(entries);
    globalThis.window = { localStorage: s };
    Object.defineProperty(globalThis, 'localStorage', { value: s, configurable: true, writable: true });
    return s;
}
installStorage();
beforeEach(() => installStorage());

const { startGame3d, basePixelRatio, nextRenderScale } = await import('../../js/3d/game3d.js');
const proto = await import('../../js/3d/proto3d.js');
const { PersistenceManager } = await import('../../js/persistence.js');
const { deviceQuat } = await import('../../js/3d/look.js');
const hud3d = await import('../../js/3d/hud3d.js');
const { qMul, qFromEulerYXZ, qToYawPitchRoll, qFromAxisAngle, DEG } = await import('../../js/3d/math3d.js');

function listeners() {
    const map = {};
    return {
        addEventListener(t, f) { (map[t] ||= []).push(f); },
        removeEventListener(t, f) { map[t] = (map[t] || []).filter((g) => g !== f); },
        fire(t, e = {}) { for (const f of map[t] || []) f(e); },
    };
}

const ctx2d = new Proxy({}, {
    get: (t, k) => (k in t ? t[k] : k === 'measureText' ? () => ({ width: 50 }) : () => ({ addColorStop() {} })),
    set: (t, k, v) => { t[k] = v; return true; },
});

function fakeEnv({ permission = null, screenAngle = 90, dpr = 3.5 } = {}) {
    const byId = new Map();
    const docL = listeners();
    const makeEl = (tag = 'div', id = '') => {
        const l = listeners();
        let cls = new Set();
        const el = {
            tagName: String(tag).toUpperCase(), id, style: {}, attrs: {}, _text: '', disabled: false, width: 0, height: 0, value: '',
            children: [], parentNode: null,
            get className() { return [...cls].join(' '); },
            set className(v) { cls = new Set(String(v).split(/\s+/).filter(Boolean)); },
            classList: {
                add: (...c) => c.forEach((x) => cls.add(x)),
                remove: (...c) => c.forEach((x) => cls.delete(x)),
                toggle: (c, on) => { const v = on === undefined ? !cls.has(c) : !!on; if (v) cls.add(c); else cls.delete(c); return v; },
                contains: (c) => cls.has(c),
            },
            get textContent() { return this._text + this.children.map((c) => c.textContent).join(''); },
            set textContent(v) { for (const c of this.children) c.parentNode = null; this.children = []; this._text = String(v); },
            ...l,
            setAttribute(k, v) { this.attrs[k] = String(v); },
            getAttribute(k) { return this.attrs[k] ?? null; },
            setPointerCapture() {}, requestPointerLock() {}, focus() {}, scrollIntoView() {},
            getContext(kind) { return kind === '2d' ? ctx2d : null; },
            querySelector(sel) { return byId.get(sel.replace(/^#/, '')) || null; },
            querySelectorAll() { return []; },
            appendChild(c) { c.parentNode = el; el.children.push(c); return c; },
            removeChild(c) { el.children = el.children.filter((x) => x !== c); c.parentNode = null; return c; },
            click() { if (!el.disabled) l.fire('click', { target: el, preventDefault() {} }); },
            pointer(type, e = {}) { l.fire(type, { target: el, pointerId: 1, pointerType: 'touch', clientX: 0, clientY: 0, button: 0, preventDefault() {}, ...e }); },
        };
        Object.defineProperty(el, 'innerHTML', {
            set(html) { for (const m of html.matchAll(/id="([^"]+)"/g)) byId.set(m[1], makeEl('div', m[1])); },
        });
        return el;
    };
    const doc = {
        ...docL, hidden: false, visibilityState: 'visible', pointerLockElement: null, activeElement: null,
        head: makeEl('head'),
        body: makeEl('body'),
        createElement: (tag) => makeEl(tag),
        exitPointerLock() {},
    };
    /** A key on the document (ui3d listens there) and the window (the game listens there). */
    doc.key = (code, key = code) => {
        const e = { code, key, repeat: false, type: 'keydown', preventDefault() {}, stopPropagation() {} };
        docL.fire('keydown', e);
        winL.fire('keydown', e);
    };
    const raf = [];
    const winL = listeners();
    const win = {
        ...winL, document: doc, innerWidth: 892, innerHeight: 412, devicePixelRatio: dpr,
        location: { search: '?3d=1&seed3d=1&layout3d=range', href: 'http://x/?3d=1&seed3d=1&layout3d=range', replace(u) { this.replaced = u; } },
        navigator: { vibrate() { return true; } },
        screen: { orientation: { angle: screenAngle } },
        requestAnimationFrame(f) { raf.push(f); },
        DeviceOrientationEvent: function DeviceOrientationEvent() {},
    };
    if (permission === 'never') win.DeviceOrientationEvent.requestPermission = () => new Promise(() => {});
    else if (permission) win.DeviceOrientationEvent.requestPermission = () => Promise.resolve(permission);
    let t = performance.now();
    const frames = (n = 1, ms = 1000 / 60) => {
        for (let i = 0; i < n; i++) { t += ms; const f = raf.shift(); if (f) f(t); }
    };
    const orient = (alpha, beta, gamma) => winL.fire('deviceorientation', { alpha, beta, gamma });
    const worlds = [];
    const debris = [];
    const renderers = [];
    const fakeRenderer = () => {
        const r = {
            three: 'fake', drawCalls: 7, setSize() {}, render() {}, burst() {}, probeLitPixels: () => ({ lit: 1 }), setWorld(w) { worlds.push(w); },
            debris(pos, o) { debris.push(o); }, get particles() { return debris.length; }, disposed: false, dispose() { this.disposed = true; },
            fovSet: null, setFov(f) { this.fovSet = f; }, palette: 'standard', setPalette(id) { this.palette = id; },
        };
        renderers.push(r);
        return r;
    };
    return { win, doc, byId, frames, orient, fakeRenderer, worlds, debris, renderers, el: (id) => byId.get(id) };
}

// Device angles for neutral ⊗ rel at a screen angle (inverse of deviceQuat)
function anglesFor(q, screen) {
    const e = qMul(qMul(q, qFromAxisAngle([0, 0, 1], screen * DEG)), [Math.SQRT1_2, 0, 0, Math.SQRT1_2]);
    const r = qToYawPitchRoll(e);
    return [r.yaw / DEG, r.pitch / DEG, -r.roll / DEG];
}

const tick = () => new Promise((r) => setTimeout(r, 0));

/**
 * Boot the page. opts.storage: localStorage entries before it starts (settings, profile);
 * opts.search: the URL query; opts.start: more startGame3d options.
 */
async function boot(opts = {}) {
    const storage = installStorage(opts.storage || {});
    const env = fakeEnv(opts);
    if (opts.search) {
        env.win.location.search = opts.search;
        env.win.location.href = 'http://x/' + opts.search;
    }
    const r = await startGame3d({
        win: env.win, createRenderer: env.fakeRenderer, persistence: new PersistenceManager(), storage, ...(opts.start || {}),
    });
    env.ui = r.ui;
    env.storage = storage;
    return env;
}
const JOY = { spaceAdventure_control3d: 'joystick' };
const PILOT = (name = 'ANN') => ({ asteroids_currentUser: name, asteroids_userList: JSON.stringify([name]) });

/** Move the menu focus to an item and select it (like arrows and Enter, or a controller). */
function pick(env, id) {
    for (let i = 0; i < 40 && env.ui.snapshot().focus !== id; i++) env.ui.navigate('down');
    assert.equal(env.ui.snapshot().focus, id, `menu item ${id} in ${JSON.stringify(env.ui.snapshot().items.map((x) => x.id))}`);
    env.ui.select();
}
/** Settings screen (from the menu or the pause menu): step a row to `value`, then back. */
function setSetting(env, key, value) {
    pick(env, 'settings');
    const id = `set-${key}`;
    for (let i = 0; i < 40 && env.ui.snapshot().focus !== id; i++) env.ui.navigate('down');
    const val = () => env.ui.snapshot().items.find((x) => x.id === id).value;
    for (let i = 0; i < 40 && val() !== value; i++) env.ui.navigate('right');
    assert.equal(val(), value, key);
    env.ui.back();
}

/** A tap on the page (the gesture motion access and audio need), as before a click. */
function gesture(env) {
    const root = env.doc.body.children.find((c) => c.id === 'proto3d');
    root.fire('pointerdown', { target: root, pointerType: 'touch', pointerId: 9, clientX: 0, clientY: 0, button: 0, preventDefault() {} });
}
/** From the first screen (name entry without a profile) to a running game, Play tapped. */
async function play(env, { tap = true } = {}) {
    if (env.ui.current === 'profile') pick(env, 'guest');
    assert.equal(env.ui.current, 'menu');
    if (tap) gesture(env);
    pick(env, 'play');
    await tick();
}

/** Fake audio3d.js / haptics3d.js objects recording every call (no real audio in unit tests). */
function fakeEffects() {
    const calls = [];
    const rec = (name) => (...args) => { calls.push([name, ...args]); };
    const audio = {
        play: rec('play'), explosion: rec('explosion'), thrust: rec('thrust'), update: rec('update'), unlock: rec('unlock'),
        setRange: rec('setRange'), stopAll: rec('stopAll'), snapshot: () => ({ fake: true }),
    };
    const haptics = { event: rec('haptic'), stop: rec('hapticStop'), stats: { vibrations: 0 } };
    const made = {};
    return {
        calls,
        start: {
            createAudio: async (o) => { made.audio = o; return audio; },
            createHaptics: async (o) => { made.haptics = o; return haptics; },
        },
        made,
        names: (kind) => calls.filter((c) => c[0] === kind).map((c) => c[1]),
    };
}

test('pixel ratio cap and adaptive render scale', () => {
    assert.equal(basePixelRatio(3.5), 1);
    assert.equal(basePixelRatio(2), 1.5);
    assert.equal(basePixelRatio(1), 1);
    assert.deepEqual(nextRenderScale(1, 30, 0), { scale: 0.9, goodSeconds: 0 });
    assert.deepEqual(nextRenderScale(0.5, 20, 0), { scale: 0.5, goodSeconds: 0 });
    assert.deepEqual(nextRenderScale(0.8, 60, 2), { scale: 0.9, goodSeconds: 0 });
    assert.deepEqual(nextRenderScale(0.8, 60, 0), { scale: 0.8, goodSeconds: 1 });
});

test('menu first; start with permission granted; Direct follows the phone 1:1', async () => {
    const env = await boot({ permission: 'granted' });
    const g = () => env.win.__spaceAdventure.game3d;
    assert.equal(g().loaded, true);
    assert.equal(g().screen, 'menu');
    assert.equal(g().permission, 'unknown');
    assert.equal(g().ui.screen, 'profile', 'no pilot yet: the name screen first');
    await play(env);
    assert.equal(g().permission, 'granted');
    assert.equal(g().screen, 'playing');
    assert.equal(g().mode, 'direct', 'chosen mode during the grace period, before any reading');
    assert.equal(g().menuOpen, false);
    const N = deviceQuat(0, 0, -90, 90);
    env.orient(0, 0, -90);
    env.frames(2);
    assert.equal(g().mode, 'direct');
    assert.ok(Math.abs(g().yaw) < 1e-3 && Math.abs(g().roll) < 1e-3);
    env.orient(...anglesFor(qMul(N, qFromEulerYXZ(10 * DEG, 30 * DEG, 25 * DEG)), 90));
    env.frames(2);
    assert.ok(Math.abs(g().yaw - 30) < 0.01, `yaw ${g().yaw}`);
    assert.ok(Math.abs(g().pitch - 10) < 0.01, `pitch ${g().pitch}`);
    assert.ok(Math.abs(g().roll - 25) < 0.01, `roll ${g().roll}`);
    env.el('p3-recentre').click();
    env.frames(2);
    assert.ok(Math.abs(g().yaw) < 1e-3 && Math.abs(g().pitch) < 1e-3 && Math.abs(g().roll) < 1e-3, 'recentre zeroes');
    // Level horizon: roll blocked
    env.el('p3-level').click();
    env.orient(...anglesFor(qMul(N, qFromEulerYXZ(0, 0, 40 * DEG)), 90));
    env.frames(2);
    assert.equal(g().levelHorizon, true);
    assert.ok(Math.abs(g().roll) < 1e-3);
    assert.equal(g().drawCalls, 7);
    assert.equal(g().pixelRatio, 1, 'DPR 3.5 phone renders at 1.0');
});

test('permission denied falls back to Joystick with a message', async () => {
    const env = await boot({ permission: 'denied' });
    const g = () => env.win.__spaceAdventure.game3d;
    await play(env);
    env.orient(0, 0, -90);
    env.frames(3);
    assert.equal(g().permission, 'denied');
    assert.equal(g().chosenMode, 'direct');
    assert.equal(g().mode, 'joystick');
    assert.match(g().message, /denied/);
});

test('joystick mode: drag rotates, roll buttons roll, thrust moves, fire splits the red ahead', async () => {
    const env = await boot({ storage: JOY });
    const g = () => env.win.__spaceAdventure.game3d;
    await play(env);
    assert.equal(g().permission, 'unknown', 'joystick never asks for motion');
    assert.equal(g().mode, 'joystick');
    const zone = env.el('p3-stick-zone');
    zone.pointer('pointerdown', { clientX: 100, clientY: 300 });
    zone.pointer('pointermove', { clientX: 164, clientY: 300 });
    env.frames(30);
    assert.ok(g().yaw < -10, `turned right: ${g().yaw}`);
    zone.pointer('pointerup');
    env.el('p3-roll-right').pointer('pointerdown');
    env.frames(20);
    env.el('p3-roll-right').pointer('pointerup');
    assert.ok(Math.abs(g().roll) > 5, `rolled: ${g().roll}`);
    // Straighten up and shoot the red rock straight ahead (layout3d=range)
    env.el('p3-recentre').click();
    env.frames(1);
    const before = g().counts.rocks;
    env.el('p3-fire').pointer('pointerdown');
    env.frames(5);
    assert.ok(g().counts.bullets > 0);
    env.frames(40);
    env.el('p3-fire').pointer('pointerup');
    assert.ok(g().counts.rocks > before, `split: ${before} -> ${g().counts.rocks}`);
    assert.ok(g().stats.redsShot > 0, 'shot (red rocks give no points, as in 2D)');
    const z0 = g().shipPos[2];
    env.el('p3-thrust').pointer('pointerdown');
    env.frames(60);
    env.el('p3-thrust').pointer('pointerup');
    assert.ok(g().shipPos[2] < z0 - 20, 'moved forward');
    // Pause, Quit to the 3D menu, Switch to 2D
    env.el('p3-pause').click();
    assert.equal(g().screen, 'paused');
    assert.equal(g().ui.screen, 'pause');
    pick(env, 'quit');
    assert.equal(g().screen, 'menu');
    pick(env, 'switch2d');
    assert.equal(env.win.location.replaced, './?2d=1');
    assert.equal(env.storage.getItem('spaceAdventure_lastMode'), null);
});

test('rate mode integrates the tilt; no sensor data falls back to Joystick', async () => {
    const env = await boot({ storage: { spaceAdventure_control3d: 'rate' } });
    const g = () => env.win.__spaceAdventure.game3d;
    await play(env);
    assert.equal(g().permission, 'not-required');
    env.frames(120); // > 1.5 s without data
    assert.equal(g().mode, 'joystick');
    assert.match(g().message, /No motion sensor/);
    const N = deviceQuat(0, 0, -90, 90);
    env.orient(0, 0, -90);
    env.frames(2);
    assert.equal(g().mode, 'rate');
    env.orient(...anglesFor(qMul(N, qFromEulerYXZ(0, 30 * DEG, 0)), 90));
    env.frames(30);
    const y1 = g().yaw;
    env.frames(30);
    assert.ok(g().yaw > y1 + 10, `keeps turning: ${y1} -> ${g().yaw}`);
    env.orient(0, 0, -90);
    env.frames(2);
    const y2 = g().yaw;
    env.frames(30);
    assert.ok(Math.abs(g().yaw - y2) < 1e-6, 'stops at neutral');
});

test('Start never waits for motion: a permission prompt that never answers still starts at once', async () => {
    const env = await boot({ permission: 'never' });
    const g = () => env.win.__spaceAdventure.game3d;
    pick(env, 'guest');
    gesture(env);
    pick(env, 'play'); // no tick: begins synchronously inside the click
    assert.equal(g().screen, 'playing');
    assert.equal(g().menuOpen, false);
    assert.equal(g().permission, 'unknown');
    env.frames(30); // 0.5 s: still in the grace period, chosen mode
    assert.equal(g().mode, 'direct');
    assert.ok(g().steps > 0 && g().time > 0, 'the game runs');
    env.frames(90); // > 1.5 s without readings: Joystick, one message
    assert.equal(g().mode, 'joystick');
    assert.equal(g().lookMode, 'joystick');
    assert.match(g().message, /motion/i);
});

test('no readings within 1.5 s switches to Joystick; readings later switch back', async () => {
    const env = await boot({});
    const g = () => env.win.__spaceAdventure.game3d;
    await play(env);
    assert.equal(g().permission, 'not-required');
    env.frames(60);
    assert.equal(g().mode, 'direct');
    env.frames(60);
    assert.equal(g().mode, 'joystick');
    assert.match(g().message, /No motion sensor/);
    env.orient(0, 0, -90);
    env.frames(2);
    assert.equal(g().lookMode, 'direct');
});

test('view distance: Far by default; a new one from the pause menu applies to the next game', async () => {
    const env = await boot({});
    const g = () => env.win.__spaceAdventure.game3d;
    assert.equal(g().viewDistance, 'far');
    assert.equal(g().world.size, 3200);
    assert.equal(env.worlds.at(-1).size, 3200, 'renderer told the world size');
    await play(env);
    env.frames(5);
    env.el('p3-pause').click();
    assert.equal(g().screen, 'paused');
    const t = g().time;
    setSetting(env, 'viewDistance3d', 'veryfar');
    assert.equal(g().viewDistance, 'veryfar');
    assert.equal(env.storage.getItem('spaceAdventure_viewDistance3d'), 'veryfar');
    assert.equal(g().ui.screen, 'pause', 'back to the pause menu');
    assert.equal(g().world.size, 3200, 'this game keeps its world');
    assert.equal(g().time, t);
    pick(env, 'quit');
    assert.equal(g().screen, 'menu');
    assert.equal(g().world.size, 4200, 'the next game: a new world');
    assert.equal(env.worlds.at(-1).fogFar, 1870);
    // layout3d=range keeps its two test rocks in every world
    assert.deepEqual(g().counts, {
        green: 1, red: 1, rocks: 2, bullets: 0, left: 2, incoming: 0, incomingLeft: 0, ufos: 0, ufoBullets: 0, bossBullets: 0, powerUps: 0,
        eventsDropped: 0,
    });
    assert.equal(g().levels, false, 'test layouts have no levels: the field stays as placed');
    const f = hud3d.formatHud({ score: 0, lives: 3, mode: 'direct', view: 'Very far', fps: 60, renderScale: 1 });
    assert.match(f.right, /View Very far · 60 fps/);
});

test('the cockpit frame is gone from the HUD', () => {
    assert.equal(hud3d.drawCockpit, undefined);
});

test('radar hook: layout3d=range puts the red rock at the front centre and the crystal at the rear centre', async () => {
    const env = await boot({ storage: JOY });
    const g = () => env.win.__spaceAdventure.game3d;
    await play(env);
    env.frames(2);
    const { front, rear, edge } = g().radar;
    const rock = front.find((b) => b.type === 'rock');
    assert.ok(rock && Math.abs(rock.x) < 1e-3 && Math.abs(rock.y) < 1e-3, JSON.stringify(front));
    const crystal = rear.find((b) => b.type === 'crystal');
    assert.ok(crystal && Math.abs(crystal.x) < 1e-3 && Math.abs(crystal.y) < 1e-3, JSON.stringify(rear));
    assert.ok(rock.near > 0.7 && rock.near < 1);
    assert.ok(edge && Math.abs(edge.angle + Math.PI / 2) < 1e-3, 'crystal straight behind: the edge arrow points down');
    // Turn right with the stick until the rock is far off to the left
    const zone = env.el('p3-stick-zone');
    zone.pointer('pointerdown', { clientX: 100, clientY: 300 });
    zone.pointer('pointermove', { clientX: 164, clientY: 300 });
    env.frames(30);
    zone.pointer('pointerup');
    env.frames(1);
    const r2 = [...g().radar.front, ...g().radar.rear].find((b) => b.type === 'rock');
    assert.ok(r2.x < -0.2, `turned right: the rock moves left (${r2.x})`);
});

test('a real game (no test layout): level 1 field, rocks-left and incoming in the hook, sounds through onSound', async () => {
    installStorage();
    const env = fakeEnv({});
    env.win.location.search = '?3d=1&seed3d=2';
    env.win.location.href = 'http://x/?3d=1&seed3d=2';
    const sounds = [];
    // The prototype's old entry name still starts the game (js/3d/proto3d.js re-exports it)
    assert.equal(proto.startPrototype, startGame3d);
    const r = await proto.startPrototype({
        win: env.win, createRenderer: env.fakeRenderer, onSound: (n) => sounds.push(n), persistence: new PersistenceManager(),
    });
    env.ui = r.ui;
    const g = () => env.win.__spaceAdventure.game3d;
    assert.equal(g().levels, true);
    assert.equal(g().level, 1);
    assert.equal(g().banner, 'LEVEL 1');
    assert.ok(g().rocksLeft > 30 && g().incomingLeft > 0, JSON.stringify([g().rocksLeft, g().incomingLeft]));
    assert.equal(g().rocksLeft, g().counts.rocks + g().incomingLeft);
    assert.equal(g().lives, 3);
    assert.equal(g().lastFew, false);
    assert.deepEqual(g().markers, []);
    await play(env);
    // Two frames: the second is 1/60 s and always runs one step (the loop's rounding tolerance),
    // which drains the level-1 event (it used to depend on the frame clock's rounding)
    env.frames(2);
    assert.equal(g().screen, 'playing');
    assert.equal(g().steps, 1);
    assert.ok(sounds.includes('level'), `sounds: ${sounds}`);
    // HUD text carries the level and rocks left
    const f = hud3d.formatHud({ score: 120, lives: 2, level: 3, rocksLeft: 17, mode: 'joystick' });
    assert.match(f.left, /LEVEL 3 {3}ROCKS 17/);
    assert.doesNotMatch(hud3d.formatHud({ score: 0, lives: 3, mode: 'joystick' }).left, /LEVEL|ROCKS/);
});

test('damage direction: screen angle of the cause in the ship frame', () => {
    assert.ok(Math.abs(hud3d.damageAngle([1, 0, 0])) < 1e-9, 'right');
    assert.ok(Math.abs(hud3d.damageAngle([0, 1, -1]) - Math.PI / 2) < 1e-9, 'up');
    assert.ok(Math.abs(hud3d.damageAngle([0, 0, 5]) + Math.PI / 2) < 1e-9, 'straight behind: down');
    // Drawing never throws, also with nothing to draw
    hud3d.drawDamage(ctx2d, 800, 400, 1, 0.5);
    hud3d.drawDamage(ctx2d, 800, 400, NaN, 1);
    hud3d.drawBanner(ctx2d, 800, 400, { text: 'LEVEL 2', sub: 'x', t: 0.2 });
    hud3d.drawBanner(ctx2d, 800, 400, null);
});

test('the frame loop: every 1/60 s frame runs exactly one step, wherever the clock starts', async () => {
    for (const ms of [1000 / 60, 16.666666666666664, 16.66666666666667]) {
        const env = await boot({ storage: JOY });
        const g = () => env.win.__spaceAdventure.game3d;
            await play(env);
        env.frames(1, ms);
        env.frames(30, ms);
        assert.equal(g().steps, 30, `${ms} ms frames`);
    }
});

test('difficulty: Medium by default, the shared setting; a change applies to the next game', async () => {
    const env = await boot({});
    const g = () => env.win.__spaceAdventure.game3d;
    assert.equal(g().difficulty, 'medium');
    pick(env, 'guest');
    setSetting(env, 'difficulty', 'hard');
    assert.equal(env.storage.getItem('spaceAdventure_difficulty'), 'hard');
    await play(env);
    assert.equal(g().difficulty, 'hard');
    assert.equal(g().lives, 2);
    env.frames(5);
    env.el('p3-pause').click();
    setSetting(env, 'difficulty', 'easy');
    assert.equal(g().lives, 2, 'this game keeps its difficulty');
    pick(env, 'restart');
    assert.equal(g().screen, 'playing');
    assert.equal(g().difficulty, 'easy');
    assert.equal(g().lives, 4);
});

test('adaptive difficulty and aids in the hook: Balanced at the start, the rock ahead bracketed', async () => {
    const env = await boot({ storage: JOY });
    const g = () => env.win.__spaceAdventure.game3d;
    assert.equal(g().adjustment.text, 'Balanced');
    assert.equal(g().adjustment.level, 'balanced');
    assert.deepEqual(g().adjustment.dda, {
        asteroidSpeedMod: 1, ufoSpawnMod: 1, ufoAccuracyMod: 1, powerUpSpawnMod: 1, greenRatioMod: 1, extraLifeThresholdMod: 1,
    });
    assert.equal(g().assist.aimDeg, 2);
    assert.equal(g().assist.crystalArrow, 'offscreen');
    await play(env);
    env.frames(2);
    // layout3d=range: the red rock 300 straight ahead is the crosshair target; it doesn't move
    const t = g().target;
    assert.ok(t && t.onScreen && t.dist === 300, JSON.stringify(t));
    assert.equal(t.lead, false);
    assert.equal(g().perf.decision, 'measuring');
    assert.equal(g().contextLoss.lost, false);
    // HUD label as in 2D
    const f = hud3d.formatHud({ score: 0, lives: 3, mode: 'joystick', adjustment: 'Assisting' });
    assert.equal(f.difficulty, 'Difficulty: Assisting');
    assert.equal(hud3d.formatHud({ score: 0, lives: 3, mode: 'joystick' }).difficulty, '');
    hud3d.drawTargetBrackets(ctx2d, { x: 10, y: 10, scale: 1 }, 20);
    hud3d.drawTargetBrackets(ctx2d, null, 20);
    hud3d.drawLeadMarker(ctx2d, { x: 10, y: 10 });
    hud3d.drawHitMarker(ctx2d, 800, 400, 0.5);
});

test('sound and vibration: game events reach audio3d / haptics3d; gestures unlock audio; pause stops loops', async () => {
    const fx = fakeEffects();
    const env = await boot({ storage: JOY, start: fx.start });
    const g = () => env.win.__spaceAdventure.game3d;
    assert.ok(fx.made.audio.settings && fx.made.audio.range > 0, 'built with the settings and the view distance');
    assert.equal(typeof fx.made.haptics.usingController, 'function');
    assert.equal(fx.made.haptics.nav, env.win.navigator);
    await play(env);
    env.win.fire('keydown', { code: 'KeyX', repeat: false, preventDefault() {} }); // a gesture (the fake DOM has no bubbling to the root)
    assert.ok(fx.calls.some((c) => c[0] === 'unlock'));
    env.el('p3-fire').pointer('pointerdown');
    for (let i = 0; i < 60 && !fx.names('explosion').length; i++) env.frames(1);
    assert.ok(g().hitMarker > 0, 'hit marker on a hit');
    env.frames(20);
    env.el('p3-fire').pointer('pointerup');
    assert.ok(fx.names('play').includes('shoot'));
    assert.ok(fx.names('explosion').includes('large'), 'the large rock split');
    assert.ok(fx.names('haptic').includes('rockDestroyed'));
    assert.ok(env.debris.length > 0 && env.debris[0].color, 'debris in the palette colour');
    assert.equal(env.debris[0].size, 'large');
    assert.ok(g().particles > 0);
    assert.ok(fx.names('update').length > 0, 'music mood every frame');
    env.el('p3-thrust').pointer('pointerdown');
    env.frames(2);
    assert.ok(fx.calls.some((c) => c[0] === 'thrust' && c[1] === true));
    env.el('p3-pause').click();
    assert.ok(fx.calls.some((c) => c[0] === 'stopAll'));
    assert.ok(fx.calls.some((c) => c[0] === 'hapticStop'));
    pick(env, 'quit');
    setSetting(env, 'viewDistance3d', 'normal');
    assert.ok(fx.calls.some((c) => c[0] === 'setRange'));
});

test('no Web Audio (unit tests, old browsers): the game runs silently', async () => {
    const env = await boot({});
    const g = () => env.win.__spaceAdventure.game3d;
    assert.equal(g().audio, null);
    await play(env);
    env.frames(10);
    assert.ok(g().steps > 0);
});

test('graphics context loss: pause, rebuild on restore; no restore: ask (Retry / Switch to 2D); 3 losses: back to 2D', async () => {
    const env = await boot({ storage: JOY });
    const g = () => env.win.__spaceAdventure.game3d;
    await play(env);
    env.frames(5);
    let prevented = false;
    env.el('p3-canvas').fire('webglcontextlost', { preventDefault() { prevented = true; } });
    assert.ok(prevented, 'preventDefault: the browser may restore it');
    assert.equal(g().screen, 'paused');
    assert.match(g().message, /Graphics reset/);
    assert.equal(g().contextLoss.lost, true);
    assert.equal(g().ui.screen, 'prompt', 'the message as a prompt over the pause menu');
    assert.match(g().ui.view.text, /Graphics reset/);
    env.ui.select(); // OK
    assert.equal(g().ui.screen, 'pause');
    env.el('p3-canvas').fire('webglcontextrestored');
    assert.equal(env.renderers.length, 2, 'renderer rebuilt');
    assert.equal(env.renderers[0].disposed, true);
    assert.equal(g().contextLoss.lost, false);
    // Lost again and not restored: after 10 s of visible time a prompt asks; nothing navigates
    env.ui.select(); // Resume on the pause menu
    env.el('p3-canvas').fire('webglcontextlost', { preventDefault() {} });
    env.ui.select(); // OK on the message: the pause menu stays
    env.frames(300, 20); // 6 s
    assert.equal(g().ui.screen, 'pause');
    env.doc.hidden = true; // a backgrounded tab: its time doesn't count
    env.frames(500, 20);
    env.doc.hidden = false;
    assert.equal(g().ui.screen, 'pause');
    env.frames(250, 20); // 5 s more visible
    assert.equal(g().ui.screen, 'prompt');
    assert.deepEqual(g().ui.view.buttons, ['retry', 'switch']);
    assert.equal(env.win.location.replaced, undefined, 'no automatic switch');
    let restores = 0;
    env.renderers.at(-1).forceRestore = () => { restores++; };
    pick(env, 'prompt-retry');
    await tick();
    assert.equal(restores, 1, 'Retry asks the browser to restore it');
    env.frames(520, 20);
    assert.equal(g().ui.screen, 'prompt', 'asked again after another wait');
    pick(env, 'prompt-switch');
    await tick();
    assert.equal(env.win.location.replaced, './?2d=1');
    // Lost 3 times within a minute: the graphics are failing, back to 2D by itself
    const env2 = await boot({ storage: JOY });
    await play(env2);
    for (let i = 0; i < 3; i++) {
        env2.el('p3-canvas').fire('webglcontextlost', { preventDefault() {} });
        env2.el('p3-canvas').fire('webglcontextrestored');
        env2.frames(5);
    }
    assert.equal(env2.win.__spaceAdventure.game3d.contextLoss.gaveUp, true);
    assert.match(env2.win.__spaceAdventure.game3d.message, /Switched to the 2D game/);
    env2.frames(200, 20);
    assert.equal(env2.win.location.replaced, './?2d=1');
});

test('slow device: still slow at the lowest render scale offers 2D; Stay keeps 3D, Switch opens 2D', async () => {
    const env = await boot({ storage: JOY });
    const g = () => env.win.__spaceAdventure.game3d;
    await play(env);
    env.frames(400, 60); // about 16 fps for 24 s
    assert.equal(g().renderScale, 0.5);
    assert.equal(g().perf.decision, 'offer-2d');
    assert.equal(g().perf.prompt, true);
    assert.equal(g().screen, 'paused');
    assert.equal(g().ui.screen, 'prompt');
    assert.deepEqual(g().ui.view.buttons, ['yes', 'no']);
    assert.equal(g().ui.view.text, 'Switch to 2D?');
    pick(env, 'prompt-no'); // Stay in 3D: no more offers
    await tick();
    assert.equal(g().perf.decision, 'ok');
    assert.equal(g().perf.prompt, false);
    assert.equal(g().ui.screen, 'pause');
    assert.equal(env.win.location.replaced, undefined);
});

test('slow device: Switch to 2D in the offer opens the 2D game', async () => {
    const env = await boot({ storage: JOY });
    const g = () => env.win.__spaceAdventure.game3d;
    await play(env);
    env.frames(400, 60);
    assert.equal(g().ui.screen, 'prompt');
    pick(env, 'prompt-yes');
    await tick();
    assert.equal(env.win.location.replaced, './?2d=1');
});

const startJoystick = async (env) => {
    await play(env);
};

test('layout3d=ufo: a UFO ahead on the radar and in the hook; shooting it scores 200', async () => {
    const fx = fakeEffects();
    const env = await boot({ storage: JOY, search: '?3d=1&seed3d=1&layout3d=ufo', start: fx.start });
    const g = () => env.win.__spaceAdventure.game3d;
    await startJoystick(env);
    env.frames(2);
    assert.equal(g().ufos.length, 1);
    assert.equal(g().ufos[0].dist, 400);
    const blip = g().radar.front.find((b) => b.type === 'saucer');
    assert.ok(blip && Math.abs(blip.x) < 1e-3, JSON.stringify(g().radar.front));
    assert.equal(g().target.dist, 400, 'the UFO gets the brackets');
    env.el('p3-fire').pointer('pointerdown');
    env.frames(40);
    env.el('p3-fire').pointer('pointerup');
    assert.equal(g().ufos.length, 0);
    assert.equal(g().score, 200);
    assert.equal(g().stats.ufosShot, 1);
    assert.ok(fx.names('play').includes('ufoExplode'));
});

test('layout3d=boss: boss in the hook and on the radar; one shot at the core after the entry defeats it; then level 3', async () => {
    const fx = fakeEffects();
    const env = await boot({ storage: JOY, search: '?3d=1&seed3d=1&layout3d=boss', start: fx.start });
    const g = () => env.win.__spaceAdventure.game3d;
    assert.equal(g().level, 2);
    assert.equal(g().boss.phase, 'entering');
    assert.ok(g().boss.dist > 600 && g().boss.dist < 800);
    await startJoystick(env);
    env.frames(2);
    assert.ok([...g().radar.front, ...g().radar.rear].some((b) => b.type === 'boss'));
    env.frames(200); // the 3 s entry
    assert.equal(g().boss.phase, 'fighting');
    env.el('p3-fire').pointer('pointerdown');
    for (let i = 0; i < 120 && g().stats.bosses === 0; i++) env.frames(1);
    env.el('p3-fire').pointer('pointerup');
    assert.equal(g().stats.bosses, 1);
    assert.ok(fx.names('haptic').includes('bossDefeated'));
    assert.ok(g().powerUps.length >= 1, 'the boss drops power-ups');
    env.frames(150);
    assert.equal(g().boss, null);
    assert.equal(g().level, 3);
});

test('layout3d=powerup: fly into it for triple shot (HUD effect), then three bullets a shot; hyperspace by H and the button', async () => {
    const env = await boot({ storage: JOY, search: '?3d=1&seed3d=1&layout3d=powerup' });
    const g = () => env.win.__spaceAdventure.game3d;
    await startJoystick(env);
    env.frames(2);
    assert.equal(g().powerUps.length, 1);
    assert.equal(g().powerUps[0].type, 'triple_shot');
    env.el('p3-thrust').pointer('pointerdown');
    for (let i = 0; i < 120 && !g().effects.triple_shot; i++) env.frames(1);
    env.el('p3-thrust').pointer('pointerup');
    assert.ok(g().effects.triple_shot > 9, JSON.stringify(g().effects));
    assert.equal(g().powerUps.length, 0);
    env.el('p3-fire').pointer('pointerdown');
    env.frames(2);
    env.el('p3-fire').pointer('pointerup');
    assert.equal(g().counts.bullets, 3);
    // Hyperspace: H, then the button is on cooldown
    assert.equal(g().hyperspace.ready, true);
    env.win.fire('keydown', { code: 'KeyH', repeat: false, preventDefault() {} });
    env.frames(2);
    assert.equal(g().hyperspace.jumps, 1);
    if (g().shipAlive) {
        assert.equal(g().hyperspace.ready, false);
        assert.equal(env.el('p3-hyper').classList.contains('p3-cool'), true);
        assert.equal(env.el('p3-hyper').textContent, '5');
        env.el('p3-hyper').pointer('pointerdown');
        env.frames(2);
        assert.equal(g().hyperspace.jumps, 1, 'not ready: no jump');
    }
});

test('HUD: power-up chips with timer bars, boss bar, radar glyphs for the new types', () => {
    const chips = hud3d.chipLayout([{ kind: 'shield', left: 3, max: 6 }, { kind: 'magnet', left: 10, max: 10 }], 12, 60);
    assert.deepEqual(chips.map((c) => [c.kind, c.x, c.fill]), [['shield', 12, 0.5], ['magnet', 58, 1]]);
    assert.equal(hud3d.CHIP_STYLE.shield.label, 'S');
    hud3d.drawPowerUpChips(ctx2d, [{ kind: 'triple_shot', left: 1, max: 10 }], 0, 0);
    hud3d.drawBossBar(ctx2d, 800, 400, { health: 10, maxHealth: 100, phase: 'fighting' });
    hud3d.drawBossBar(ctx2d, 800, 400, null);
    const layout = { r: 40, front: { cx: 100, cy: 100 }, rear: { cx: 100, cy: 200 }, label: 'left' };
    const blips = ['saucer', 'boss', 'powerup', 'shot'].map((type, i) => ({ id: i, type, x: 0, y: 0, dist: 100, near: 0.5, threat: type === 'shot', beyond: false }));
    hud3d.drawRadar(ctx2d, layout, { front: blips, rear: [] }, { collect: '#0f0', hazard: '#f00', ufo: '#a0f' }, 0);
});

test('layout3d=doom: the crystal at the ship is collected, the red rock ends the game within about 2 s; Esc pauses', async () => {
    const env = await boot({ storage: JOY, search: '?3d=1&seed3d=1&layout3d=doom' });
    const g = () => env.win.__spaceAdventure.game3d;
    assert.equal(g().lives, 1);
    await startJoystick(env);
    env.frames(3);
    assert.ok(g().score > 0, 'collected at once');
    env.doc.key('Escape');
    assert.equal(g().screen, 'paused');
    assert.equal(g().ui.screen, 'pause');
    env.doc.key('KeyP', 'p'); // P resumes, as it paused
    assert.equal(g().screen, 'playing');
    assert.equal(g().ui.visible, false);
    for (let i = 0; i < 200 && !g().over; i++) env.frames(1);
    assert.equal(g().over, true);
    assert.ok(g().time < 2.6, `over at ${g().time} s`);
    assert.equal(g().screen, 'over');
    assert.equal(g().ui.screen, 'gameOver');
    assert.equal(g().ui.view.score, g().score);
});

// --- Phase 4 and 5 wiring: menus, progress, tutorial, settings

test('menus: the name screen first; a named pilot gets the menu with the version; the hook carries ui and user', async () => {
    const env = await boot({});
    const g = () => env.win.__spaceAdventure.game3d;
    assert.equal(g().ui.screen, 'profile');
    assert.equal(g().screen, 'menu');
    assert.equal(g().user, null);
    assert.equal(g().updateSafe, true, 'a service-worker update may apply on the name screen');
    const named = await boot({ storage: PILOT() });
    const h = () => named.win.__spaceAdventure.game3d;
    assert.equal(h().ui.screen, 'menu');
    assert.equal(h().user, 'ANN');
    assert.match(h().ui.view.version, /^sa-[0-9a-f]{12}$/);
    assert.equal(h().tutorial.active, false);
});

test('game over through the UI: score, rank on the 3D board, credits from the 2D rule; Play again', async () => {
    const env = await boot({ storage: { ...JOY, ...PILOT(), spaceAdventure_offerTutorial: 'false' }, search: '?3d=1&seed3d=1&layout3d=doom' });
    const g = () => env.win.__spaceAdventure.game3d;
    await play(env);
    assert.equal(g().screen, 'playing');
    env.frames(3);
    assert.ok(g().credits > 0, 'ceil(10 % of the points) while playing');
    for (let i = 0; i < 200 && !g().over; i++) env.frames(1);
    assert.equal(g().ui.screen, 'gameOver');
    assert.equal(g().ui.view.rank, 0);
    assert.equal(g().ui.view.newHigh, true);
    assert.equal(g().ui.view.credits, g().credits);
    const board = JSON.parse(env.storage.getItem('asteroids_highScores3d_ANN'));
    assert.equal(board[0].score, g().score);
    assert.equal(g().updateSafe, true);
    pick(env, 'again');
    assert.equal(g().screen, 'playing');
    assert.equal(g().over, false);
    assert.equal(g().updateSafe, false, 'no update during a run');
});

test('upgrades reach the game: thrust, lives and pickup radius in the sim, turn speed in the look (not Direct)', async () => {
    const upgrades = JSON.stringify({ levels: { turnSpeed: 2, startingLives: 1 }, currency: 0 });
    const env = await boot({ storage: { ...JOY, ...PILOT(), spaceAdventure_offerTutorial: 'false', asteroids_upgrades_ANN: upgrades } });
    const g = () => env.win.__spaceAdventure.game3d;
    await play(env);
    assert.ok(Math.abs(g().turnRateMult - 1.2) < 1e-9, `turn ${g().turnRateMult}`);
    assert.equal(g().lives, 4, 'Medium 3 + the Starting Lives upgrade');
    // Joystick at full deflection turns 20 % faster than without the upgrade
    const zone = env.el('p3-stick-zone');
    zone.pointer('pointerdown', { clientX: 100, clientY: 300 });
    zone.pointer('pointermove', { clientX: 164, clientY: 300 });
    env.frames(10);
    const fast = Math.abs(g().yaw);
    const base = await boot({ storage: { ...JOY, ...PILOT(), spaceAdventure_offerTutorial: 'false' } });
    await play(base);
    const z2 = base.el('p3-stick-zone');
    z2.pointer('pointerdown', { clientX: 100, clientY: 300 });
    z2.pointer('pointermove', { clientX: 164, clientY: 300 });
    base.frames(10);
    const slow = Math.abs(base.win.__spaceAdventure.game3d.yaw);
    assert.ok(Math.abs(fast / slow - 1.2) < 0.02, `${fast} / ${slow}`);
});

test('tutorial: offered to a new pilot, runs in a quiet world with its steps; Skip records it and starts level 1', async () => {
    const env = await boot({ storage: { ...JOY, ...PILOT() }, search: '?3d=1&seed3d=1' });
    const g = () => env.win.__spaceAdventure.game3d;
    gesture(env);
    pick(env, 'play');
    assert.equal(g().ui.screen, 'tutorial');
    pick(env, 'tutorial-yes');
    await tick();
    assert.equal(g().screen, 'playing');
    assert.deepEqual([g().tutorial.active, g().tutorial.step], [true, 'look']);
    assert.equal(g().lives, 99, 'no lives lost in training');
    assert.equal(g().levels, false);
    // Look: turn with the stick until the step is done
    const zone = env.el('p3-stick-zone');
    zone.pointer('pointerdown', { clientX: 100, clientY: 300 });
    zone.pointer('pointermove', { clientX: 164, clientY: 300 });
    for (let i = 0; i < 200 && g().tutorial.step === 'look'; i++) env.frames(1);
    zone.pointer('pointerup');
    assert.equal(g().tutorial.step, 'thrust');
    assert.equal(env.el('p3-thrust').classList.contains('p3-hl'), true, 'Thrust pulses');
    env.el('p3-thrust').pointer('pointerdown');
    for (let i = 0; i < 200 && g().tutorial.step === 'thrust'; i++) env.frames(1);
    env.el('p3-thrust').pointer('pointerup');
    assert.equal(g().tutorial.step, 'collect');
    assert.equal(g().counts.green, 1, 'a crystal to collect');
    assert.equal(g().score, 0);
    env.el('p3-skip').click();
    assert.equal(g().tutorial.active, false);
    assert.equal(g().tutorial.finished, false, 'a new game resets it');
    assert.equal(g().levels, true, 'level 1 of a real game');
    assert.equal(g().level, 1);
    const rec = JSON.parse([...env.storage.map.entries()].find(([k]) => k.startsWith('asteroids_tutorial3d'))[1]);
    assert.equal(rec.done, true);
    assert.equal(rec.skipped, true);
});

test('settings apply live: invert, field of view, left-handed layout (radar to the left), vignette in fast turns', async () => {
    const env = await boot({ storage: { ...JOY, ...PILOT(), spaceAdventure_offerTutorial: 'false' } });
    const g = () => env.win.__spaceAdventure.game3d;
    assert.equal(env.renderers[0].fovSet, 70, 'the renderer gets the setting at start');
    setSetting(env, 'fov3d', 85);
    assert.equal(env.renderers[0].fovSet, 85);
    setSetting(env, 'invert3d', true);
    setSetting(env, 'leftHanded3d', true);
    assert.equal(g().leftHanded, true);
    assert.ok(g().radar.layout.front.cx < 892 / 2, 'radar on the left');
    assert.equal(g().radar.layout.label, 'right');
    await play(env);
    assert.equal(g().invert, true);
    // Stick down with invert: the nose goes up
    const zone = env.el('p3-stick-zone');
    zone.pointer('pointerdown', { clientX: 600, clientY: 200 });
    zone.pointer('pointermove', { clientX: 600, clientY: 264 });
    env.frames(30);
    assert.ok(g().pitch > 5, `inverted: ${g().pitch}`);
    // Fast turn: the vignette darkens the edges
    zone.pointer('pointermove', { clientX: 664, clientY: 200 });
    env.frames(30);
    assert.ok(g().vignette > 0.2, `vignette ${g().vignette}`);
    zone.pointer('pointerup');
    env.el('p3-pause').click();
    setSetting(env, 'vignette3d', false);
    pick(env, 'resume');
    zone.pointer('pointerdown', { clientX: 600, clientY: 200 });
    zone.pointer('pointermove', { clientX: 664, clientY: 200 });
    env.frames(60);
    assert.ok(g().vignette < 0.01, 'off');
});

test('controller in the menus: D-pad moves the focus, Ⓐ selects, Ⓑ goes back; motion is then asked with a prompt', async () => {
    const env = await boot({ permission: 'granted', storage: { ...PILOT(), spaceAdventure_offerTutorial: 'false' } });
    const g = () => env.win.__spaceAdventure.game3d;
    const buttons = Array.from({ length: 17 }, () => ({ pressed: false, value: 0 }));
    const gp = { connected: true, axes: [0, 0, 0, 0], buttons };
    env.win.navigator.getGamepads = () => [gp];
    const press = (i) => { buttons[i].pressed = true; env.frames(1); buttons[i].pressed = false; env.frames(1); };
    env.frames(1);
    assert.equal(g().ui.focus, 'play');
    press(13); // D-pad down
    assert.equal(g().ui.focus, 'settings');
    press(0); // Ⓐ
    assert.equal(g().ui.screen, 'settings');
    press(1); // Ⓑ
    assert.equal(g().ui.screen, 'menu');
    press(12); // up
    assert.equal(g().ui.focus, 'play');
    press(0); // Play with Ⓐ: no tap, so Direct asks for motion access in a prompt (iPhone)
    assert.equal(g().ui.screen, 'prompt');
    assert.equal(g().ui.view.title, 'Motion');
    assert.equal(g().permission, 'unknown');
    press(0); // Allow
    await tick();
    assert.equal(g().permission, 'granted');
    assert.equal(g().screen, 'paused', 'the pause menu under the prompt');
    press(1); // Ⓑ on the pause menu resumes
    assert.equal(g().screen, 'playing');
});

test('HUD helpers: vignette strength, wrapped tutorial text, toast and tutorial box draw', () => {
    assert.equal(hud3d.vignetteAlpha(0), 0);
    assert.equal(hud3d.vignetteAlpha((60 * Math.PI) / 180), 0);
    assert.ok(Math.abs(hud3d.vignetteAlpha(Math.PI) - 0.55) < 1e-9);
    assert.deepEqual(hud3d.wrapText('one two three four', 9), ['one two', 'three', 'four']);
    hud3d.drawToast(ctx2d, 800, 400, { text: 'Achievement: Rookie', t: 2 });
    hud3d.drawTutorialBox(ctx2d, 800, 400, { title: 'Fly', body: 'Hold THRUST to fly forward', progress: { index: 1, count: 5, value: 0.5 } });
    hud3d.drawRadarPulse(ctx2d, { r: 40, front: { cx: 10, cy: 10 }, rear: { cx: 10, cy: 100 } }, 1);
    hud3d.drawVignette(ctx2d, 800, 400, 0.5);
});

test('layout3d=blocked: no rock left, a UFO beyond the view distance keeps the level going: it shows at any distance with an arrow', async () => {
    const env = await boot({ storage: JOY, search: '?3d=1&seed3d=1&layout3d=blocked' });
    const g = () => env.win.__spaceAdventure.game3d;
    await play(env);
    env.frames(2);
    assert.equal(g().rocksLeft, 0);
    assert.equal(g().ufos.length, 1);
    const far = g().ufos[0].dist;
    assert.ok(far > g().world.fogFar, `beyond the view distance: ${far}`);
    assert.equal(g().lastFew, true, 'treated like the last few rocks');
    const blip = [...g().radar.front, ...g().radar.rear].find((b) => b.type === 'saucer');
    assert.ok(blip, 'on the radar at any distance');
    assert.ok(g().markers.some((m) => m.type === 'saucer'), 'with an edge arrow');
    assert.equal(g().level, 1, 'still blocked');
});

// --- plan 07 compliance pass: platform and comfort

test('controller in play (plan §3): LT thrusts, RT fires, LB / RB roll, Ⓑ jumps, Start pauses', async () => {
    const env = await boot({ storage: { ...JOY, ...PILOT(), spaceAdventure_offerTutorial: 'false' } });
    const g = () => env.win.__spaceAdventure.game3d;
    await play(env);
    const buttons = Array.from({ length: 17 }, () => ({ pressed: false, value: 0 }));
    env.win.navigator.getGamepads = () => [{ connected: true, axes: [0, 0, 0, 0], buttons }];
    buttons[6].value = 1; // LT
    env.frames(30);
    buttons[6].value = 0;
    assert.ok(g().speed > 20, `thrust: ${g().speed}`);
    buttons[7].value = 1; // RT
    env.frames(5);
    buttons[7].value = 0;
    assert.ok(g().stats.shots > 0, 'fire');
    buttons[5].pressed = true; // RB
    env.frames(20);
    buttons[5].pressed = false;
    assert.ok(Math.abs(g().roll) > 5, `roll: ${g().roll}`);
    buttons[9].pressed = true; // Start
    env.frames(1);
    buttons[9].pressed = false;
    assert.equal(g().screen, 'paused');
});

test('colour-safe palette in 3D, Recentre only for Direct and Rate, the frame-rate line behind a setting', async () => {
    const env = await boot({ storage: { ...JOY, ...PILOT(), spaceAdventure_offerTutorial: 'false', spaceAdventure_palette: 'safe' } });
    const g = () => env.win.__spaceAdventure.game3d;
    assert.equal(env.renderers[0].palette, 'safe', 'rocks and crystals in the colour-safe colours');
    setSetting(env, 'palette', 'standard');
    assert.equal(env.renderers[0].palette, 'standard');
    await play(env);
    assert.equal(env.el('p3-recentre').classList.contains('p3-hidden'), true, 'Joystick: no Recentre');
    const f = hud3d.formatHud({ score: 0, lives: 3, mode: 'joystick', fps: 60 });
    assert.match(f.right, /60 fps/, 'still formatted for the debug line');
    env.el('p3-pause').click();
    setSetting(env, 'debug3d', true);
    assert.equal(env.storage.getItem('spaceAdventure_debug3d'), 'true');
});

test('desktop hint until the mouse is captured; landscape lock in an installed app, unlocked on Quit; reduced motion', async () => {
    const env = await boot({ storage: { ...JOY, ...PILOT(), spaceAdventure_offerTutorial: 'false' } });
    const g = () => env.win.__spaceAdventure.game3d;
    const locks = [];
    env.win.matchMedia = (q) => ({ matches: /display-mode: standalone/.test(q) });
    env.win.screen.orientation.lock = (o) => { locks.push(o); return Promise.resolve(); };
    env.win.screen.orientation.unlock = () => locks.push('unlock');
    await play(env);
    await tick();
    assert.deepEqual(locks, ['landscape']);
    assert.equal(g().orientationLocked, true);
    env.doc.key('KeyW', 'w'); // a key: desktop
    env.frames(1);
    assert.match(g().hint, /Click the view/);
    env.doc.pointerLockElement = env.doc.body.children.find((c) => c.id === 'proto3d');
    env.frames(1);
    assert.equal(g().hint, '');
    env.doc.pointerLockElement = null;
    env.el('p3-pause').click();
    pick(env, 'quit');
    assert.deepEqual(locks, ['landscape', 'unlock']);
    assert.equal(g().reducedMotion, false);
    const calm = fakeEnv({});
    calm.win.matchMedia = (q) => ({ matches: /reduced-motion/.test(q) });
    installStorage(JOY);
    await startGame3d({ win: calm.win, createRenderer: calm.fakeRenderer, persistence: new PersistenceManager() });
    assert.equal(calm.win.__spaceAdventure.game3d.reducedMotion, true);
});

test('iPhone in portrait: a hint to turn it sideways, also over the menus', async () => {
    const env = fakeEnv({});
    env.win.navigator.userAgent = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)';
    env.win.innerWidth = 412;
    env.win.innerHeight = 892;
    env.win.screen.orientation.angle = 0;
    installStorage();
    await startGame3d({ win: env.win, createRenderer: env.fakeRenderer, persistence: new PersistenceManager() });
    const g = env.win.__spaceAdventure.game3d;
    assert.equal(g.ui.visible, true);
    assert.match(g.rotateHint, /iPhone sideways/);
});

test('no WebGL 2: a message, then the 2D game', async () => {
    const env = fakeEnv({});
    installStorage();
    const r = await startGame3d({ win: env.win, createRenderer: () => { throw new Error('WebGL2 unavailable'); }, persistence: new PersistenceManager() });
    const g = () => env.win.__spaceAdventure.game3d;
    assert.equal(g().loaded, false);
    assert.match(g().error, /WebGL2/);
    assert.equal(g().ui.screen, 'prompt');
    assert.match(g().ui.view.text, /WebGL 2/);
    r.ui.select(); // Open 2D
    await tick();
    assert.equal(env.win.location.replaced, './?2d=1');
});

test('reduced motion reaches the renderer view (calmer shield and boss in meshes3d)', async () => {
    const env = fakeEnv({});
    env.win.matchMedia = (q) => ({ matches: /reduced-motion/.test(q) });
    installStorage(JOY);
    const views = [];
    const make = () => { const r = env.fakeRenderer(); r.render = (v) => views.push({ reducedMotion: v.reducedMotion, hyperspace: v.hyperspace }); return r; };
    await startGame3d({ win: env.win, createRenderer: make, persistence: new PersistenceManager() });
    env.frames(2);
    assert.equal(views.at(-1).reducedMotion, true);
    assert.equal(views.at(-1).hyperspace, null);
});
