// The 3D prototype entry (js/3d/proto3d.js) on a minimal fake DOM with a fake renderer:
// wiring of the start button, motion permission, control types, buttons and the test hook.
// The real WebGL path is covered by tests/integration/proto3d.spec.js (chromium-3d project).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startPrototype, basePixelRatio, nextRenderScale } from '../../js/3d/proto3d.js';
import { deviceQuat } from '../../js/3d/look.js';
import * as hud3d from '../../js/3d/hud3d.js';
import { qMul, qFromEulerYXZ, qToYawPitchRoll, qFromAxisAngle, DEG } from '../../js/3d/math3d.js';

function listeners() {
    const map = {};
    return {
        addEventListener(t, f) { (map[t] ||= []).push(f); },
        removeEventListener(t, f) { map[t] = (map[t] || []).filter((g) => g !== f); },
        fire(t, e = {}) { for (const f of map[t] || []) f(e); },
    };
}

function classList() {
    const s = new Set();
    return {
        add: (...c) => c.forEach((x) => s.add(x)),
        remove: (...c) => c.forEach((x) => s.delete(x)),
        toggle: (c, on) => { const v = on === undefined ? !s.has(c) : !!on; if (v) s.add(c); else s.delete(c); return v; },
        contains: (c) => s.has(c),
    };
}

const ctx2d = new Proxy({}, { get: (t, k) => (k in t ? t[k] : () => ({ addColorStop() {} })), set: (t, k, v) => { t[k] = v; return true; } });

function fakeEnv({ permission = null, screenAngle = 90, dpr = 3.5 } = {}) {
    const byId = new Map();
    const makeEl = (id = '') => {
        const l = listeners();
        const el = {
            id, style: {}, attrs: {}, textContent: '', disabled: false, width: 0, height: 0,
            classList: classList(),
            ...l,
            setAttribute(k, v) { this.attrs[k] = String(v); },
            getAttribute(k) { return this.attrs[k]; },
            setPointerCapture() {}, requestPointerLock() {},
            getContext(kind) { return kind === '2d' ? ctx2d : null; },
            querySelector(sel) { return byId.get(sel.replace(/^#/, '')) || null; },
            querySelectorAll() { return []; },
            appendChild() {},
            click() { l.fire('click', { target: el, preventDefault() {} }); },
            pointer(type, e = {}) { l.fire(type, { target: el, pointerId: 1, pointerType: 'touch', clientX: 0, clientY: 0, button: 0, preventDefault() {}, ...e }); },
        };
        Object.defineProperty(el, 'innerHTML', {
            set(html) { for (const m of html.matchAll(/id="([^"]+)"/g)) byId.set(m[1], makeEl(m[1])); },
        });
        return el;
    };
    const docL = listeners();
    const doc = {
        ...docL, hidden: false, visibilityState: 'visible', pointerLockElement: null,
        head: { appendChild() {} },
        body: { classList: classList(), appendChild() {} },
        createElement: () => makeEl(),
        exitPointerLock() {},
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

async function boot(opts = {}) {
    globalThis.localStorage = undefined;
    const env = fakeEnv(opts);
    if (opts.search) {
        env.win.location.search = opts.search;
        env.win.location.href = 'http://x/' + opts.search;
    }
    await startPrototype({ win: env.win, createRenderer: env.fakeRenderer, ...(opts.start || {}) });
    return env;
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
    assert.equal(env.el('p3-start').textContent, 'Enable motion & start');
    env.el('p3-start').click();
    await tick();
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
    env.el('p3-start').click();
    await tick();
    env.orient(0, 0, -90);
    env.frames(3);
    assert.equal(g().permission, 'denied');
    assert.equal(g().chosenMode, 'direct');
    assert.equal(g().mode, 'joystick');
    assert.match(g().message, /denied/);
});

test('joystick mode: drag rotates, roll buttons roll, thrust moves, fire splits the red ahead', async () => {
    const env = await boot({});
    const g = () => env.win.__spaceAdventure.game3d;
    env.el('p3-mode-joystick').click();
    env.el('p3-start').click();
    await tick();
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
    // Pause and Back to 2D
    env.el('p3-pause').click();
    assert.equal(g().screen, 'paused');
    env.el('p3-back2d').click();
    assert.equal(env.win.location.replaced, 'http://x/');
});

test('rate mode integrates the tilt; no sensor data falls back to Joystick', async () => {
    const env = await boot({});
    const g = () => env.win.__spaceAdventure.game3d;
    env.el('p3-mode-rate').click();
    await tick();
    env.el('p3-start').click();
    await tick();
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
    env.el('p3-start').click(); // no tick: begins synchronously inside the click
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
    env.el('p3-start').click();
    await tick();
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

test('view distance: Far by default; choosing one regenerates the world and shows in the HUD footer', async () => {
    const env = await boot({});
    const g = () => env.win.__spaceAdventure.game3d;
    assert.equal(g().viewDistance, 'far');
    assert.equal(g().world.size, 3200);
    assert.equal(env.el('p3-view-far').getAttribute('aria-pressed'), 'true');
    assert.equal(env.worlds.at(-1).size, 3200, 'renderer told the world size');
    env.el('p3-start').click();
    await tick();
    env.frames(5);
    env.el('p3-pause').click();
    assert.equal(g().screen, 'paused');
    const t = g().time;
    env.el('p3-view-veryfar').click();
    assert.equal(g().viewDistance, 'veryfar');
    assert.equal(g().world.size, 4200);
    assert.equal(env.worlds.at(-1).fogFar, 1870);
    assert.equal(g().screen, 'menu', 'a new field: Start begins afresh');
    assert.ok(g().time < t, 'new simulation');
    assert.equal(env.el('p3-view-veryfar').getAttribute('aria-pressed'), 'true');
    assert.equal(env.el('p3-view-far').getAttribute('aria-pressed'), 'false');
    assert.equal(env.el('p3-start').textContent, 'Tap to start');
    // layout3d=range keeps its two test rocks in every world
    assert.deepEqual(g().counts, { green: 1, red: 1, rocks: 2, bullets: 0, left: 2, incoming: 0, incomingLeft: 0 });
    assert.equal(g().levels, false, 'test layouts have no levels: the field stays as placed');
    const f = hud3d.formatHud({ score: 0, lives: 3, mode: 'direct', view: 'Very far', fps: 60, renderScale: 1 });
    assert.match(f.right, /View Very far · 60 fps/);
});

test('the cockpit frame is gone from the HUD', () => {
    assert.equal(hud3d.drawCockpit, undefined);
});

test('radar hook: layout3d=range puts the red rock at the front centre and the crystal at the rear centre', async () => {
    const env = await boot({});
    const g = () => env.win.__spaceAdventure.game3d;
    env.el('p3-mode-joystick').click();
    env.el('p3-start').click();
    await tick();
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
    globalThis.localStorage = undefined;
    const env = fakeEnv({});
    env.win.location.search = '?3d=1&seed3d=2';
    env.win.location.href = 'http://x/?3d=1&seed3d=2';
    const sounds = [];
    await startPrototype({ win: env.win, createRenderer: env.fakeRenderer, onSound: (n) => sounds.push(n) });
    const g = () => env.win.__spaceAdventure.game3d;
    assert.equal(g().levels, true);
    assert.equal(g().level, 1);
    assert.equal(g().banner, 'LEVEL 1');
    assert.ok(g().rocksLeft > 30 && g().incomingLeft > 0, JSON.stringify([g().rocksLeft, g().incomingLeft]));
    assert.equal(g().rocksLeft, g().counts.rocks + g().incomingLeft);
    assert.equal(g().lives, 3);
    assert.equal(g().lastFew, false);
    assert.deepEqual(g().markers, []);
    env.el('p3-mode-joystick').click();
    env.el('p3-start').click();
    await tick();
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
        const env = await boot({});
        const g = () => env.win.__spaceAdventure.game3d;
        env.el('p3-mode-joystick').click();
        env.el('p3-start').click();
        await tick();
        env.frames(1, ms);
        env.frames(30, ms);
        assert.equal(g().steps, 30, `${ms} ms frames`);
    }
});

test('difficulty row: Medium by default, the shared setting, a new game with the difficulty\'s lives', async () => {
    const env = await boot({});
    const g = () => env.win.__spaceAdventure.game3d;
    assert.equal(g().difficulty, 'medium');
    assert.equal(env.el('p3-diff-medium').getAttribute('aria-pressed'), 'true');
    env.el('p3-diff-hard').click();
    assert.equal(g().difficulty, 'hard');
    assert.equal(g().lives, 2);
    assert.equal(env.el('p3-diff-hard').getAttribute('aria-pressed'), 'true');
    assert.equal(env.el('p3-diff-medium').getAttribute('aria-pressed'), 'false');
    // During a game: back to the menu with a new game
    env.el('p3-start').click();
    await tick();
    env.frames(5);
    env.el('p3-pause').click();
    env.el('p3-diff-easy').click();
    assert.equal(g().screen, 'menu');
    assert.equal(g().lives, 4);
    assert.match(env.el('p3-status').textContent, /Difficulty: Easy/);
});

test('adaptive difficulty and aids in the hook: Balanced at the start, the rock ahead bracketed', async () => {
    const env = await boot({});
    const g = () => env.win.__spaceAdventure.game3d;
    assert.equal(g().adjustment.text, 'Balanced');
    assert.equal(g().adjustment.level, 'balanced');
    assert.deepEqual(g().adjustment.dda, {
        asteroidSpeedMod: 1, ufoSpawnMod: 1, ufoAccuracyMod: 1, powerUpSpawnMod: 1, greenRatioMod: 1, extraLifeThresholdMod: 1,
    });
    assert.equal(g().assist.aimDeg, 2);
    assert.equal(g().assist.crystalArrow, 'offscreen');
    env.el('p3-mode-joystick').click();
    env.el('p3-start').click();
    await tick();
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
    const env = await boot({ start: fx.start });
    const g = () => env.win.__spaceAdventure.game3d;
    assert.ok(fx.made.audio.settings && fx.made.audio.range > 0, 'built with the settings and the view distance');
    assert.equal(typeof fx.made.haptics.usingController, 'function');
    assert.equal(fx.made.haptics.nav, env.win.navigator);
    env.el('p3-mode-joystick').click();
    env.el('p3-start').click();
    await tick();
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
    env.el('p3-view-normal').click();
    assert.ok(fx.calls.some((c) => c[0] === 'setRange'));
});

test('no Web Audio (unit tests, old browsers): the game runs silently', async () => {
    const env = await boot({});
    const g = () => env.win.__spaceAdventure.game3d;
    assert.equal(g().audio, null);
    env.el('p3-start').click();
    await tick();
    env.frames(10);
    assert.ok(g().steps > 0);
});

test('graphics context loss: pause, rebuild on restore; no restore in time: back to 2D with a message', async () => {
    const env = await boot({});
    const g = () => env.win.__spaceAdventure.game3d;
    env.el('p3-mode-joystick').click();
    env.el('p3-start').click();
    await tick();
    env.frames(5);
    let prevented = false;
    env.el('p3-canvas').fire('webglcontextlost', { preventDefault() { prevented = true; } });
    assert.ok(prevented, 'preventDefault: the browser may restore it');
    assert.equal(g().screen, 'paused');
    assert.match(g().message, /Graphics reset/);
    assert.equal(g().contextLoss.lost, true);
    env.el('p3-canvas').fire('webglcontextrestored');
    assert.equal(env.renderers.length, 2, 'renderer rebuilt');
    assert.equal(env.renderers[0].disposed, true);
    assert.equal(g().contextLoss.lost, false);
    // Lost again and never restored: after 3 s, the message, then the 2D game
    env.el('p3-canvas').fire('webglcontextlost', { preventDefault() {} });
    env.frames(400, 20);
    assert.equal(g().contextLoss.gaveUp, true);
    assert.match(g().message, /Switched to the 2D game/);
    assert.equal(env.win.location.replaced, './?2d=1');
});

test('slow device: still slow at the lowest render scale offers 2D; Stay keeps 3D, Switch opens 2D', async () => {
    const env = await boot({});
    const g = () => env.win.__spaceAdventure.game3d;
    env.el('p3-mode-joystick').click();
    env.el('p3-start').click();
    await tick();
    env.frames(400, 60); // about 16 fps for 24 s
    assert.equal(g().renderScale, 0.5);
    assert.equal(g().perf.decision, 'offer-2d');
    assert.equal(g().perf.prompt, true);
    assert.equal(g().screen, 'paused');
    assert.equal(env.el('p3-perf').classList.contains('p3-hidden'), false);
    env.el('p3-perf-stay').click();
    assert.equal(env.el('p3-perf').classList.contains('p3-hidden'), true);
    assert.equal(g().perf.decision, 'ok');
    env.el('p3-perf-switch').click();
    assert.equal(env.win.location.replaced, './?2d=1');
});
