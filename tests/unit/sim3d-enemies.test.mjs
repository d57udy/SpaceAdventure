// The 3D simulation with UFOs, the boss, power-ups and hyperspace (js/3d/sim3d.js using
// ufo3d.js, boss3d.js, powerup3d.js, hyperspace3d.js; plan 07 §2.4 to §2.8).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    createSim, stepSim, drainEvents, nextId, levelBlocked, activeEffects, hyperspaceState, pickupRadius, SIM, simCounts,
} from '../../js/3d/sim3d.js';
import { makeRock, nearestDelta } from '../../js/3d/world3d.js';
import { createAdaptive3d, DIFFICULTY_3D } from '../../js/3d/rules3d.js';
import { UFO3D } from '../../js/3d/ufo3d.js';
import { BOSS3D, weakPointPlan } from '../../js/3d/boss3d.js';
import { POWERUP3D } from '../../js/3d/powerup3d.js';
import { qIdentity, vLen, vScale, vAdd } from '../../js/3d/math3d.js';

const run = (s, input, seconds) => { for (let i = 0; i < Math.round(seconds * 60); i++) stepSim(s, input); };
const types = (s) => drainEvents(s).map((e) => e.type);
const empty = (o = {}) => createSim({ field: false, ...o });
const ahead = (s, d) => { const [x, y, z] = s.ship.pos; return [x, y, z - d]; };
const place = (s, kind, pos, size = 'small') => {
    const r = makeRock({ id: nextId(s), kind, size, pos, vel: [0, 0, 0], rand: s.rand });
    s.rocks.push(r);
    return r;
};
/** A UFO shot at `pos` flying with `vel` (straight into the UFO system's list). */
const ufoShot = (s, pos, vel) => s.ufoSys.state.bullets.push({ id: nextId(s), hostile: true, pos, prev: pos, vel, life: 3, radius: 3 });

test('UFOs appear on a level after the 2D interval and follow the adaptive modifiers', () => {
    const adaptive = createAdaptive3d();
    const s = createSim({ seed: 2, adaptive });
    assert.equal(s.ufos.length, 0);
    const t = s.ufoSys.state.spawnTimer;
    assert.ok(t > 15 * 0.95 * 0.74 && t < 15 * 1.26, `timer ${t}`);
    run(s, { q: qIdentity() }, t + 0.1);
    assert.ok(s.ufos.length === 1 || s.stats.hits > 0, 'one UFO (unless it already rammed us)');
    assert.ok(drainEvents(s).some((e) => e.type === 'ufoSpawn'));
    adaptive.performanceScore = -0.8;
    adaptive.applyAdjustments();
    stepSim(s, { q: qIdentity() });
    assert.equal(s.ufoSys.state.dda.ufoSpawnMod, adaptive.ufoSpawnMod);
    assert.equal(s.ufoSys.state.dda.ufoAccuracyMod, adaptive.ufoAccuracyMod);
    assert.equal(s.power.state.spawnMod, adaptive.powerUpSpawnMod);
    // Without levels (test layouts) no UFO comes unless asked for
    const e = empty();
    run(e, { q: qIdentity() }, 30);
    assert.equal(e.ufos.length, 0);
});

test('shooting a UFO: 200 points × the difficulty, destroyed, a drop chance; a hostile UFO blocks the level', () => {
    for (const difficulty of ['medium', 'hard']) {
        const s = empty({ difficulty });
        const u = s.ufoSys.spawnAt(ahead(s, 300), s.ship.pos);
        u.vel = [0, 0, 0];
        assert.equal(levelBlocked(s), false, 'ufos list refreshes on the next step');
        stepSim(s, { q: qIdentity() });
        assert.equal(levelBlocked(s), true);
        run(s, { q: qIdentity(), fire: true }, 0.5);
        assert.equal(s.stats.ufosShot, 1);
        assert.equal(s.ufos.length, 0);
        assert.equal(s.score, Math.round(UFO3D.score * DIFFICULTY_3D[difficulty].scoreMultiplier));
        assert.ok(drainEvents(s).some((e) => e.type === 'ufoDestroyed' && e.by === 'player'));
    }
});

test('UFO shots: a life lost; the shield power-up absorbs one; crystals destroyed and red rocks split', () => {
    const s = empty();
    ufoShot(s, ahead(s, 40), [0, 0, 350]);
    run(s, { q: qIdentity() }, 0.3);
    assert.equal(s.lives, DIFFICULTY_3D.medium.startingLives - 1);
    assert.ok(drainEvents(s).some((e) => e.type === 'hit' && e.cause === 'ufoShot'));
    // Shield power-up
    const t = empty();
    t.power.activate('shield');
    ufoShot(t, ahead(t, 40), [0, 0, 350]);
    run(t, { q: qIdentity() }, 0.3);
    assert.equal(t.lives, DIFFICULTY_3D.medium.startingLives);
    assert.equal(t.power.active('shield'), false, 'the shield broke');
    assert.ok(t.ship.invulnerable > 0);
    assert.ok(types(t).includes('shieldHit'));
    // Against rocks: as in 2D
    const r = empty();
    const g = place(r, 'green', ahead(r, 500));
    const red = place(r, 'red', [r.ship.pos[0] + 300, r.ship.pos[1], r.ship.pos[2]], 'large');
    ufoShot(r, vAdd(g.pos, [0, 60, 0]), [0, -350, 0]);
    ufoShot(r, vAdd(red.pos, [0, 80, 0]), [0, -350, 0]);
    run(r, { q: qIdentity() }, 0.5);
    assert.ok(!r.rocks.includes(g) && !r.rocks.includes(red));
    assert.equal(r.stats.redsShot, 0, 'not the player\'s');
    assert.equal(r.stats.wasted, 0);
    const ev = drainEvents(r);
    assert.ok(ev.some((e) => e.type === 'wasted' && e.by === 'ufo'));
    assert.ok(ev.some((e) => e.type === 'split' && e.by === 'ufo'));
});

test('ramming a UFO costs a life and destroys it', () => {
    const s = empty();
    const u = s.ufoSys.spawnAt(ahead(s, 10), s.ship.pos);
    u.vel = [0, 0, 0];
    stepSim(s, { q: qIdentity() });
    assert.equal(s.lives, DIFFICULTY_3D.medium.startingLives - 1);
    assert.equal(s.ufos.length, 0);
    const ev = drainEvents(s);
    assert.ok(ev.some((e) => e.type === 'ufoDestroyed' && e.by === 'ship'));
    assert.ok(ev.some((e) => e.type === 'hit' && e.cause === 'ufo'));
});

/** Shoot one bullet straight into a boss weak point (or the body for the core). */
function shootAt(s, wp) {
    const b = s.boss;
    const target = wp ? b.weakPointPos(wp) : b.state.pos;
    const n = wp ? b.weakPointNormal(wp) : [0, 0, 1];
    const from = vAdd(target, vScale(n, wp ? 40 : BOSS3D.bodyRadius + 40));
    s.bullets.push({ id: nextId(s), pos: from, vel: vScale(n, -SIM.bulletSpeed), life: 0.2 });
    run(s, { q: qIdentity() }, 0.1);
}

test('the boss every 2 levels: banner, blocks the level, weak points, core, points, escorts and drops', () => {
    const s = createSim({ seed: 5, level: 2, ufos: false, powerUps: false });
    assert.ok(s.boss, 'level 2 has a boss');
    assert.equal(s.banner.sub, 'BOSS BATTLE');
    s.ship.invulnerable = 1e6; // the test is about the boss, not dodging it
    s.rocks = [];
    s.incoming.left = 0;
    stepSim(s, { q: qIdentity() });
    assert.equal(levelBlocked(s), true);
    assert.equal(s.level, 2);
    run(s, { q: qIdentity() }, BOSS3D.enterSeconds + 0.1);
    assert.equal(s.boss.phase, 'fighting');
    const plan = weakPointPlan(1);
    for (const wp of s.boss.state.weakPoints) {
        for (let i = 0; i < 10 && !wp.destroyed; i++) shootAt(s, wp);
        assert.ok(wp.destroyed, `weak point ${wp.id}`);
    }
    assert.equal(s.stats.weakPoints, plan.outer);
    assert.equal(s.ufos.length, plan.outer, 'one escort per weak point');
    for (let i = 0; i < 20 && s.boss && s.boss.phase !== 'defeated'; i++) shootAt(s, null);
    assert.equal(s.stats.bosses, 1);
    assert.equal(s.score, plan.outer * BOSS3D.weakPointPoints + plan.score);
    assert.ok(s.stats.credits > 0);
    assert.equal(s.power.pickups.length, BOSS3D.drops);
    run(s, { q: qIdentity() }, BOSS3D.defeatedSeconds + 0.1);
    assert.equal(s.boss, null, 'gone 2 s after the defeat');
    assert.equal(s.level, 2, 'the escorts still block it');
    for (const u of [...s.ufos]) s.ufoSys.destroy(u.id);
    run(s, { q: qIdentity() }, 0.1);
    assert.equal(s.level, 3);
    assert.equal(s.boss, null, 'level 3: no boss');
});

test('touching the boss or its shots costs a life', () => {
    const s = createSim({ seed: 5, level: 2, ufos: false, powerUps: false });
    s.rocks = [];
    s.ship.invulnerable = 0; // a new level's protection
    s.ship.pos = vAdd(s.boss.state.pos, [0, 0, BOSS3D.bodyRadius + 5]);
    stepSim(s, { q: qIdentity() });
    assert.equal(s.lives, DIFFICULTY_3D.medium.startingLives - 1);
    assert.ok(drainEvents(s).some((e) => e.type === 'hit' && e.cause === 'boss'));
});

test('power-ups: pickup, effects and their durations × the upgrade', () => {
    const s = empty({ mods: { powerUpDurationMult: 1.5 } });
    s.power.dropAt(ahead(s, 5), 'triple_shot');
    stepSim(s, { q: qIdentity() });
    assert.ok(s.power.active('triple_shot'));
    assert.ok(drainEvents(s).some((e) => e.type === 'powerUp' && e.kind === 'triple_shot'));
    assert.deepEqual(activeEffects(s).map((e) => [e.kind, e.max]), [['triple_shot', 10 * 1.5]]);
    stepSim(s, { q: qIdentity(), fire: true });
    assert.equal(s.bullets.length, 3, 'triple shot: 3 bullets');
    assert.equal(s.stats.shots, 1);
    // Rapid fire: 0.4 × the interval
    const r = empty();
    r.power.activate('rapid_fire');
    run(r, { q: qIdentity(), fire: true }, 1);
    const n = empty();
    run(n, { q: qIdentity(), fire: true }, 1);
    assert.ok(r.stats.shots >= n.stats.shots * 2, `${r.stats.shots} vs ${n.stats.shots}`);
    // Speed boost: thrust and top speed × 1.6
    const b = empty();
    b.power.activate('speed_boost');
    run(b, { q: qIdentity(), thrust: true }, 6);
    assert.ok(vLen(b.ship.vel) > SIM.maxSpeed * 1.5);
    // 2x score
    const m = empty();
    m.power.activate('score_multiplier');
    place(m, 'green', ahead(m, 5), 'large');
    stepSim(m, { q: qIdentity() });
    assert.equal(m.score, 200);
    // Extra life at once
    const l = empty();
    l.power.dropAt(ahead(l, 5), 'extra_life');
    stepSim(l, { q: qIdentity() });
    assert.equal(l.lives, DIFFICULTY_3D.medium.startingLives + 1);
    // Magnet pulls crystals in
    const g = empty();
    g.power.activate('magnet');
    const c = place(g, 'green', ahead(g, 100));
    stepSim(g, { q: qIdentity() });
    assert.ok(c.vel[2] > 0, 'pulled toward the ship (it is behind the crystal, +z)');
    // Drops: about 30 % of red rocks shot leave a power-up
    let drops = 0;
    for (let seed = 1; seed <= 40; seed++) {
        const d = empty({ seed });
        place(d, 'red', ahead(d, 200), 'small');
        run(d, { q: qIdentity(), fire: true }, 0.4);
        drops += d.power.pickups.length;
    }
    assert.ok(drops >= 5 && drops <= 22, `drops ${drops}/40`);
});

test('the timed power-up appears within the view distance', () => {
    const s = createSim({ seed: 3, ufos: false, lives: 99 });
    let spawned = null;
    for (let i = 0; i < 60 * 60 && !spawned; i++) {
        stepSim(s, { q: qIdentity() });
        if (drainEvents(s).some((e) => e.type === 'powerUpSpawn')) spawned = s.power.pickups.at(-1);
    }
    assert.ok(spawned, 'one after about 20 s of play');
    assert.ok(s.time >= POWERUP3D.interval);
    const d = vLen(nearestDelta(s.ship.pos, spawned.pos, s.size));
    assert.ok(d <= s.world.fogFar * POWERUP3D.spawnFar + 1, `distance ${d}`);
    assert.ok(simCounts(s).powerUps >= 1);
});

test('hyperspace: a jump clear of rocks, the ship stops, 5 s cooldown; failures cost a life', () => {
    const s = empty();
    place(s, 'red', ahead(s, 400));
    run(s, { q: qIdentity(), thrust: true }, 0.5);
    const p0 = s.ship.pos.slice();
    stepSim(s, { q: qIdentity(), hyperspace: true });
    const e = drainEvents(s).find((x) => x.type === 'hyperspace');
    assert.ok(e);
    if (e.result === 'ok') {
        assert.notDeepEqual(s.ship.pos, p0);
        assert.deepEqual(s.ship.vel, [0, 0, 0]);
        assert.equal(hyperspaceState(s).ready, false);
        assert.ok(hyperspaceState(s).cooldown > 4.9);
        stepSim(s, { q: qIdentity(), hyperspace: true });
        assert.equal(drainEvents(s).filter((x) => x.type === 'hyperspace').length, 0, 'not ready');
    }
    // Over many seeds about 10 % of the jumps destroy the ship
    let lost = 0;
    for (let seed = 1; seed <= 60; seed++) {
        const t = empty({ seed });
        stepSim(t, { q: qIdentity(), hyperspace: true });
        if (t.lives < DIFFICULTY_3D.medium.startingLives) lost++;
    }
    assert.ok(lost >= 1 && lost <= 15, `lost ${lost}/60`);
});

test('ship upgrades: thrust, starting lives and the pickup radius', () => {
    const base = empty();
    const up = empty({ mods: { accelMult: 1.3, extraLives: 2, pickupRadiusMult: 1.2 } });
    assert.equal(up.lives, base.lives + 2);
    assert.ok(Math.abs(pickupRadius(up) - pickupRadius(base) * 1.2) < 1e-9);
    run(base, { q: qIdentity(), thrust: true }, 0.5);
    run(up, { q: qIdentity(), thrust: true }, 0.5);
    assert.ok(vLen(up.ship.vel) > vLen(base.ship.vel) * 1.25);
});
