// Power-ups in the 3D game (docs/plans/07-3d-game.md §2.7), following 2D (js/powerup.js,
// js/main.js activatePowerUp / applyMagnet / spawnPowerUpAt, the power-up timer). Pure and
// DOM-free; random numbers are injected (js/rng.js).
//
// From 2D:
//   - the 7 types, their chances (PowerUp.getRandomType: extra life 5 %, shield 10 %,
//     triple 15 %, rapid 20 %, speed 20 %, magnet 15 %, 2x score 15 %) and durations
//     (rapid 8, triple 10, shield 6, speed 8, magnet 10, 2x 12 s) × the Power-Up Duration
//     upgrade;
//   - a 30 % drop chance when a red rock or UFO is destroyed, plus one every 20 s ×
//     adaptive powerUpSpawnMod; a power-up lasts 15 s and blinks for its last 3 s;
//   - shield: absorbs one hit and then breaks (2D sets it to 0 on impact);
//   - rapid fire: shot interval × 0.4 (2D cooldown 0.25 → 0.1 s);
//   - speed boost: thrust × 1.6 (SPEED_BOOST_MULT). 2D has no top speed (only friction), so
//     the boost also raises how fast the ship gets; 3D has a top speed, so it is × 1.6 too;
//   - 2x score: crystal points × 2; extra life: +1 life at once.
//
// 3D translations:
//   - the timed one appears within the view distance (30 … 70 % of it) so it can be found;
//   - triple shot: 3 bullets 3° apart (plan 07 §2.7); 2D's 15° would miss in 3D;
//   - magnet: 2D pulls greens within 300 px with acceleration 100 / d (px/s², d in px),
//     from 20 px. With SCALE = view distance / 720 (as ufo3d.js), the same pull in screen
//     terms is radius 300·S, minimum 20·S and acceleration 100·S² / d (d in 3D units).

import { PowerUpType, PowerUp } from '../powerup.js';
import { vAdd, vScale, vLen, vNorm, forwardOf, rightOf, DEG } from './math3d.js';
import { nearestDelta, wrapPos, randomUnit } from './world3d.js';

export const POWERUP3D = Object.freeze({
    dropChance: 0.3,
    interval: 20,
    lifetime: 15,
    blinkStart: 3,
    radius: 14,
    pickupBonus: 10,       // added to ship + power-up radius (a little generous, like crystals)
    rapidFactor: 0.4,      // 2D RAPID_FIRE_COOLDOWN / NORMAL_SHOT_COOLDOWN
    speedFactor: 1.6,      // 2D SPEED_BOOST_MULT
    scoreFactor: 2,
    tripleAngle: 3 * DEG,
    magnetRadius2d: 300,
    magnetMin2d: 20,
    magnetForce2d: 100,
    viewRef: 720,
    spawnNear: 0.3,        // timed spawn: share of the view distance
    spawnFar: 0.7,
});

/** Timed effects (seconds left), the 2D p.powerUps keys. Extra life is instant. */
export const TIMED_POWERUPS = Object.freeze(['rapid_fire', 'triple_shot', 'shield', 'speed_boost', 'magnet', 'score_multiplier']);

export const POWERUP_TYPES = Object.freeze(Object.fromEntries(Object.values(PowerUpType).map(t => [t.id, t])));

/** A random type with the 2D chances (rand: seeded generator). */
export const randomType = (rand) => PowerUp.getRandomType(rand);

export const powerUpScale = (range) => Math.max(1e-6, Number(range) || POWERUP3D.viewRef) / POWERUP3D.viewRef;

/** Magnet acceleration (3D units/s²) on a crystal at distance d, or 0 outside the pull. */
export function magnetAccel(d, range) {
    const S = powerUpScale(range);
    if (d <= POWERUP3D.magnetMin2d * S || d >= POWERUP3D.magnetRadius2d * S) return 0;
    return POWERUP3D.magnetForce2d * S * S / d;
}

/**
 * Directions of one shot: the nose, plus two 3° to the left and right with triple shot.
 * q: the ship's orientation.
 */
export function shotDirections(q, triple = false) {
    const f = forwardOf(q);
    if (!triple) return [f];
    const r = rightOf(q);
    const t = Math.tan(POWERUP3D.tripleAngle);
    return [f, vNorm(vAdd(f, vScale(r, -t))), vNorm(vAdd(f, vScale(r, t)))];
}

const rr = (rand, lo, hi) => lo + rand() * (hi - lo);

/**
 * @param {object} o
 * @param {() => number} o.rand
 * @param {number} o.size - world cube side
 * @param {number} o.range - view distance
 * @param {number} [o.durationMult] - Power-Up Duration upgrade (progress3d ship().powerUpDurationMult)
 * @param {object} [o.dda] - { powerUpSpawnMod }
 * @param {() => any} [o.nextId]
 */
export function createPowerUps({ rand, size, range, durationMult = 1, dda = null, nextId = null } = {}) {
    let ids = 1;
    const newId = () => (nextId ? nextId() : `p${ids++}`);
    const st = {
        pickups: [],
        effects: Object.fromEntries(TIMED_POWERUPS.map(k => [k, 0])),
        timer: 0,
        size, range, durationMult,
        spawnMod: (dda && Number.isFinite(dda.powerUpSpawnMod)) ? dda.powerUpSpawnMod : 1,
        enabled: true,
    };
    const resetTimer = () => { st.timer = POWERUP3D.interval * st.spawnMod; };
    resetTimer();

    function place(pos, type) {
        const p = { id: newId(), kind: 'powerup', type: type.id, pos: wrapPos(pos, st.size), radius: POWERUP3D.radius, life: POWERUP3D.lifetime };
        st.pickups.push(p);
        return p;
    }

    const api = {
        state: st,
        get pickups() { return st.pickups; },
        get effects() { return st.effects; },
        configure({ range: r, size: s, durationMult: m, dda: d } = {}) {
            if (r !== undefined) st.range = r;
            if (s !== undefined) st.size = s;
            if (m !== undefined) st.durationMult = m;
            if (d && Number.isFinite(d.powerUpSpawnMod)) st.spawnMod = d.powerUpSpawnMod;
        },
        setEnabled(on) { st.enabled = !!on; },
        /** New game: no pickups, no effects, a fresh timer. */
        reset() {
            st.pickups = [];
            for (const k of TIMED_POWERUPS) st.effects[k] = 0;
            resetTimer();
        },
        /** New level: pickups go, running effects stay (as in 2D). */
        clearPickups() { st.pickups = []; },
        /** A red rock or UFO was destroyed at pos: 30 % chance of a drop. Returns it or null. */
        onDestroyed(pos) {
            if (rand() >= POWERUP3D.dropChance) return null;
            return place(pos, randomType(rand));
        },
        /** A drop that always happens (the boss's 3). type: id, or random. */
        dropAt(pos, typeId = null) {
            return place(pos, (typeId && POWERUP_TYPES[typeId]) || randomType(rand));
        },
        /** Start an effect (or the extra life). Returns { type, extraLife?, seconds }. */
        activate(typeId) {
            if (typeId === 'extra_life') return { type: typeId, extraLife: true, seconds: 0 };
            const t = POWERUP_TYPES[typeId];
            if (!t || !(typeId in st.effects)) return { type: typeId, seconds: 0 };
            st.effects[typeId] = t.duration * st.durationMult;
            return { type: typeId, seconds: st.effects[typeId] };
        },
        active(typeId) { return (st.effects[typeId] || 0) > 0; },
        /** A hit while shielded: the shield breaks and absorbs it. Returns true if it did. */
        consumeShield() {
            if (st.effects.shield > 0) { st.effects.shield = 0; return true; }
            return false;
        },
        fireIntervalMult() { return st.effects.rapid_fire > 0 ? POWERUP3D.rapidFactor : 1; },
        speedMult() { return st.effects.speed_boost > 0 ? POWERUP3D.speedFactor : 1; },
        scoreMult() { return st.effects.score_multiplier > 0 ? POWERUP3D.scoreFactor : 1; },
        shotDirections(q) { return shotDirections(q, st.effects.triple_shot > 0); },
        /**
         * One step. world: { ship: { pos, alive, radius }, rocks: [...] } (magnet pulls greens).
         * Returns events: powerUpSpawn { id, type }, powerUp { id, type, extraLife?, seconds },
         * powerUpExpired { id } (not picked up in 15 s), effectEnd { type }.
         */
        update(dt, { ship = null, rocks = [] } = {}) {
            const events = [];
            const alive = !!(ship && ship.alive !== false);
            // Effects count down
            for (const k of TIMED_POWERUPS) {
                if (st.effects[k] > 0) {
                    st.effects[k] = Math.max(0, st.effects[k] - dt);
                    if (st.effects[k] === 0) events.push({ type: 'effectEnd', kind: k });
                }
            }
            // Timed spawn within the view distance
            if (st.enabled && alive) {
                st.timer -= dt;
                if (st.timer <= 0) {
                    const d = rr(rand, POWERUP3D.spawnNear, POWERUP3D.spawnFar) * st.range;
                    const p = place(vAdd(ship.pos, vScale(randomUnit(rand), d)), randomType(rand));
                    events.push({ type: 'powerUpSpawn', id: p.id, kind: p.type });
                    resetTimer();
                }
            }
            // Lifetimes and pickup
            const keep = [];
            for (const p of st.pickups) {
                p.life -= dt;
                if (p.life <= 0) { events.push({ type: 'powerUpExpired', id: p.id }); continue; }
                if (alive) {
                    const reach = (ship.radius ?? 9) + p.radius + POWERUP3D.pickupBonus;
                    if (vLen(nearestDelta(ship.pos, p.pos, st.size)) <= reach) {
                        events.push({ ...api.activate(p.type), type: 'powerUp', id: p.id, kind: p.type });
                        continue;
                    }
                }
                keep.push(p);
            }
            st.pickups = keep;
            // Magnet: crystals drift toward the ship
            if (alive && st.effects.magnet > 0) {
                for (const r of rocks) {
                    if (!r || r.kind !== 'green') continue;
                    const d = nearestDelta(r.pos, ship.pos, st.size);
                    const dist = vLen(d);
                    const a = magnetAccel(dist, st.range);
                    if (a > 0) r.vel = vAdd(r.vel || [0, 0, 0], vScale(d, a * dt / dist));
                }
            }
            return events;
        },
        /** Blinking in its last 3 s (the renderer's cue). */
        blinking(p) { return p.life < POWERUP3D.blinkStart; },
        snapshot() {
            return {
                pickups: st.pickups.map(p => ({ id: p.id, type: p.type, life: Math.round(p.life * 100) / 100 })),
                effects: { ...st.effects }, timer: st.timer,
            };
        },
    };
    return api;
}
