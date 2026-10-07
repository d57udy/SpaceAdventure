import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHaptics3d, HAPTIC3D, createBrowserHaptics3d } from '../../js/3d/haptics3d.js';
import { Haptics, HAPTIC_PATTERNS } from '../../js/haptics.js';
import { RUMBLE_PATTERNS } from '../../js/gamepad.js';
import { createSettings } from '../../js/settings.js';

function memStorage() {
    const m = new Map();
    return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) };
}
function fakeNav() {
    const calls = [];
    return { calls, vibrate: (p) => { calls.push(p); return true; } };
}
function fakePad() {
    const calls = [];
    return { calls, rumbleEvent: (name, i) => { calls.push([name, i]); return !!RUMBLE_PATTERNS[name]; } };
}
function setup({ controller = false } = {}) {
    const settings = createSettings({ storage: memStorage() });
    const nav = fakeNav();
    let t = 0;
    const haptics = new Haptics({ nav, now: () => t, enabled: () => settings.get('haptics') });
    const pad = fakePad();
    const h = createHaptics3d({ haptics, gamepad: pad, settings, usingController: () => controller });
    return { settings, nav, pad, h, advance: (ms) => { t += ms; } };
}

test('every 3D event names existing vibration and rumble patterns', () => {
    for (const [name, def] of Object.entries(HAPTIC3D)) {
        if (def.haptic) assert.ok(HAPTIC_PATTERNS[def.haptic], `${name}: ${def.haptic}`);
        if (def.rumble) assert.ok(RUMBLE_PATTERNS[def.rumble], `${name}: ${def.rumble}`);
    }
    for (const e of ['hit', 'collect', 'threat', 'bossWeakPoint', 'bossDefeated']) assert.ok(HAPTIC3D[e], e);
});

test('touch play: vibrates with the 2D patterns, no rumble', () => {
    const { h, nav, pad } = setup();
    assert.deepEqual(h.event('hit'), { vibrated: true, rumbled: false });
    assert.deepEqual(nav.calls[0], HAPTIC_PATTERNS.lifeLost.pattern);
    assert.equal(pad.calls.length, 0);
    assert.deepEqual(h.event('nope'), { vibrated: false, rumbled: false });
    assert.equal(h.stats.vibrations, 1);
    assert.equal(h.stats.last, 'hit');
});

test('threat: at most once a second (haptics gap)', () => {
    const { h, nav, advance } = setup();
    h.event('threat');
    advance(500);
    h.event('threat');
    assert.equal(nav.calls.length, 1);
    advance(600);
    h.event('threat');
    assert.equal(nav.calls.length, 2);
});

test('controller play: rumble too, unless Controller rumble is off', () => {
    const { h, pad, settings } = setup({ controller: true });
    assert.equal(h.event('bossDefeated').rumbled, true);
    assert.deepEqual(pad.calls[0], ['bossDefeated', null]);
    assert.equal(h.event('rockDestroyed').rumbled, true);
    assert.equal(h.event('rockDestroyed').vibrated, false, 'no vibration for every rock');
    settings.set('rumble', false);
    assert.equal(h.event('collect').rumbled, false);
});

test('Vibration setting off: no vibration; stop cancels', () => {
    const { h, nav, settings } = setup();
    settings.set('haptics', false);
    assert.equal(h.event('hit').vibrated, false);
    assert.equal(nav.calls.length, 0);
    settings.set('haptics', true);
    h.event('levelUp');
    h.stop();
    assert.equal(nav.calls.at(-1), 0);
});

test('missing or throwing parts never break the game', () => {
    const none = createHaptics3d();
    assert.deepEqual(none.event('hit'), { vibrated: false, rumbled: false });
    none.stop();
    const bad = createHaptics3d({
        haptics: { play() { throw new Error('x'); }, stop() { throw new Error('x'); } },
        gamepad: { rumbleEvent() { throw new Error('x'); } }, usingController: () => true,
    });
    assert.deepEqual(bad.event('hit'), { vibrated: false, rumbled: false });
    bad.stop();
});

test('createBrowserHaptics3d follows the Vibration setting', async () => {
    const nav = fakeNav();
    Object.defineProperty(globalThis, 'navigator', { value: nav, configurable: true, writable: true });
    const settings = createSettings({ storage: memStorage() });
    const h = await createBrowserHaptics3d({ settings });
    assert.equal(h.event('collect').vibrated, true);
    settings.set('haptics', false);
    assert.equal(h.event('hit').vibrated, false);
});
