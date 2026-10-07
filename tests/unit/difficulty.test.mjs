import { test } from 'node:test';
import assert from 'node:assert/strict';

console.log = () => {};
const { Difficulty, createDynamicDifficulty, adjustmentLevel } = await import('../../js/difficulty.js');

test('difficulty table: the 2D values', () => {
    assert.deepEqual(Object.keys(Difficulty), ['EASY', 'MEDIUM', 'HARD']);
    assert.equal(Difficulty.EASY.ufoAccuracy, 0.6);
    assert.equal(Difficulty.MEDIUM.ufoAccuracy, 0.8);
    assert.equal(Difficulty.HARD.ufoAccuracy, 0.95);
    assert.deepEqual(Difficulty.MEDIUM, {
        id: 'medium', name: 'Medium', startingAsteroids: 4, asteroidSpeedMultiplier: 1.0,
        ufoSpawnMultiplier: 1.0, ufoAccuracy: 0.8, startingLives: 3, scoreMultiplier: 1.0,
    });
    assert.equal(Difficulty.HARD.startingLives, 2);
    assert.equal(Difficulty.EASY.scoreMultiplier, 0.75);
});

test('each createDynamicDifficulty() is an independent tracker', () => {
    const a = createDynamicDifficulty();
    const b = createDynamicDifficulty();
    a.reset(); b.reset();
    a.onPlayerDeath();
    assert.equal(a.deaths, 1);
    assert.equal(b.deaths, 0);
    assert.ok(a.performanceScore < 0);
    assert.equal(b.performanceScore, 0);
});

test('game clock: tick advances, bad values ignored, reset clears', () => {
    const d = createDynamicDifficulty();
    d.reset();
    d.tick(0.5); d.tick(-1); d.tick(NaN); d.tick(Infinity);
    assert.equal(d.now(), 500);
    d.reset();
    assert.equal(d.now(), 0);
});

test('evaluate waits for the interval, then struggling lowers the score and applies modifiers', () => {
    const d = createDynamicDifficulty();
    d.reset();
    for (let i = 0; i < 20; i++) d.trackShotFired();
    d.trackShotHit(); // 5 % accuracy
    d.trackGreenSpawned(10); // none collected
    d.tick(5);
    d.evaluate(0);
    assert.equal(d.performanceScore, 0, 'not before 15 s');
    d.tick(11);
    d.evaluate(0);
    assert.ok(d.performanceScore < 0);
    assert.ok(d.asteroidSpeedMod < 1 && d.ufoSpawnMod > 1 && d.ufoAccuracyMod < 1);
    assert.ok(d.powerUpSpawnMod > 1 && d.greenRatioMod > 1 && d.extraLifeThresholdMod < 1);
});

test('skilled play raises the score; modifiers stay within their ranges', () => {
    const d = createDynamicDifficulty();
    d.reset();
    for (let k = 0; k < 20; k++) {
        for (let i = 0; i < 20; i++) { d.trackShotFired(); d.trackShotHit(); }
        d.trackGreenSpawned(5);
        for (let i = 0; i < 5; i++) d.trackGreenCollected(12);
        d.tick(16);
        d.evaluate((k + 1) * 16 * 40);
    }
    assert.ok(d.performanceScore > 0.3);
    assert.equal(d.getAdjustmentText(), 'Challenging');
    assert.equal(d.getAdjustmentLevel(), 'challenging');
    assert.ok(d.performanceScore <= 1);
    assert.ok(d.asteroidSpeedMod <= 1.4 + 1e-9 && d.ufoSpawnMod >= 0.5 - 1e-9);
});

test('adjustment levels and texts match', () => {
    assert.equal(adjustmentLevel(-0.31), 'assisting');
    assert.equal(adjustmentLevel(-0.3), 'balanced');
    assert.equal(adjustmentLevel(0.3), 'balanced');
    assert.equal(adjustmentLevel(0.31), 'challenging');
    const d = createDynamicDifficulty();
    d.reset();
    for (let i = 0; i < 3; i++) d.onPlayerDeath();
    assert.equal(d.getAdjustmentText(), 'Assisting');
    assert.equal(d.getAdjustmentLevel(), 'assisting');
    assert.equal(d.getAdjustmentColor(), '#00FF00');
});
