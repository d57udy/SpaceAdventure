// Collisions in the wrap-around cube. Pure, DOM-free.
// Bullets are swept (segment against sphere), so a fast bullet can never tunnel through a
// small rock between two simulation steps.

import { vAdd, vScale, vDot, vSub, vLenSq } from './math3d.js';
import { nearestDelta } from './world3d.js';

/** Do two spheres overlap (nearest image)? */
export function spheresOverlap(a, ra, b, rb, size) {
    const d = nearestDelta(a, b, size);
    const r = ra + rb;
    return vLenSq(d) <= r * r;
}

/**
 * First time t in [0, 1] at which the segment p0 → p0 + move touches the sphere (centre c,
 * radius r), or -1 if it never does. Starting inside counts as t = 0. Unwrapped coordinates.
 */
export function segmentSphereT(p0, move, c, r) {
    const m = vSub(p0, c);
    const cc = vDot(m, m) - r * r;
    if (cc <= 0) return 0;
    const a = vDot(move, move);
    if (a < 1e-12) return -1;
    const b = vDot(m, move);
    if (b >= 0) return -1; // moving away
    const disc = b * b - a * cc;
    if (disc < 0) return -1;
    const t = (-b - Math.sqrt(disc)) / a;
    return t >= 0 && t <= 1 ? t : -1;
}

/**
 * Swept test in the wrap-around world: uses the image of c nearest to the segment's midpoint.
 * Valid while |move| < size / 2 (a bullet moves ~15 units per 1/60 s step).
 */
export function sweptHit(p0, move, c, r, size) {
    const mid = vAdd(p0, vScale(move, 0.5));
    const cImg = vAdd(mid, nearestDelta(mid, c, size));
    return segmentSphereT(p0, move, cImg, r);
}
