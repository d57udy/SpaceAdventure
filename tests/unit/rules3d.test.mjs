import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    DIFFICULTY_3D, NEUTRAL_DDA, ddaOf, difficultyOf, RULES3D, CRYSTAL_SIZES, levelPlan, planRockCount, crystalScore,
    nextExtraLife, isBossLevel, DIFFICULTY_IDS_3D, createAdaptive3d,
} from '../../js/3d/rules3d.js';
import { Difficulty } from '../../js/difficulty.js';
import { AsteroidSize } from '../../js/asteroid.js';

test('difficulty table: the 2D values', () => {
    // js/main.js Difficulty (2D): lives, speed, UFO and score multipliers
    assert.deepEqual(
        Object.values(DIFFICULTY_3D).map((d) => [d.startingLives, d.asteroidSpeedMultiplier, d.ufoSpawnMultiplier, d.ufoAccuracy, d.scoreMultiplier]),
        [[4, 0.8, 1.5, 0.6, 0.75], [3, 1.0, 1.0, 0.8, 1.0], [2, 1.2, 0.7, 0.95, 1.5]],
    );
    assert.equal(difficultyOf('nonsense').id, 'medium');
    // Faster incoming rocks on harder settings
    assert.ok(DIFFICULTY_3D.easy.incomingInterval > DIFFICULTY_3D.medium.incomingInterval);
    assert.ok(DIFFICULTY_3D.medium.incomingInterval > DIFFICULTY_3D.hard.incomingInterval);
});

test('difficulty table: taken from js/difficulty.js, not a copy', () => {
    assert.deepEqual(DIFFICULTY_IDS_3D, ['easy', 'medium', 'hard']);
    for (const d of Object.values(Difficulty)) {
        // Every 2D field with the 2D value; the 3D-only fields (incoming rock tuning) on top
        const e = DIFFICULTY_3D[d.id];
        for (const [k, v] of Object.entries(d)) assert.equal(e[k], v, `${d.id}.${k}`);
        assert.ok(e.incomingInterval > 0);
    }
});

test('adaptive tracker: the 2D DynamicDifficulty, fresh and Balanced', () => {
    const a = createAdaptive3d();
    assert.equal(a.getAdjustmentLevel(), 'balanced');
    assert.equal(a.getAdjustmentText(), 'Balanced');
    assert.deepEqual(ddaOf(a), { ...NEUTRAL_DDA }, 'its modifier fields read as a dda');
    a.onPlayerDeath(); a.onPlayerDeath();
    assert.equal(a.getAdjustmentLevel(), 'assisting');
    assert.ok(ddaOf(a).asteroidSpeedMod < 1);
});

test('crystal scores are the 2D green scores; sizes get smaller', () => {
    assert.deepEqual(
        [CRYSTAL_SIZES.large.score, CRYSTAL_SIZES.medium.score, CRYSTAL_SIZES.small.score],
        [AsteroidSize.LARGE.greenScore, AsteroidSize.MEDIUM.greenScore, AsteroidSize.SMALL.greenScore],
    );
    assert.ok(CRYSTAL_SIZES.large.radius > CRYSTAL_SIZES.medium.radius && CRYSTAL_SIZES.medium.radius > CRYSTAL_SIZES.small.radius);
});

test('crystal score: the 2D formula (difficulty, ×2 power-up, × combo, + streak)', () => {
    assert.equal(crystalScore('large'), 100);
    assert.equal(crystalScore('medium', { difficulty: 'easy' }), Math.round(50 * 0.75));
    assert.equal(crystalScore('large', { multiplier: true, comboMultiplier: 3, streakBonus: 1000 }), 100 * 2 * 3 + 1000);
});

test('extra life threshold and the adaptive modifier', () => {
    assert.equal(RULES3D.extraLifeScore, 10000);
    assert.equal(nextExtraLife(10000), 20000);
    assert.equal(nextExtraLife(10000, { extraLifeThresholdMod: 0.5 }), 15000);
});

test('dda: missing fields are neutral', () => {
    assert.deepEqual(ddaOf(null), { ...NEUTRAL_DDA });
    assert.deepEqual(ddaOf({ asteroidSpeedMod: 1.3, junk: 5 }), { ...NEUTRAL_DDA, asteroidSpeedMod: 1.3 });
});

test('level plan: grows with the level; boss levels have 40 % of the rocks', () => {
    const a = levelPlan(1), b = levelPlan(5);
    assert.ok(planRockCount(b) > planRockCount(a));
    assert.ok(b.incoming.count > a.incoming.count && b.greens > a.greens);
    assert.ok(b.incoming.interval < a.incoming.interval);
    assert.ok(levelPlan(40).incoming.interval >= RULES3D.incomingMinInterval);
    assert.equal(isBossLevel(1), false);
    assert.equal(isBossLevel(2), true);
    const boss = levelPlan(2, { boss: true });
    const normal = levelPlan(2);
    assert.ok(Math.abs(planRockCount(boss) / planRockCount(normal) - RULES3D.bossFieldShare) < 0.15);
});

test('level plan: difficulty and adaptive modifiers change speed, incoming timing and crystals', () => {
    const e = levelPlan(1, { difficulty: 'easy' }), h = levelPlan(1, { difficulty: 'hard' });
    assert.ok(e.speedMult < h.speedMult);
    assert.ok(e.incoming.speed[1] < h.incoming.speed[1]);
    assert.ok(e.incoming.interval > h.incoming.interval);
    const helped = levelPlan(1, { dda: { greenRatioMod: 1.3, asteroidSpeedMod: 0.6 } });
    assert.ok(helped.greens > levelPlan(1).greens, 'more crystals for a struggling player');
    assert.ok(helped.speedMult < levelPlan(1).speedMult);
});

test('3D tuning per difficulty: Easy fewer incoming rocks and smaller clusters, Hard more and a wider miss', async () => {
    const { TUNING_3D } = await import('../../js/3d/rules3d.js');
    const e = levelPlan(1, { difficulty: 'easy' }), m = levelPlan(1, { difficulty: 'medium' }), h = levelPlan(1, { difficulty: 'hard' });
    assert.ok(e.incoming.count < m.incoming.count && m.incoming.count < h.incoming.count);
    assert.equal(m.incoming.count, 22);
    assert.equal(h.incoming.miss, TUNING_3D.hard.miss);
    assert.ok(h.incoming.miss > m.incoming.miss);
    assert.ok(e.clusterRocks.small < m.clusterRocks.small);
    assert.equal(m.clusterRocks.small, 3);
    assert.ok(e.incoming.interval > m.incoming.interval && m.incoming.interval > h.incoming.interval);
});
