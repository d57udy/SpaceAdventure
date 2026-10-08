// UFOs in the 3D game, following the 2D rules (docs/plans/07-3d-game.md §2.4; 2D sources:
// js/ufo.js, js/main.js resetUfoSpawnTimer / updateUfoSpawning, js/bullet.js). Pure and
// DOM-free: random numbers are injected (js/rng.js mulberry32), the sim calls update(dt, world)
// every fixed step and applies the events.
//
// 2D rules carried over:
//   - one UFO at a time (ufoMaxActive 1); the next one after 15 s (UFO_SPAWN_BASE_INTERVAL)
//     × difficulty ufoSpawnMultiplier × adaptive ufoSpawnMod × max(0.5, 1 − 0.05 × level),
//     randomised × 0.75 … 1.25;
//   - speed 100 in a straight line, wrapping around the world; radius 15, score 200;
//   - first shot after 2 s × 0.5 … 1.5, then every 2 s × 0.8 … 1.2;
//   - 30 % of the shots go at a random green crystal near the UFO (2D: within 400 px),
//     the rest at the ship, aimed at where it is now (2D aims without lead), spread by the
//     accuracy (difficulty ufoAccuracy × adaptive ufoAccuracyMod, at most 1).
//
// 3D translations (plan 07 §2.4):
//   - Staying in play: a UFO appears at the edge of the visible range (the fog end) and its
//     straight line passes within half the view distance of the ship, which is what a 2D UFO
//     crossing its small screen does. A UFO that stays beyond the cull distance for
//     FAR_TIMEOUT s leaves quietly, so a lost UFO never blocks the next one or the level end.
//   - It only fires while within the view distance (a 2D UFO off screen still fires, but it
//     is never more than about a screen away; from beyond the fog a shot would be unfair).
//   - Distances: SCALE = view distance / 720 3D units per 2D px. At the original 3D view
//     (fog end 720) one 2D px is one unit; Far (1440) doubles it. So the 2D 400 px "nearby
//     green" radius is 800 at Far.
//   - Bullets: 2D UFO_BULLET_SPEED 350, kept in 3D units per second (not scaled), so a shot
//     takes about a second to cross 350 units and can be dodged; life 3 s (1050 units, inside
//     the Far view distance). Scaling it like the player's bullet (500 → 900, × 1.8) would
//     give 630 units/s, too fast to see coming out of the fog.
//   - Aim spread: see aimCone3d below.

import { vAdd, vScale, vLen, vNorm, vCross } from './math3d.js';
import { nearestDelta, wrapPos, randomUnit } from './world3d.js';
import { sweptHit } from './collide3d.js';
import { Difficulty } from '../difficulty.js';

export const UFO3D = Object.freeze({
    baseInterval: 15,       // 2D UFO_SPAWN_BASE_INTERVAL
    maxActive: 1,           // 2D ufoMaxActive (single-player)
    speed: 100,             // 2D UFOSize.STANDARD.speed
    radius: 15,
    score: 200,
    fireRate: 2,            // s (2D UFOSize.STANDARD.fireRate)
    greenShare: 0.3,        // 2D: 30 % of shots at a nearby green
    greenRadius2d: 400,     // 2D px
    bulletSpeed: 350,       // 2D UFO_BULLET_SPEED, unscaled (see above)
    bulletLife: 3,
    bulletRadius: 3,
    pathWithin: 0.5,        // the straight line passes within this share of the view distance
    farTimeout: 8,          // s beyond the cull distance before a UFO leaves
    viewRef: 720,           // 3D view distance at which 1 unit = 1 2D px
    shipRadius2d: 15,       // 2D PlayerShip radius
    shipRadius3d: 9,        // 3D SIM.shipRadius
});

/** 3D units per 2D px for a view distance (fog end). */
export const scaleFor = (range) => Math.max(1e-6, Number(range) || UFO3D.viewRef) / UFO3D.viewRef;

/** 2D UFO accuracy rule: difficulty × adaptive modifier, at most 1. */
export function ufoAccuracy(difficultyAccuracy, accuracyMod = 1) {
    return Math.max(0, Math.min(1, difficultyAccuracy * accuracyMod));
}

/** 2D next-UFO interval before the 0.75 … 1.25 randomisation. */
export function ufoInterval({ spawnMultiplier = 1, spawnMod = 1, level = 1 } = {}) {
    return UFO3D.baseInterval * spawnMultiplier * spawnMod * Math.max(0.5, 1 - level * 0.05);
}

/**
 * Probability that a 2D UFO shot hits a still ship at distance d2 (2D px): the shot angle is
 * uniform in ±θ2 with θ2 = (1 − accuracy)·π, and it hits when it is within asin(R2 / d2) of the
 * direction to the ship's centre.
 */
export function hitChance2d(accuracy, d2, r2 = UFO3D.shipRadius2d) {
    const theta2 = (1 - accuracy) * Math.PI;
    const alpha2 = Math.asin(Math.min(1, r2 / Math.max(d2, 1e-9)));
    if (theta2 <= alpha2) return 1;
    return alpha2 / theta2;
}

/**
 * Half-angle (radians) of the 3D aim cone, so a 3D shot hits as often as a 2D shot at the
 * same distance.
 *
 * Derivation. In 2D the shot direction is uniform on an arc of half-angle θ2 = (1 − a)·π and
 * the ship (radius R2 = 15 px) at distance d2 covers ±α2 of it, α2 = asin(R2 / d2):
 *     P2 = min(1, α2 / θ2).
 * In 3D the shot direction is uniform over a spherical cap of half-angle θ3 around the
 * direction to the ship (solid angle 2π(1 − cos θ3)); the ship (radius R3 = 9) at distance d3
 * covers a cap of half-angle α3 = asin(R3 / d3), solid angle 2π(1 − cos α3), so
 *     P3 = min(1, (1 − cos α3) / (1 − cos θ3)).
 * "The same distance" in screen-equivalent units is d2 = d3 / SCALE (scaleFor). Setting
 * P3 = P2 and solving for θ3:
 *     1 − cos θ3 = (1 − cos α3) / P2   →   θ3 = acos(1 − (1 − cos α3) / P2),
 * and θ3 = α3 when P2 = 1 (every shot on target). The cone depends on the distance, because
 * a 2D spread loses hits in proportion to 1/d while a 3D cone loses them in proportion to
 * 1/d²; using the 2D θ2 directly as the cone would make UFOs far weaker than in 2D (the same
 * geometry problem as plan 07 §2.1). For small angles θ3 ≈ α3·sqrt(θ2 / α2).
 * The match is for a still target and ignores bullet travel time, as the 2D rule does.
 *
 * @param {number} accuracy - 0..1 (ufoAccuracy)
 * @param {number} d3 - distance to the target, 3D units
 * @param {object} [o] - { scale: 3D units per 2D px, r3: 3D target radius, r2: 2D ship radius }
 */
export function aimCone3d(accuracy, d3, { scale = 1, r3 = UFO3D.shipRadius3d, r2 = UFO3D.shipRadius2d } = {}) {
    const d = Math.max(d3, 1e-9);
    const alpha3 = Math.asin(Math.min(1, r3 / d));
    const p2 = hitChance2d(accuracy, d / scale, r2);
    if (p2 >= 1) return alpha3;
    const c = 1 - (1 - Math.cos(alpha3)) / p2;
    return Math.acos(Math.max(-1, Math.min(1, c)));
}

/** A unit vector uniformly distributed over the cap of half-angle theta around unit `dir`. */
export function randomInCone(rand, dir, theta) {
    const cosT = 1 - rand() * (1 - Math.cos(theta));
    const sinT = Math.sqrt(Math.max(0, 1 - cosT * cosT));
    const phi = rand() * Math.PI * 2;
    const helper = Math.abs(dir[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
    const u = vNorm(vCross(dir, helper));
    const v = vCross(dir, u);
    return vNorm(vAdd(vScale(dir, cosT), vAdd(vScale(u, sinT * Math.cos(phi)), vScale(v, sinT * Math.sin(phi)))));
}

function difficultyEntry(d) {
    if (d && typeof d === 'object') return d;
    const key = String(d || 'medium').toUpperCase();
    return Difficulty[key] || Difficulty.MEDIUM;
}

const rr = (rand, lo, hi) => lo + rand() * (hi - lo);

/**
 * @param {object} o
 * @param {() => number} o.rand - seeded generator
 * @param {number} o.size - world cube side
 * @param {number} o.range - view distance (fog end)
 * @param {number} [o.cull] - distance beyond which a UFO counts as far (default range + 90)
 * @param {string|object} [o.difficulty] - 'easy' | 'medium' | 'hard' or a js/difficulty.js entry
 * @param {object} [o.dda] - { ufoSpawnMod, ufoAccuracyMod }
 * @param {number} [o.level]
 * @param {() => number} [o.nextId]
 */
export function createUfoSystem({ rand, size, range, cull, difficulty = 'medium', dda = null, level = 1, nextId = null, maxActive = UFO3D.maxActive } = {}) {
    let ids = 1;
    const newId = () => (nextId ? nextId() : `u${ids++}`);
    const sys = {
        ufos: [],
        bullets: [],
        spawnTimer: 0,
        level,
        size,
        range,
        cull: cull ?? range + 90,
        difficulty: difficultyEntry(difficulty),
        dda: { ufoSpawnMod: 1, ufoAccuracyMod: 1, ...(dda || {}) },
        maxActive,
        enabled: true,
    };

    function resetTimer() {
        const base = ufoInterval({
            spawnMultiplier: sys.difficulty.ufoSpawnMultiplier, spawnMod: sys.dda.ufoSpawnMod, level: sys.level,
        });
        sys.spawnTimer = base * rr(rand, 0.75, 1.25);
    }

    function accuracy() {
        return ufoAccuracy(sys.difficulty.ufoAccuracy, sys.dda.ufoAccuracyMod);
    }

    function spawn(shipPos) {
        const dirOut = randomUnit(rand);
        const pos = wrapPos(vAdd(shipPos, vScale(dirOut, sys.range)), sys.size);
        // A point within half the view distance of the ship; the straight line goes through it
        const offset = vScale(randomUnit(rand), rand() * sys.range * UFO3D.pathWithin);
        const toward = vNorm(vAdd(nearestDelta(pos, shipPos, sys.size), offset));
        const ufo = {
            id: newId(), kind: 'ufo', pos, vel: vScale(toward, UFO3D.speed), radius: UFO3D.radius,
            alive: true, fireTimer: UFO3D.fireRate * rr(rand, 0.5, 1.5), farTime: 0, shots: 0, score: UFO3D.score,
        };
        sys.ufos.push(ufo);
        return ufo;
    }

    function fire(ufo, ship, greens, events) {
        const greenRadius = UFO3D.greenRadius2d * scaleFor(sys.range);
        let target = null;
        let targetType = 'ship';
        const near = (greens || []).filter(g => g && g.alive !== false
            && vLen(nearestDelta(ufo.pos, g.pos, sys.size)) < greenRadius);
        if (near.length > 0 && rand() < UFO3D.greenShare) {
            target = near[Math.floor(rand() * near.length)];
            targetType = 'green';
        } else if (ship && ship.alive !== false) {
            target = ship;
        }
        if (!target) return;
        const delta = nearestDelta(ufo.pos, target.pos, sys.size);
        const dist = vLen(delta);
        if (dist < 1e-6) return;
        const theta = aimCone3d(accuracy(), dist, { scale: scaleFor(sys.range), r3: targetType === 'ship' ? UFO3D.shipRadius3d : (target.radius || 16) });
        const dir = randomInCone(rand, vScale(delta, 1 / dist), theta);
        const start = wrapPos(vAdd(ufo.pos, vScale(dir, ufo.radius + 2)), sys.size);
        const bullet = {
            id: newId(), hostile: true, from: ufo.id, pos: start, prev: start,
            vel: vScale(dir, UFO3D.bulletSpeed), life: UFO3D.bulletLife, radius: UFO3D.bulletRadius,
        };
        sys.bullets.push(bullet);
        ufo.shots++;
        events.push({ type: 'ufoShoot', ufo: ufo.id, bullet: bullet.id, target: targetType, cone: theta });
    }

    resetTimer();

    const api = {
        state: sys,
        get ufos() { return sys.ufos; },
        get bullets() { return sys.bullets; },
        get accuracy() { return accuracy(); },
        /** Level, adaptive modifiers or view distance changed (the timer keeps running). */
        configure({ level: L, dda: d, range: r, size: s, difficulty: diff, cull: c } = {}) {
            if (L !== undefined) sys.level = L;
            if (d) sys.dda = { ...sys.dda, ...d };
            if (r !== undefined) { sys.range = r; sys.cull = c ?? r + 90; }
            if (s !== undefined) sys.size = s;
            if (diff !== undefined) sys.difficulty = difficultyEntry(diff);
        },
        /** New level or new game: no UFOs or UFO bullets, a fresh timer. */
        clear() {
            sys.ufos = [];
            sys.bullets = [];
            resetTimer();
        },
        /**
         * An extra UFO at `pos` (a boss escort), outside the one-at-a-time limit. It heads for a
         * point near the ship like a spawned one. Returns it.
         */
        spawnAt(pos, shipPos) {
            const offset = vScale(randomUnit(rand), rand() * sys.range * UFO3D.pathWithin * 0.5);
            const toward = vNorm(vAdd(nearestDelta(pos, shipPos, sys.size), offset));
            const ufo = {
                id: newId(), kind: 'ufo', pos: wrapPos(pos, sys.size), vel: vScale(toward, UFO3D.speed), radius: UFO3D.radius,
                alive: true, fireTimer: UFO3D.fireRate * rr(rand, 0.5, 1.5), farTime: 0, shots: 0, score: UFO3D.score, escort: true,
            };
            sys.ufos.push(ufo);
            return ufo;
        },
        /** Off during the tutorial or between lives (2D: no UFO while every ship is waiting). */
        setEnabled(on) { sys.enabled = !!on; },
        /**
         * One step. world: { ship: { pos, alive }, greens: [rock], recall }. recall: nothing else
         * is left in the level, so a UFO beyond the cull distance turns back toward the ship
         * (straight at it) instead of wandering off for farTimeout s (review #1).
         * Returns events: ufoSpawn { ufo }, ufoShoot { ufo, bullet, target: 'ship'|'green' },
         * ufoLeft { ufo } (gone far away), bulletExpired { bullet }.
         */
        update(dt, { ship, greens = [], recall = false } = {}) {
            const events = [];
            // Shots that ran out last step go now: collideBullets tested their last move first
            sys.bullets = sys.bullets.filter(b => b.life > 0);
            const shipPos = ship && ship.pos;
            const shipAlive = !!(ship && ship.alive !== false);
            // Spawning (not while the ship waits to respawn)
            if (sys.enabled && shipAlive && sys.ufos.length < sys.maxActive) {
                sys.spawnTimer -= dt;
                if (sys.spawnTimer <= 0) {
                    const ufo = spawn(shipPos);
                    events.push({ type: 'ufoSpawn', ufo: ufo.id });
                    resetTimer();
                }
            }
            // UFOs: straight line, wrap, fire within the view distance, leave when lost
            for (const ufo of sys.ufos) {
                ufo.pos = wrapPos(vAdd(ufo.pos, vScale(ufo.vel, dt)), sys.size);
                const toShip = shipPos ? nearestDelta(ufo.pos, shipPos, sys.size) : null;
                const dist = toShip ? vLen(toShip) : Infinity;
                if (recall && toShip && dist > sys.cull) {
                    ufo.vel = vScale(toShip, UFO3D.speed / dist);
                    ufo.recalled = (ufo.recalled || 0) + 1;
                }
                // Lost far away: it leaves after farTimeout s (never while recalled: it is on its way back)
                ufo.farTime = dist > sys.cull && !recall ? ufo.farTime + dt : 0;
                if (ufo.farTime >= UFO3D.farTimeout) {
                    ufo.alive = false;
                    events.push({ type: 'ufoLeft', ufo: ufo.id });
                    continue;
                }
                ufo.fireTimer -= dt;
                if (ufo.fireTimer <= 0) {
                    if (dist <= sys.range) fire(ufo, shipAlive ? ship : null, greens, events);
                    ufo.fireTimer = UFO3D.fireRate * rr(rand, 0.8, 1.2);
                }
            }
            sys.ufos = sys.ufos.filter(u => u.alive);
            // Bullets
            for (const b of sys.bullets) {
                b.prev = b.pos;
                b.pos = wrapPos(vAdd(b.pos, vScale(b.vel, dt)), sys.size);
                b.life -= dt;
                if (b.life <= 0) events.push({ type: 'bulletExpired', bullet: b.id });
            }
            return events;
        },
        /**
         * Swept collisions of this step's UFO bullet moves against the ship and rocks.
         * target: { ship: { pos, radius, alive, invulnerable }, rocks: [rock] }.
         * Hit bullets are removed. Returns [{ bullet, hit: 'ship' | rock }] (first hit along each path).
         */
        collideBullets({ ship = null, rocks = [] } = {}) {
            const hits = [];
            const keep = [];
            for (const b of sys.bullets) {
                const move = nearestDelta(b.prev, b.pos, sys.size);
                let best = null;
                let bestT = Infinity;
                if (ship && ship.alive !== false && !(ship.invulnerable > 0)) {
                    const t = sweptHit(b.prev, move, ship.pos, (ship.radius ?? UFO3D.shipRadius3d) + b.radius, sys.size);
                    if (t >= 0 && t < bestT) { bestT = t; best = 'ship'; }
                }
                for (const r of rocks) {
                    if (!r || r.alive === false) continue;
                    const t = sweptHit(b.prev, move, r.pos, r.radius + b.radius, sys.size);
                    if (t >= 0 && t < bestT) { bestT = t; best = r; }
                }
                if (best) hits.push({ bullet: b, hit: best });
                else if (b.life > 0) keep.push(b); // an expired shot had its last move tested here
            }
            sys.bullets = keep;
            return hits;
        },
        /**
         * Player bullets (or anything swept) against UFOs: the first UFO the segment p0 → p0 + move
         * touches (radius r added), or null.
         */
        hitUfo(p0, move, r = 0) {
            let best = null;
            let bestT = Infinity;
            for (const u of sys.ufos) {
                const t = sweptHit(p0, move, u.pos, u.radius + r, sys.size);
                if (t >= 0 && t < bestT) { bestT = t; best = u; }
            }
            return best;
        },
        /** The ship touching a UFO (ramming: as in 2D, a life lost and the UFO destroyed). */
        rammedBy(shipPos, shipRadius = UFO3D.shipRadius3d) {
            return sys.ufos.find(u => vLen(nearestDelta(shipPos, u.pos, sys.size)) <= u.radius + shipRadius) || null;
        },
        /** Destroy a UFO (shot or rammed). Returns { score } or null when it wasn't there. */
        destroy(id) {
            const u = sys.ufos.find(x => x.id === id);
            if (!u) return null;
            u.alive = false;
            sys.ufos = sys.ufos.filter(x => x.alive);
            return { score: u.score, pos: u.pos };
        },
        /** The nearest UFO to a point (for the hum and the edge arrow), with its delta. */
        nearest(pos) {
            let best = null;
            for (const u of sys.ufos) {
                const d = nearestDelta(pos, u.pos, sys.size);
                const dist = vLen(d);
                if (!best || dist < best.dist) best = { ufo: u, delta: d, dist };
            }
            return best;
        },
        /** Hostile UFOs keep the level going (2D level-end rule). */
        get blocking() { return sys.ufos.length > 0; },
        snapshot() {
            return {
                ufos: sys.ufos.map(u => ({ id: u.id, pos: u.pos.slice(), vel: u.vel.slice(), fireTimer: u.fireTimer, shots: u.shots })),
                bullets: sys.bullets.length, spawnTimer: sys.spawnTimer, accuracy: accuracy(),
            };
        },
    };
    return api;
}
