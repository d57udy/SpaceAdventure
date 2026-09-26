import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mulberry32, hashSeed, levelSeed, courseSeed, rngInt, rngRange } from '../../js/rng.js';

const take = (rand, n) => Array.from({ length: n }, () => rand());

test('same seed gives the same sequence', () => {
    assert.deepEqual(take(mulberry32(12345), 100), take(mulberry32(12345), 100));
});

test('values are in [0, 1)', () => {
    for (const seed of [0, 1, 42, 0xFFFFFFFF, -7, 2 ** 40 + 3]) {
        for (const v of take(mulberry32(seed), 2000)) {
            assert.ok(v >= 0 && v < 1, `seed ${seed}: ${v}`);
        }
    }
});

test('different seeds give different sequences', () => {
    assert.notDeepEqual(take(mulberry32(1), 10), take(mulberry32(2), 10));
    assert.notDeepEqual(take(mulberry32(0), 10), take(mulberry32(0x80000000), 10));
});

test('sequence is roughly uniform', () => {
    const rand = mulberry32(99);
    const buckets = new Array(10).fill(0);
    for (let i = 0; i < 10000; i++) buckets[Math.floor(rand() * 10)]++;
    for (const b of buckets) assert.ok(b > 850 && b < 1150, `bucket ${b}`);
});

test('hashSeed is stable, unsigned and distinguishes strings', () => {
    assert.equal(hashSeed('course:1:medium'), hashSeed('course:1:medium'));
    assert.notEqual(hashSeed('course:1:medium'), hashSeed('course:2:medium'));
    const h = hashSeed('');
    assert.ok(Number.isInteger(h) && h >= 0 && h <= 0xFFFFFFFF);
});

test('level seeds are stable and differ per level and run', () => {
    const run = hashSeed('run');
    assert.equal(levelSeed(run, 3), levelSeed(run, 3));
    const seeds = new Set(Array.from({ length: 50 }, (_, l) => levelSeed(run, l + 1)));
    assert.equal(seeds.size, 50);
    assert.notEqual(levelSeed(run, 1), levelSeed(run + 1, 1));
    for (const s of seeds) assert.ok(Number.isInteger(s) && s >= 0 && s <= 0xFFFFFFFF);
});

test('level seeds are pinned (changing them would change every course)', () => {
    // Pinned values: if this fails, stored ghosts no longer match their courses.
    assert.equal(levelSeed(courseSeed(1, 'medium'), 1), 1930448265);
    assert.equal(levelSeed(courseSeed(1, 'MEDIUM'), 1), 1930448265);
    assert.equal(hashSeed('abc'), 482950588);
    // Reference Mulberry32 output for seed 1
    assert.equal(mulberry32(1)(), 0.6270739405881613);
});

test('rngInt and rngRange stay in bounds', () => {
    const rand = mulberry32(7);
    for (let i = 0; i < 1000; i++) {
        const n = rngInt(rand, 3, 6);
        assert.ok(Number.isInteger(n) && n >= 3 && n <= 6);
        const f = rngRange(rand, -2, 2);
        assert.ok(f >= -2 && f < 2);
    }
});
