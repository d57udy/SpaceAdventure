// Balance targets for the 3D game (docs/plans/07-3d-game.md §2.1, §6.2), checked with the
// headless harness (scripts/balance3d.mjs) on short seeded runs so a change can't silently
// make the game trivial or unfair again.
//
// Phase 1 (rocks only): the bands below are the rocks' share of the plan's targets. UFOs and
// their shots (Phase 2) add the rest; the bands are tightened toward the full targets then.
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

test('Medium, level 1 (rocks only): a threat every 7.5 to 17 s; careless pilot loses a life every 50 to 240 s; dodging helps', () => {
    const careless = averagePilot({ seconds: SECONDS, pilot: 'nododge', difficulty: 'medium', view: 'far' }, SEEDS);
    const dodge = averagePilot({ seconds: SECONDS, pilot: 'dodge', difficulty: 'medium', view: 'far' }, SEEDS);
    const msg = `threats ${careless.threatsPerMin.toFixed(2)}/min, lives lost ${careless.hitsPerMin.toFixed(2)} vs ${dodge.hitsPerMin.toFixed(2)}/min`;
    assert.ok(careless.threatsPerMin >= 3.5 && careless.threatsPerMin <= 8, msg);
    assert.ok(careless.hitsPerMin >= 0.25 && careless.hitsPerMin <= 1.2, msg);
    assert.ok(dodge.hitsPerMin < careless.hitsPerMin, msg);
    // Collecting works: most of the level's crystals within 3 minutes
    assert.ok(careless.collected >= 10, `crystals ${careless.collected}`);
});

test('difficulty orders the danger: Easy < Hard', () => {
    const easy = averagePilot({ seconds: SECONDS, pilot: 'nododge', difficulty: 'easy', view: 'far' }, 4);
    const hard = averagePilot({ seconds: SECONDS, pilot: 'nododge', difficulty: 'hard', view: 'far' }, 4);
    assert.ok(easy.threatsPerMin < hard.threatsPerMin, `${easy.threatsPerMin} < ${hard.threatsPerMin}`);
    assert.ok(easy.hitsPerMin < hard.hitsPerMin, `${easy.hitsPerMin} < ${hard.hitsPerMin}`);
});

test('a level can be cleared: the dodging pilot finishes level 1 in about 2 to 5 minutes', () => {
    const times = [];
    for (let seed = 1; seed <= 4; seed++) times.push(...runPilot({ seed, seconds: 330, pilot: 'dodge', difficulty: 'medium', view: 'far' }).levelSeconds.slice(0, 1));
    assert.ok(times.length >= 3, `cleared in ${times.length} of 4 runs`);
    for (const t of times) assert.ok(t > 100 && t < 330, `level time ${t}`);
});
