// Saucer mode maths (plan 05 §4.5, MP-5). Pure: no DOM, no globals.
//
// P1 flies the ship and must reach a target score within 150 s; P2 steers a UFO directly
// (js/ufo.js with `controlled`), turret along the movement direction, with slight aim assist and
// a fire cooldown. A lobby "saucer strength" handicap changes the saucer's speed and cooldown.
import { wrapDelta } from './utils.js';

/** Handicap presets, weakest first. `normal` matches the plan (speed 150, 1 s cooldown). */
export const SAUCER_STRENGTHS = Object.freeze({
    weak: Object.freeze({ id: 'weak', name: 'Weak', speed: 120, fireCooldown: 1.4 }),
    normal: Object.freeze({ id: 'normal', name: 'Normal', speed: 150, fireCooldown: 1 }),
    strong: Object.freeze({ id: 'strong', name: 'Strong', speed: 180, fireCooldown: 0.7 }),
});
export const STRENGTH_ORDER = Object.freeze(['weak', 'normal', 'strong']);
export const DEFAULT_STRENGTH = 'normal';

/** Rules that are not part of the handicap. */
export const SAUCER_RULES = Object.freeze({
    aimAssistDeg: 30,       // turret snaps to P1 or a green within this angle of its heading
    respawnDelay: 4,        // s after the saucer is destroyed
    invulnerability: 2,     // s of (translucent) protection after it appears
    killPoints: 200,        // P1's points for destroying the saucer
    greenShotPoints: 1,     // P2's points per green destroyed by a saucer shot
    pilotKillPoints: 3,     // P2's points per P1 life taken
    edgeInset: 40,          // px inside the view edge where the saucer reappears
});

export function strengthOf(id) {
    return SAUCER_STRENGTHS[id] || SAUCER_STRENGTHS[DEFAULT_STRENGTH];
}

/** Step the handicap (wraps round). */
export function cycleStrength(id, dir = 1) {
    const n = STRENGTH_ORDER.length;
    const i = STRENGTH_ORDER.indexOf(strengthOf(id).id);
    return STRENGTH_ORDER[(((i + (dir < 0 ? -1 : 1)) % n) + n) % n];
}

/** P1's target score: an explicit number wins, else the mode's value for the difficulty. */
export function saucerTarget(targets, difficulty, override = null) {
    if (Number.isFinite(override) && override > 0) return override;
    const t = targets || {};
    return t[difficulty] ?? t.medium ?? 2500;
}

/**
 * Absolute steering (the stick or keys point where the saucer goes; "up" is up on screen).
 * A stick wins over keys. Returns a vector of length 0..1.
 * @param {{up?:boolean, down?:boolean, left?:boolean, right?:boolean}} keys
 * @param {{active:boolean, angle:number, magnitude:number}|null} stick
 * @returns {{x:number, y:number, active:boolean}}
 */
export function steerVector(keys = {}, stick = null) {
    if (stick && stick.active && stick.magnitude > 0) {
        const m = Math.min(1, stick.magnitude);
        return { x: Math.cos(stick.angle) * m, y: Math.sin(stick.angle) * m, active: true };
    }
    const x = (keys.right ? 1 : 0) - (keys.left ? 1 : 0);
    const y = (keys.down ? 1 : 0) - (keys.up ? 1 : 0);
    if (!x && !y) return { x: 0, y: 0, active: false };
    const len = Math.hypot(x, y);
    return { x: x / len, y: y / len, active: true };
}

/** Smallest signed difference b - a between two angles, in (-PI, PI]. */
export function angleBetween(a, b) {
    let d = (b - a) % (Math.PI * 2);
    if (d > Math.PI) d -= Math.PI * 2;
    if (d <= -Math.PI) d += Math.PI * 2;
    return d;
}

/**
 * Aim assist: the turret points along `heading`; if a target lies within `maxDeg` of it, aim
 * straight at the one closest in angle (ties: the nearer). Wrap-aware in a W x H world.
 * @param {Array<{x:number, y:number}>} targets
 * @returns {{angle:number, target:object|null}}
 */
export function aimAssist(fromX, fromY, heading, targets, W, H, maxDeg = SAUCER_RULES.aimAssistDeg) {
    const max = (maxDeg * Math.PI) / 180;
    let best = null, bestDiff = Infinity, bestDist = Infinity, bestAngle = heading;
    for (const t of targets || []) {
        if (!t) continue;
        const dx = wrapDelta(t.x - fromX, W);
        const dy = wrapDelta(t.y - fromY, H);
        const dist = Math.hypot(dx, dy);
        if (!(dist > 0)) continue;
        const a = Math.atan2(dy, dx);
        const diff = Math.abs(angleBetween(heading, a));
        if (diff > max + 1e-9) continue;
        if (diff < bestDiff - 1e-9 || (Math.abs(diff - bestDiff) <= 1e-9 && dist < bestDist)) {
            best = t; bestDiff = diff; bestDist = dist; bestAngle = a;
        }
    }
    return { angle: bestAngle, target: best };
}

/**
 * Fire cooldown step. Returns the new state; `fired` when a shot goes out this frame.
 * @param {{cooldown:number}} state
 */
export function stepGun(state, dt, wantFire, cooldown) {
    const left = Math.max(0, (state && state.cooldown > 0 ? state.cooldown : 0) - dt);
    if (wantFire && left <= 0) return { cooldown: cooldown, fired: true };
    return { cooldown: left, fired: false };
}

function mod(v, size) {
    if (!(size > 0)) return v;
    const r = v % size;
    return r < 0 ? r + size : r;
}

/**
 * Where the saucer (re)appears: on the view's edge, on the far side of the view centre from
 * the pilot (P1), `inset` px inside the edge. Wrapped into the world.
 * @param {number} cx @param {number} cy view centre (world)
 * @param {{x:number, y:number}|null} pilot P1's ship (null: to the right of the centre)
 * @param {number} halfW @param {number} halfH half the view in world units
 */
export function farEdgePoint(cx, cy, pilot, halfW, halfH, W, H, inset = SAUCER_RULES.edgeInset) {
    let dx = 1, dy = 0;
    if (pilot) {
        // Away from the pilot: the direction from the pilot through the centre
        const px = wrapDelta(pilot.x - cx, W);
        const py = wrapDelta(pilot.y - cy, H);
        if (Math.hypot(px, py) > 1e-6) { dx = -px; dy = -py; }
        else { dx = 0; dy = -1; } // pilot at the centre: the top edge
    }
    const ax = Math.max(1, halfW - inset);
    const ay = Math.max(1, halfH - inset);
    const tx = dx !== 0 ? ax / Math.abs(dx) : Infinity;
    const ty = dy !== 0 ? ay / Math.abs(dy) : Infinity;
    const t = Math.min(tx, ty);
    return { x: mod(cx + dx * t, W), y: mod(cy + dy * t, H) };
}
