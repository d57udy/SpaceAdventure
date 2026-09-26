import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeCanvasSize, MAX_RENDER_SCALE } from '../../js/viewport.js';

test('iPad portrait at DPR 2: 729 CSS px, 1458 backing px', () => {
    assert.deepEqual(computeCanvasSize(810, 1080, 2), { css: 729, scale: 2, backing: 1458 });
});

test('desktop at DPR 1: backing equals CSS size', () => {
    assert.deepEqual(computeCanvasSize(1280, 800, 1), { css: 720, scale: 1, backing: 720 });
});

test('DPR 3 is capped at MAX_RENDER_SCALE (2)', () => {
    assert.equal(MAX_RENDER_SCALE, 2);
    const s = computeCanvasSize(390, 844, 3);
    assert.equal(s.css, 351);
    assert.equal(s.backing, 702);
    assert.equal(s.scale, 2);
});

test('a lower cap can be passed (adaptive fallback)', () => {
    assert.deepEqual(computeCanvasSize(810, 1080, 2, 1), { css: 729, scale: 1, backing: 729 });
    const s = computeCanvasSize(810, 1080, 2, 1.5);
    assert.equal(s.backing, Math.round(729 * 1.5));
    assert.equal(s.scale, s.backing / s.css);
});

test('fractional DPR 1.5 gives the exact backing / css ratio', () => {
    const s = computeCanvasSize(1001, 1001, 1.5);
    assert.equal(s.css, 900);
    assert.equal(s.backing, 1350);
    assert.equal(s.scale, s.backing / s.css);
    const t = computeCanvasSize(777, 900, 1.5); // 699 * 1.5 = 1048.5 -> 1049
    assert.equal(t.css, 699);
    assert.equal(t.backing, 1049);
    assert.equal(t.scale, 1049 / 699);
});

test('DPR 0, undefined, NaN or below 1 are treated as 1', () => {
    for (const dpr of [0, undefined, NaN, null, 0.5]) {
        assert.deepEqual(computeCanvasSize(1280, 800, dpr), { css: 720, scale: 1, backing: 720 }, `dpr ${dpr}`);
    }
});

test('a tiny viewport returns css < 50 (caller ignores it)', () => {
    const s = computeCanvasSize(40, 30, 2);
    assert.ok(s.css < 50);
    assert.equal(computeCanvasSize(0, 0, 2).css, 0);
    assert.ok(Number.isFinite(computeCanvasSize(0, 0, 2).scale));
});
