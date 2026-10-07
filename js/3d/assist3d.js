// 3D aids that follow the adaptive difficulty level (docs/plans/07-3d-game.md §2.9). There
// are no assistance settings: the 2D DynamicDifficulty's level (getAdjustmentLevel():
// 'assisting' | 'balanced' | 'challenging') picks a row of ASSIST3D. Target brackets around
// the target nearest the crosshair and the hit marker are always on.
//
// Pure and DOM-free. Vectors in the world frame unless named `local` (ship frame: x right,
// y up, -z the nose, as radar3d.js).

import { vAdd, vScale, vLen, vDot, vNorm, vSub, qConj, qRotate, forwardOf, DEG } from './math3d.js';
import { nearestDelta } from './world3d.js';
import { verticalFov } from './radar3d.js';

/**
 * The aids per adaptive level.
 * aimDeg: a shot bends toward a target within this angle of the nose (0 = off);
 * lead: lead marker in front of moving targets; crystalArrow: 'always' (nearest crystal off
 * screen), 'offscreen' (only when no crystal is on screen) or 'last' (only the last-few
 * arrows); threatTone / threatVibrate: the threat warning beyond the radar flash;
 * pickupBonus: extra share of the collection radius.
 */
export const ASSIST3D = Object.freeze({
    assisting: Object.freeze({ level: 'assisting', aimDeg: 4, lead: true, crystalArrow: 'always', threatTone: true, threatVibrate: true, pickupBonus: 0.5 }),
    balanced: Object.freeze({ level: 'balanced', aimDeg: 2, lead: true, crystalArrow: 'offscreen', threatTone: true, threatVibrate: true, pickupBonus: 0 }),
    challenging: Object.freeze({ level: 'challenging', aimDeg: 0, lead: false, crystalArrow: 'last', threatTone: false, threatVibrate: false, pickupBonus: 0 }),
});
export const ASSIST_LEVELS = Object.freeze(Object.keys(ASSIST3D));

export const TARGET3D = Object.freeze({
    bracketDeg: 12,     // the target nearest the crosshair within this angle gets brackets
    leadMinSpeed: 4,    // relative speed (units/s) below which a target counts as still: no lead marker
});

/** The aids for an adaptive level (unknown: Balanced). */
export function assistFor(level) {
    return ASSIST3D[level] || ASSIST3D.balanced;
}

/** Hostile targets for aiming: red rocks and UFOs that are not friendly or dead. */
export function isTarget(o) {
    if (!o || !o.pos) return false;
    if (o.kind === 'red') return true;
    return o.kind === 'ufo' && o.alive !== false && !o.friendly;
}

/**
 * Time for a bullet of speed `speed` (relative to the ship) to meet a target at `delta`
 * moving at `relVel` (both relative to the ship): the smallest t >= 0 with
 * |delta + relVel t| = speed t, or null when it can't be reached.
 */
export function interceptTime(delta, relVel, speed) {
    const a = vDot(relVel, relVel) - speed * speed;
    const b = 2 * vDot(delta, relVel);
    const c = vDot(delta, delta);
    if (Math.abs(a) < 1e-9) {
        if (Math.abs(b) < 1e-9) return null;
        const t = -c / b;
        return t >= 0 ? t : null;
    }
    const disc = b * b - 4 * a * c;
    if (disc < 0) return null;
    const r = Math.sqrt(disc);
    const t1 = (-b - r) / (2 * a), t2 = (-b + r) / (2 * a);
    const lo = Math.min(t1, t2), hi = Math.max(t1, t2);
    if (lo >= 0) return lo;
    return hi >= 0 ? hi : null;
}

/** Where to aim (relative to the ship) to hit a target: its intercept point, or its centre. */
export function aimPoint(delta, relVel, speed) {
    const t = interceptTime(delta, relVel, speed);
    return t === null ? delta : vAdd(delta, vScale(relVel, t));
}

const angleBetween = (a, b) => {
    const la = vLen(a), lb = vLen(b);
    if (la < 1e-9 || lb < 1e-9) return Math.PI;
    return Math.acos(Math.max(-1, Math.min(1, vDot(a, b) / (la * lb))));
};

/**
 * Aim assist at fire time: bend a shot's direction toward the best target (smallest angle
 * between the shot and the target's intercept point) within `maxAngle` radians and `range`.
 * @param {object} o - { from: ship position, dir: unit shot direction, shipVel, targets,
 *   size: world side, maxAngle, range, bulletSpeed }
 * @returns {{ dir: number[], id: (number|null), angle: number }} angle: the correction applied
 */
export function aimAssist({ from, dir, shipVel = [0, 0, 0], targets, size, maxAngle, range, bulletSpeed }) {
    if (!(maxAngle > 0) || !targets || !targets.length) return { dir, id: null, angle: 0 };
    let best = null;
    for (const t of targets) {
        if (!isTarget(t)) continue;
        const delta = nearestDelta(from, t.pos, size);
        if (vLen(delta) > range + (t.radius || 0)) continue;
        if (vDot(delta, dir) <= 0) continue;
        const aim = aimPoint(delta, vSub(t.vel || [0, 0, 0], shipVel), bulletSpeed);
        const a = angleBetween(dir, aim);
        if (a <= maxAngle && (!best || a < best.angle)) best = { id: t.id, aim, angle: a };
    }
    if (!best) return { dir, id: null, angle: 0 };
    return { dir: vNorm(best.aim), id: best.id, angle: best.angle };
}

/**
 * The target nearest the crosshair (smallest angle off the nose) within `maxAngle` and the
 * view distance: it gets the target brackets and, when moving, the lead marker.
 * @param {object} ship - { pos, q, vel }
 * @returns {{ id, local: number[], dist: number, angle: number, radius: number, relVel: number[] } | null}
 */
export function crosshairTarget(ship, targets, { size, range, maxAngle = TARGET3D.bracketDeg * DEG }) {
    const nose = forwardOf(ship.q);
    let best = null;
    for (const t of targets || []) {
        if (!isTarget(t)) continue;
        const delta = nearestDelta(ship.pos, t.pos, size);
        const dist = vLen(delta);
        if (dist > range) continue;
        const a = angleBetween(nose, delta);
        if (a > maxAngle || (best && a >= best.angle)) continue;
        best = { t, delta, dist, angle: a };
    }
    if (!best) return null;
    const inv = qConj(ship.q);
    return {
        id: best.t.id,
        local: qRotate(inv, best.delta),
        dist: best.dist,
        angle: best.angle,
        radius: best.t.radius || 0,
        relVel: qRotate(inv, vSub(best.t.vel || [0, 0, 0], ship.vel || [0, 0, 0])),
    };
}

/**
 * Lead marker for a crosshairTarget(): the ship-frame point to shoot at so a bullet of
 * `bulletSpeed` meets it, or null for a still target (or one out of reach).
 */
export function leadPoint(target, bulletSpeed) {
    if (!target || vLen(target.relVel) < TARGET3D.leadMinSpeed) return null;
    const t = interceptTime(target.local, target.relVel, bulletSpeed);
    return t === null ? null : vAdd(target.local, vScale(target.relVel, t));
}

/**
 * Screen position of a ship-frame point with the camera's field of view (radar3d.js
 * verticalFov, as render3d.js uses). null when behind the ship.
 * @returns {{ x: number, y: number, scale: number } | null} scale: CSS px per world unit at that depth
 */
export function projectLocal(local, w, h) {
    const [x, y, z] = local;
    if (z >= -1e-6) return null;
    const ty = Math.tan((verticalFov(w / h) * DEG) / 2);
    const depth = -z;
    const scale = (h / 2) / (ty * depth);
    return { x: w / 2 + x * scale, y: h / 2 - y * scale, scale };
}

/**
 * Edge-arrow options for the nearest crystal (radar3d.js edgeMarker) from the aids and
 * whether the level is down to its last few rocks: null = no crystal arrow.
 */
export function crystalArrowOptions(assist, lastFew) {
    if (lastFew) return null; // every remaining rock gets its own arrow instead
    if (assist.crystalArrow === 'last') return null;
    return { always: assist.crystalArrow === 'always' };
}
