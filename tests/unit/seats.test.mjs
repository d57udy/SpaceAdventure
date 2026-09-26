import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    MAX_SEATS, MAX_TOUCH_SEATS, KEY_PROFILES, MERGED_EXTRA, SHARED_CODES, lookupCode, lookupShared,
    sourceKind, rotateVector, stickFromDrag, SeatTable,
} from '../../js/seats.js';

const near = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) <= eps, `expected ${b}, got ${a}`);

test('limits', () => {
    assert.equal(MAX_SEATS, 4);
    assert.equal(MAX_TOUCH_SEATS, 2);
});

test('key profiles match plan §8', () => {
    assert.deepEqual(KEY_PROFILES.kbLeft, {
        thrust: ['KeyW'], rotateLeft: ['KeyA'], rotateRight: ['KeyD'], hyperspace: ['KeyS'], fire: ['Space', 'KeyF'],
    });
    assert.deepEqual(KEY_PROFILES.kbRight, {
        thrust: ['ArrowUp', 'Numpad8'], rotateLeft: ['ArrowLeft', 'Numpad4'], rotateRight: ['ArrowRight', 'Numpad6'],
        hyperspace: ['ArrowDown', 'Numpad5', 'Numpad2'], fire: ['Enter', 'NumpadEnter', 'Numpad0', 'ShiftRight'],
    });
    assert.deepEqual(MERGED_EXTRA, { hyperspace: ['KeyH'] });
    assert.deepEqual(SHARED_CODES.menuSelect, ['Enter', 'NumpadEnter', 'Space']);
});

test('every bound key maps to exactly one source and action', () => {
    for (const [source, profile] of Object.entries(KEY_PROFILES)) {
        for (const [action, codes] of Object.entries(profile)) {
            for (const code of codes) {
                for (const merged of [false, true]) {
                    const hits = lookupCode(code, merged);
                    assert.equal(hits.length, 1, `${code} merged=${merged}`);
                    assert.deepEqual({ ...hits[0] }, { source, action });
                }
            }
        }
    }
});

test('modifier keys are never bound', () => {
    for (const code of ['ControlLeft', 'ControlRight', 'MetaLeft', 'MetaRight', 'AltLeft', 'AltRight', 'ShiftLeft']) {
        assert.equal(lookupCode(code, true).length, 0, code);
        assert.equal(lookupShared(code).length, 0, code);
    }
});

test('H is hyperspace only in single-player (merged)', () => {
    assert.deepEqual(lookupCode('KeyH', false), []);
    assert.deepEqual(lookupCode('KeyH', true).map((h) => ({ ...h })), [{ source: 'kbLeft', action: 'hyperspace' }]);
    assert.deepEqual(lookupCode('KeyQ', true), []);
});

test('shared actions', () => {
    assert.deepEqual([...lookupShared('KeyP')], ['pause']);
    assert.deepEqual([...lookupShared('Escape')], ['escape']);
    assert.deepEqual([...lookupShared('KeyM')], ['toggleMute']);
    assert.deepEqual([...lookupShared('Enter')].sort(), ['enter', 'menuSelect']);
    assert.deepEqual([...lookupShared('KeyW')], ['menuUp']);
    assert.deepEqual([...lookupShared('ArrowLeft')], ['menuLeft']);
    assert.deepEqual([...lookupShared('Backspace')], ['backspace']);
    assert.deepEqual([...lookupShared('KeyZ')], []);
});

test('sourceKind', () => {
    assert.equal(sourceKind('kbLeft'), 'keyboard');
    assert.equal(sourceKind('kbRight'), 'keyboard');
    assert.equal(sourceKind('pad:0'), 'gamepad');
    assert.equal(sourceKind('pad:3'), 'gamepad');
    assert.equal(sourceKind('touch:a'), 'touch');
    assert.equal(sourceKind('touch:b'), 'touch');
    assert.equal(sourceKind('touch:c'), null);
    assert.equal(sourceKind('pad:x'), null);
    assert.equal(sourceKind(undefined), null);
});

test('vector rotation', () => {
    assert.deepEqual(rotateVector(3, -2, 180), { x: -3, y: 2 });
    assert.deepEqual(rotateVector(0, 1, 180), { x: 0, y: -1 });
    assert.ok(!Object.is(rotateVector(0, 1, 180).x, -0), 'no negative zero');
    assert.deepEqual(rotateVector(3, -2, 0), { x: 3, y: -2 });
    assert.deepEqual(rotateVector(3, -2, 360), { x: 3, y: -2 });
    assert.deepEqual(rotateVector(1, 0, 90), { x: 0, y: 1 });
    assert.deepEqual(rotateVector(1, 0, -90), { x: 0, y: -1 });
    const r = rotateVector(1, 0, 45);
    near(r.x, Math.SQRT1_2);
    near(r.y, Math.SQRT1_2);
});

test('stickFromDrag', () => {
    assert.deepEqual(stickFromDrag(0, 0, 50), { active: false, angle: 0, magnitude: 0 });
    const s = stickFromDrag(25, 0, 50);
    assert.equal(s.active, true);
    near(s.angle, 0);
    near(s.magnitude, 0.5);
    const d = stickFromDrag(0, 200, 50);
    near(d.angle, Math.PI / 2);
    assert.equal(d.magnitude, 1);
    assert.equal(stickFromDrag(10, 10, 0).active, false);
});

test('merged mode: every source drives seat 0, no joining', () => {
    const t = new SeatTable();
    assert.equal(t.merged, true);
    for (const src of ['kbLeft', 'kbRight', 'pad:2', 'touch:a', 'touch:b']) assert.equal(t.seatOf(src), 0);
    assert.equal(t.seatOf('bogus'), null);
    assert.deepEqual(t.sourcesOf(0), ['*']);
    assert.deepEqual(t.sourcesOf(1), []);
    assert.equal(t.join('kbLeft'), null);
});

test('joining takes the lowest free seat and is idempotent', () => {
    const t = new SeatTable();
    t.setMerged(false);
    assert.equal(t.seatOf('kbLeft'), null);
    assert.equal(t.join('kbRight'), 0);
    assert.equal(t.join('kbLeft'), 1);
    assert.equal(t.join('kbRight'), 0, 'idempotent');
    assert.equal(t.count, 2);
    assert.equal(t.leave('kbRight'), 0);
    assert.equal(t.join('pad:0'), 0, 'lowest free seat reused');
    assert.equal(t.seatOf('kbLeft'), 1);
    assert.deepEqual(t.sourcesOf(1), ['kbLeft']);
    assert.equal(t.join('nonsense'), null);
});

test('full at 4 seats', () => {
    const t = new SeatTable();
    t.setMerged(false);
    ['kbLeft', 'kbRight', 'pad:0', 'pad:1'].forEach((s, i) => assert.equal(t.join(s), i));
    assert.equal(t.join('pad:2'), null);
    assert.equal(t.join('touch:a'), null);
    assert.equal(t.count, 4);
});

test('at most 2 touch seats', () => {
    const t = new SeatTable();
    t.setMerged(false);
    assert.equal(t.join('touch:a'), 0);
    assert.equal(t.join('touch:b'), 1);
    assert.equal(t.touchCount(), 2);
    assert.equal(t.join('kbLeft'), 2);
    assert.equal(t.leave(1), 1);
    assert.equal(t.join('touch:b'), 1);
});

test('third touch source is refused', () => {
    const t = new SeatTable({ maxTouchSeats: 1 });
    t.setMerged(false);
    assert.equal(t.join('touch:a'), 0);
    assert.equal(t.join('touch:b'), null);
});

test('leaving', () => {
    const t = new SeatTable();
    t.setMerged(false);
    t.join('kbLeft');
    t.join('kbRight');
    assert.equal(t.leave('kbLeft'), 0);
    assert.equal(t.seatOf('kbLeft'), null);
    assert.equal(t.leave('kbLeft'), null, 'already gone');
    assert.equal(t.leave(3), null, 'empty seat');
    assert.equal(t.leave(9), null, 'out of range');
    assert.equal(t.seatOf('kbRight'), 1);
});

test('reserving a disconnected controller seat and rejoining', () => {
    const t = new SeatTable();
    t.setMerged(false);
    t.join('kbLeft');
    t.join('pad:0');
    t.cycleColour(1, 1); // colour 1 -> 2
    const colour = t.colourOf(1);
    assert.equal(t.reserve(1), true);
    assert.equal(t.isReserved(1), true);
    assert.equal(t.seatOf('pad:0'), null);
    assert.deepEqual(t.sourcesOf(1), []);
    assert.equal(t.count, 2, 'reserved seat stays taken');
    // Any controller joining takes the reserved seat back with its colour
    assert.equal(t.join('pad:1'), 1);
    assert.equal(t.isReserved(1), false);
    assert.equal(t.colourOf(1), colour);
    // Reserve again, then drop it
    t.reserve(1);
    assert.equal(t.leave(1), 1);
    assert.equal(t.count, 1);
    assert.equal(t.reserve(3), false, 'nothing to reserve');
});

test('colours: seat index by default, cycling skips taken colours', () => {
    const t = new SeatTable();
    t.setMerged(false);
    t.join('kbLeft');
    t.join('kbRight');
    t.join('pad:0');
    assert.deepEqual([0, 1, 2].map((s) => t.colourOf(s)), [0, 1, 2]);
    assert.equal(t.cycleColour(0, 1), 3, 'skips 1 and 2');
    assert.equal(t.cycleColour(0, 1), 0, 'wraps round');
    assert.equal(t.cycleColour(0, -1), 3);
    t.leave(1);
    t.join('pad:1'); // seat 1, colour 1 still free
    assert.equal(t.colourOf(1), 1);
    // A new seat whose own colour is taken gets the lowest free one
    const u = new SeatTable();
    u.setMerged(false);
    u.join('kbLeft');
    u.cycleColour(0, 1); // seat 0 now colour 1
    u.join('kbRight');
    assert.equal(u.colourOf(1), 0);
    assert.equal(u.cycleColour(3), null);
});

test('snapshot is a plain copy; setMerged(true) clears seats', () => {
    const t = new SeatTable();
    t.setMerged(false);
    t.join('touch:b');
    const snap = t.snapshot();
    assert.deepEqual(snap, {
        merged: false,
        seats: [{ seat: 0, source: 'touch:b', colour: 0, reserved: false }, null, null, null],
    });
    snap.seats[0].source = 'hacked';
    assert.equal(t.seatOf('touch:b'), 0);
    t.setMerged(true);
    assert.deepEqual(t.snapshot().seats, [null, null, null, null]);
});
