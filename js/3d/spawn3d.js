// Level fields for the 3D game (docs/plans/07-3d-game.md §2.2, §2.3): clusters, scattered
// rocks and incoming rocks. Pure and seeded (random numbers are injected).
//
// - Clusters: spheres of red rocks drifting together, with most of the level's crystals
//   inside, so collecting means flying through danger.
// - Scattered: a few rocks and crystals in the calm space between clusters.
// - Incoming: part of the level's fixed set that arrives during the level, from just beyond
//   the fog, aimed at where the ship will be (plus a miss offset). While an incoming rock is
//   still in the fog (faint or hidden) it keeps re-aiming; once it is fully visible (the fog
//   start) it homes in with a turn rate that grows with the level, so a ship that keeps
//   moving is still chased. In the final approach (RULES3D.incomingFinal units or
//   incomingFinalTime seconds before the closest approach) it flies straight, so a late dodge works.
//
// Nothing refills: the level ends when every rock (and crystal) is gone, as in 2D.

import { vAdd, vSub, vScale, vLen, vNorm, vCross, vDot } from './math3d.js';
import { makeRock, randomUnit, spawnPoint, wrapPos, nearestDelta, driftVel } from './world3d.js';
import { RULES3D } from './rules3d.js';

const rr = (rand, lo, hi) => lo + rand() * (hi - lo);

/** Uniform random point inside a sphere of radius r (relative to its centre). */
export function randomInSphere(rand, r) {
    return vScale(randomUnit(rand), r * Math.cbrt(rand()));
}

/** A size from a [[size, weight], ...] mix. */
export function pickFromMix(rand, mix) {
    const total = mix.reduce((t, [, w]) => t + w, 0);
    let x = rand() * total;
    for (const [size, w] of mix) {
        x -= w;
        if (x < 0) return size;
    }
    return mix[mix.length - 1][0];
}

/** Cluster radius for a number of members: compact enough to be dangerous to cross. */
export const clusterRadius = (members) => 70 + 35 * Math.cbrt(Math.max(1, members));

/** A unit vector perpendicular to `d`. */
function perpendicular(rand, d) {
    let p = vCross(d, randomUnit(rand));
    if (vLen(p) < 1e-3) p = vCross(d, [0, 1, 0]);
    if (vLen(p) < 1e-3) p = [1, 0, 0];
    return vNorm(p);
}

/**
 * The level's starting field (rules3d.js levelPlan): clusters, then scattered rocks and
 * crystals, all away from the ship. Incoming rocks are not in it (createIncoming).
 * @returns {{ rocks: object[], clusters: Array<{ id, centre, radius }> }}
 */
export function spawnLevel(rand, plan, { size, shipPos, nextId, clearance = 320 }) {
    const rocks = [];
    const clusters = [];
    const perCluster = plan.clusterRocks.large + plan.clusterRocks.medium + plan.clusterRocks.small;
    const clusterGreens = Math.round(plan.greens * plan.clusterGreenShare);
    const greensIn = (c) => Math.floor(clusterGreens / plan.clusters) + (c < clusterGreens % plan.clusters ? 1 : 0);
    const maxR = clusterRadius(perCluster + Math.ceil(clusterGreens / Math.max(1, plan.clusters)));
    const avoid = [shipPos];
    for (let c = 0; c < plan.clusters; c++) {
        const greens = greensIn(c);
        const R = clusterRadius(perCluster + greens);
        // Away from the ship (its edge too) and from the other clusters
        const centre = spawnPoint(rand, size, avoid, clearance + maxR + 40, 60);
        avoid.push(centre);
        const id = c + 1;
        clusters.push({ id, centre: centre.slice(), radius: R });
        // The cluster drifts as one, its members wander a little within it
        const common = vScale(randomUnit(rand), rr(rand, 3, 8) * plan.speedMult);
        const placed = [];
        const members = [
            ...Array(plan.clusterRocks.large).fill(['red', 'large']),
            ...Array(plan.clusterRocks.medium).fill(['red', 'medium']),
            ...Array(plan.clusterRocks.small).fill(['red', 'small']),
            ...Array.from({ length: greens }, () => ['green', pickFromMix(rand, plan.crystalMix)]),
        ];
        for (const [kind, sz] of members) {
            let pos = null;
            for (let k = 0; k < 20 && !pos; k++) {
                const p = vAdd(centre, randomInSphere(rand, R));
                if (placed.every((q) => vLen(vSub(p, q)) > 50)) pos = p;
            }
            if (!pos) pos = vAdd(centre, randomInSphere(rand, R));
            placed.push(pos);
            const vel = vAdd(common, vScale(randomUnit(rand), rr(rand, 1, 3) * plan.speedMult));
            const rock = makeRock({ id: nextId(), kind, size: sz, pos: wrapPos(pos, size), vel, rand });
            rock.cluster = id;
            rocks.push(rock);
        }
    }
    // Scattered: medium, every fourth large; the remaining crystals
    for (let i = 0; i < plan.scattered; i++) {
        const sz = i % 4 === 3 ? 'large' : 'medium';
        const pos = spawnPoint(rand, size, [shipPos], clearance);
        rocks.push(makeRock({ id: nextId(), kind: 'red', size: sz, pos, vel: vScale(driftVel(rand, 'red', sz), plan.speedMult), rand }));
    }
    for (let i = clusterGreens; i < plan.greens; i++) {
        const pos = spawnPoint(rand, size, [shipPos], clearance);
        const sz = pickFromMix(rand, plan.crystalMix);
        rocks.push(makeRock({ id: nextId(), kind: 'green', size: sz, pos, vel: driftVel(rand, 'green', sz), rand }));
    }
    return { rocks, clusters };
}

/** Incoming-rock state for a level: how many are left to send and when the next one goes. */
export function createIncoming(plan) {
    return {
        left: plan.incoming.count,
        timer: plan.incoming.interval,
        interval: plan.incoming.interval,
        speed: plan.incoming.speed.slice(),
        missFactor: plan.incoming.miss ?? RULES3D.incomingMiss,
        turnRate: (plan.incoming.turnRate ?? 0) * Math.PI / 180, // rad/s
        sizeMix: plan.incoming.sizeMix,
        sent: 0,
    };
}

/**
 * Velocity that takes a rock at `pos` (speed `speed`) to where the ship will be, plus the
 * miss offset: the intercept time solves |D + V t| = speed t (D: rock → ship + miss, nearest
 * image; V: ship velocity). When the ship outruns it, it heads straight at the ship.
 */
export function aimVelocity(pos, speed, shipPos, shipVel, size, miss = [0, 0, 0]) {
    const D = nearestDelta(pos, vAdd(shipPos, miss), size);
    const a = vDot(shipVel, shipVel) - speed * speed;
    const b = 2 * vDot(D, shipVel);
    const c = vDot(D, D);
    let t = -1;
    if (Math.abs(a) < 1e-9) {
        if (b < 0) t = -c / b;
    } else {
        const disc = b * b - 4 * a * c;
        if (disc >= 0) {
            const q = Math.sqrt(disc);
            const ts = [(-b - q) / (2 * a), (-b + q) / (2 * a)].filter((x) => x > 0);
            if (ts.length) t = Math.min(...ts);
        }
    }
    const aim = t > 0 ? vAdd(D, vScale(shipVel, t)) : D;
    return vScale(vNorm(aim), speed);
}

/**
 * One incoming rock: placed `distance` from the ship (out of sight) inside a cone around the
 * ship's motion (anywhere while the ship is nearly still), aimed at its predicted position.
 */
export function spawnIncoming(rand, inc, { shipPos, shipVel, size, distance, nextId, time = 0, shipRadius = 9 }) {
    const speed = vLen(shipVel);
    let dir;
    if (speed < RULES3D.incomingStill) {
        dir = randomUnit(rand);
    } else {
        // Uniform direction inside the cone around the motion
        const axis = vScale(shipVel, 1 / speed);
        const cosMax = Math.cos(RULES3D.incomingCone * Math.PI / 180);
        const cz = rr(rand, cosMax, 1);
        const sz = Math.sqrt(Math.max(0, 1 - cz * cz));
        dir = vNorm(vAdd(vScale(axis, cz), vScale(perpendicular(rand, axis), sz)));
    }
    const pos = wrapPos(vAdd(shipPos, vScale(dir, distance)), size);
    const rockSize = pickFromMix(rand, inc.sizeMix);
    const rockSpeed = rr(rand, inc.speed[0], inc.speed[1]);
    const rock = makeRock({ id: nextId(), kind: 'red', size: rockSize, pos, vel: [0, 0, 0], rand });
    // Miss offset: uniform in a disc across the approach direction, scaled to the rock and ship
    const reach = (rock.radius + shipRadius) * (inc.missFactor ?? RULES3D.incomingMiss);
    const miss = vScale(perpendicular(rand, dir), reach * Math.sqrt(rand()));
    rock.vel = aimVelocity(pos, rockSpeed, shipPos, shipVel, size, miss);
    rock.incoming = { speed: rockSpeed, miss, turnRate: inc.turnRate ?? 0, homing: false, locked: false, since: time };
    return rock;
}

/**
 * Turn `v` toward the direction `want` by at most `maxAngle` radians, keeping its length.
 */
export function turnVelocity(v, want, maxAngle) {
    const speed = vLen(v);
    const u = vScale(v, 1 / speed);
    const w = vNorm(want);
    const c = Math.max(-1, Math.min(1, vDot(u, w)));
    const angle = Math.acos(c);
    if (angle <= maxAngle) return vScale(w, speed);
    // The part of w across u (any perpendicular when w points straight back)
    let p = vSub(w, vScale(u, c));
    if (vLen(p) < 1e-9) p = vCross(u, Math.abs(u[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0]);
    p = vNorm(p);
    return vScale(vAdd(vScale(u, Math.cos(maxAngle)), vScale(p, Math.sin(maxAngle))), speed);
}

/**
 * Steer an incoming rock. In the fog (farther than `lockDistance`, the fog start) it re-aims
 * exactly; once visible (`homing`) it turns toward the aim point at most its turn rate × dt (speed
 * unchanged); in the final approach it flies straight for good (`locked`). It stops counting
 * as incoming after its closest approach, and is never steered once past the ship.
 * @returns {boolean} still on its way in
 */
export function steerIncoming(rock, shipPos, shipVel, size, lockDistance, dt = 0) {
    const inc = rock.incoming;
    if (!inc) return false;
    const d = nearestDelta(rock.pos, shipPos, size); // rock → ship
    const dist = vLen(d);
    if (!inc.homing && !inc.locked) {
        if (dist > lockDistance) {
            rock.vel = aimVelocity(rock.pos, inc.speed, shipPos, shipVel, size, inc.miss);
            return true;
        }
        inc.homing = true;
    }
    const rel = vSub(rock.vel, shipVel);
    const closing = vDot(d, rel);
    // Past the closest approach: an ordinary rock now
    if (closing <= 0) {
        rock.incoming = null;
        return false;
    }
    if (inc.locked) return true;
    // Final approach: from here it flies straight
    const tClosest = closing / Math.max(1e-9, vDot(rel, rel));
    if (!(inc.turnRate > 0) || dist <= RULES3D.incomingFinal || tClosest <= RULES3D.incomingFinalTime) {
        inc.locked = true;
        return true;
    }
    const want = aimVelocity(rock.pos, inc.speed, shipPos, shipVel, size, inc.miss);
    rock.vel = turnVelocity(rock.vel, want, inc.turnRate * dt);
    return true;
}

/** Rocks still on their way in. */
export const incomingInFlight = (rocks) => rocks.reduce((n, r) => n + (r.incoming ? 1 : 0), 0);

/**
 * Push rocks out of a sphere around `centre` (a respawning ship): each moves along its own
 * direction to `radius` plus its own radius. Mutates.
 */
export function pushRocksAway(rocks, centre, radius, size) {
    for (const r of rocks) {
        const d = nearestDelta(centre, r.pos, size);
        const len = vLen(d);
        const want = radius + r.radius;
        if (len >= want) continue;
        const dir = len > 1e-6 ? vScale(d, 1 / len) : [0, 0, -1];
        r.pos = wrapPos(vAdd(centre, vScale(dir, want)), size);
    }
}
