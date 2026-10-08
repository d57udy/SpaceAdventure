// Balance targets for the 3D game (docs/plans/07-3d-game.md §2.1, §6.2), checked with the
// headless harness (scripts/balance3d.mjs) on short seeded runs so a change can't silently
// make the game trivial or unfair again.
//
// The bands are the plan's targets (Medium, Far, owner feedback 8 October 2026: more danger,
// growing with the level) with a tolerance for the short seeded runs: the careless pilot
// (always moving toward crystals) loses a life every 30 to 40 s at level 1, 22 to 30 s at
// level 3 and 15 to 22 s at level 5 (± 10 %); the dodging pilot every 75 to 120 s at level 1
// (± 20 %, it is a simple bot) and clearly more often at levels 3 and 5. The measured numbers
// are in plan 07 §2.1.
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

// One measurement per pilot, difficulty and level, shared by the tests below (8 seeds × 3
// minutes; the dodging pilot's level 3 and 5 rates need 16 seeds to be steady)
const cache = new Map();
function measure(pilot, difficulty, level, seeds = SEEDS) {
    const key = `${pilot} ${difficulty} ${level} ${seeds}`;
    if (!cache.has(key)) cache.set(key, averagePilot({ seconds: SECONDS, pilot, difficulty, view: 'far', level }, seeds));
    return cache.get(key);
}
const lifeEvery = (a) => 60 / Math.max(a.hitsPerMin, 1e-9);

test('Medium, level 1: a threat every 5 to 10 s; careless pilot loses a life every 30 to 40 s, the dodging pilot every 75 to 120 s', () => {
    const careless = measure('nododge', 'medium', 1);
    const dodge = measure('dodge', 'medium', 1);
    const msg = `threat every ${(60 / careless.threatsPerMin).toFixed(1)} s, a life every ${lifeEvery(careless).toFixed(0)} vs ${lifeEvery(dodge).toFixed(0)} s`;
    assert.ok(careless.threatsPerMin >= 6 && careless.threatsPerMin <= 12, msg);
    assert.ok(lifeEvery(careless) >= 27 && lifeEvery(careless) <= 44, msg);
    assert.ok(lifeEvery(dodge) >= 60 && lifeEvery(dodge) <= 144, msg);
    assert.ok(lifeEvery(dodge) > lifeEvery(careless) * 1.5, msg);
    // Collecting works: most of the level's crystals within 3 minutes
    assert.ok(careless.collected >= 10, `crystals ${careless.collected}`);
});

test('Medium: danger grows with the level (careless 22 to 30 s at level 3, 15 to 22 s at level 5; dodging clearly more often)', () => {
    const c = [1, 3, 5].map((L) => lifeEvery(measure('nododge', 'medium', L)));
    const d = [1, 3, 5].map((L) => lifeEvery(measure('dodge', 'medium', L, 16)));
    const msg = `careless ${c.map((x) => x.toFixed(0)).join(' / ')} s, dodging ${d.map((x) => x.toFixed(0)).join(' / ')} s at levels 1 / 3 / 5`;
    assert.ok(c[1] >= 20 && c[1] <= 33, msg);
    assert.ok(c[2] >= 13.5 && c[2] <= 24, msg);
    assert.ok(c[0] > c[1] && c[1] > c[2], msg);
    // Level 1 → 5: 10 to 30 % more often per level
    const growth = c[0] / c[2];
    assert.ok(growth >= 1.1 ** 4 && growth <= 1.3 ** 4, `${msg}: × ${growth.toFixed(2)}`);
    assert.ok(d[0] > d[1] && d[1] > d[2] && d[2] < d[0] * 0.7, msg);
});

test('difficulty orders the danger: Easy < Medium < Hard at levels 1, 3 and 5', () => {
    for (const L of [1, 3, 5]) {
        const [easy, medium, hard] = ['easy', 'medium', 'hard'].map((d) => measure('nododge', d, L).hitsPerMin);
        assert.ok(easy < medium && medium < hard, `level ${L}: ${easy.toFixed(2)} < ${medium.toFixed(2)} < ${hard.toFixed(2)} lives/min`);
    }
});

test('a level can be cleared: the dodging pilot finishes level 1 in about 2 to 5 minutes', () => {
    const times = [];
    for (let seed = 1; seed <= 4; seed++) times.push(...runPilot({ seed, seconds: 330, pilot: 'dodge', difficulty: 'medium', view: 'far' }).levelSeconds.slice(0, 1));
    assert.ok(times.length >= 3, `cleared in ${times.length} of 4 runs`);
    for (const t of times) assert.ok(t > 100 && t < 330, `level time ${t}`);
});

// Easy and Hard against Medium (plan 07 §2.1): Easy about half the Medium threat rate, Hard
// about 1.5 times, at levels 1, 3 and 5; and the threat rate grows with the level (4 to 15 %
// a level passes; measured about 11 %). 8 seeds × 3 minutes per point: the ratios are steady
// to about ± 0.1 at that size.
test('Easy about half, Hard about 1.5 times the Medium threat rate, at levels 1, 3 and 5; it grows with the level', () => {
    const tpm = {};
    for (const level of [1, 3, 5]) {
        for (const difficulty of ['easy', 'medium', 'hard']) {
            tpm[`${difficulty}${level}`] = measure('nododge', difficulty, level).threatsPerMin;
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

// Measured over 16 seeds: Easy 103 to 338 s, Medium 140 to 312 s, Hard 211 to 533 s
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
