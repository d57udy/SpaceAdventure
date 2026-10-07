// The 3D prototype's game simulation: ship physics, bullets, collecting greens, splitting
// reds, lives. Pure and seeded (js/rng.js mulberry32): the same seed and inputs give the
// same run, so unit tests and ?seed3d=N screenshots are repeatable. Fixed step (1/60 s),
// separate from rendering (proto3d.js runs as many steps as real time needs).
//
// The ship's orientation comes from the look model (look.js); the simulation only reads it.

import { mulberry32 } from '../rng.js';
import { vAdd, vScale, vLen, vSub, forwardOf, qIdentity } from './math3d.js';
import {
    WORLD, ROCK_SIZES, wrapPos, spawnField, spawnOne, splitRock, driftRocks, countRocks, nearestDelta,
} from './world3d.js';
import { spheresOverlap, sweptHit } from './collide3d.js';

export const SIM = Object.freeze({
    dt: 1 / 60,
    accel: 170,          // units/s² while thrusting
    maxSpeed: 260,
    drag: 0.35,          // fraction of speed lost per second when not thrusting
    bulletSpeed: 900,
    bulletLife: 0.85,    // seconds (range ~765, just past the fog)
    fireInterval: 0.14,  // seconds between shots while Fire is held
    shipRadius: 9,
    pickupBonus: 16,     // generous pickup radius for green crystals
    lives: 3,
    invulnerable: 2.0,   // seconds after a hit
    greenScore: 100,
    minGreens: 6,
    minReds: 8,
});

/**
 * @param {object} [o]
 * @param {number} [o.seed]
 * @param {number} [o.size] - world cube side
 * @param {boolean} [o.field] - false: start with an empty world (tests place rocks themselves)
 */
export function createSim({ seed = 1, size = WORLD.size, field = true, greens, reds } = {}) {
    const s = {
        seed,
        rand: mulberry32(seed),
        size,
        time: 0,
        ship: { pos: [size / 2, size / 2, size / 2], vel: [0, 0, 0], q: qIdentity(), invulnerable: 0 },
        rocks: [],
        bullets: [],
        score: 0,
        lives: SIM.lives,
        over: false,
        fireCooldown: 0,
        nextIdValue: 1,
        refill: field,
        events: [],
        stats: { collected: 0, splits: 0, hits: 0, shots: 0 },
    };
    if (field) {
        s.rocks = spawnField(s.rand, { size, shipPos: s.ship.pos, greens, reds, nextId: () => nextId(s) });
    }
    return s;
}

export function nextId(s) {
    return s.nextIdValue++;
}

function emit(s, type, data = {}) {
    s.events.push({ type, t: s.time, ...data });
    if (s.events.length > 200) s.events.splice(0, s.events.length - 200);
}

/** Take (and clear) the events since the last call: 'fire', 'collect', 'split', 'hit', 'gameover'. */
export function drainEvents(s) {
    const e = s.events;
    s.events = [];
    return e;
}

function fire(s) {
    const f = forwardOf(s.ship.q);
    s.bullets.push({
        id: nextId(s),
        pos: wrapPos(vAdd(s.ship.pos, vScale(f, SIM.shipRadius + 4)), s.size),
        vel: vAdd(s.ship.vel, vScale(f, SIM.bulletSpeed)),
        life: SIM.bulletLife,
    });
    s.stats.shots++;
    emit(s, 'fire');
}

function hitRed(s, rock, hitDir, byShip) {
    const i = s.rocks.indexOf(rock);
    if (i < 0) return;
    s.rocks.splice(i, 1);
    const pieces = splitRock(rock, s.rand, { hitDir, nextId: () => nextId(s) });
    s.rocks.push(...pieces);
    if (!byShip) s.score += ROCK_SIZES[rock.size].score;
    s.stats.splits++;
    emit(s, 'split', { pos: rock.pos.slice(), size: rock.size, pieces: pieces.length, byShip: !!byShip });
}

/**
 * One fixed simulation step.
 * @param {object} s - from createSim()
 * @param {object} input - { q: ship orientation quaternion, thrust: bool, fire: bool }
 * @param {number} [dt]
 */
export function stepSim(s, input = {}, dt = SIM.dt) {
    s.time += dt;
    if (input.q) s.ship.q = input.q.slice();
    driftRocks(s.rocks, dt, s.size);

    const ship = s.ship;
    if (!s.over) {
        // Ship physics: thrust along the nose, gentle drag, speed cap
        if (input.thrust) {
            ship.vel = vAdd(ship.vel, vScale(forwardOf(ship.q), SIM.accel * dt));
        } else {
            ship.vel = vScale(ship.vel, Math.max(0, 1 - SIM.drag * dt));
        }
        const sp = vLen(ship.vel);
        if (sp > SIM.maxSpeed) ship.vel = vScale(ship.vel, SIM.maxSpeed / sp);
        ship.pos = wrapPos(vAdd(ship.pos, vScale(ship.vel, dt)), s.size);
        if (ship.invulnerable > 0) ship.invulnerable = Math.max(0, ship.invulnerable - dt);

        s.fireCooldown = Math.max(0, s.fireCooldown - dt);
        if (input.fire && s.fireCooldown <= 0) {
            fire(s);
            s.fireCooldown = SIM.fireInterval;
        }
    }

    // Bullets: swept against red rocks (earliest hit wins)
    for (let i = s.bullets.length - 1; i >= 0; i--) {
        const b = s.bullets[i];
        const move = vScale(b.vel, dt);
        let best = null;
        let bestT = 2;
        for (const r of s.rocks) {
            if (r.kind !== 'red') continue;
            const t = sweptHit(b.pos, move, r.pos, r.radius, s.size);
            if (t >= 0 && t < bestT) { bestT = t; best = r; }
        }
        if (best) {
            s.bullets.splice(i, 1);
            hitRed(s, best, b.vel, false);
            continue;
        }
        b.pos = wrapPos(vAdd(b.pos, move), s.size);
        b.life -= dt;
        if (b.life <= 0) s.bullets.splice(i, 1);
    }

    if (!s.over) {
        // Collect greens (generous radius), collide with reds
        for (let i = s.rocks.length - 1; i >= 0; i--) {
            const r = s.rocks[i];
            if (!r) continue;
            if (r.kind === 'green') {
                if (spheresOverlap(ship.pos, SIM.shipRadius + SIM.pickupBonus, r.pos, r.radius, s.size)) {
                    s.rocks.splice(i, 1);
                    s.score += SIM.greenScore;
                    s.stats.collected++;
                    emit(s, 'collect', { pos: r.pos.slice() });
                }
            } else if (ship.invulnerable <= 0 && spheresOverlap(ship.pos, SIM.shipRadius, r.pos, r.radius, s.size)) {
                s.lives = Math.max(0, s.lives - 1);
                ship.invulnerable = SIM.invulnerable;
                s.stats.hits++;
                emit(s, 'hit', { pos: r.pos.slice(), lives: s.lives });
                hitRed(s, r, vSub([0, 0, 0], nearestDelta(r.pos, ship.pos, s.size)), true);
                if (s.lives <= 0) {
                    s.over = true;
                    ship.vel = [0, 0, 0];
                    emit(s, 'gameover', { score: s.score });
                }
            }
        }
    }

    // Keep the field populated (far from the ship, never pops in view thanks to the fog)
    if (s.refill) {
        const c = countRocks(s.rocks);
        if (c.green < SIM.minGreens) s.rocks.push(spawnOne(s.rand, 'green', { size: s.size, shipPos: ship.pos, nextId: () => nextId(s) }));
        if (c.red < SIM.minReds) s.rocks.push(spawnOne(s.rand, 'red', { size: s.size, shipPos: ship.pos, nextId: () => nextId(s) }));
    }
    return s;
}

/** Counts for the HUD / test hook. */
export function simCounts(s) {
    return { ...countRocks(s.rocks), bullets: s.bullets.length };
}
