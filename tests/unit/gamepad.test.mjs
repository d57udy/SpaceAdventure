import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
    GP, GamepadPoller, radialDeadzone, controllerFamily, controllerName, buttonGlyph, mergePads,
    CONTEXT_MAPPINGS, RUMBLE_PATTERNS, TRIGGER_THRESHOLD, MENU_REPEAT_DELAY, MENU_REPEAT_INTERVAL,
} from '../../js/gamepad.js';

// A mutable fake controller in the standard mapping.
class FakePad {
    constructor(index = 0, id = 'Xbox Wireless Controller (STANDARD GAMEPAD Vendor: 045e Product: 0b13)', { rumble = true, mapping = 'standard' } = {}) {
        this.index = index;
        this.id = id;
        this.mapping = mapping;
        this.connected = true;
        this.buttons = Array.from({ length: 17 }, () => ({ pressed: false, value: 0 }));
        this.axes = [0, 0, 0, 0];
        this.effects = [];
        this.vibrationActuator = rumble ? { playEffect: (type, params) => { this.effects.push({ type, ...params }); return Promise.resolve('complete'); } } : null;
    }
    press(b, value = 1) { this.buttons[b] = { pressed: value > 0.5, value }; return this; }
    release(b) { this.buttons[b] = { pressed: false, value: 0 }; return this; }
    stick(x, y) { this.axes[0] = x; this.axes[1] = y; return this; }
}

function setup(pads = [new FakePad()]) {
    const env = { list: pads, t: 0 };
    const poller = new GamepadPoller({ getGamepads: () => env.list, now: () => env.t });
    return { env, poller, pad: pads[0] };
}

const only = (result, i = 0) => result.pads.find(p => p.index === i);

test('button constants follow the standard mapping', () => {
    assert.equal(GP.A, 0);
    assert.equal(GP.B, 1);
    assert.equal(GP.X, 2);
    assert.equal(GP.Y, 3);
    assert.equal(GP.LT, 6);
    assert.equal(GP.RT, 7);
    assert.equal(GP.VIEW, 8);
    assert.equal(GP.MENU, 9);
    assert.deepEqual([GP.UP, GP.DOWN, GP.LEFT, GP.RIGHT], [12, 13, 14, 15]);
    assert.equal(TRIGGER_THRESHOLD, 0.35);
    assert.equal(MENU_REPEAT_DELAY, 400);
    assert.equal(MENU_REPEAT_INTERVAL, 140);
});

test('radial deadzone', () => {
    assert.equal(radialDeadzone(0.1, 0).active, false);
    assert.equal(radialDeadzone(0.1, 0.1).active, false);
    const r = radialDeadzone(0.7, 0);
    assert.equal(r.active, true);
    assert.equal(r.angle, 0);
    assert.ok(Math.abs(r.magnitude - 0.647) < 0.01, `magnitude ${r.magnitude}`);
    const d = radialDeadzone(1, 1);
    assert.equal(d.magnitude, 1, 'diagonal clamped to 1');
    assert.ok(Math.abs(d.angle - Math.PI / 4) < 1e-9);
    const down = radialDeadzone(0, 1);
    assert.ok(Math.abs(down.angle - Math.PI / 2) < 1e-9, '+y is down like the canvas');
    assert.ok(Math.abs(Math.hypot(d.x, d.y) - 1) < 1e-9);
    assert.equal(radialDeadzone(NaN, undefined).active, false);
    // continuous just above the deadzone
    assert.ok(radialDeadzone(0.16, 0).magnitude < 0.02);
});

test('controller family and name from id', () => {
    assert.equal(controllerFamily('Xbox Wireless Controller (STANDARD GAMEPAD Vendor: 045e Product: 0b13)'), 'xbox');
    assert.equal(controllerFamily('045e-02fd-Xbox Wireless Controller'), 'xbox');
    assert.equal(controllerFamily('DualSense Wireless Controller (STANDARD GAMEPAD Vendor: 054c Product: 0ce6)'), 'playstation');
    assert.equal(controllerFamily('Wireless Controller (STANDARD GAMEPAD Vendor: 054c Product: 09cc)'), 'playstation');
    assert.equal(controllerFamily('054c-05c4-Wireless Controller'), 'playstation');
    assert.equal(controllerFamily('Pro Controller (STANDARD GAMEPAD Vendor: 057e Product: 2009)'), 'nintendo');
    assert.equal(controllerFamily('Joy-Con (L/R)'), 'nintendo');
    assert.equal(controllerFamily('8BitDo SN30 Pro'), 'generic');
    assert.equal(controllerFamily(undefined), 'generic');
    assert.equal(controllerName('Xbox Wireless Controller (STANDARD GAMEPAD Vendor: 045e Product: 0b13)'), 'Xbox Wireless Controller');
    assert.equal(controllerName(''), 'Controller');
});

test('button glyphs per family (Nintendo letters swapped)', () => {
    assert.equal(buttonGlyph('xbox', GP.A), 'A');
    assert.equal(buttonGlyph('playstation', GP.A), '✕');
    assert.equal(buttonGlyph('playstation', GP.B), '○');
    assert.equal(buttonGlyph('nintendo', GP.A), 'B');
    assert.equal(buttonGlyph('nintendo', GP.B), 'A');
    assert.equal(buttonGlyph('generic', GP.A), '●');
    assert.equal(buttonGlyph('xbox', GP.MENU), 'Start');
    assert.equal(buttonGlyph('unknown', GP.Y), '●');
});

test('a button held for 3 polls counts as pressed only once', () => {
    const { poller, pad } = setup();
    pad.press(GP.A);
    const r1 = only(poller.poll('game'));
    const r2 = only(poller.poll('game'));
    const r3 = only(poller.poll('game'));
    assert.ok(r1.pressed.has('fire'));
    assert.ok(!r2.pressed.has('fire'));
    assert.ok(!r3.pressed.has('fire'));
    for (const r of [r1, r2, r3]) assert.ok(r.held.has('fire'));
    pad.release(GP.A);
    const r4 = only(poller.poll('game'));
    assert.ok(!r4.held.has('fire'));
    pad.press(GP.A);
    assert.ok(only(poller.poll('game')).pressed.has('fire'), 'pressed again after release');
});

test('context mapping: A = fire in game, select in menu; B = hyperspace or back', () => {
    const { poller, pad } = setup();
    pad.press(GP.A);
    assert.ok(only(poller.poll('game')).pressed.has('fire'));
    pad.release(GP.A); poller.poll('menu');
    pad.press(GP.A);
    const m = only(poller.poll('menu'));
    assert.ok(m.pressed.has('menuSelect'));
    assert.ok(!m.held.has('fire'));
    pad.release(GP.A); poller.poll('game');
    pad.press(GP.B);
    assert.ok(only(poller.poll('game')).pressed.has('hyperspace'));
    pad.release(GP.B); poller.poll('menu');
    pad.press(GP.B);
    assert.ok(only(poller.poll('menu')).pressed.has('escape'));
});

test('full game mapping: triggers, D-pad, Start and View', () => {
    const { poller, pad } = setup();
    pad.press(GP.RT, 0.3);
    assert.ok(!only(poller.poll('game')).held.has('fire'), 'RT below 0.35 does nothing');
    pad.press(GP.RT, 0.4);
    assert.ok(only(poller.poll('game')).held.has('fire'), 'RT above 0.35 fires');
    pad.press(GP.LT, 0.5);
    assert.ok(only(poller.poll('game')).held.has('thrust'));
    pad.release(GP.LT).release(GP.RT);
    pad.press(GP.UP).press(GP.LEFT);
    let r = only(poller.poll('game'));
    assert.ok(r.held.has('thrust') && r.held.has('rotateLeft'));
    pad.release(GP.UP).release(GP.LEFT).press(GP.RIGHT).press(GP.DOWN);
    r = only(poller.poll('game'));
    assert.ok(r.held.has('rotateRight') && r.pressed.has('hyperspace'));
    pad.release(GP.RIGHT).release(GP.DOWN).press(GP.MENU).press(GP.VIEW);
    r = only(poller.poll('game'));
    assert.ok(r.pressed.has('pause') && r.pressed.has('skipTutorial'));
});

test('menu and pause mappings for Start, Y and View', () => {
    const { poller, pad } = setup();
    pad.press(GP.MENU);
    assert.ok(only(poller.poll('menu')).pressed.has('menuSelect'), 'Start selects on the menu');
    pad.release(GP.MENU); poller.poll('pause');
    pad.press(GP.MENU);
    assert.ok(only(poller.poll('pause')).pressed.has('pause'), 'Start resumes from pause');
    pad.release(GP.MENU).press(GP.Y);
    assert.ok(only(poller.poll('menu')).pressed.has('replayTutorial'));
    pad.release(GP.Y).press(GP.VIEW);
    assert.ok(only(poller.poll('menu')).pressed.has('toggleMute'));
    assert.ok(CONTEXT_MAPPINGS.game && CONTEXT_MAPPINGS.menu && CONTEXT_MAPPINGS.pause);
});

test('menu repeat: immediately, then after 400 ms, then every 140 ms', () => {
    const { env, poller, pad } = setup();
    pad.press(GP.DOWN);
    const times = [];
    for (env.t = 0; env.t <= 1000; env.t += 10) {
        if (only(poller.poll('menu')).pressed.has('menuDown')) times.push(env.t);
    }
    assert.deepEqual(times, [0, 400, 540, 680, 820, 960]);
    pad.release(GP.DOWN);
    env.t += 10;
    poller.poll('menu');
    pad.press(GP.DOWN);
    env.t += 10;
    assert.ok(only(poller.poll('menu')).pressed.has('menuDown'), 'release resets the repeat');
});

test('game actions do not auto-repeat', () => {
    const { env, poller, pad } = setup();
    pad.press(GP.B);
    let n = 0;
    for (env.t = 0; env.t <= 1000; env.t += 10) if (only(poller.poll('game')).pressed.has('hyperspace')) n++;
    assert.equal(n, 1);
});

test('stick navigates menus with hysteresis (on above 0.6, re-armed below 0.4)', () => {
    const { env, poller, pad } = setup();
    pad.stick(0, 0.5);
    assert.ok(!only(poller.poll('menu')).held.has('menuDown'), '0.5 is not enough');
    pad.stick(0, 0.7);
    assert.ok(only(poller.poll('menu')).pressed.has('menuDown'));
    pad.stick(0, 0.5);
    env.t += 10;
    let r = only(poller.poll('menu'));
    assert.ok(r.held.has('menuDown') && !r.pressed.has('menuDown'), 'still held at 0.5');
    pad.stick(0, 0.3);
    env.t += 10;
    assert.ok(!only(poller.poll('menu')).held.has('menuDown'), 'released below 0.4');
    pad.stick(0, 0.7);
    env.t += 10;
    assert.ok(only(poller.poll('menu')).pressed.has('menuDown'), 're-armed');
    pad.stick(-0.9, 0.2);
    env.t += 10;
    r = only(poller.poll('menu'));
    assert.ok(r.pressed.has('menuLeft'));
    pad.stick(0.3, -0.8);
    env.t += 10;
    r = only(poller.poll('menu'));
    assert.ok(r.pressed.has('menuUp'));
    assert.ok(!r.held.has('menuLeft'));
});

test('stick in game gives steering (angle and magnitude)', () => {
    const { poller, pad } = setup();
    pad.stick(1, 0);
    const r = only(poller.poll('game'));
    assert.equal(r.stick.active, true);
    assert.equal(r.stick.angle, 0);
    assert.equal(r.stick.magnitude, 1);
    assert.equal(r.held.size, 0, 'stick is not a button action in game');
    pad.stick(0.05, -0.05);
    assert.equal(only(poller.poll('game')).stick.active, false);
});

test('suppressed buttons block until released', () => {
    const { poller, pad } = setup();
    pad.press(GP.A);
    poller.poll('menu');
    poller.suppressHeld();
    let r = only(poller.poll('game'));
    assert.ok(!r.held.has('fire') && !r.pressed.has('fire'), 'the A that selected Start does not fire');
    r = only(poller.poll('game'));
    assert.ok(!r.held.has('fire'));
    pad.release(GP.A);
    poller.poll('game');
    pad.press(GP.A);
    assert.ok(only(poller.poll('game')).pressed.has('fire'));
});

test('suppressHeld also covers a held stick direction in menus', () => {
    const { poller, pad } = setup();
    pad.stick(0, 1);
    poller.poll('menu');
    poller.suppressHeld();
    assert.ok(!only(poller.poll('menu')).held.has('menuDown'));
    pad.stick(0, 0);
    poller.poll('menu');
    pad.stick(0, 1);
    assert.ok(only(poller.poll('menu')).pressed.has('menuDown'));
});

test('a button held across a context change is not a new press', () => {
    const { poller, pad } = setup();
    pad.press(GP.A);
    poller.poll('menu');
    const r = only(poller.poll('game'));
    assert.ok(r.held.has('fire'));
    assert.ok(!r.pressed.has('fire'));
});

test('connect and disconnect are detected by polling; null entries tolerated', () => {
    const a = new FakePad(0);
    const { env, poller } = setup([a]);
    let r = poller.poll('game');
    assert.deepEqual(r.connected.map(c => c.index), [0]);
    assert.equal(r.connected[0].mapping, 'standard');
    r = poller.poll('game');
    assert.equal(r.connected.length, 0);
    const b = new FakePad(2, 'DualSense Wireless Controller');
    env.list = [null, null, b, null];
    r = poller.poll('game');
    assert.deepEqual(r.disconnected.map(d => d.index), [0]);
    assert.deepEqual(r.connected.map(c => [c.index, c.family]), [[2, 'playstation']]);
    assert.equal(r.pads.length, 1);
    b.connected = false;
    r = poller.poll('game');
    assert.deepEqual(r.disconnected.map(d => d.index), [2]);
    assert.equal(r.pads.length, 0);
    assert.equal(r.activeIndex, null);
    env.list = null;
    assert.doesNotThrow(() => poller.poll('game'));
    const throwing = new GamepadPoller({ getGamepads: () => { throw new Error('SecurityError'); }, now: () => 0 });
    assert.deepEqual(throwing.poll('game').pads, []);
});

test('a different controller in the same slot counts as disconnect + connect', () => {
    const { env, poller } = setup([new FakePad(0, 'Xbox Wireless Controller')]);
    poller.poll('game');
    env.list = [new FakePad(0, 'DualSense Wireless Controller')];
    const r = poller.poll('game');
    assert.equal(r.disconnected.length, 1);
    assert.equal(r.connected.length, 1);
    assert.equal(r.pads[0].family, 'playstation');
});

test('per-pad results for multiplayer: each controller reported separately', () => {
    const p0 = new FakePad(0);
    const p1 = new FakePad(1, 'DualSense Wireless Controller');
    const { poller } = setup([p0, p1]);
    p0.press(GP.A);
    p1.stick(0, -1);
    const r = poller.poll('game');
    assert.equal(r.pads.length, 2);
    const [a, b] = r.pads;
    assert.equal(a.index, 0);
    assert.ok(a.pressed.has('fire'));
    assert.equal(a.stick.active, false);
    assert.equal(b.index, 1);
    assert.ok(!b.held.has('fire'));
    assert.ok(b.stick.active);
    assert.ok(Math.abs(b.stick.angle + Math.PI / 2) < 1e-9);
    assert.equal(b.family, 'playstation');
    assert.equal(r.anyInput, true);
});

test('anyInput and active flags', () => {
    const { poller, pad } = setup();
    let r = poller.poll('game');
    assert.equal(r.anyInput, false);
    assert.equal(r.pads[0].active, false);
    pad.press(GP.X); // unmapped in game, still counts as input
    r = poller.poll('game');
    assert.equal(r.anyInput, true);
    assert.equal(r.pads[0].held.size, 0);
    r = poller.poll('game');
    assert.equal(r.anyInput, false, 'holding without change is not new input');
});

test('merge helper: union of actions, stick from the most recently active pad', () => {
    const p0 = new FakePad(0);
    const p1 = new FakePad(1);
    const { env, poller } = setup([p0, p1]);
    p0.stick(1, 0);
    let r = poller.poll('game');
    assert.equal(r.activeIndex, 0);
    env.t = 1000;
    p1.press(GP.A);
    r = poller.poll('game');
    assert.equal(r.activeIndex, 1, 'a button press makes that pad active');
    let m = mergePads(r);
    assert.ok(m.pressed.has('fire'));
    assert.equal(m.index, 1);
    assert.equal(m.stick.active, true, 'falls back to a pad with an active stick');
    p1.stick(0, 1);
    env.t = 1010;
    r = poller.poll('game');
    m = mergePads(r);
    assert.ok(Math.abs(m.stick.angle - Math.PI / 2) < 1e-9, 'active pad stick wins');
    assert.ok(m.held.has('fire'));
    const merged = poller.pollMerged('game').merged;
    assert.equal(merged.index, 1);
    assert.equal(mergePads({ pads: [] }).stick.active, false);
    assert.equal(mergePads(null).index, null);
});

test('rumble: dual-rumble with clamped magnitudes; no-op without an actuator', () => {
    const p0 = new FakePad(0);
    const p1 = new FakePad(1, 'Generic USB Pad', { rumble: false });
    const { poller } = setup([p0, p1]);
    poller.poll('game');
    assert.equal(poller.rumble(0, 0.8, 1.5, 350), true);
    assert.deepEqual(p0.effects[0], { type: 'dual-rumble', startDelay: 0, duration: 350, strongMagnitude: 0.8, weakMagnitude: 1 });
    assert.equal(poller.rumble(1, 1, 1, 100), false);
    assert.equal(poller.rumble(5, 1, 1, 100), false);
    assert.equal(poller.rumbleEvent('death', 0), true);
    assert.deepEqual(p0.effects[1].strongMagnitude, RUMBLE_PATTERNS.death.strong);
    assert.equal(poller.rumbleEvent('nope', 0), false);
    // null index = most recently active pad
    assert.equal(poller.rumble(null, 0, 0.2, 40), true);
    assert.equal(p0.effects.length, 3);
});

test('rumble tolerates actuators that throw or reject', async () => {
    const pad = new FakePad(0);
    pad.vibrationActuator = { playEffect: () => Promise.reject(new Error('NotSupported')) };
    const { poller } = setup([pad]);
    assert.equal(poller.rumble(0, 1, 1, 50), true);
    await new Promise(r => setTimeout(r, 0)); // no unhandled rejection
    pad.vibrationActuator = { playEffect: () => { throw new Error('boom'); } };
    assert.equal(poller.rumble(0, 1, 1, 50), false);
    const empty = new GamepadPoller({ getGamepads: () => [], now: () => 0 });
    assert.equal(empty.rumble(null, 1, 1, 50), false);
});

test('rumble table matches the plan', () => {
    assert.deepEqual([RUMBLE_PATTERNS.death.strong, RUMBLE_PATTERNS.death.ms], [0.8, 350]);
    assert.deepEqual([RUMBLE_PATTERNS.redDestroyed.weak, RUMBLE_PATTERNS.redDestroyed.ms], [0.25, 60]);
    assert.deepEqual([RUMBLE_PATTERNS.bossHit.weak, RUMBLE_PATTERNS.bossHit.ms], [0.4, 80]);
    assert.deepEqual([RUMBLE_PATTERNS.bossDefeated.strong, RUMBLE_PATTERNS.bossDefeated.ms], [0.6, 500]);
    assert.deepEqual([RUMBLE_PATTERNS.collect.weak, RUMBLE_PATTERNS.collect.ms], [0.15, 40]);
});

test('non-standard mapping is flagged for a toast; buttons as plain numbers work', () => {
    const pad = new FakePad(0, 'Weird Pad', { mapping: '' });
    pad.buttons[GP.A] = 1; // some browsers/stubs expose numbers
    const { poller } = setup([pad]);
    const r = poller.poll('game');
    assert.equal(r.pads[0].standard, false);
    assert.ok(r.pads[0].held.has('fire'));
});

test('defaults to navigator.getGamepads when not injected (absent in Node)', () => {
    const p = new GamepadPoller();
    assert.doesNotThrow(() => p.poll('game'));
    assert.deepEqual(p.poll('game').pads, []);
});

test('a controller first seen by suppressHeld() is still reported as connected by the next poll', () => {
    const { poller, pad } = setup();
    pad.press(GP.A);
    poller.suppressHeld(); // e.g. a state transition before the first poll
    let r = poller.poll('menu');
    assert.deepEqual(r.connected.map(c => c.index), [0]);
    assert.ok(!only(r).pressed.has('menuSelect'), 'still suppressed');
    r = poller.poll('menu');
    assert.equal(r.connected.length, 0, 'announced once');
});
