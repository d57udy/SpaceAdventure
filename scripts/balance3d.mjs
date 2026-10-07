#!/usr/bin/env node
// Balance harness for the 3D game (docs/plans/07-3d-game.md §2.1, §6.2). Runs the pure
// simulation (js/3d/sim3d.js) headless for seeded minutes with two scripted pilots and
// reports how often danger shows up:
//   - 'nododge': flies straight at the nearest crystal and never reacts to danger; once the
//     crystals are gone it hunts the remaining red rocks;
//   - 'dodge': the same, but it shoots red rocks in its way, and after a human reaction time
//     turns to shoot a threat in front of it, or flies across the threat's path when it is not.
// Lives are unlimited here so the rates stay measurable.
//
// Usage: node scripts/balance3d.mjs [--seconds 180] [--seeds 4] [--difficulty medium] [--view far] [--level 1]
// tests/unit/balance3d.test.mjs checks the plan's targets with a short run.

import { pathToFileURL } from 'node:url';
import { createSim, stepSim, drainEvents, SIM } from '../js/3d/sim3d.js';
import { nearestDelta } from '../js/3d/world3d.js';
import { isThreat } from '../js/3d/radar3d.js';
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
    fixDeadband: 25,                // velocity error below which the nose points at the target instead
    threatSample: 6,                // steps between threat samples (0.1 s)
    reaction: 0.6,                  // s: the dodge pilot reacts to a threat this long after it appears
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
    for (const r of s.rocks) {
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
    for (const r of s.rocks) {
        const d = nearestDelta(s.ship.pos, r.pos, s.size);
        const w = vAdd(vScale(f, SIM.bulletSpeed), vSub(s.ship.vel, r.vel)); // bullet relative to the rock
        const wl = vLen(w);
        const along = vDot(d, w) / wl;
        if (along <= 0 || along > range) continue;
        const off = vLen(vSub(d, vScale(w, along / wl)));
        if (off > r.radius * PILOT.aimSlack) continue;
        if (!first || along < first.along) first = { r, along };
    }
    return !!first && first.r.kind === 'red';
}

function threats(s) {
    const out = [];
    const range = s.world.fogFar;
    for (const r of s.rocks) {
        if (r.kind !== 'red') continue;
        const d = nearestDelta(s.ship.pos, r.pos, s.size);
        if (isThreat(d, vSub(r.vel, s.ship.vel), r.radius, range)) out.push({ r, d, dist: vLen(d) });
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
        if (angleTo(q, t.d) < PILOT.engageCone) {
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
    const target = crystal || nearest(s, (r) => r.kind === 'red');
    if (!target) return { q, thrust: false, fire: false };
    // The careless pilot only shoots once it is hunting red rocks
    const shoots = kind === 'dodge' || !crystal;
    // Steer by velocity, as a player does: the ship can only brake by turning and thrusting,
    // so aim the nose at the velocity correction while it is large, else at the target
    const gap = crystal ? target.dist : target.dist - PILOT.standOff;
    const want = vScale(vNorm(target.d), clamp(gap * PILOT.approachGain, 0, PILOT.cruise));
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
 * Run one pilot for `seconds` of game time.
 * @returns {{ minutes, hits, hitsPerMin, threats, threatsPerMin, collected, levels, levelSeconds: number[] }}
 */
export function runPilot({ seed = 1, seconds = 120, pilot = 'nododge', difficulty = 'medium', view = 'far', level = 1, dda = null } = {}) {
    const s = createSim({ seed, view, difficulty, level, dda, lives: 999 });
    let q = s.ship.q;
    let hits = 0, threatCount = 0;
    let seen = new Map(); // threat id -> time first seen
    let list = [];
    const levelSeconds = [];
    let levelStart = 0;
    const steps = Math.round(seconds / SIM.dt);
    for (let i = 0; i < steps; i++) {
        if (i % PILOT.threatSample === 0) {
            list = s.ship.alive ? threats(s) : [];
            const now = new Map();
            for (const t of list) {
                if (!seen.has(t.r.id)) threatCount++;
                now.set(t.r.id, seen.get(t.r.id) ?? s.time);
                t.age = s.time - now.get(t.r.id);
            }
            seen = now;
        }
        const inp = pilotInput(s, pilot, q, SIM.dt, list);
        q = inp.q;
        stepSim(s, inp);
        for (const e of drainEvents(s)) {
            if (e.type === 'hit' || e.type === 'shieldHit') hits++;
            if (e.type === 'level' && e.level > level) { levelSeconds.push(s.time - levelStart); levelStart = s.time; }
        }
    }
    const minutes = seconds / 60;
    return {
        minutes,
        hits,
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
    for (const difficulty of diffs) {
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
