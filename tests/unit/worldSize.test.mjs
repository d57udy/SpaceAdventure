import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    computeWorldSize, scaledAsteroidCount, WORLD_SCREENS, MAX_WORLD_ASPECT, MIN_WORLD_SIDE, MAX_ASTEROID_SCALE,
} from '../../js/worldSize.js';

const close = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-6, `${msg}: ${a} vs ${b}`);

test('a square view gives the old world: 1.5 views per axis, no extra rocks', () => {
    assert.equal(WORLD_SCREENS, 1.5);
    for (const side of [351, 720, 729, 1000]) {
        const w = computeWorldSize(side, side);
        assert.equal(w.width, side * 1.5);
        assert.equal(w.height, side * 1.5);
        assert.equal(w.asteroidScale, 1);
    }
});

test('4:3, 16:10 and 16:9 screens: 1.5 views per axis, same asteroid count', () => {
    for (const [vw, vh] of [[1024, 768], [768, 1024], [1080, 810], [1280, 800], [1920, 1080], [1080, 1920]]) {
        const w = computeWorldSize(vw, vh);
        close(w.width, vw * 1.5, `${vw}x${vh} width`);
        close(w.height, vh * 1.5, `${vw}x${vh} height`);
        close(w.asteroidScale, 1, `${vw}x${vh} scale`);
    }
});

test('a tall phone does not get a skinny world: the short axis grows to 16:9, more rocks', () => {
    const w = computeWorldSize(412, 892); // Pixel 7 Pro portrait
    assert.equal(w.height, 892 * 1.5);
    close(w.width, (892 * 1.5) / MAX_WORLD_ASPECT, 'width');
    assert.ok(w.width > 412 * 1.5, 'wider than 1.5 views');
    close(w.height / w.width, 16 / 9, 'aspect');
    close(w.asteroidScale, (w.width * w.height) / (2.25 * 412 * 892), 'scale = extra area');
    assert.ok(w.asteroidScale > 1.2 && w.asteroidScale < 1.25);
    assert.equal(scaledAsteroidCount(10, w.asteroidScale), 12);
    // Landscape: the same world turned
    const l = computeWorldSize(892, 412);
    close(l.width, w.height, 'landscape width');
    close(l.height, w.width, 'landscape height');
    close(l.asteroidScale, w.asteroidScale, 'landscape scale');
});

test('ultra-wide: clamped aspect, asteroid scale capped', () => {
    const w = computeWorldSize(3440, 1440);
    close(w.width / w.height, MAX_WORLD_ASPECT, 'aspect');
    assert.ok(w.asteroidScale > 1 && w.asteroidScale <= MAX_ASTEROID_SCALE);
    const x = computeWorldSize(5120, 600); // absurd 8.5:1
    assert.equal(x.asteroidScale, MAX_ASTEROID_SCALE);
});

test('the world is always at least 1.5 views and MIN_WORLD_SIDE per axis, and aspect <= 16:9', () => {
    for (let vw = 200; vw <= 3800; vw += 150) {
        for (let vh = 200; vh <= 2200; vh += 125) {
            const w = computeWorldSize(vw, vh);
            assert.ok(w.width >= vw * 1.5 - 1e-9 && w.height >= vh * 1.5 - 1e-9, `${vw}x${vh}`);
            assert.ok(w.width >= MIN_WORLD_SIDE && w.height >= MIN_WORLD_SIDE, `${vw}x${vh}`);
            assert.ok(Math.max(w.width, w.height) / Math.min(w.width, w.height) <= MAX_WORLD_ASPECT + 1e-9, `${vw}x${vh}`);
            assert.ok(w.asteroidScale >= 1 && w.asteroidScale <= MAX_ASTEROID_SCALE, `${vw}x${vh}`);
        }
    }
});

test('tiny views get the minimum side; bad input is safe', () => {
    const w = computeWorldSize(200, 200);
    assert.equal(w.width, MIN_WORLD_SIDE);
    assert.equal(w.height, MIN_WORLD_SIDE);
    assert.ok(w.asteroidScale > 1);
    const z = computeWorldSize(0, NaN);
    assert.ok(Number.isFinite(z.width) && Number.isFinite(z.height) && Number.isFinite(z.asteroidScale));
});

test('scaledAsteroidCount', () => {
    assert.equal(scaledAsteroidCount(10, 1), 10);
    assert.equal(scaledAsteroidCount(10, 1.35), 14);
    assert.equal(scaledAsteroidCount(4, 2), 8);
    assert.equal(scaledAsteroidCount(0, 2), 0);
    assert.equal(scaledAsteroidCount(10, 0.5), 10); // never fewer than the level asks for
    assert.equal(scaledAsteroidCount(10, NaN), 10);
    assert.equal(scaledAsteroidCount(undefined, 2), 0);
});
