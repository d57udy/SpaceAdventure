import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    createSim, stepSim, drainEvents, simCounts, SIM, nextId, rocksLeft, levelBlocked, pickupRadius, adaptiveInfo, aimTargets,
} from '../../js/3d/sim3d.js';
import { makeRock, WORLD, worldFor, wrappedDistance, nearestDelta } from '../../js/3d/world3d.js';
import { RULES3D, levelPlan, planRockCount, DIFFICULTY_3D, CRYSTAL_SIZES, createAdaptive3d } from '../../js/3d/rules3d.js';
import { qIdentity, qFromAxisAngle, vLen, vDot, vSub, vScale } from '../../js/3d/math3d.js';

const run = (s, input, seconds) => { for (let i = 0; i < Math.round(seconds * 60); i++) stepSim(s, input); };
const types = (s) => drainEvents(s).map((e) => e.type);
/** A world without levels, rocks placed by the test. */
const empty = (o = {}) => createSim({ field: false, ...o });
const place = (s, kind, dz, size = kind === 'green' ? 'large' : 'small', dx = 0) => {
    const [x, y, z] = s.ship.pos;
    const r = makeRock({ id: nextId(s), kind, size, pos: [x + dx, y, z + dz], vel: [0, 0, 0], rand: s.rand });
    s.rocks.push(r);
    return r;
};

test('seeded: same seed gives the same level field and the same run', () => {
    const a = createSim({ seed: 5 }), b = createSim({ seed: 5 });
    assert.deepEqual(a.rocks.map((r) => r.pos), b.rocks.map((r) => r.pos));
    const input = { q: qFromAxisAngle([0, 1, 0], 0.3), thrust: true, fire: true };
    run(a, input, 12); run(b, input, 12);
    assert.deepEqual(a.ship.pos, b.ship.pos);
    assert.equal(a.score, b.score);
    assert.deepEqual(simCounts(a), simCounts(b));
    assert.notDeepEqual(createSim({ seed: 6 }).rocks[0].pos, a.rocks[0].pos);
});

test('a new game: level 1 field from the plan, lives from the difficulty, banner', () => {
    for (const difficulty of ['easy', 'medium', 'hard']) {
        const s = createSim({ seed: 2, view: 'far', difficulty });
        const plan = levelPlan(1, { difficulty });
        assert.equal(s.level, 1);
        assert.equal(s.levels, true);
        assert.equal(s.lives, DIFFICULTY_3D[difficulty].startingLives, difficulty);
        assert.equal(rocksLeft(s), planRockCount(plan), difficulty);
        assert.equal(s.incoming.left, plan.incoming.count);
        assert.equal(simCounts(s).green, plan.greens);
        assert.equal(s.banner.text, 'LEVEL 1');
        for (const r of s.rocks) assert.ok(wrappedDistance(s.ship.pos, r.pos, s.size) >= s.world.spawnClearance - 1e-6);
        assert.ok(drainEvents(s).some((e) => e.type === 'level' && e.level === 1));
    }
});

test('thrust moves the ship along its nose; drag slows it', () => {
    const s = empty();
    const start = s.ship.pos.slice();
    run(s, { q: qIdentity(), thrust: true }, 1);
    assert.ok(s.ship.vel[2] < -100, 'moving along -Z');
    assert.ok(s.ship.pos[2] < start[2] - 50);
    const v = vLen(s.ship.vel);
    run(s, { q: qIdentity() }, 1);
    assert.ok(vLen(s.ship.vel) < v);
    run(s, { q: qIdentity(), thrust: true }, 5);
    assert.ok(vLen(s.ship.vel) <= SIM.maxSpeed + 1e-9);
});

test('fly into a crystal: collected with the 2D score for its size, combo counts', () => {
    const s = empty();
    place(s, 'green', -120, 'large');
    run(s, { q: qIdentity(), thrust: true }, 2);
    assert.equal(simCounts(s).green, 0);
    assert.equal(s.score, CRYSTAL_SIZES.large.score);
    assert.equal(s.stats.collected, 1);
    assert.equal(s.combo.count, 1);
    assert.ok(drainEvents(s).some((e) => e.type === 'collect' && e.points === 100));
    // Hard scores 1.5×
    const h = empty({ difficulty: 'hard' });
    place(h, 'green', -20, 'small');
    stepSim(h, { q: qIdentity() });
    assert.equal(h.score, Math.round(25 * 1.5));
});

test('combo: five quick crystals double the score, a streak bonus at 5; it lapses after 3 s', () => {
    const s = empty();
    for (let i = 0; i < 5; i++) {
        place(s, 'green', -10, 'large');
        stepSim(s, { q: qIdentity() });
    }
    // 100 × 4 at ×1, the fifth at ×2 plus the 5-streak bonus (5 × 100)
    assert.equal(s.score, 400 + 200 + 500);
    assert.equal(s.combo.multiplier, 2);
    assert.ok(drainEvents(s).some((e) => e.type === 'combo' && e.milestone === 5));
    run(s, { q: qIdentity() }, 3.1);
    assert.equal(s.combo.count, 0);
    assert.ok(drainEvents(s).some((e) => e.type === 'comboLost'));
});

test('shooting a crystal destroys it with no points (wasted), as in 2D', () => {
    const s = empty();
    place(s, 'green', -300, 'large');
    stepSim(s, { q: qIdentity(), fire: true });
    run(s, { q: qIdentity() }, 0.6);
    assert.equal(simCounts(s).green, 0);
    assert.equal(s.score, 0);
    assert.equal(s.stats.wasted, 1);
    assert.ok(drainEvents(s).some((e) => e.type === 'wasted'));
});

test('shoot a red: it splits into two, then the pieces into small ones; no points, as in 2D', () => {
    const s = empty();
    place(s, 'red', -300, 'large');
    s.ship.invulnerable = 99;
    stepSim(s, { q: qIdentity(), fire: true });
    assert.equal(simCounts(s).bullets, 1);
    run(s, { q: qIdentity() }, 0.5);
    const c = simCounts(s);
    assert.equal(c.red, 2, 'large → 2 medium');
    assert.ok(s.rocks.every((r) => r.size === 'medium'));
    assert.equal(s.score, 0);
    assert.equal(s.stats.redsShot, 1);
    assert.equal(c.bullets, 0, 'the bullet is used up');
    const ev = drainEvents(s);
    assert.ok(ev.some((e) => e.type === 'split' && e.size === 'large' && e.pieces === 2));
});

test('hit by a red: a life lost, the rock splits, 2 s without a ship, then 3 s protection with rocks pushed out', () => {
    const s = empty();
    const rock = place(s, 'red', -5, 'medium');
    stepSim(s, { q: qIdentity() });
    assert.equal(s.lives, DIFFICULTY_3D.medium.startingLives - 1);
    assert.equal(s.ship.alive, false);
    assert.ok(!s.rocks.includes(rock), 'split');
    assert.equal(simCounts(s).red, 2, 'medium → 2 small');
    const hit = drainEvents(s).find((e) => e.type === 'hit');
    assert.ok(hit && vLen(hit.from) < 40, 'the hit carries its direction');
    // No control while the ship is gone
    const pos = s.ship.pos.slice();
    run(s, { q: qIdentity(), thrust: true, fire: true }, 1);
    assert.deepEqual(s.ship.pos, pos);
    assert.equal(s.bullets.length, 0);
    // A rock drifts right onto the respawn point
    place(s, 'red', 20, 'small');
    run(s, { q: qIdentity() }, RULES3D.respawnDelay - 1 + 0.05);
    assert.equal(s.ship.alive, true);
    assert.ok(types(s).includes('respawn'));
    assert.ok(Math.abs(s.ship.invulnerable - RULES3D.respawnInvulnerable) < 0.1);
    for (const r of s.rocks) assert.ok(wrappedDistance(s.ship.pos, r.pos, s.size) >= RULES3D.respawnPush + r.radius - 1e-6);
    // Protected: a rock right on the ship does nothing
    place(s, 'red', -3);
    stepSim(s, { q: qIdentity() });
    assert.equal(s.lives, DIFFICULTY_3D.medium.startingLives - 1);
});

test('a shield absorbs one hit, then 1 s of protection', () => {
    const s = empty();
    s.ship.shield = 10;
    place(s, 'red', -3);
    stepSim(s, { q: qIdentity() });
    assert.equal(s.lives, DIFFICULTY_3D.medium.startingLives);
    assert.equal(s.ship.alive, true);
    assert.equal(s.ship.shield, 0);
    assert.ok(Math.abs(s.ship.invulnerable - RULES3D.shieldGrace) < 0.02);
    assert.ok(types(s).includes('shieldHit'));
});

test('out of lives: game over, no control', () => {
    const s = empty({ difficulty: 'hard' });
    for (let i = 0; i < DIFFICULTY_3D.hard.startingLives; i++) {
        s.ship.invulnerable = 0;
        if (!s.ship.alive) run(s, { q: qIdentity() }, RULES3D.respawnDelay + 0.05);
        s.ship.invulnerable = 0;
        place(s, 'red', -3);
        stepSim(s, { q: qIdentity() });
    }
    assert.equal(s.lives, 0);
    assert.equal(s.over, true);
    assert.ok(drainEvents(s).some((e) => e.type === 'gameover'));
    const pos = s.ship.pos.slice();
    run(s, { q: qIdentity(), thrust: true, fire: true }, 3);
    assert.deepEqual(s.ship.pos, pos, 'no control after game over');
    assert.equal(s.ship.alive, false, 'no respawn after game over');
});

test('extra life every 10000 points', () => {
    const s = empty();
    s.score = 9950;
    place(s, 'green', -10, 'large');
    stepSim(s, { q: qIdentity() });
    assert.equal(s.lives, DIFFICULTY_3D.medium.startingLives + 1);
    assert.equal(s.nextExtraLife, 20000);
    assert.ok(types(s).includes('extraLife'));
    // The adaptive modifier stretches the next threshold (2D extraLifeThresholdMod)
    const d = empty({ dda: { extraLifeThresholdMod: 1.5 } });
    d.score = 9990;
    place(d, 'green', -10, 'small');
    stepSim(d, { q: qIdentity() });
    assert.equal(d.nextExtraLife, 25000);
});

test('level complete: nothing left → next level, banner, protection; UFOs and the boss block it', () => {
    const s = createSim({ seed: 3 });
    drainEvents(s);
    // Clear the field by hand: level 1 still has incoming rocks to send
    s.rocks = [];
    stepSim(s, { q: qIdentity() });
    assert.equal(s.level, 1, 'incoming rocks still to come');
    assert.ok(s.rocks.some((r) => r.incoming), 'with the rest cleared, the next incoming comes at once');
    // Pretend every incoming rock was dealt with
    s.incoming.left = 0;
    s.rocks = [];
    const [x, y, z] = s.ship.pos;
    const u = s.ufoSys.spawnAt([x + 1000, y, z], s.ship.pos);
    stepSim(s, { q: qIdentity() });
    assert.equal(s.level, 1, 'a hostile UFO blocks the level end');
    assert.equal(levelBlocked(s), true);
    s.ufoSys.destroy(u.id);
    s.boss = { alive: true, update: () => [], hitTest: () => null, collideBullets: () => [], touches: () => false, state: { pos: [0, 0, 0], bullets: [] } };
    stepSim(s, { q: qIdentity() });
    assert.equal(s.level, 1, 'the boss blocks the level end');
    s.boss = null;
    stepSim(s, { q: qIdentity() });
    assert.equal(s.level, 2);
    assert.equal(s.stats.levels, 1);
    assert.equal(s.banner.text, 'LEVEL 2');
    assert.ok(s.ship.invulnerable >= RULES3D.levelInvulnerable - 0.02);
    assert.equal(rocksLeft(s), planRockCount(levelPlan(2, { boss: true })), 'level 2 is a boss level: 40 % of the rocks');
    assert.ok(drainEvents(s).some((e) => e.type === 'level' && e.level === 2));
    run(s, { q: qIdentity() }, RULES3D.bannerSeconds + 0.1);
    assert.equal(s.banner, null);
});

test('no level end while the ship is gone', () => {
    const s = createSim({ seed: 3 });
    s.incoming.left = 0;
    s.rocks = [];
    s.ship.alive = false;
    s.ship.respawn = 1;
    stepSim(s, { q: qIdentity() });
    assert.equal(s.level, 1);
    run(s, { q: qIdentity() }, 1.1);
    assert.equal(s.level, 2);
});

test('incoming rocks: sent on the difficulty interval, at the cull distance, aimed near the ship, at most 4 in flight', () => {
    const s = createSim({ seed: 9, view: 'far' });
    const interval = levelPlan(1).incoming.interval;
    run(s, { q: qIdentity() }, interval - 0.1);
    assert.equal(simCounts(s).incoming, 0);
    run(s, { q: qIdentity() }, 0.2);
    const inc = s.rocks.filter((r) => r.incoming);
    assert.equal(inc.length, 1);
    const d = wrappedDistance(s.ship.pos, inc[0].pos, s.size);
    assert.ok(d > s.world.fogFar, `out of sight: ${d}`);
    // Its course passes the (still) ship within the miss disc
    const r = inc[0];
    const toShip = nearestDelta(r.pos, s.ship.pos, s.size);
    const v = vLen(r.vel);
    const along = vDot(toShip, r.vel) / v;
    assert.ok(along > 0, 'heading in');
    const miss = vLen(vSub(toShip, vScale(r.vel, along / v)));
    assert.ok(miss <= (r.radius + SIM.shipRadius) * RULES3D.incomingMiss + 1, `miss ${miss}`);
    assert.ok(v >= levelPlan(1).incoming.speed[0] - 1e-6 && v <= levelPlan(1).incoming.speed[1] + 1e-6);
    // Never more than the cap in flight
    for (let i = 0; i < 60 * 40; i++) {
        stepSim(s, { q: qIdentity() });
        assert.ok(simCounts(s).incoming <= RULES3D.maxIncomingInFlight);
    }
});

test('rocks left = rocks on the field + incoming ones not sent yet, throughout a run', () => {
    const s = createSim({ seed: 4, view: 'far', ufos: false }); // UFO hits would hold the incoming rocks
    const plan = levelPlan(1);
    for (let i = 0; i < 60 * 40; i++) {
        stepSim(s, { q: qIdentity() });
        if (i % 60 === 0) assert.equal(rocksLeft(s), s.rocks.length + plan.incoming.count - s.incoming.sent);
    }
    assert.ok(s.incoming.sent >= 5, `sent ${s.incoming.sent}`);
});

test('a seeded 60 s run plays: shots, splits, no refills', () => {
    const s = createSim({ seed: 11 });
    const start = rocksLeft(s);
    let q = qIdentity();
    for (let i = 0; i < 60 * 60; i++) {
        if (i % 120 === 0) q = qFromAxisAngle([Math.sin(i), 1, Math.cos(i)], i * 0.01);
        stepSim(s, { q, thrust: i % 3 === 0, fire: true });
        drainEvents(s);
    }
    assert.ok(s.stats.shots > 100);
    // Splits add pieces, nothing else adds rocks: left can only grow by splits
    assert.ok(rocksLeft(s) <= start + s.stats.splits, `${rocksLeft(s)} <= ${start} + ${s.stats.splits}`);
});

test('view distance presets: world size, a level field inside the cube, bullet range', () => {
    for (const view of ['normal', 'far', 'veryfar']) {
        const w = worldFor(view);
        const s = createSim({ seed: 3, view });
        assert.equal(s.size, w.size, view);
        assert.equal(s.world.name, view);
        for (const r of s.rocks) for (const v of r.pos) assert.ok(v >= 0 && v < w.size);
        stepSim(s, { q: qIdentity(), fire: true });
        assert.ok(Math.abs(s.bullets[0].life - (w.bulletLife - SIM.dt)) < 1e-9, view);
    }
});

test('a plain random field (no levels) still works for the prototype counts', () => {
    const s = createSim({ seed: 1, greens: WORLD.greens, reds: WORLD.reds });
    assert.equal(s.levels, false);
    assert.deepEqual([simCounts(s).green, simCounts(s).red], [WORLD.greens, WORLD.reds]);
});

test('adaptive difficulty: the sim feeds the tracker as 2D does', () => {
    const adaptive = createAdaptive3d();
    const s = createSim({ seed: 4, adaptive });
    assert.equal(adaptive.greenAsteroidsSpawned, s.plan.greens, 'crystals of the level counted as spawned');
    s.rocks = [];
    s.incoming.left = 0;
    const g = place(s, 'red', -300, 'large');
    run(s, { q: qIdentity(), fire: true }, 0.5);
    assert.ok(adaptive.shotsFired >= 3 && adaptive.shotsFired === s.stats.shots);
    assert.ok(adaptive.shotsHit >= 1 && adaptive.shotsHit === s.stats.shotsHit);
    assert.equal(adaptive.redAsteroidsDestroyed, s.stats.redsShot);
    assert.ok(!s.rocks.includes(g));
    s.rocks = [];
    place(s, 'red', 1000); // keeps the level going
    place(s, 'green', -10);
    stepSim(s, { q: qIdentity() });
    assert.equal(adaptive.greenAsteroidsCollected, 1);
    // A lost life: the 2D immediate death penalty
    place(s, 'red', -5, 'large');
    stepSim(s, { q: qIdentity() });
    assert.equal(adaptive.deaths, 1);
    assert.ok(adaptive.performanceScore < 0);
    // Game time and evaluation run with the sim (15 s interval)
    assert.ok(adaptive.now() > 0);
});

test('adaptive difficulty: level and modifiers follow the tracker; Assisting widens the pickup radius', () => {
    const adaptive = createAdaptive3d();
    const s = empty({ adaptive });
    assert.equal(adaptiveInfo(s).text, 'Balanced');
    assert.equal(s.assist.level, 'balanced');
    const r0 = pickupRadius(s);
    adaptive.performanceScore = -0.6;
    adaptive.applyAdjustments();
    stepSim(s, { q: qIdentity() });
    assert.equal(s.assist.level, 'assisting');
    assert.equal(adaptiveInfo(s).text, 'Assisting');
    assert.equal(adaptiveInfo(s).color, '#00FF00');
    assert.ok(Math.abs(pickupRadius(s) - r0 * 1.5) < 1e-9, '+50 % collection radius');
    assert.ok(s.dda.asteroidSpeedMod < 1 && s.dda.greenRatioMod > 1 && s.dda.powerUpSpawnMod > 1 && s.dda.extraLifeThresholdMod < 1);
    assert.ok(s.dda.ufoSpawnMod > 1 && s.dda.ufoAccuracyMod < 1, 'UFO modifiers kept for the UFO system');
    adaptive.performanceScore = 0.6;
    adaptive.applyAdjustments();
    stepSim(s, { q: qIdentity() });
    assert.equal(s.assist.level, 'challenging');
    assert.equal(s.assist.aimDeg, 0);
    assert.equal(pickupRadius(s), r0);
});

test('adaptive difficulty: a new rock speed modifier applies to the incoming rocks still to come', () => {
    const adaptive = createAdaptive3d();
    const s = createSim({ seed: 2, adaptive });
    const before = s.incoming.speed.slice();
    adaptive.performanceScore = 0.5;
    adaptive.applyAdjustments();
    stepSim(s, { q: qIdentity() });
    assert.ok(Math.abs(s.incoming.speed[1] / before[1] - adaptive.asteroidSpeedMod) < 1e-9);
});

test('aim assist: a rock 3° off the nose is hit when Assisting (4°), missed when Challenging (off)', () => {
    const shoot = (assist) => {
        const s = empty({ assist });
        const [x, y, z] = s.ship.pos;
        const d = 500;
        s.rocks.push(makeRock({ id: nextId(s), kind: 'red', size: 'small', pos: [x + Math.sin(3 * Math.PI / 180) * d, y, z - Math.cos(3 * Math.PI / 180) * d], rand: s.rand }));
        stepSim(s, { q: qIdentity(), fire: true });
        run(s, { q: qIdentity() }, 1);
        return s;
    };
    const a = shoot('assisting');
    assert.equal(a.stats.redsShot, 1);
    assert.equal(a.stats.assisted, 1);
    const c = shoot('challenging');
    assert.equal(c.stats.redsShot, 0);
    assert.equal(c.stats.assisted, 0);
    assert.equal(shoot('balanced').stats.redsShot, 0, '3° is beyond Balanced (2°)');
    // Crystals are never aim-assist targets
    const s = empty();
    place(s, 'green', -300);
    place(s, 'red', -300, 'small');
    assert.deepEqual(aimTargets(s).map((r) => r.kind), ['red']);
});

// --- Regression tests for docs/plans/07-review.md
import { showAllTargets as rvShowAll, MAX_EVENTS as RV_MAX_EVENTS } from '../../js/3d/sim3d.js';
import { BOSS3D as RV_BOSS3D } from '../../js/3d/boss3d.js';

test('review #2: a shield hit protects from a second hit in the same step', () => {
    const s = empty({ lives: 3 });
    s.power.activate('shield');
    place(s, 'red', 0, 'small', 10);
    place(s, 'red', 0, 'small', -10);
    stepSim(s, {});
    const t = types(s);
    assert.deepEqual(t.filter((x) => x === 'hit' || x === 'shieldHit'), ['shieldHit']);
    assert.equal(s.lives, 3);
    // Two UFO-shot-like hits through shipHit: only the first counts while protected
    const s2 = empty({ lives: 3 });
    s2.ship.invulnerable = 0.5;
    place(s2, 'red', 0, 'small', 5);
    stepSim(s2, {});
    assert.equal(s2.lives, 3, 'protected: no hit');
});

test('review #3: nothing scores after the game is over (shots in flight are cleared)', () => {
    const s = empty({ lives: 1 });
    const [x, y, z] = s.ship.pos;
    const u = s.ufoSys.spawnAt([x, y, z - 80], s.ship.pos);
    u.vel = [0, 0, 0];
    s.bullets.push({ id: nextId(s), pos: [x, y, z - 20], vel: [0, 0, -900], life: 1 });
    place(s, 'red', 0, 'small', 5);
    run(s, {}, 0.2);
    const t = types(s);
    assert.ok(t.includes('gameover'));
    assert.ok(!t.includes('ufoDestroyed'), t.join());
    assert.equal(s.score, 0);
    assert.equal(s.bullets.length, 0);
});

test('review #4: a respawn never leaves the ship inside the boss', () => {
    const s = createSim({ seed: 3, level: 2, lives: 3 });
    assert.ok(s.boss);
    s.ship.pos = s.boss.state.pos.slice(); // a failed jump left it right inside
    s.ship.alive = false;
    s.ship.respawn = 1 / 120;
    stepSim(s, {});
    assert.equal(s.ship.alive, true);
    const d = wrappedDistance(s.ship.pos, s.boss.state.pos, s.size);
    assert.ok(d >= RV_BOSS3D.bodyRadius + SIM.shipRadius, `outside the boss (${d})`);
});

test('review #1: no rock left: a UFO lost far away heads back, and the radar shows everything', () => {
    const s = createSim({ seed: 4, view: 'far', lives: 99 });
    s.incoming.left = 0;
    s.rocks = [];
    const u = s.ufoSys.spawnAt(s.ship.pos, s.ship.pos);
    u.pos = [s.ship.pos[0] + 1550, s.ship.pos[1] + 1000, s.ship.pos[2]]; // beyond the cull distance
    u.vel = [100, 0, 0]; // flying away
    s.ufos = s.ufoSys.ufos;
    assert.equal(rvShowAll(s), true, 'blocking UFO with no rocks: show all at any distance');
    stepSim(s, {});
    const toShip = nearestDelta(u.pos, s.ship.pos, s.size);
    assert.ok(vDot(u.vel, toShip) > 0, 're-aimed toward the ship');
    // It comes within the cull distance instead of leaving
    let closest = Infinity;
    for (let i = 0; i < 60 * 30 && s.level === 1; i++) {
        stepSim(s, {});
        if (s.ufos.length) closest = Math.min(closest, wrappedDistance(s.ufos[0].pos, s.ship.pos, s.size));
    }
    assert.ok(closest < s.world.cullDistance, `came back (${closest})`);
    // With rocks left it is not "show all"
    const t = createSim({ seed: 4, view: 'far' });
    assert.equal(rvShowAll(t), false);
});

test('review #8: the first UFO of a new level is timed with the new level', () => {
    const s = createSim({ seed: 9, lives: 99 });
    s.incoming.left = 0;
    s.rocks = [];
    stepSim(s, {}); // level 2 starts
    assert.equal(s.level, 2);
    assert.equal(s.ufoSys.state.level, 2);
    const lo = 15 * 1 * 1 * (1 - 2 * 0.05) * 0.75, hi = 15 * (1 - 2 * 0.05) * 1.25;
    assert.ok(s.ufoSys.state.spawnTimer >= lo - 1e-9 && s.ufoSys.state.spawnTimer <= hi + 1e-9, `${s.ufoSys.state.spawnTimer}`);
});

test('review #9: shots the boss body absorbs are not hits for the adaptive difficulty', () => {
    const adaptive = createAdaptive3d();
    const s = createSim({ seed: 3, level: 2, lives: 99, adaptive });
    s.rocks = [];
    s.incoming.left = 0;
    const b = s.boss.state;
    // Straight at the body centre, away from every weak point direction (entering: absorbed)
    const [x, y, z] = b.pos;
    s.ship.pos = [x, y, z + 400];
    s.bullets.push({ id: nextId(s), pos: [x, y, z + 300], vel: [0, 0, -900], life: 1 });
    const before = s.stats.shotsHit;
    run(s, {}, 0.3);
    assert.equal(s.bullets.length, 0, 'the body absorbed it');
    assert.equal(s.stats.shotsHit, before);
});

test('review #10: split pieces are wrapped into the cube', () => {
    const s = empty();
    const [x, y, z] = s.ship.pos;
    const r = makeRock({ id: nextId(s), kind: 'red', size: 'large', pos: [s.size - 1, y, z - 200], vel: [0, 0, 0], rand: s.rand });
    s.rocks.push(r);
    s.bullets.push({ id: nextId(s), pos: [s.size - 1, y, z - 120], vel: [0, 0, -900], life: 1 });
    run(s, {}, 0.2);
    assert.ok(s.rocks.length >= 2, 'split');
    for (const p of s.rocks) for (const c of p.pos) assert.ok(c >= 0 && c < s.size, `${p.pos}`);
});

test('review #14: dropped events are counted', () => {
    const s = empty();
    for (let i = 0; i < RV_MAX_EVENTS + 25; i++) s.events.push({ type: 'x' });
    stepSim(s, { fire: true });
    assert.equal(s.events.length, RV_MAX_EVENTS);
    assert.ok(simCounts(s).eventsDropped >= 26);
});

test('review #13: the UFO and power-up modifiers are reconfigured only when the adaptive modifiers change', () => {
    const adaptive = createAdaptive3d();
    const s = createSim({ seed: 2, view: 'far', adaptive, lives: 99 });
    let ufoCalls = 0, powerCalls = 0;
    const uc = s.ufoSys.configure, pc = s.power.configure;
    s.ufoSys.configure = (o) => { if (o && o.dda) ufoCalls++; return uc(o); };
    s.power.configure = (o) => { powerCalls++; return pc(o); };
    const ddaBefore = s.dda;
    run(s, { fire: true }, 2);
    assert.equal(ufoCalls, 0, 'nothing changed: no reconfigure');
    assert.equal(powerCalls, 0);
    assert.equal(s.dda, ddaBefore, 'same object');
    // The tracker moves: the new modifiers apply on the next step, everywhere
    adaptive.ufoSpawnMod = 0.8;
    adaptive.ufoAccuracyMod = 1.1;
    adaptive.powerUpSpawnMod = 1.3;
    stepSim(s, {});
    assert.equal(ufoCalls, 1);
    assert.equal(powerCalls, 1);
    assert.equal(s.dda.ufoSpawnMod, 0.8);
    assert.equal(s.ufoSys.state.dda.ufoAccuracyMod, 1.1);
    assert.equal(s.power.state.spawnMod, 1.3);
    stepSim(s, {});
    assert.equal(ufoCalls, 1, 'once per change');
});
