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
import { averagePilot, runPilot, turnToward, leadDirection, PILOT } from '../../scripts/balance3d.mjs';
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
    const easy = averagePilot({ seconds: SECONDS, pilot: 'nododge', difficulty: 'easy', view: 'far' }, 4);
    const medium = averagePilot({ seconds: SECONDS, pilot: 'nododge', difficulty: 'medium', view: 'far' }, 4);
    const hard = averagePilot({ seconds: SECONDS, pilot: 'nododge', difficulty: 'hard', view: 'far' }, 4);
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
