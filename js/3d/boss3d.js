// The 3D boss (docs/plans/07-3d-game.md §2.6), following the 2D Boss (js/boss.js) and its
// scoring in js/main.js. Pure and DOM-free; random numbers are injected (js/rng.js).
//
// From 2D:
//   - every 2 levels (rules3d isBossLevel); boss level L = floor(level / 2);
//   - weak point health 20 + 5·L, the core 40 + 10·L, 10 damage per bullet; the core only
//     takes damage once every outer weak point is destroyed;
//   - score 1000 + 500·L; a destroyed weak point gives 200 points and 20 credits, the
//     defeated boss its score and 20 % of it in credits; 3 power-ups drop where it dies;
//   - entering (3 s, invulnerable) → fighting → defeated (2 s, then gone);
//   - moves toward a new point near the player every 3 s at 50 + 5·L;
//   - attacks every 2 − min(0.1·L, 1) s, cycling spread, aimed and circle bursts
//     (5 shots at 200, 1 at 300, 8 + L at 150).
//
// 3D translations:
//   - a body (radius 150) rotating at 0.5 rad/s (2D rotationAngle) with the weak points on
//     its surface. 2D has 3 + floor(L/2) outer points; 3D uses at least 4 (plan 07: "4 glowing
//     weak points spread around it", so you fly around it), spread evenly over the sphere;
//   - exposure: a weak point is only hit from its outward side: the bullet must be moving
//     into the surface (velocity · outward normal < 0) and strike the outer half of the
//     weak point (hit point − body centre) · normal > 0. Bullets that hit the body elsewhere
//     are absorbed; once the outer points are gone, any body hit damages the core;
//   - the spread is 5 shots 4° apart (centre, up, down, left, right) instead of 15° in a
//     plane, which in 3D would put four of five far off target (plan 07 §2.1); the circle
//     burst goes out in all directions evenly;
//   - shots leave from the living weak point nearest the ship (its turrets), else the centre;
//   - each destroyed weak point releases one escort UFO (an 'escort' event; ufo3d spawnAt).

import { vAdd, vSub, vScale, vLen, vNorm, vDot, vCross, qFromAxisAngle, qMul, qRotate, qIdentity, qNorm, DEG } from './math3d.js';
import { nearestDelta, wrapPos, randomUnit } from './world3d.js';
import { sweptHit, segmentSphereT } from './collide3d.js';

export const BOSS3D = Object.freeze({
    bodyRadius: 150,
    weakPointRadius: 26,
    minOuterPoints: 4,
    spin: 0.5,               // rad/s (2D rotationAngle speed)
    enterSeconds: 3,         // 2D maxEntryTime
    defeatedSeconds: 2,
    damage: 10,              // per bullet (2D damageWeakPoint(wp, 10))
    weakPointPoints: 200,
    weakPointCredits: 20,
    bossCreditShare: 0.2,
    drops: 3,
    moveEvery: 3,            // s (2D moveDuration)
    holdMin: 450,            // distance band from the ship it hovers in
    holdMax: 650,
    spawnDistance: 700,      // ahead of the ship
    spreadCount: 5,
    spreadAngle: 4 * DEG,
    spreadSpeed: 200,
    aimedSpeed: 300,
    circleSpeed: 150,
    bulletLife: 4,
    bulletRadius: 4,
});

export const bossLevelOf = (level) => Math.max(1, Math.floor(level / 2));

/** n directions spread evenly over the unit sphere (Fibonacci lattice). */
export function sphereDirections(n) {
    const out = [];
    const golden = Math.PI * (3 - Math.sqrt(5));
    for (let i = 0; i < n; i++) {
        const y = n === 1 ? 0 : 1 - (2 * (i + 0.5)) / n;
        const r = Math.sqrt(Math.max(0, 1 - y * y));
        const a = golden * i;
        out.push([Math.cos(a) * r, y, Math.sin(a) * r]);
    }
    return out;
}

/** Weak point stats for a boss level (2D createWeakPoints). */
export function weakPointPlan(bossLevel) {
    const outer = Math.max(BOSS3D.minOuterPoints, 3 + Math.floor(bossLevel / 2));
    return {
        outer,
        outerHealth: 20 + bossLevel * 5,
        coreHealth: 40 + bossLevel * 10,
        score: 1000 + bossLevel * 500,
        attackCooldown: 2 - Math.min(bossLevel * 0.1, 1),
        moveSpeed: 50 + bossLevel * 5,
    };
}

const rr = (rand, lo, hi) => lo + rand() * (hi - lo);

function perpendicular(dir) {
    const helper = Math.abs(dir[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
    const u = vNorm(vCross(dir, helper));
    return [u, vCross(dir, u)];
}

/**
 * @param {object} o
 * @param {() => number} o.rand
 * @param {number} o.size - world cube side
 * @param {number} o.level - game level (boss level = floor(level / 2))
 * @param {number[]} o.shipPos
 * @param {number[]} [o.shipForward] - the boss appears ahead of the ship
 * @param {() => any} [o.nextId]
 */
export function createBoss3d({ rand, size, level, shipPos, shipForward = [0, 0, -1], nextId = null }) {
    let ids = 1;
    const newId = () => (nextId ? nextId() : `b${ids++}`);
    const L = bossLevelOf(level);
    const plan = weakPointPlan(L);
    const axis = vNorm(vAdd(randomUnit(rand), [0, 2, 0])); // mostly upright spin
    const weakPoints = sphereDirections(plan.outer).map((dir, i) => ({
        id: i, dir, health: plan.outerHealth, maxHealth: plan.outerHealth, destroyed: false, isCore: false,
    }));
    const core = { id: 'core', dir: [0, 0, 0], health: plan.coreHealth, maxHealth: plan.coreHealth, destroyed: false, isCore: true };
    const b = {
        level: L,
        alive: true,
        phase: 'entering',
        phaseTimer: 0,
        pos: wrapPos(vAdd(shipPos, vScale(vNorm(shipForward), BOSS3D.spawnDistance)), size),
        q: qIdentity(),
        axis,
        weakPoints,
        core,
        score: plan.score,
        attackCooldown: plan.attackCooldown,
        attackTimer: 0,
        attackPattern: 0,
        moveSpeed: plan.moveSpeed,
        moveTimer: BOSS3D.moveEvery, // pick a target on the first fighting step
        target: null,
        bullets: [],
        flash: 0,
    };

    const outerLeft = () => b.weakPoints.filter(w => !w.destroyed).length;
    const health = () => b.weakPoints.reduce((s, w) => s + (w.destroyed ? 0 : w.health), 0) + (core.destroyed ? 0 : core.health);
    const maxHealth = plan.outer * plan.outerHealth + plan.coreHealth;

    /** World position of a weak point now (unwrapped around the body centre). */
    function wpPos(w) {
        return vAdd(b.pos, vScale(qRotate(b.q, w.dir), BOSS3D.bodyRadius));
    }
    function wpNormal(w) {
        return qRotate(b.q, w.dir);
    }

    function shoot(origin, dir, speed, events, pattern) {
        const bullet = {
            id: newId(), hostile: true, from: 'boss', pos: wrapPos(origin, size), prev: wrapPos(origin, size),
            vel: vScale(vNorm(dir), speed), life: BOSS3D.bulletLife, radius: BOSS3D.bulletRadius,
        };
        b.bullets.push(bullet);
        events.push({ type: 'bossShoot', bullet: bullet.id, pattern });
    }

    function turretToward(shipP) {
        let best = null;
        for (const w of b.weakPoints) {
            if (w.destroyed) continue;
            const p = wpPos(w);
            const d = vLen(nearestDelta(p, shipP, size));
            if (!best || d < best.d) best = { p, d, n: wpNormal(w) };
        }
        return best ? vAdd(best.p, vScale(best.n, BOSS3D.weakPointRadius + 6)) : b.pos;
    }

    function attack(ship, events) {
        b.attackPattern = (b.attackPattern + 1) % 3;
        const origin = turretToward(ship.pos);
        const toShip = vNorm(nearestDelta(origin, ship.pos, size));
        if (b.attackPattern === 0) {
            const [u, v] = perpendicular(toShip);
            const t = Math.tan(BOSS3D.spreadAngle);
            for (const off of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]]) {
                shoot(origin, vAdd(toShip, vAdd(vScale(u, off[0] * t), vScale(v, off[1] * t))), BOSS3D.spreadSpeed, events, 'spread');
            }
        } else if (b.attackPattern === 1) {
            shoot(origin, toShip, BOSS3D.aimedSpeed, events, 'aimed');
        } else {
            const n = 8 + b.level;
            for (const d of sphereDirections(n)) {
                const dir = qRotate(b.q, d);
                shoot(vAdd(b.pos, vScale(dir, BOSS3D.bodyRadius * 0.5)), dir, BOSS3D.circleSpeed, events, 'circle');
            }
        }
    }

    function defeat(events) {
        b.phase = 'defeated';
        b.phaseTimer = 0;
        const drops = [];
        for (let i = 0; i < BOSS3D.drops; i++) drops.push(wrapPos(vAdd(b.pos, vScale(randomUnit(rand), rr(rand, 20, 100))), size));
        events.push({
            type: 'bossDefeated', points: b.score, credits: Math.ceil(b.score * BOSS3D.bossCreditShare),
            pos: b.pos.slice(), drops,
        });
    }

    const api = {
        state: b,
        get alive() { return b.alive; },
        get phase() { return b.phase; },
        get health() { return health(); },
        get maxHealth() { return maxHealth; },
        /** Can it take damage now? (Not while entering or defeated: 2D checkBulletHit.) */
        get vulnerable() { return b.phase === 'fighting'; },
        /** Should the "BOSS BATTLE" warning show? (2D: first 2 s of the entry.) */
        get warning() { return b.phase === 'entering' && b.phaseTimer < 2; },
        weakPointPos: wpPos,
        weakPointNormal: wpNormal,
        /**
         * One step. world: { ship: { pos, alive } }. Returns events: bossFight (entry over),
         * bossShoot, bossGone (2 s after defeat), bulletExpired.
         */
        update(dt, { ship } = {}) {
            const events = [];
            if (!b.alive) return events;
            b.q = qNorm(qMul(qFromAxisAngle(b.axis, BOSS3D.spin * dt), b.q));
            b.flash = Math.max(0, b.flash - dt);
            b.phaseTimer += dt;
            if (b.phase === 'entering') {
                if (b.phaseTimer >= BOSS3D.enterSeconds) {
                    b.phase = 'fighting';
                    b.phaseTimer = 0;
                    events.push({ type: 'bossFight' });
                }
            } else if (b.phase === 'fighting' && ship) {
                b.moveTimer += dt;
                if (b.moveTimer >= BOSS3D.moveEvery || !b.target) {
                    b.moveTimer = 0;
                    // A new offset from the ship near the current one, so the boss drifts around the
                    // ship instead of cutting straight through it
                    const cur = vNorm(nearestDelta(ship.pos, b.pos, size));
                    const dir = vNorm(vAdd(cur, vScale(randomUnit(rand), 0.7)));
                    b.target = vScale(dir, rr(rand, BOSS3D.holdMin, BOSS3D.holdMax));
                }
                const goal = vAdd(ship.pos, b.target);
                const d = nearestDelta(b.pos, goal, size);
                const dist = vLen(d);
                if (dist > 5) b.pos = wrapPos(vAdd(b.pos, vScale(d, Math.min(dist, b.moveSpeed * dt) / dist)), size);
                b.attackTimer += dt;
                if (b.attackTimer >= b.attackCooldown && ship.alive !== false) {
                    b.attackTimer = 0;
                    attack(ship, events);
                }
            } else if (b.phase === 'defeated' && b.phaseTimer >= BOSS3D.defeatedSeconds) {
                b.alive = false;
                events.push({ type: 'bossGone' });
            }
            for (const bl of b.bullets) {
                bl.prev = bl.pos;
                bl.pos = wrapPos(vAdd(bl.pos, vScale(bl.vel, dt)), size);
                bl.life -= dt;
                if (bl.life <= 0) events.push({ type: 'bulletExpired', bullet: bl.id });
            }
            b.bullets = b.bullets.filter(x => x.life > 0);
            return events;
        },
        /**
         * Where a player bullet moving p0 → p0 + move (radius r) first strikes the boss:
         *   { type: 'weakPoint', wp, t } an exposed weak point from its outward side,
         *   { type: 'core', t }           the body once every outer point is gone,
         *   { type: 'body', t }           the body (absorbed, no damage),
         *   null                          a miss.
         * Only while the boss is alive (entering bullets are absorbed by the body too).
         */
        hitTest(p0, move, r = 0) {
            if (!b.alive || b.phase === 'defeated') return null;
            const mid = vAdd(p0, vScale(move, 0.5));
            const centre = vAdd(mid, nearestDelta(mid, b.pos, size)); // body image nearest the path
            const shift = vSub(centre, b.pos);
            let best = null;
            for (const w of b.weakPoints) {
                if (w.destroyed) continue;
                const c = vAdd(wpPos(w), shift);
                const t = segmentSphereT(p0, move, c, BOSS3D.weakPointRadius + r);
                if (t < 0) continue;
                const n = wpNormal(w);
                const at = vAdd(p0, vScale(move, t));
                const inward = vDot(move, n) < 0;
                const outer = vDot(vSub(at, centre), n) > BOSS3D.bodyRadius - BOSS3D.weakPointRadius * 0.25;
                if (inward && outer && (!best || t < best.t)) best = { type: 'weakPoint', wp: w, t };
            }
            const tb = segmentSphereT(p0, move, centre, BOSS3D.bodyRadius + r);
            if (tb >= 0 && (!best || tb < best.t)) {
                return { type: outerLeft() === 0 && !core.destroyed ? 'core' : 'body', t: tb };
            }
            return best;
        },
        /**
         * Apply a hit from hitTest (10 damage unless given). Returns events:
         * weakPointHit { id, health }, weakPointDestroyed { id, points: 200, credits: 20, pos },
         * escort { pos } (one per destroyed weak point), coreHit, bossDefeated { points, credits,
         * pos, drops: [3 positions] }. Nothing while not fighting or for a body hit.
         */
        damage(hit, amount = BOSS3D.damage) {
            const events = [];
            if (!hit || b.phase !== 'fighting') return events;
            if (hit.type === 'weakPoint') {
                const w = hit.wp;
                if (w.destroyed) return events;
                w.health = Math.max(0, w.health - amount);
                b.flash = 0.1;
                events.push({ type: 'weakPointHit', id: w.id, health: w.health });
                if (w.health <= 0) {
                    w.destroyed = true;
                    const pos = wrapPos(wpPos(w), size);
                    events.push({ type: 'weakPointDestroyed', id: w.id, points: BOSS3D.weakPointPoints, credits: BOSS3D.weakPointCredits, pos });
                    events.push({ type: 'escort', pos: wrapPos(vAdd(wpPos(w), vScale(wpNormal(w), 40)), size) });
                }
            } else if (hit.type === 'core') {
                if (outerLeft() > 0 || core.destroyed) return events;
                core.health = Math.max(0, core.health - amount);
                b.flash = 0.1;
                events.push({ type: 'coreHit', health: core.health });
                if (core.health <= 0) {
                    core.destroyed = true;
                    defeat(events);
                }
            }
            return events;
        },
        /** Swept boss bullets against the ship; hit bullets removed. Returns [{ bullet }]. */
        collideBullets({ ship = null } = {}) {
            if (!ship || ship.alive === false || ship.invulnerable > 0) return [];
            const hits = [];
            b.bullets = b.bullets.filter(bl => {
                const t = sweptHit(bl.prev, nearestDelta(bl.prev, bl.pos, size), ship.pos, (ship.radius ?? 9) + bl.radius, size);
                if (t >= 0) { hits.push({ bullet: bl }); return false; }
                return true;
            });
            return hits;
        },
        /** The ship touching the body costs a life (as touching any enemy in 2D). */
        touches(shipPos, shipRadius = 9) {
            return b.alive && b.phase !== 'defeated' && vLen(nearestDelta(shipPos, b.pos, size)) <= BOSS3D.bodyRadius + shipRadius;
        },
        snapshot() {
            return {
                phase: b.phase, level: b.level, pos: b.pos.slice(), health: health(), maxHealth,
                weakPoints: b.weakPoints.map(w => ({ id: w.id, health: w.health, destroyed: w.destroyed })),
                core: { health: core.health, destroyed: core.destroyed }, bullets: b.bullets.length,
            };
        },
    };
    return api;
}
