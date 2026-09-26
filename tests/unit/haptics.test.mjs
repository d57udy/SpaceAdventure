import { test } from 'node:test';
import assert from 'node:assert/strict';

import { Haptics, HAPTIC_PATTERNS, HAPTICS_KEY, HAPTICS_MAX_PER_SECOND, patternDuration } from '../../js/haptics.js';

function fakeNav({ activated } = {}) {
    const nav = { calls: [], vibrate(p) { this.calls.push(p); return true; } };
    if (activated !== undefined) nav.userActivation = { hasBeenActive: activated };
    return nav;
}

function fakeClock(start = 1000) {
    const c = { t: start, now: () => c.t, advance(ms) { c.t += ms; } };
    return c;
}

class FakeStorage {
    constructor(init = {}) { this.map = new Map(Object.entries(init)); }
    getItem(k) { return this.map.has(k) ? this.map.get(k) : null; }
    setItem(k, v) { this.map.set(k, String(v)); }
}

function make(opts = {}) {
    const nav = opts.nav || fakeNav();
    const clock = fakeClock();
    const h = new Haptics({ nav, now: clock.now, ...opts });
    return { h, nav, clock };
}

test('pattern table matches the plan', () => {
    assert.equal(HAPTICS_KEY, 'spaceAdventure_haptics');
    const expect = {
        collect: [12, 1, 70], powerUp: [[20, 40, 20], 2, 150], shieldHit: [40, 3, 150],
        bossWeakPoint: [25, 2, 100], hyperspace: [[15, 30, 40], 2, 0], levelUp: [[30, 60, 30, 60, 60], 3, 0],
        lifeLost: [[120, 60, 200], 4, 0], bossDefeated: [[60, 40, 60, 40, 220], 4, 0],
        gameOver: [[200, 100, 350], 5, 0], enabled: [30, 5, 0],
    };
    assert.deepEqual(Object.keys(HAPTIC_PATTERNS).sort(), Object.keys(expect).sort());
    for (const [name, [pattern, priority, gap]] of Object.entries(expect)) {
        assert.deepEqual(HAPTIC_PATTERNS[name].pattern, pattern, name);
        assert.equal(HAPTIC_PATTERNS[name].priority, priority, name);
        assert.equal(HAPTIC_PATTERNS[name].gap, gap, name);
    }
    assert.equal(HAPTICS_MAX_PER_SECOND, 8);
    assert.equal(patternDuration(12), 12);
    assert.equal(patternDuration([120, 60, 200]), 380);
});

test('unsupported: play() returns false and never throws', () => {
    for (const nav of [null, {}, { vibrate: 'nope' }]) {
        const h = new Haptics({ nav, now: () => 0 });
        assert.equal(h.supported, false);
        assert.equal(h.play('collect'), false);
        assert.equal(h.stop(), false);
        assert.doesNotThrow(() => h.setEnabled(true));
    }
});

test('a throwing vibrate is swallowed', () => {
    const nav = { vibrate() { throw new Error('blocked'); } };
    const { h } = make({ nav });
    assert.equal(h.play('lifeLost'), false);
    assert.equal(h.stats.errors, 1);
    assert.doesNotThrow(() => h.stop());
});

test('enabled by default; setEnabled(false) persists and stops', () => {
    const storage = new FakeStorage();
    const { h, nav } = make({ storage });
    assert.equal(h.enabled, true);
    h.setEnabled(false);
    assert.equal(storage.getItem(HAPTICS_KEY), 'false');
    assert.deepEqual(nav.calls, [0], 'stop sends vibrate(0)');
    assert.equal(h.play('collect'), false);
    const h2 = new Haptics({ nav: fakeNav(), now: () => 0, storage });
    assert.equal(h2.enabled, false, 'stored preference is read');
});

test('switching on plays the confirmation tick', () => {
    const { h, nav } = make({ enabled: false });
    h.setEnabled(true);
    assert.deepEqual(nav.calls, [30]);
});

test('enabled can be an injected getter (settings module)', () => {
    let on = true;
    const { h, nav } = make({ enabled: () => on });
    assert.equal(h.play('collect'), true);
    on = false;
    assert.equal(h.enabled, false);
    assert.equal(h.play('powerUp'), false);
    assert.equal(nav.calls.length, 1);
    const broken = new Haptics({ nav: fakeNav(), now: () => 0, enabled: () => { throw new Error('x'); } });
    assert.equal(broken.enabled, false);
});

test('each pattern is passed to vibrate exactly', () => {
    for (const name of Object.keys(HAPTIC_PATTERNS)) {
        const { h, nav } = make();
        assert.equal(h.play(name), true, name);
        assert.deepEqual(nav.calls, [HAPTIC_PATTERNS[name].pattern], name);
    }
});

test('unknown names are ignored', () => {
    const { h, nav } = make();
    assert.equal(h.play('explode'), false);
    assert.equal(h.play('toString'), false);
    assert.equal(nav.calls.length, 0);
});

test('per-event minimum gap: collects 30 ms apart -> one call, 80 ms apart -> two', () => {
    let { h, nav, clock } = make();
    h.play('collect');
    clock.advance(30);
    h.play('collect');
    assert.equal(nav.calls.length, 1);

    ({ h, nav, clock } = make());
    h.play('collect');
    clock.advance(80);
    h.play('collect');
    assert.equal(nav.calls.length, 2);
});

test('priority: death then collect 50 ms later -> collect dropped', () => {
    const { h, nav, clock } = make();
    assert.equal(h.play('lifeLost'), true);
    clock.advance(50);
    assert.equal(h.play('collect'), false);
    assert.deepEqual(nav.calls, [[120, 60, 200]]);
    // after the death pattern has finished, collects work again
    clock.advance(400);
    assert.equal(h.play('collect'), true);
});

test('priority: collect then death -> death goes through', () => {
    const { h, nav, clock } = make();
    h.play('collect');
    clock.advance(5);
    assert.equal(h.play('lifeLost'), true);
    assert.deepEqual(nav.calls, [12, [120, 60, 200]]);
});

test('equal priority may interrupt', () => {
    const { h, clock } = make();
    h.play('lifeLost');
    clock.advance(20);
    assert.equal(h.play('bossDefeated'), true);
});

test('global cap of 8 calls per second', () => {
    const { h, nav, clock } = make();
    let ok = 0;
    for (let i = 0; i < 20; i++) {
        if (h.play('hyperspace')) ok++; // no gap, priority 2
        clock.advance(10);
    }
    assert.equal(ok, 8);
    assert.equal(nav.calls.length, 8);
    clock.advance(1000);
    assert.equal(h.play('hyperspace'), true);
});

test('stop() cancels with vibrate(0) and resets priority', () => {
    const { h, nav, clock } = make();
    h.play('gameOver');
    h.stop();
    assert.deepEqual(nav.calls.at(-1), 0);
    clock.advance(10);
    assert.equal(h.play('collect'), true, 'a stopped pattern no longer blocks');
    assert.equal(h.stats.stops, 1);
});

test('no vibration before the first user gesture (userActivation)', () => {
    const nav = fakeNav({ activated: false });
    const { h } = make({ nav });
    assert.equal(h.hasUserActivation, false);
    assert.equal(h.play('collect'), false);
    assert.equal(h.stop(), false);
    assert.equal(nav.calls.length, 0);
    nav.userActivation.hasBeenActive = true;
    assert.equal(h.play('collect'), true);
});

test('stats record calls, drops and the last pattern', () => {
    const { h, clock } = make();
    h.play('collect');
    clock.advance(10);
    h.play('collect');
    h.play('levelUp');
    assert.equal(h.stats.calls, 2);
    assert.equal(h.stats.dropped, 1);
    assert.equal(h.stats.last, 'levelUp');
});

test('defaults to globalThis.navigator when no nav is injected', () => {
    const h = new Haptics({ now: () => 0 });
    // Node has a navigator without vibrate (or none): must be unsupported, not throw
    assert.equal(h.supported, typeof globalThis.navigator?.vibrate === 'function');
    assert.doesNotThrow(() => h.play('collect'));
});
