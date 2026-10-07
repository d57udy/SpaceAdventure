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
    const fakeRenderer = () => ({ three: 'fake', drawCalls: 7, setSize() {}, render() {}, burst() {}, probeLitPixels: () => ({ lit: 1 }), setWorld(w) { worlds.push(w); } });
    return { win, doc, byId, frames, orient, fakeRenderer, worlds, el: (id) => byId.get(id) };
}

// Device angles for neutral ⊗ rel at a screen angle (inverse of deviceQuat)
function anglesFor(q, screen) {
    const e = qMul(qMul(q, qFromAxisAngle([0, 0, 1], screen * DEG)), [Math.SQRT1_2, 0, 0, Math.SQRT1_2]);
    const r = qToYawPitchRoll(e);
    return [r.yaw / DEG, r.pitch / DEG, -r.roll / DEG];
}

const tick = () => new Promise((r) => setTimeout(r, 0));

async function boot(opts) {
    globalThis.localStorage = undefined;
    const env = fakeEnv(opts);
    await startPrototype({ win: env.win, createRenderer: env.fakeRenderer });
    return env;
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
    assert.ok(g().score > 0);
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
    assert.deepEqual(g().counts, { green: 1, red: 1, rocks: 2, bullets: 0 });
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
