#!/usr/bin/env node
// Balance harness for the 3D game (docs/plans/07-3d-game.md §2.1, §6.2). Runs the pure
// simulation (js/3d/sim3d.js) headless for seeded minutes with two scripted pilots and
// reports how often danger shows up:
//   - 'nododge': keeps thrusting toward the nearest crystal (never slower than
//     PILOT.keepMoving, so it is always moving and changing direction, as players do) and never
//     reacts to danger; once the crystals are gone it hunts the remaining red rocks and UFOs (a
//     UFO blocks the level end);
//   - 'dodge': the same, but it shoots red rocks and UFOs in its way, and after a human
//     reaction time turns to shoot a threat in front of it, or flies across the threat's path
//     when it is not. UFO shots can only be dodged; they glow, so it sees them from the view
//     distance instead of waiting for the radar flash.
// Threats are what the radar flashes for: red rocks and UFOs on a collision course and UFO or
// boss shots heading for the ship. Lives are unlimited here so the rates stay measurable.
//
// Usage: node scripts/balance3d.mjs [--seconds 180] [--seeds 4] [--difficulty medium] [--view far] [--level 1]
//        node scripts/balance3d.mjs --levels 1-6 [--seconds 180] [--seeds 16] [--difficulty medium]
// (--levels: one row per difficulty and pilot, a life lost every N s at each starting level)
// tests/unit/balance3d.test.mjs checks the plan's targets with a short run.

import { pathToFileURL } from 'node:url';
import { createSim, stepSim, drainEvents, SIM } from '../js/3d/sim3d.js';
import { nearestDelta } from '../js/3d/world3d.js';
import { isThreat, RADAR } from '../js/3d/radar3d.js';
import { BOSS3D } from '../js/3d/boss3d.js';
import { hitChance2d, scaleFor, UFO3D } from '../js/3d/ufo3d.js';
import {
    vDot, vLen, vNorm, vCross, vSub, vScale, vAdd, qMul, qFromAxisAngle, qNorm, forwardOf, clamp,
} from '../js/3d/math3d.js';

export const PILOT = Object.freeze({
    turnRate: 110 * Math.PI / 180, // rad/s: about the Rate and Joystick maximum at sensitivity 5
    thrustCone: 25 * Math.PI / 180,
    aimSlack: 0.9,                  // fire when the nose line passes this share of a rock's radius from its centre
    engageCone: 40 * Math.PI / 180, // dodge pilot: a threat this close to the nose is shot, not dodged
    standOff: 450,                  // approach a red rock to this distance, then shoot it
    cruise: 220,                    // cruising speed toward a target
    approachGain: 0.8,              // wanted closing speed per unit of distance (slows down near the target)
    keepMoving: 180,                // careless pilot: never slower than this toward a crystal
    fixDeadband: 25,                // velocity error below which the nose points at the target instead
    threatSample: 6,                // steps between threat samples (0.1 s)
    reaction: 0.6,                  // s: the dodge pilot reacts to a threat this long after it appears
    bossStandOff: 420,              // hold this far from the boss centre while its weak points turn past
});

/** Rotate q so its nose turns toward `dir` by at most maxAngle (world-frame rotation). */
export function turnToward(q, dir, maxAngle) {
    const f = forwardOf(q);
    const d = vNorm(dir);
    const c = clamp(vDot(f, d), -1, 1);
    const angle = Math.acos(c);
    if (angle < 1e-6) return q;
    let axis = vCross(f, d);
    if (vLen(axis) < 1e-9) axis = [0, 1, 0];
    return qNorm(qMul(qFromAxisAngle(vNorm(axis), Math.min(angle, maxAngle)), q));
}

const angleTo = (q, dir) => Math.acos(clamp(vDot(forwardOf(q), vNorm(dir)), -1, 1));

function nearest(s, pred) {
    let best = null;
    for (const r of [...s.rocks, ...s.ufos]) {
        if (!pred(r)) continue;
        const d = nearestDelta(s.ship.pos, r.pos, s.size);
        const dist = vLen(d);
        if (!best || dist < best.dist) best = { r, d, dist };
    }
    return best;
}

/**
 * Nose direction that makes a bullet (which keeps the ship's velocity) meet a target at `d`
 * moving with `vel`: the lead a player learns.
 */
export function leadDirection(d, shipVel, vel) {
    const dh = vNorm(d);
    const v = vSub(shipVel, vel); // the bullet's drift relative to the target
    const dv = vDot(dh, v);
    const disc = dv * dv - vDot(v, v) + SIM.bulletSpeed * SIM.bulletSpeed;
    if (disc <= 0) return dh;
    const k = dv + Math.sqrt(disc);
    return vNorm(vSub(vScale(dh, k), v));
}

/**
 * Fire only if the first object a bullet would meet (its path relative to each object,
 * within that object's radius) is a red rock.
 */
function clearShot(s, q, range) {
    const f = forwardOf(q);
    let first = null;
    for (const r of [...s.rocks, ...s.ufos]) {
        const d = nearestDelta(s.ship.pos, r.pos, s.size);
        const w = vAdd(vScale(f, SIM.bulletSpeed), vSub(s.ship.vel, r.vel)); // bullet relative to the rock
        const wl = vLen(w);
        const along = vDot(d, w) / wl;
        if (along <= 0 || along > range) continue;
        const off = vLen(vSub(d, vScale(w, along / wl)));
        if (off > r.radius * PILOT.aimSlack) continue;
        if (!first || along < first.along) first = { r, along };
    }
    return !!first && (first.r.kind === 'red' || first.r.kind === 'ufo');
}

/**
 * Threats the pilot knows about: what the radar flashes for (red rocks, UFOs, shots within its
 * threat distance). seeShots: UFO and boss shots within the whole view distance (the dodging
 * pilot watches them; they are counted as radar threats only within the radar's distance).
 */
function threats(s, { seeShots = false } = {}) {
    const out = [];
    const range = s.world.fogFar;
    const shots = [...s.ufoSys.bullets, ...(s.boss ? s.boss.state.bullets : [])];
    for (const r of [...s.rocks.filter((x) => x.kind === 'red'), ...s.ufos]) {
        const d = nearestDelta(s.ship.pos, r.pos, s.size);
        if (isThreat(d, vSub(r.vel, s.ship.vel), r.radius, range)) out.push({ r, d, dist: vLen(d), radar: true });
    }
    for (const r of shots) {
        const d = nearestDelta(s.ship.pos, r.pos, s.size);
        const rel = vSub(r.vel, s.ship.vel);
        const radar = isThreat(d, rel, r.radius, range);
        if (radar || (seeShots && isThreat(d, rel, r.radius, range / RADAR.threatFraction))) out.push({ r, d, dist: vLen(d), radar });
    }
    return out.sort((a, b) => a.dist - b.dist);
}

/** One pilot decision: { q, thrust, fire } for this step. */
export function pilotInput(s, kind, q, dt, threatList) {
    if (!s.ship.alive || s.over) return { q, thrust: false, fire: false };
    const range = SIM.bulletSpeed * s.world.bulletLife;
    const seen = kind === 'dodge' && threatList ? threatList.filter((t) => t.age >= PILOT.reaction) : [];
    if (seen.length) {
        const t = seen[0];
        // Rocks and UFOs in front are shot; shots can only be dodged
        if (t.r.kind && angleTo(q, t.d) < PILOT.engageCone) {
            const nq = turnToward(q, leadDirection(t.d, s.ship.vel, t.r.vel), PILOT.turnRate * dt);
            return { q: nq, thrust: false, fire: clearShot(s, nq, range) };
        }
        // Fly across its path: away from the line the rock travels along
        const rel = vSub(t.r.vel, s.ship.vel);
        const rh = vLen(rel) > 1e-6 ? vNorm(rel) : [0, 0, 1];
        const toShip = vScale(t.d, -1);
        let away = vSub(toShip, vScale(rh, vDot(toShip, rh)));
        if (vLen(away) < 1e-3) away = vCross(rh, [0, 1, 0]);
        const nq = turnToward(q, away, PILOT.turnRate * dt);
        return { q: nq, thrust: angleTo(nq, away) < PILOT.thrustCone * 2, fire: clearShot(s, nq, range) };
    }
    const crystal = nearest(s, (r) => r.kind === 'green');
    const target = crystal || nearest(s, (r) => r.kind === 'red' || r.kind === 'ufo');
    if (!target) return s.boss ? attackBoss(s, q, dt, range) : { q, thrust: false, fire: false };
    // The careless pilot only shoots once it is hunting red rocks
    const shoots = kind === 'dodge' || !crystal;
    // Steer by velocity, as a player does: the ship can only brake by turning and thrusting,
    // so aim the nose at the velocity correction while it is large, else at the target
    // The careless pilot keeps its speed up through the crystals, as players do
    const gap = crystal ? target.dist : target.dist - PILOT.standOff;
    const slowest = kind === 'dodge' || !crystal ? 0 : PILOT.keepMoving;
    const want = vScale(vNorm(target.d), clamp(gap * PILOT.approachGain, slowest, PILOT.cruise));
    const fix = vSub(want, s.ship.vel);
    if (vLen(fix) > PILOT.fixDeadband) {
        const nq = turnToward(q, fix, PILOT.turnRate * dt);
        return { q: nq, thrust: angleTo(nq, fix) < PILOT.thrustCone, fire: shoots && clearShot(s, nq, range) };
    }
    const aim = crystal ? target.d : leadDirection(target.d, s.ship.vel, target.r.vel);
    const nq = turnToward(q, aim, PILOT.turnRate * dt);
    return { q: nq, thrust: false, fire: shoots && clearShot(s, nq, range) };
}

/**
 * The boss, once nothing else is left: hold PILOT.bossStandOff from its centre on the ship's
 * side and let it turn its weak points past (they are only hit from their outward side). Aim
 * at the living weak point that faces the ship best, leading its motion, and fire when a
 * shot would strike a weak point (or the core once they are all gone).
 */
function attackBoss(s, q, dt, range) {
    const boss = s.boss;
    const st = boss.state;
    const toBoss = nearestDelta(s.ship.pos, st.pos, s.size);
    const living = st.weakPoints.filter((w) => !w.destroyed);
    let aim = toBoss;
    let best = null;
    for (const w of living) {
        const n = boss.weakPointNormal(w);
        const d = nearestDelta(s.ship.pos, boss.weakPointPos(w), s.size);
        const facing = -vDot(n, vNorm(d)); // 1: the weak point looks straight at the ship
        if (!best || facing > best.facing) best = { w, d, n, facing };
    }
    if (best) {
        // The point moves with the spin: v = ω × r
        const r = vScale(best.n, BOSS3D.bodyRadius);
        const vel = vScale(vCross(st.axis, r), BOSS3D.spin);
        aim = leadDirection(best.d, s.ship.vel, vel);
    }
    const fire = boss.vulnerable && (() => {
        const h = boss.hitTest(s.ship.pos, vScale(forwardOf(q), range));
        return !!h && (h.type === 'weakPoint' || h.type === 'core');
    })();
    const goal = vSub(toBoss, vScale(vNorm(toBoss), PILOT.bossStandOff));
    const want = vScale(vNorm(goal), clamp(vLen(goal) * PILOT.approachGain, 0, PILOT.cruise));
    const fix = vSub(want, s.ship.vel);
    if (vLen(fix) > PILOT.fixDeadband * 2) {
        const nq = turnToward(q, fix, PILOT.turnRate * dt);
        return { q: nq, thrust: angleTo(nq, fix) < PILOT.thrustCone, fire };
    }
    const nq = turnToward(q, aim, PILOT.turnRate * dt);
    return { q: nq, thrust: false, fire };
}

/**
 * Run one pilot for `seconds` of game time.
 * @returns {{ minutes, hits, hitsPerMin, threats, threatsPerMin, collected, levels, levelSeconds: number[] }}
 */
export function runPilot({ seed = 1, seconds = 120, pilot = 'nododge', difficulty = 'medium', view = 'far', level = 1, dda = null } = {}) {
    const s = createSim({ seed, view, difficulty, level, dda, lives: 999 });
    let q = s.ship.q;
    let hits = 0, threatCount = 0;
    const hitsBy = {}; // cause -> lives lost (rock, ufo, ufoShot, boss, bossShot, hyperspace)
    let seen = new Map(); // threat id -> time first seen
    let list = [];
    const levelSeconds = [];
    let levelStart = 0;
    const steps = Math.round(seconds / SIM.dt);
    for (let i = 0; i < steps; i++) {
        if (i % PILOT.threatSample === 0) {
            list = s.ship.alive ? threats(s, { seeShots: pilot === 'dodge' }) : [];
            const now = new Map();
            for (const t of list) {
                if (!seen.has(t.r.id) && t.radar) threatCount++;
                now.set(t.r.id, seen.get(t.r.id) ?? s.time);
                t.age = s.time - now.get(t.r.id);
            }
            seen = now;
        }
        const inp = pilotInput(s, pilot, q, SIM.dt, list);
        q = inp.q;
        stepSim(s, inp);
        for (const e of drainEvents(s)) {
            if (e.type === 'hit' || e.type === 'shieldHit') {
                hits++;
                hitsBy[e.cause || 'rock'] = (hitsBy[e.cause || 'rock'] || 0) + 1;
            }
            if (e.type === 'level' && e.level > level) { levelSeconds.push(s.time - levelStart); levelStart = s.time; }
        }
    }
    const minutes = seconds / 60;
    return {
        minutes,
        hits,
        hitsBy,
        hitsPerMin: hits / minutes,
        threats: threatCount,
        threatsPerMin: threatCount / minutes,
        collected: s.stats.collected,
        wasted: s.stats.wasted,
        redsShot: s.stats.redsShot,
        levels: s.stats.levels,
        levelSeconds,
    };
}

/**
 * UFO hit chance against 2D (plan 07 §2.4, §6.2): an empty field, UFOs on their 2D timer, a
 * ship that sits still (as the 2D rule assumes) and a shield that never runs out, so every
 * shot that reaches it counts and nothing changes position. For each shot aimed at the ship,
 * the 2D chance at the same distance (in 2D px: distance / scaleFor(view distance)) is
 * hitChance2d with the 2D hit radius (ship 15 + bullet 2). Only shots that can reach the ship
 * count (a 3D shot flies 350 × 3 s = 1050 units, less than the Far view distance; a 2D UFO is
 * always within reach): `outOfReach` counts the others. Returns the shots, the hits and the
 * hits expected from 2D (their ratio should be about 1).
 */
export function ufoHitCheck({ seed = 1, seconds = 600, difficulty = 'medium', view = 'far', r2 = 17 } = {}) {
    const s = createSim({ seed, view, difficulty, field: false, ufos: true, powerUps: false, lives: 999 });
    const scale = scaleFor(s.world.fogFar);
    let shots = 0, hits = 0, expected = 0, outOfReach = 0;
    const reach = UFO3D.bulletSpeed * UFO3D.bulletLife + UFO3D.shipRadius3d; // ufo3d fire: beyond this it does not shoot
    const steps = Math.round(seconds / SIM.dt);
    for (let i = 0; i < steps; i++) {
        s.ship.shield = 1e9;
        s.ship.invulnerable = 0;
        stepSim(s, { q: s.ship.q });
        for (const e of drainEvents(s)) {
            if (e.type === 'ufoShoot' && e.target === 'ship' && e.pos) {
                const d = vLen(nearestDelta(e.pos, s.ship.pos, s.size));
                if (d > reach) { outOfReach++; continue; }
                shots++;
                expected += hitChance2d(s.ufoSys.accuracy, d / scale, r2);
            } else if (e.type === 'shieldHit' && e.cause === 'ufoShot') hits++;
        }
    }
    return { shots, hits, expected, outOfReach, ratio: expected > 0 ? hits / expected : 0, hitRate: shots ? hits / shots : 0 };
}

/** Average over seeds 1..n. */
export function averagePilot(opts, seeds = 4) {
    const runs = [];
    for (let i = 1; i <= seeds; i++) runs.push(runPilot({ ...opts, seed: i }));
    const avg = (k) => runs.reduce((t, r) => t + r[k], 0) / runs.length;
    return {
        hitsPerMin: avg('hitsPerMin'),
        threatsPerMin: avg('threatsPerMin'),
        collected: avg('collected'),
        levels: avg('levels'),
        levelSeconds: runs.flatMap((r) => r.levelSeconds),
        runs,
    };
}

function main(argv) {
    const arg = (name, dflt) => {
        const i = argv.indexOf('--' + name);
        return i >= 0 ? argv[i + 1] : dflt;
    };
    const seconds = Number(arg('seconds', 180));
    const seeds = Number(arg('seeds', 4));
    const view = arg('view', 'far');
    const level = Number(arg('level', 1));
    const diffs = arg('difficulty', 'easy,medium,hard').split(',');
    const levels = arg('levels', null);
    if (levels) {
        const [lo, hi] = levels.split('-').map(Number);
        for (const difficulty of diffs) {
            for (const pilot of ['nododge', 'dodge']) {
                const row = [];
                for (let L = lo; L <= (hi || lo); L++) {
                    const a = averagePilot({ seconds, pilot, difficulty, view, level: L }, seeds);
                    row.push(`L${L} ${(60 / Math.max(a.hitsPerMin, 1e-9)).toFixed(0)} s`);
                }
                console.log(`${difficulty.padEnd(6)} ${pilot.padEnd(7)} life lost every: ${row.join(', ')}`);
            }
        }
        return;
    }
    for (const difficulty of diffs) {
        let u = { shots: 0, hits: 0, expected: 0, outOfReach: 0 };
        for (let i = 1; i <= seeds; i++) {
            const r = ufoHitCheck({ seed: i, difficulty, view });
            u = { shots: u.shots + r.shots, hits: u.hits + r.hits, expected: u.expected + r.expected, outOfReach: u.outOfReach + r.outOfReach };
        }
        console.log(`${difficulty.padEnd(6)} UFO shots at a still ship: ${u.shots} (+${u.outOfReach} out of reach), hits ${u.hits} (${(100 * u.hits / Math.max(1, u.shots)).toFixed(1)} %), ` +
            `2D would hit ${u.expected.toFixed(1)} (${(100 * u.expected / Math.max(1, u.shots)).toFixed(1)} %): × ${(u.hits / Math.max(1e-9, u.expected)).toFixed(2)}`);
        for (const pilot of ['nododge', 'dodge']) {
            const a = averagePilot({ seconds, pilot, difficulty, view, level }, seeds);
            const lv = a.levelSeconds.length ? (a.levelSeconds.reduce((t, x) => t + x, 0) / a.levelSeconds.length).toFixed(0) + ' s' : '-';
            console.log(`${difficulty.padEnd(6)} ${pilot.padEnd(7)} L${level} ${view}: threats ${a.threatsPerMin.toFixed(1)}/min ` +
                `(one per ${(60 / Math.max(a.threatsPerMin, 1e-9)).toFixed(1)} s), lives lost ${a.hitsPerMin.toFixed(2)}/min ` +
                `(one per ${(60 / Math.max(a.hitsPerMin, 1e-9)).toFixed(0)} s), crystals ${a.collected.toFixed(1)}, levels ${a.levels.toFixed(2)} (avg ${lv})`);
        }
    }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main(process.argv.slice(2));
