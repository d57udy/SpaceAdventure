import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeCanvasSize, MAX_RENDER_SCALE, radarSize, playHudLayout } from '../../js/viewport.js';

// The canvas fills the safe-area viewport at any aspect ratio (minus reserved bars)
const cases = [
    ['Pixel 7 Pro portrait', 412, 892],
    ['Pixel 7 Pro landscape', 892, 412],
    ['iPhone portrait', 390, 844],
    ['iPad gen 7 portrait', 810, 1080],
    ['iPad gen 7 landscape', 1080, 810],
    ['iPad 10.2 landscape', 1024, 768],
    ['desktop 16:10', 1280, 800],
    ['desktop 16:9', 1920, 1080],
    ['ultra-wide 21:9', 3440, 1440],
];

test('fills the whole safe viewport in both dimensions, any aspect ratio', () => {
    for (const [name, w, h] of cases) {
        const s = computeCanvasSize(w, h, 1);
        assert.equal(s.width, w, name);
        assert.equal(s.height, h, name);
        assert.equal(s.backingWidth, w, name);
        assert.equal(s.backingHeight, h, name);
        assert.equal(s.scale, 1, name);
    }
});

test('HiDPI: backing store per axis, exact ratio per axis', () => {
    const s = computeCanvasSize(810, 1080, 2);
    assert.deepEqual(s, { width: 810, height: 1080, scale: 2, scaleX: 2, scaleY: 2, backingWidth: 1620, backingHeight: 2160 });
    // Pixel 7 Pro: DPR 3.5 is capped at 2
    const p = computeCanvasSize(412, 892, 3.5);
    assert.equal(MAX_RENDER_SCALE, 2);
    assert.equal(p.backingWidth, 824);
    assert.equal(p.backingHeight, 1784);
    // Fractional DPR: each axis rounds on its own and keeps its exact ratio
    const f = computeCanvasSize(699, 777, 1.5); // 1048.5 -> 1049, 1165.5 -> 1166
    assert.equal(f.backingWidth, 1049);
    assert.equal(f.backingHeight, 1166);
    assert.equal(f.scaleX, 1049 / 699);
    assert.equal(f.scaleY, 1166 / 777);
    assert.equal(f.scale, f.scaleX);
});

test('a lower cap can be passed (adaptive fallback)', () => {
    const s = computeCanvasSize(810, 1080, 2, 1);
    assert.equal(s.backingWidth, 810);
    assert.equal(s.scale, 1);
    const t = computeCanvasSize(810, 1080, 2, 1.5);
    assert.equal(t.backingWidth, Math.round(810 * 1.5));
    assert.equal(t.backingHeight, 1620);
});

test('safe areas are subtracted by the caller; fractional sizes round down', () => {
    // A notched phone in landscape: 47 px insets left and right, 21 at the bottom
    const s = computeCanvasSize(892 - 47 - 47, 412 - 21, 1);
    assert.deepEqual([s.width, s.height], [798, 391]);
    const f = computeCanvasSize(412.6, 891.4, 1);
    assert.deepEqual([f.width, f.height], [412, 891]);
});

test('reserved bars (multiplayer) are left free', () => {
    const s = computeCanvasSize(1080, 810, 2, 2, { left: 173, right: 173 });
    assert.equal(s.width, 1080 - 346);
    assert.equal(s.height, 810);
    const f = computeCanvasSize(810, 1080, 2, 2, { top: 150, bottom: 150 });
    assert.deepEqual([f.width, f.height], [810, 780]);
    assert.equal(computeCanvasSize(800, 600, 1, 2, null).width, 800);
});

test('DPR 0, undefined, NaN or below 1 are treated as 1', () => {
    for (const dpr of [0, undefined, NaN, null, 0.5]) {
        const s = computeCanvasSize(1280, 800, dpr);
        assert.deepEqual([s.width, s.height, s.scale, s.backingWidth], [1280, 800, 1, 1280], `dpr ${dpr}`);
    }
});

test('a tiny viewport returns sizes < 50 (caller ignores it)', () => {
    const s = computeCanvasSize(40, 30, 2);
    assert.ok(s.width < 50 && s.height < 50);
    const z = computeCanvasSize(0, 0, 2);
    assert.equal(z.width, 0);
    assert.ok(Number.isFinite(z.scale) && Number.isFinite(z.scaleY));
    assert.equal(computeCanvasSize(100, 100, 1, 2, { left: 80, right: 80 }).width, 0);
});

test('radar: 20% of the short side, 70 to 120 px', () => {
    assert.equal(radarSize(412, 892), 82);
    assert.equal(radarSize(892, 412), 82);
    assert.equal(radarSize(300, 300), 70);
    assert.equal(radarSize(1280, 800), 120);
});

test('play HUD: keyboard corners; touch moves the radar to the bottom centre, clear of the controls', () => {
    const k = playHudLayout(1280, 800);
    assert.deepEqual(k.radar, { x: 1280 - 120 - 15, y: 800 - 120 - 15, size: 120 });
    assert.deepEqual(k.asteroids, { x: 10, y: 790, align: 'left' });
    for (const [name, w, h] of cases) {
        const t = playHudLayout(w, h, { touch: true });
        const r = t.radar;
        assert.ok(r.x >= 0 && r.y >= 0 && r.x + r.size <= w && r.y + r.size <= h, name);
        // Clear of the corner clusters: steer / rotate (left, 140 px) and fire (right, 140 px)
        assert.ok(r.x >= 140 && r.x + r.size <= w - 140, `${name}: radar between the clusters`);
        assert.ok(Math.abs(r.x + r.size / 2 - w / 2) <= 1, name);
        assert.equal(t.asteroids.align, 'center');
        assert.ok(t.asteroids.y < r.y && t.dda.y < t.asteroids.y, name);
    }
});
