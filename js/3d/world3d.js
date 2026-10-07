// The 3D wrap-around world (a 3-torus): a cube of side `size` whose opposite faces are joined,
// the 3D version of the 2D wrap-around rectangle. Every object is drawn and collided at its
// NEAREST IMAGE relative to the ship, and fog ends before half the cube side, so the seam is
// never visible. Pure, DOM-free; random numbers are injected (js/rng.js mulberry32).

import { vLen, vNorm, vAdd, vScale, vCross } from './math3d.js';
import { CRYSTAL_SIZES } from './rules3d.js';

export const WORLD = Object.freeze({
    size: 1600,          // cube side (world units)
    fogNear: 260,
    fogFar: 720,         // < size / 2: an object is always drawn closer than its wrapped copy
    spawnClearance: 320, // no rock spawns closer than this to the ship
    greens: 12,
    reds: 18,            // initial red rocks (mix of large and medium)
});

/**
 * View distance presets (owner feedback 2026-10-07: "objects disappear a little too quickly").
 * `range` is the visible range relative to the original 720 fog end. For each preset the cube
 * side keeps fogFar <= 0.45 x side, so an object is fully fogged (and culled) well before its
 * nearest image can jump across the seam at side / 2. Rock and crystal counts scale with the
 * world volume, so the density per visible volume stays as it was (capped by MAX_FIELD_ROCKS).
 * Every side is a multiple of 200 (the renderer's space-dust box).
 */
export const VIEW_DISTANCES = Object.freeze({
    normal: Object.freeze({ label: 'Normal', range: 1.5, fogNear: 390, fogFar: 1080, size: 2400 }),
    far: Object.freeze({ label: 'Far', range: 2, fogNear: 520, fogFar: 1440, size: 3200 }),
    veryfar: Object.freeze({ label: 'Very far', range: 2.6, fogNear: 675, fogFar: 1870, size: 4200 }),
});
export const VIEW_DISTANCE_NAMES = Object.freeze(Object.keys(VIEW_DISTANCES));
export const DEFAULT_VIEW_DISTANCE = 'far';
export const MAX_FIELD_ROCKS = 600;    // cap on the initial field (crystals + red rocks)
export const FOG_SEAM_RATIO = 0.45;    // fogFar <= this x side
const BULLET_SPEED = 900;              // matches SIM.bulletSpeed (sim3d.js)

/**
 * Everything that depends on the world size: cube side, fog, cull distance, spawn distance,
 * bullet life, and the counts of a plain random field (greens, reds: the prototype's field,
 * still used by createSim({ greens, reds }); the game's levels come from rules3d.js).
 * name: a VIEW_DISTANCES key, or null for the original 1600 cube (unit tests). maxRocks: cap
 * on greens + reds.
 */
export function worldFor(name = DEFAULT_VIEW_DISTANCE, { maxRocks = MAX_FIELD_ROCKS } = {}) {
    const key = name ? (VIEW_DISTANCES[name] ? name : DEFAULT_VIEW_DISTANCE) : null;
    const p = key ? VIEW_DISTANCES[key] : null;
    const size = p ? p.size : WORLD.size;
    const fogNear = p ? p.fogNear : WORLD.fogNear;
    const fogFar = p ? p.fogFar : WORLD.fogFar;
    const volume = (size / WORLD.size) ** 3;
    const base = WORLD.greens + WORLD.reds;
    const k = Math.min(1, maxRocks / (base * volume)); // < 1 only when the cap bites
    const scale = volume * k;
    return {
        name: key || 'classic',
        label: p ? p.label : 'Classic',
        size,
        fogNear,
        fogFar,
        // Beyond this an object is not drawn: even a large rock's spikes (~80) are then past the
        // fog end, and it is below side / 2, so a drawn object never switches to another image
        cullDistance: fogFar + 90,
        spawnClearance: WORLD.spawnClearance,   // a level's field: away from the ship
        greens: Math.round(WORLD.greens * scale),
        reds: Math.round(WORLD.reds * scale),
        bulletLife: p ? +((fogFar + 60) / BULLET_SPEED).toFixed(3) : 0.85, // range just past the fog
    };
}

export const ROCK_SIZES = Object.freeze({
    large: { radius: 42, score: 20, next: 'medium' },
    medium: { radius: 24, score: 50, next: 'small' },
    small: { radius: 13, score: 100, next: null },
});
export const GREEN_RADIUS = 16;

/** One coordinate wrapped into [0, size). */
export function wrapCoord(v, size) {
    const r = v % size;
    return r < 0 ? r + size : r;
}

export const wrapPos = (p, size) => [wrapCoord(p[0], size), wrapCoord(p[1], size), wrapCoord(p[2], size)];

/** Shortest signed difference b - a on a ring of length size: in [-size/2, size/2). */
export function wrapDelta1(a, b, size) {
    let d = (b - a) % size;
    if (d >= size / 2) d -= size;
    else if (d < -size / 2) d += size;
    return d;
}

/** Vector from a to the nearest image of b. */
export function nearestDelta(a, b, size) {
    return [wrapDelta1(a[0], b[0], size), wrapDelta1(a[1], b[1], size), wrapDelta1(a[2], b[2], size)];
}

/** Position of b's nearest image to a (in a's unwrapped neighbourhood). */
export const nearestImage = (a, b, size) => vAdd(a, nearestDelta(a, b, size));

export const wrappedDistance = (a, b, size) => vLen(nearestDelta(a, b, size));

const rr = (rand, lo, hi) => lo + rand() * (hi - lo);

/** Uniform random unit vector. */
export function randomUnit(rand) {
    const z = rr(rand, -1, 1);
    const t = rr(rand, 0, Math.PI * 2);
    const s = Math.sqrt(1 - z * z);
    return [s * Math.cos(t), s * Math.sin(t), z];
}

/**
 * Random point at least `clearance` (wrapped) from every point in `avoid`.
 * Falls back to the best candidate after `tries`.
 */
export function spawnPoint(rand, size, avoid = [], clearance = WORLD.spawnClearance, tries = 40) {
    let best = null;
    let bestD = -1;
    for (let i = 0; i < tries; i++) {
        const p = [rr(rand, 0, size), rr(rand, 0, size), rr(rand, 0, size)];
        let d = Infinity;
        for (const a of avoid) d = Math.min(d, wrappedDistance(a, p, size));
        if (d >= clearance) return p;
        if (d > bestD) { bestD = d; best = p; }
    }
    return best;
}

let fallbackId = 1;

/**
 * A rock or crystal. Crystals come in the 2D sizes (rules3d.js CRYSTAL_SIZES; a size that
 * is not a crystal size gives a medium crystal, radius GREEN_RADIUS).
 */
export function makeRock({ id, kind, size = 'large', pos, vel = [0, 0, 0], rand = Math.random }) {
    const crystal = kind === 'green' ? (CRYSTAL_SIZES[size] ? size : 'medium') : null;
    const radius = crystal ? CRYSTAL_SIZES[crystal].radius : ROCK_SIZES[size].radius;
    return {
        id: id ?? fallbackId++,
        kind,                                  // 'green' (collect) | 'red' (shoot)
        size: crystal || size,
        radius,
        pos: pos.slice(),
        vel: vel.slice(),
        spinAxis: randomUnit(rand),
        spin: rr(rand, 0.3, 1.4) * (kind === 'green' ? 1.5 : 1),
        angle: rr(rand, 0, Math.PI * 2),
        shape: Math.floor(rand() * 4),         // mesh variant for the renderer
    };
}

/** Drift speed range per kind (world units per second); rocks drift slowly (depth is harder to judge). */
export function driftVel(rand, kind, size) {
    const max = kind === 'green' ? 10 : size === 'small' ? 32 : size === 'medium' ? 24 : 16;
    return vScale(randomUnit(rand), rr(rand, max * 0.3, max));
}

/**
 * Initial field: `greens` crystals and `reds` red rocks (two thirds large), all at least
 * `clearance` from the ship. nextId() hands out ids.
 */
export function spawnField(rand, { size = WORLD.size, shipPos = [0, 0, 0], greens = WORLD.greens, reds = WORLD.reds,
    clearance = WORLD.spawnClearance, nextId } = {}) {
    const ids = nextId || (() => fallbackId++);
    const rocks = [];
    const avoid = [shipPos];
    for (let i = 0; i < greens + reds; i++) {
        const kind = i < greens ? 'green' : 'red';
        const sz = kind === 'red' && (i - greens) % 3 === 2 ? 'medium' : 'large';
        const pos = spawnPoint(rand, size, avoid, clearance);
        rocks.push(makeRock({ id: ids(), kind, size: sz, pos, vel: driftVel(rand, kind, sz), rand }));
    }
    return rocks;
}

/** Spawn one rock of a kind far from the ship (keeps the field populated). */
export function spawnOne(rand, kind, { size = WORLD.size, shipPos, clearance = WORLD.fogFar * 0.8, nextId, rockSize = 'large' } = {}) {
    const pos = spawnPoint(rand, size, [shipPos], clearance);
    return makeRock({ id: nextId ? nextId() : fallbackId++, kind, size: rockSize, pos, vel: driftVel(rand, kind, rockSize), rand });
}

/**
 * Split a red rock: large → 2 medium, medium → 2 small, small → nothing. The pieces fly
 * apart perpendicular to the hit direction, on top of the parent's drift.
 */
export function splitRock(rock, rand, { hitDir = [0, 0, -1], nextId } = {}) {
    const next = ROCK_SIZES[rock.size] && ROCK_SIZES[rock.size].next;
    if (rock.kind !== 'red' || !next) return [];
    const ids = nextId || (() => fallbackId++);
    const h = vNorm(hitDir);
    // A direction perpendicular to the hit
    let side = vCross(h, randomUnit(rand));
    if (vLen(side) < 1e-3) side = vCross(h, [0, 1, 0]);
    if (vLen(side) < 1e-3) side = [1, 0, 0];
    side = vNorm(side);
    const speed = rr(rand, 26, 44);
    const r = ROCK_SIZES[next].radius;
    return [1, -1].map((s) => makeRock({
        id: ids(),
        kind: 'red',
        size: next,
        pos: vAdd(rock.pos, vScale(side, s * r * 1.1)),
        vel: vAdd(vAdd(rock.vel, vScale(side, s * speed)), vScale(h, speed * 0.25)),
        rand,
    }));
}

/** Move every rock by its velocity and wrap. Mutates. */
export function driftRocks(rocks, dt, size) {
    for (const r of rocks) {
        r.pos = wrapPos(vAdd(r.pos, vScale(r.vel, dt)), size);
        r.angle += r.spin * dt;
    }
}

/** Counts for the HUD / test hook. */
export function countRocks(rocks) {
    let green = 0, red = 0;
    for (const r of rocks) (r.kind === 'green' ? green++ : red++);
    return { green, red, rocks: rocks.length };
}

