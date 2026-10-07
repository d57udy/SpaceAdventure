// Two-circle radar for the 3D prototype (X-Wing / FreeSpace style; owner choice 2026-10-07,
// docs/plans/06-3d-mode.md §3). Pure and DOM-free: hud3d.js draws what this returns.
//
// Every object is taken in the SHIP'S OWN frame (x right, y up, -z the nose), so rolling the
// ship rotates the dots automatically. Objects in front go in the FRONT circle, objects
// behind in the REAR circle. The distance from a circle's centre is the angle off the nose
// (front) or off the tail (rear): centre = dead ahead / dead behind, rim = 90° off-axis. The
// direction from the centre is the object's up/right direction. The rear circle is NOT drawn
// as "looking backwards": right stays right, so a dot on the right always means "turn right".

import { qConj, qRotate, vDot, vSub, vLen, vAdd, vScale } from './math3d.js';
import { nearestDelta } from './world3d.js';

export const RADAR = Object.freeze({
    maxBlips: 24,            // nearest objects drawn (both circles together); more gets unreadable at Very far
    beyondCrystals: 3,       // crystals beyond the view distance still shown (dimmed)
    threatFraction: 0.25,    // a red rock within this share of the view distance ...
    threatTime: 6,           // ... reaching its closest approach within this many seconds ...
    threatMargin: 30,        // ... and passing closer than the radii plus this margin
    shipRadius: 9,
});

// Object kinds -> radar types (later: 'saucer' UFO, 'boss', 'powerup')
const TYPE_OF = { green: 'crystal', red: 'rock' };

/**
 * Where a ship-local direction goes on the radar.
 * @param {number[]} local - [x right, y up, z back] (the nose is -z)
 * @returns {{ hemi: 'front'|'rear', x: number, y: number, angle: number }} x, y in the unit
 *   circle (y up); angle off the nose (front) or tail (rear), radians, 0..π/2
 */
export function radarPoint(local) {
    const [x, y, z] = local;
    const len = Math.hypot(x, y, z);
    if (len < 1e-9) return { hemi: 'front', x: 0, y: 0, angle: 0 };
    const front = z <= 0;
    const axial = front ? -z : z; // along the nose (front) or the tail (rear), >= 0
    const lateral = Math.hypot(x, y);
    const angle = Math.atan2(lateral, axial); // 0 .. π/2
    const r = Math.min(1, angle / (Math.PI / 2));
    if (lateral < 1e-9) return { hemi: front ? 'front' : 'rear', x: 0, y: 0, angle };
    return { hemi: front ? 'front' : 'rear', x: (x / lateral) * r, y: (y / lateral) * r, angle };
}

/** Rim point in a blip's direction (beyond-range crystals get a tick on the rim). */
function rimOf(p) {
    const l = Math.hypot(p.x, p.y);
    return l < 1e-9 ? { rimX: 0, rimY: -1 } : { rimX: p.x / l, rimY: p.y / l };
}

/** Vector from the ship to an object's nearest image, in the ship's own frame. */
export function toLocal(shipPos, shipQ, pos, size) {
    return qRotate(qConj(shipQ), nearestDelta(shipPos, pos, size));
}

/**
 * Is a red rock a threat: close, closing, and on a course that passes near the ship soon?
 * delta = rock - ship (nearest image), relVel = rock velocity - ship velocity (world frame).
 */
export function isThreat(delta, relVel, rockRadius, range) {
    const dist = vLen(delta);
    if (dist > range * RADAR.threatFraction) return false;
    const closing = vDot(delta, relVel);
    if (closing >= 0) return false; // moving apart (or not moving)
    const v2 = vDot(relVel, relVel);
    const t = -closing / v2; // time of closest approach
    if (t > RADAR.threatTime) return false;
    const miss = vLen(vAdd(delta, vScale(relVel, t)));
    return miss < rockRadius + RADAR.shipRadius + RADAR.threatMargin;
}

/**
 * Build both radar circles.
 * @param {object} ship - { pos, q, vel }
 * @param {object[]} rocks - sim rocks ({ id, kind, pos, vel, radius })
 * @param {object} o - { size: world cube side, range: view distance (fog far) }
 * @returns {{ front: object[], rear: object[] }} blips { id, type, x, y, dist, near, threat, beyond }
 *   near: 1 = right at the ship, 0 = at the view distance (beyond-range crystals: 0)
 */
export function buildRadar(ship, rocks, { size, range }) {
    const shipVel = ship.vel || [0, 0, 0];
    const inRange = [];
    const beyond = [];
    for (const r of rocks) {
        const type = TYPE_OF[r.kind] || r.kind;
        const delta = nearestDelta(ship.pos, r.pos, size);
        const dist = vLen(delta);
        const e = { r, type, delta, dist };
        if (dist <= range) inRange.push(e);
        else if (type === 'crystal') beyond.push(e);
    }
    inRange.sort((a, b) => a.dist - b.dist);
    beyond.sort((a, b) => a.dist - b.dist);
    const pick = [
        ...inRange.slice(0, RADAR.maxBlips),
        ...beyond.slice(0, RADAR.beyondCrystals).map((e) => ({ ...e, beyond: true })),
    ];
    const inv = qConj(ship.q);
    const out = { front: [], rear: [] };
    for (const e of pick) {
        const p = radarPoint(qRotate(inv, e.delta));
        const threat = !e.beyond && e.type === 'rock'
            && isThreat(e.delta, vSub(e.r.vel || [0, 0, 0], shipVel), e.r.radius || 0, range);
        out[p.hemi].push({
            id: e.r.id,
            type: e.type,
            x: p.x,
            y: p.y,
            dist: e.dist,
            near: e.beyond ? 0 : Math.max(0, Math.min(1, 1 - e.dist / range)),
            threat,
            beyond: !!e.beyond,
            ...(e.beyond ? rimOf(p) : {}),
        });
    }
    return out;
}

/** The camera's vertical field of view (degrees) for an aspect ratio (render3d.js uses it). */
export function verticalFov(aspect) {
    const vfov = 2 * Math.atan(Math.tan(45 * Math.PI / 180) / Math.max(1e-6, aspect)) * 180 / Math.PI;
    return Math.min(80, Math.max(50, vfov));
}

/** Is a ship-local direction inside the camera's view (with a small margin)? */
export function onScreen(local, aspect, margin = 0.92) {
    const [x, y, z] = local;
    if (z >= -1e-6) return false;
    const ty = Math.tan((verticalFov(aspect) * Math.PI / 180) / 2) * margin;
    const tx = ty * aspect;
    return Math.abs(x / -z) <= tx && Math.abs(y / -z) <= ty;
}

/**
 * Edge-of-screen marker for the nearest crystal, only when no crystal within the view
 * distance is on screen. angle: screen direction of the shortest turn (radians, 0 = right,
 * π/2 = up); dist: world distance.
 * @returns {{ id, angle: number, dist: number } | null}
 */
export function edgeMarker(ship, rocks, { size, range, aspect }) {
    const inv = qConj(ship.q);
    let best = null;
    for (const r of rocks) {
        if (r.kind !== 'green') continue;
        const delta = nearestDelta(ship.pos, r.pos, size);
        const dist = vLen(delta);
        const local = qRotate(inv, delta);
        if (dist <= range && onScreen(local, aspect)) return null; // a crystal is in view
        if (!best || dist < best.dist) best = { r, dist, local };
    }
    if (!best) return null;
    const [x, y] = best.local;
    // Straight behind with no sideways component: point down (turn either way)
    const angle = Math.hypot(x, y) < 1e-6 ? -Math.PI / 2 : Math.atan2(y, x);
    return { id: best.r.id, angle, dist: best.dist };
}

/**
 * Where the two circles go: bottom centre between Thrust and Fire, above the footer line.
 * When the screen is too narrow (portrait) they move up above the buttons. Button boxes
 * mirror proto3d.js CSS (84 px round buttons 16 px from the edges; Thrust moves next to
 * Fire in Joystick mode; roll buttons above them).
 * @returns {{ r: number, front: {cx, cy}, rear: {cx, cy}, lifted: boolean }}
 */
export function radarLayout(w, h) {
    const r = Math.round(Math.max(30, Math.min(70, Math.min(w, h) * 0.11)));
    const gap = 10;
    const half = 2 * r + gap / 2; // half the width of both circles
    const footerTop = h - Math.max(18, h * 0.06) + 2;
    const leftClear = 16 + 84 + 10;          // Thrust (left)
    const rightClear = 116 + 84 + 10;        // Fire + Thrust in Joystick mode (right)
    const fits = w / 2 - half >= leftClear && w / 2 + half <= w - rightClear;
    const label = 12; // room for the FRONT / REAR labels above the circles
    let cy = footerTop - 6 - r;
    if (!fits) cy = h - (16 + 84 + 16 + 64 + 12) - r; // above Thrust/Fire and the roll buttons
    cy = Math.max(r + label, cy);
    return {
        r,
        front: { cx: w / 2 - r - gap / 2, cy },
        rear: { cx: w / 2 + r + gap / 2, cy },
        lifted: !fits,
    };
}
