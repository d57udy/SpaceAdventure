import { test } from 'node:test';
import assert from 'node:assert/strict';

const { wrapAroundEdges, degToRad, randomRange, wrapDelta, isNearAny } = await import('../../js/utils.js');

test('wrapAroundEdges wraps each axis to the opposite edge', () => {
    const e = { x: -1, y: -1 };
    wrapAroundEdges(e, 800, 600);
    assert.deepEqual(e, { x: 800, y: 600 });
    const f = { x: 801, y: 601 };
    wrapAroundEdges(f, 800, 600);
    assert.deepEqual(f, { x: 0, y: 0 });
});

test('wrapAroundEdges leaves in-bounds positions (including edges) untouched', () => {
    for (const p of [{ x: 0, y: 0 }, { x: 800, y: 600 }, { x: 400, y: 300 }]) {
        const e = { ...p };
        wrapAroundEdges(e, 800, 600);
        assert.deepEqual(e, p);
    }
});

test('degToRad converts common angles', () => {
    assert.equal(degToRad(0), 0);
    assert.equal(degToRad(180), Math.PI);
    assert.equal(degToRad(90), Math.PI / 2);
    assert.equal(degToRad(-360), -2 * Math.PI);
});

test('randomRange stays within [min, max)', () => {
    for (let i = 0; i < 1000; i++) {
        const v = randomRange(-5, 7);
        assert.ok(v >= -5 && v < 7, `out of range: ${v}`);
    }
});

test('randomRange maps Math.random endpoints linearly', (t) => {
    t.mock.method(Math, 'random', () => 0);
    assert.equal(randomRange(10, 20), 10);
    Math.random.mock.mockImplementation(() => 0.5);
    assert.equal(randomRange(10, 20), 15);
});

test('wrapDelta returns delta unchanged when size is not positive', () => {
    for (const size of [0, -10, NaN, undefined, null]) {
        assert.equal(wrapDelta(900, size), 900);
        assert.equal(wrapDelta(-900, size), -900);
    }
});

test('wrapDelta returns shortest signed distance on a wrapping axis', () => {
    assert.equal(wrapDelta(10, 1000), 10);
    assert.equal(wrapDelta(-10, 1000), -10);
    assert.equal(wrapDelta(990, 1000), -10);   // across the seam going left
    assert.equal(wrapDelta(-990, 1000), 10);   // across the seam going right
    assert.equal(wrapDelta(0, 1000), 0);
});

test('wrapDelta keeps exactly half-size deltas as-is', () => {
    assert.equal(wrapDelta(500, 1000), 500);
    assert.equal(wrapDelta(-500, 1000), -500);
    assert.equal(wrapDelta(501, 1000), -499);
    assert.equal(wrapDelta(-501, 1000), 499);
});

test('wrapDelta result magnitude never exceeds size/2 for deltas within (-size, size)', () => {
    const size = 777;
    for (let d = -776; d <= 776; d += 7) {
        assert.ok(Math.abs(wrapDelta(d, size)) <= size / 2, `d=${d}`);
    }
});

test('isNearAny measures across the world wrap (safe-spawn fix)', () => {
    const ship = { x: 10, y: 10 };
    // 20 px away across the corner of a 1200x900 world; straight-line distance would be ~1500
    assert.equal(isNearAny(1195, 895, [ship], 300, 1200, 900), true);
    assert.equal(isNearAny(600, 450, [ship], 300, 1200, 900), false);
    // any of several points
    assert.equal(isNearAny(600, 450, [ship, { x: 700, y: 450 }], 300, 1200, 900), true);
    assert.equal(isNearAny(600, 450, [], 300, 1200, 900), false);
    // no wrapping when the world size is 0
    assert.equal(isNearAny(1195, 895, [ship], 300, 0, 0), false);
});
