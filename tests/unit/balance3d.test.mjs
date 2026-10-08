// Balance targets for the 3D game (docs/plans/07-3d-game.md §2.1, §6.2), checked with the
// headless harness (scripts/balance3d.mjs) on short seeded runs so a change can't silently
// make the game trivial or unfair again.
//
// With UFOs (Phase 2 and 3) the bands are the plan's full targets (Medium, level 1, Far) with
// a tolerance for the short seeded runs: a threat every 6 to 10 s, the careless pilot losing a
// life every 30 to 60 s (± 10 %), the dodging pilot every 2 to 3 minutes (± 20 %, it is a
// simple bot). The measured numbers are in plan 07 §2.1.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { averagePilot, runPilot, turnToward, leadDirection, ufoHitCheck, PILOT } from '../../scripts/balance3d.mjs';
import { levelPlan } from '../../js/3d/rules3d.js';
import { forwardOf, qIdentity, vDot, vNorm, vLen, vSub, vScale, vAdd } from '../../js/3d/math3d.js';
import { SIM } from '../../js/3d/sim3d.js';

const SECONDS = 180;
const SEEDS = 8;

test('pilot helpers: turning is rate-limited; the lead meets a moving target', () => {
    const q = turnToward(qIdentity(), [1, 0, 0], PILOT.turnRate / 60);
    const f = forwardOf(q);
    assert.ok(Math.abs(Math.acos(vDot(f, [0, 0, -1])) - PILOT.turnRate / 60) < 1e-6);
    const d = [0, 0, -600], shipVel = [80, 0, 0], vel = [0, 50, 0];
    const u = leadDirection(d, shipVel, vel);
    // A bullet with the ship's velocity along u meets the target
    const bullet = vAdd(vScale(u, SIM.bulletSpeed), shipVel);
    const rel = vSub(bullet, vel);
    const t = vLen(d) / vDot(vNorm(d), rel);
    assert.ok(vLen(vSub(vScale(rel, t), d)) < 1, 'hits');
});

test('Medium, level 1: a threat every 6 to 10 s; careless pilot loses a life every 30 to 60 s, the dodging pilot every 2 to 3 min', () => {
    const careless = averagePilot({ seconds: SECONDS, pilot: 'nododge', difficulty: 'medium', view: 'far' }, SEEDS);
    const dodge = averagePilot({ seconds: SECONDS, pilot: 'dodge', difficulty: 'medium', view: 'far' }, SEEDS);
    const msg = `threats ${careless.threatsPerMin.toFixed(2)}/min, lives lost ${careless.hitsPerMin.toFixed(2)} vs ${dodge.hitsPerMin.toFixed(2)}/min`;
    assert.ok(careless.threatsPerMin >= 6 && careless.threatsPerMin <= 10, msg);
    assert.ok(careless.hitsPerMin >= 0.9 && careless.hitsPerMin <= 2.2, msg);
    assert.ok(dodge.hitsPerMin >= 60 / 216 && dodge.hitsPerMin <= 60 / 96, msg);
    assert.ok(dodge.hitsPerMin < careless.hitsPerMin * 0.7, msg);
    // Collecting works: most of the level's crystals within 3 minutes
    assert.ok(careless.collected >= 10, `crystals ${careless.collected}`);
});

test('difficulty orders the danger: Easy < Medium < Hard', () => {
    // 12 seeds: lives lost come in whole numbers per run, so 4 seeds could tie Medium and Hard
    const easy = averagePilot({ seconds: SECONDS, pilot: 'nododge', difficulty: 'easy', view: 'far' }, 12);
    const medium = averagePilot({ seconds: SECONDS, pilot: 'nododge', difficulty: 'medium', view: 'far' }, 12);
    const hard = averagePilot({ seconds: SECONDS, pilot: 'nododge', difficulty: 'hard', view: 'far' }, 12);
    assert.ok(easy.threatsPerMin < hard.threatsPerMin, `${easy.threatsPerMin} < ${hard.threatsPerMin}`);
    assert.ok(easy.hitsPerMin < medium.hitsPerMin && medium.hitsPerMin < hard.hitsPerMin,
        `${easy.hitsPerMin} < ${medium.hitsPerMin} < ${hard.hitsPerMin}`);
});

test('a level can be cleared: the dodging pilot finishes level 1 in about 2 to 5 minutes', () => {
    const times = [];
    for (let seed = 1; seed <= 4; seed++) times.push(...runPilot({ seed, seconds: 330, pilot: 'dodge', difficulty: 'medium', view: 'far' }).levelSeconds.slice(0, 1));
    assert.ok(times.length >= 3, `cleared in ${times.length} of 4 runs`);
    for (const t of times) assert.ok(t > 100 && t < 330, `level time ${t}`);
});

// Easy and Hard against Medium (plan 07 §2.1): Easy about half the Medium threat rate, Hard
// about 1.5 times, at levels 1, 3 and 5; and the threat rate grows with the level (about
// 8 % a level in the plan; 4 to 15 % a level passes). 8 seeds × 3 minutes per point: the
// ratios are steady to about ± 0.1 at that size (measured 0.47 to 0.56 and 1.34 to 1.56).
test('Easy about half, Hard about 1.5 times the Medium threat rate, at levels 1, 3 and 5; it grows with the level', () => {
    const tpm = {};
    for (const level of [1, 3, 5]) {
        for (const difficulty of ['easy', 'medium', 'hard']) {
            tpm[`${difficulty}${level}`] = averagePilot({ seconds: SECONDS, pilot: 'nododge', difficulty, view: 'far', level }, 8).threatsPerMin;
        }
        const easy = tpm[`easy${level}`] / tpm[`medium${level}`];
        const hard = tpm[`hard${level}`] / tpm[`medium${level}`];
        assert.ok(easy >= 0.4 && easy <= 0.68, `level ${level}: Easy × ${easy.toFixed(2)}`);
        assert.ok(hard >= 1.25 && hard <= 1.8, `level ${level}: Hard × ${hard.toFixed(2)}`);
    }
    const growth = tpm.medium5 / tpm.medium1; // 4 levels
    assert.ok(growth >= 1.04 ** 4 && growth <= 1.15 ** 4, `Medium level 1 → 5: × ${growth.toFixed(2)}`);
    assert.ok(tpm.medium3 > tpm.medium1 && tpm.medium5 > tpm.medium3, `${tpm.medium1} < ${tpm.medium3} < ${tpm.medium5}`);
});

// Measured over 16 seeds: Easy 107 to 253 s, Medium 163 to 265 s, Hard 172 to 500 s
test('the boss level (level 2) can be beaten: the dodging pilot clears it within 6 minutes (Hard 9)', () => {
    for (const difficulty of ['easy', 'medium', 'hard']) {
        const limit = difficulty === 'hard' ? 540 : 360;
        const times = [];
        for (let seed = 1; seed <= 3; seed++) {
            times.push(...runPilot({ seed, seconds: limit, pilot: 'dodge', difficulty, view: 'far', level: 2 }).levelSeconds.slice(0, 1));
        }
        assert.ok(times.length >= 2, `${difficulty}: cleared in ${times.length} of 3 runs`);
        for (const t of times) assert.ok(t > 60 && t < limit, `${difficulty}: boss level in ${t.toFixed(0)} s`);
    }
});

test('boss levels: floor(40 %) of the red rocks (2D createLevelAsteroids), half the crystals, fewer clusters', () => {
    const reds = (p) => p.clusters * (p.clusterRocks.large + p.clusterRocks.medium + p.clusterRocks.small) + p.scattered + p.incoming.count;
    for (const difficulty of ['easy', 'medium', 'hard']) {
        for (const level of [2, 4, 6, 10]) {
            const n = levelPlan(level, { difficulty }), b = levelPlan(level, { difficulty, boss: true });
            assert.equal(reds(b), Math.floor(reds(n) * 0.4), `${difficulty} ${level}`);
            assert.equal(b.greens, Math.round(n.greens * 0.5));
            assert.ok(b.clusters < n.clusters);
        }
    }
});

// Plan 07 §2.4 / §6.2: a UFO shot at a still ship hits as often as a 2D shot at the same
// distance (in 2D px). Measured: × 1.08, 1.04, 1.01 (Easy, Medium, Hard; 40 seeds × 10
// minutes). Easy has few hits (about 6 %), so it needs the most shots to be steady.
test('UFO hit chance matches 2D at the same distance (still ship), on every difficulty', () => {
    for (const difficulty of ['easy', 'medium', 'hard']) {
        let hits = 0, expected = 0, shots = 0;
        for (let seed = 1; seed <= 16; seed++) {
            const r = ufoHitCheck({ seed, seconds: 600, difficulty, view: 'far' });
            hits += r.hits; expected += r.expected; shots += r.shots;
        }
        assert.ok(shots > 1200, `${difficulty}: ${shots} shots`);
        const ratio = hits / expected;
        assert.ok(ratio > 0.8 && ratio < 1.25, `${difficulty}: 3D hits ${hits} vs 2D ${expected.toFixed(1)} (× ${ratio.toFixed(2)})`);
    }
});
