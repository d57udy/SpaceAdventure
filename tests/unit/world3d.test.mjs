import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mulberry32 } from '../../js/rng.js';
import {
    WORLD, ROCK_SIZES, wrapCoord, wrapPos, wrapDelta1, nearestDelta, nearestImage, wrappedDistance, spawnPoint,
    spawnField, splitRock, makeRock, driftRocks, countRocks,
    VIEW_DISTANCES, VIEW_DISTANCE_NAMES, DEFAULT_VIEW_DISTANCE, MAX_FIELD_ROCKS, FOG_SEAM_RATIO, worldFor,
} from '../../js/3d/world3d.js';
import { vLen, vDot, vSub } from '../../js/3d/math3d.js';

const S = 1000;

test('wrapCoord / wrapPos keep coordinates in [0, size)', () => {
    assert.equal(wrapCoord(1050, S), 50);
    assert.equal(wrapCoord(-10, S), 990);
    assert.equal(wrapCoord(0, S), 0);
    assert.deepEqual(wrapPos([-1, 1001, 500], S), [999, 1, 500]);
});

test('nearest image: the shortest way round each axis', () => {
    assert.equal(wrapDelta1(10, 990, S), -20);
    assert.equal(wrapDelta1(990, 10, S), 20);
    assert.equal(wrapDelta1(100, 400, S), 300);
    assert.deepEqual(nearestDelta([10, 500, 990], [990, 520, 5], S), [-20, 20, 15]);
    assert.deepEqual(nearestImage([10, 10, 10], [990, 10, 10], S), [-10, 10, 10]);
    assert.equal(wrappedDistance([0, 0, 0], [999, 0, 0], S), 1);
    for (const d of nearestDelta([0, 0, 0], [500, 499, 501], S)) assert.ok(d >= -S / 2 && d < S / 2);
});

test('fog ends before half the cube side, so the seam is never visible', () => {
    assert.ok(WORLD.fogFar < WORLD.size / 2);
});

test('spawn clearance: every rock starts far from the ship', () => {
    const rand = mulberry32(3);
    const ship = [WORLD.size / 2, WORLD.size / 2, WORLD.size / 2];
    let id = 1;
    const rocks = spawnField(rand, { shipPos: ship, nextId: () => id++ });
    assert.equal(rocks.length, WORLD.greens + WORLD.reds);
    const c = countRocks(rocks);
    assert.equal(c.green, WORLD.greens);
    assert.equal(c.red, WORLD.reds);
    for (const r of rocks) assert.ok(wrappedDistance(ship, r.pos, WORLD.size) >= WORLD.spawnClearance, `rock ${r.id}`);
    assert.equal(new Set(rocks.map((r) => r.id)).size, rocks.length, 'unique ids');
    // Ship near a corner: clearance still holds across the seam
    const corner = [5, 5, 5];
    const p = spawnPoint(mulberry32(9), WORLD.size, [corner], 300);
    assert.ok(wrappedDistance(corner, p, WORLD.size) >= 300);
});

test('same seed, same field', () => {
    const a = spawnField(mulberry32(42), {}).map((r) => r.pos);
    const b = spawnField(mulberry32(42), {}).map((r) => r.pos);
    assert.deepEqual(a, b);
});

test('split: large → 2 medium → 2 small → nothing; greens never split', () => {
    const rand = mulberry32(1);
    const large = makeRock({ id: 1, kind: 'red', size: 'large', pos: [100, 100, 100], vel: [5, 0, 0], rand });
    const mediums = splitRock(large, rand, { hitDir: [0, 0, -1] });
    assert.equal(mediums.length, 2);
    for (const m of mediums) {
        assert.equal(m.size, 'medium');
        assert.equal(m.radius, ROCK_SIZES.medium.radius);
    }
    // The pieces fly apart
    const rel = vSub(mediums[0].vel, mediums[1].vel);
    assert.ok(vLen(rel) > 30);
    assert.ok(Math.abs(vDot(vSub(mediums[0].pos, mediums[1].pos), [0, 0, 1])) < 1e-9, 'separated perpendicular to the hit');
    const smalls = splitRock(mediums[0], rand);
    assert.deepEqual(smalls.map((s) => s.size), ['small', 'small']);
    assert.deepEqual(splitRock(smalls[0], rand), []);
    const green = makeRock({ id: 5, kind: 'green', pos: [0, 0, 0], rand });
    assert.deepEqual(splitRock(green, rand), []);
});

test('drift moves and wraps', () => {
    const r = makeRock({ id: 1, kind: 'red', pos: [995, 0, 0], vel: [10, 0, -10], rand: mulberry32(1) });
    driftRocks([r], 1, S);
    assert.deepEqual(r.pos, [5, 0, 990]);
});

// --- View distance (owner feedback 2026-10-07: "we need to see farther")
const ORIGINAL = { size: 1600, fogFar: 720, rocks: 30 };
const densityPerVisible = (w) => (w.greens + w.reds) / w.fogFar ** 3;
const originalDensity = ORIGINAL.rocks / ORIGINAL.fogFar ** 3;

test('view distances: Normal x1.5, Far x2 (default), Very far x2.6 of the original fog end', () => {
    assert.deepEqual([...VIEW_DISTANCE_NAMES], ['normal', 'far', 'veryfar']);
    assert.equal(DEFAULT_VIEW_DISTANCE, 'far');
    for (const n of VIEW_DISTANCE_NAMES) {
        const w = worldFor(n);
        assert.ok(Math.abs(w.fogFar / ORIGINAL.fogFar - VIEW_DISTANCES[n].range) < 0.02, n);
        assert.ok(w.fogNear < w.fogFar, n);
    }
    assert.equal(worldFor().name, 'far');
    assert.equal(worldFor('nonsense').name, 'far');
    // null keeps the original 1600 cube (the simulation's default in unit tests)
    assert.deepEqual([worldFor(null).size, worldFor(null).fogFar, worldFor(null).greens, worldFor(null).reds], [1600, 720, 12, 18]);
});

test('view distances: fog ends by 0.45 x side, culling happens before the seam, dust box divides the side', () => {
    for (const n of VIEW_DISTANCE_NAMES) {
        const w = worldFor(n);
        assert.ok(w.fogFar <= FOG_SEAM_RATIO * w.size + 1e-9, `${n}: fog ${w.fogFar} / side ${w.size}`);
        assert.ok(w.cullDistance > w.fogFar, n);
        // Drawn objects never sit at the seam (side / 2), and a large rock's spikes (about
        // 1.9 x 42 = 80) are past the fog end when it is culled: no popping
        assert.ok(w.cullDistance < w.size / 2, `${n}: cull ${w.cullDistance}`);
        assert.ok(w.cullDistance - 80 >= w.fogFar, `${n}: cull ${w.cullDistance}`);
        assert.equal(w.size % 200, 0, `${n}: space-dust box`);
        assert.ok(w.bulletLife * 900 > w.fogFar && w.bulletLife * 900 < w.size / 2, `${n}: bullet range`);
    }
    // Larger setting, larger world
    const sizes = VIEW_DISTANCE_NAMES.map((n) => worldFor(n).size);
    assert.ok(sizes[0] < sizes[1] && sizes[1] < sizes[2]);
});

test('view distances: density per visible volume within 15 % of the original, counts capped', () => {
    for (const n of VIEW_DISTANCE_NAMES) {
        const w = worldFor(n);
        const ratio = densityPerVisible(w) / originalDensity;
        assert.ok(ratio > 0.85 && ratio < 1.15, `${n}: density ratio ${ratio.toFixed(3)}`);
        assert.ok(w.greens + w.reds <= MAX_FIELD_ROCKS, `${n}: ${w.greens + w.reds}`);
        // Same mix as the original field (12 : 18)
        assert.ok(Math.abs(w.greens / (w.greens + w.reds) - 0.4) < 0.01, n);
    }
    // The cap bites when asked for less
    const capped = worldFor('veryfar', { maxRocks: 100 });
    assert.ok(capped.greens + capped.reds <= 101 && capped.greens + capped.reds >= 99, JSON.stringify(capped));
    assert.ok(MAX_FIELD_ROCKS <= 600, 'performance cap');
});

test('a Very far field: right counts, all spawned away from the ship', () => {
    const w = worldFor('veryfar');
    const ship = [w.size / 2, w.size / 2, w.size / 2];
    let id = 1;
    const rocks = spawnField(mulberry32(5), { size: w.size, shipPos: ship, greens: w.greens, reds: w.reds, nextId: () => id++ });
    assert.deepEqual(countRocks(rocks), { green: w.greens, red: w.reds, rocks: w.greens + w.reds });
    for (const r of rocks) {
        assert.ok(wrappedDistance(ship, r.pos, w.size) >= w.spawnClearance);
        for (const c of r.pos) assert.ok(c >= 0 && c < w.size);
    }
});
