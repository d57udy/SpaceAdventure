/**
 * Shared camera maths for local multiplayer (plan 05 §3).
 *
 * Pure module: no DOM, no globals. The world wraps on both axes.
 *
 * Conventions
 * - (cx, cy) is the world point at the centre of the view.
 * - (x, y) is the world point at the top-left of the view, as in today's Camera:
 *     x = cx - view.width  / (2 * zoom)
 *     y = cy - view.height / (2 * zoom)
 *   so with zoom 1 and one target, x = ship.x - width / 2 exactly as before.
 * - worldToScreen(wx, wy) = ((wx - x) * zoom, (wy - y) * zoom). It does not wrap;
 *   the renderer keeps handling wrap-around as it does today.
 * - parallaxX/Y accumulate the camera's wrapped movement (ship movement in
 *   single-player) for the starfield; flip glides are excluded.
 *
 * With one target and `singleInstant` (the default) the camera behaves exactly
 * like today's: instant snap, zoom 1, parallax from wrapped ship deltas, and cx/cy
 * are not normalised. With two or more targets it follows the smallest covering
 * midpoint with light smoothing, hysteresis on the half-world flip, and zooms out
 * for 3-4 players. With no targets it holds.
 */
import { wrapDelta } from './utils.js';

export const CAMERA_DEFAULTS = Object.freeze({
    smoothing: 0.12,     // s, time constant of normal multi-target following
    flipTime: 0.2,       // s, glide after a half-world flip
    hysteresis: 0.04,    // fraction of the world size the other midpoint must win by
    margin: 25,          // px, ship plus shield ring kept inside the view
    minZoom: 0.75,       // never zoom out further (nothing drawn twice)
    zoomOutTime: 0.25,   // s, zoom-out is essentially complete after this
    zoomInTime: 0.4,     // s, zoom-in is essentially complete after this
    singleInstant: true  // one target: today's instant follow
});

function mod(v, size) {
    if (!(size > 0)) return v;
    const r = v % size;
    return r < 0 ? r + size : r;
}

/**
 * All covering intervals of the points on a circle of circumference `size`,
 * one per gap between neighbouring points, sorted by span (smallest first).
 * @returns {{centre:number, span:number}[]}
 */
export function coverCandidates(coords, size) {
    if (!coords.length) return [];
    if (!(size > 0)) {
        const lo = Math.min(...coords), hi = Math.max(...coords);
        return [{ centre: (lo + hi) / 2, span: hi - lo }];
    }
    const pts = coords.map(c => mod(c, size)).sort((a, b) => a - b);
    const n = pts.length;
    if (n === 1) return [{ centre: pts[0], span: 0 }];
    const out = [];
    for (let i = 0; i < n; i++) {
        const cur = pts[i];
        const next = i === n - 1 ? pts[0] + size : pts[i + 1];
        const gap = next - cur;
        const span = size - gap;
        // The cover starts after the gap (at `next`) and runs forward by `span`.
        out.push({ centre: mod(next + span / 2, size), span });
    }
    out.sort((a, b) => a.span - b.span);
    return out;
}

/**
 * Smallest interval covering every coordinate on a circle of circumference `size`.
 * @returns {{centre:number, span:number}|null}
 */
export function axisCover(coords, size) {
    const c = coverCandidates(coords, size);
    return c.length ? c[0] : null;
}

/**
 * Pick the centre on one axis with hysteresis (plan §3.3). The candidate nearest
 * to `prevCentre` is "current"; switch to the best one only when its span is
 * smaller by more than `hysteresis` (world units).
 * @returns {{centre:number, span:number, flipped:boolean}|null}
 */
export function chooseCentreAxis(coords, size, prevCentre = null, hysteresis = 0.04 * size) {
    const cands = coverCandidates(coords, size);
    if (!cands.length) return null;
    const best = cands[0];
    if (prevCentre === null || prevCentre === undefined || cands.length === 1) {
        return { centre: best.centre, span: best.span, flipped: false };
    }
    let current = best, currentD = Infinity;
    for (const c of cands) {
        const d = Math.abs(wrapDelta(c.centre - prevCentre, size));
        if (d < currentD) { current = c; currentD = d; }
    }
    if (current === best || current.span - best.span <= hysteresis) {
        return { centre: current.centre, span: current.span, flipped: false };
    }
    return { centre: best.centre, span: best.span, flipped: true };
}

/**
 * Zoom needed so both spans plus `margin` on each side fit the view, clamped to
 * [floor, 1] where floor = max(minZoom, view/world) so nothing is drawn twice.
 */
export function requiredZoom(spanX, spanY, view, { margin = 25, minZoom = 0.75 } = {}) {
    let z = 1;
    z = Math.min(z, view.width / (spanX + 2 * margin));
    z = Math.min(z, view.height / (spanY + 2 * margin));
    let floor = minZoom;
    if (view.worldWidth > 0) floor = Math.max(floor, view.width / view.worldWidth);
    if (view.worldHeight > 0) floor = Math.max(floor, view.height / view.worldHeight);
    return Math.max(floor, Math.min(1, z));
}

/**
 * Goal framing for a set of points: centre per axis (with hysteresis against
 * `prev` = {x, y} or null), spans and zoom. Does not smooth.
 * @returns {{cx, cy, spanX, spanY, zoom, flippedX, flippedY}|null}
 */
export function frameTargets(points, view, prev = null, opts = {}) {
    if (!points.length) return null;
    const o = { ...CAMERA_DEFAULTS, ...opts };
    const W = view.worldWidth, H = view.worldHeight;
    const ax = chooseCentreAxis(points.map(p => p.x), W, prev ? prev.x : null, o.hysteresis * W);
    const ay = chooseCentreAxis(points.map(p => p.y), H, prev ? prev.y : null, o.hysteresis * H);
    return {
        cx: ax.centre, cy: ay.centre, spanX: ax.span, spanY: ay.span,
        zoom: requiredZoom(ax.span, ay.span, view, o),
        flippedX: ax.flipped, flippedY: ay.flipped
    };
}

function smoothstep(k) { return k * k * (3 - 2 * k); }

/** Create a camera. See the module comment for conventions. */
export function createCamera(options = {}) {
    const o = { ...CAMERA_DEFAULTS, ...options };

    const cam = {
        x: 0, y: 0, cx: 0, cy: 0, zoom: 1,
        parallaxX: 0, parallaxY: 0,
        lastShipX: null, lastShipY: null,   // single-target tracking (today's fields)
        multi: false,                       // last update used multi-target following
        goalX: null, goalY: null,           // last chosen cover centres (hysteresis reference)
        followX: 0, followY: 0,             // smoothed centre, excluding flip glide
        flipX: { start: 0, offset: 0, timer: 0 },
        flipY: { start: 0, offset: 0, timer: 0 },
        targetZoom: 1,
        options: o,

        _applyTopLeft(view) {
            this.x = this.cx - view.width / (2 * this.zoom);
            this.y = this.cy - view.height / (2 * this.zoom);
        },

        /**
         * @param {{x:number,y:number}[]} targets living ships (and beacons when they fit)
         * @param {number} dt seconds
         * @param {{width:number,height:number,worldWidth:number,worldHeight:number}} view
         */
        update(targets, dt, view) {
            const n = targets ? targets.length : 0;
            if (n === 0) return; // hold

            if (n === 1 && o.singleInstant) {
                const t = targets[0];
                if (this.multi) {
                    // Coming from multi-target following: no parallax jump.
                    this.lastShipX = t.x; this.lastShipY = t.y;
                }
                if (this.lastShipX !== null) {
                    this.parallaxX += wrapDelta(t.x - this.lastShipX, view.worldWidth);
                    this.parallaxY += wrapDelta(t.y - this.lastShipY, view.worldHeight);
                }
                this.lastShipX = t.x;
                this.lastShipY = t.y;
                this.multi = false;
                this.cx = t.x; this.cy = t.y;
                this.zoom = 1; this.targetZoom = 1;
                this.followX = t.x; this.followY = t.y;
                this.goalX = null; this.goalY = null;
                this.flipX.offset = this.flipX.timer = 0;
                this.flipY.offset = this.flipY.timer = 0;
                this._applyTopLeft(view);
                return;
            }

            const W = view.worldWidth, H = view.worldHeight;
            if (!this.multi) {
                this.multi = true;
                this.followX = mod(this.cx, W);
                this.followY = mod(this.cy, H);
                this.goalX = null; this.goalY = null;
                this.lastShipX = null; this.lastShipY = null;
            }

            const prev = this.goalX === null ? null : { x: this.goalX, y: this.goalY };
            const f = frameTargets(targets, view, prev, o);
            const alpha = o.smoothing > 0 ? 1 - Math.exp(-dt / o.smoothing) : 1;

            const axis = (goalKey, followKey, flip, goal, flipped, size, parKey) => {
                if (this[goalKey] !== null && flipped) {
                    const jump = wrapDelta(goal - this[goalKey], size);
                    this[followKey] = mod(this[followKey] + jump, size);
                    flip.start = flip.offset - jump;
                    flip.offset = flip.start;
                    flip.timer = o.flipTime;
                }
                this[goalKey] = goal;
                const ds = wrapDelta(goal - this[followKey], size) * alpha;
                this[followKey] = mod(this[followKey] + ds, size);
                this[parKey] += ds;
                if (flip.timer > 0) {
                    flip.timer = Math.max(0, flip.timer - dt);
                    flip.offset = o.flipTime > 0 ? flip.start * smoothstep(flip.timer / o.flipTime) : 0;
                } else {
                    flip.offset = 0;
                }
                return mod(this[followKey] + flip.offset, size);
            };
            this.cx = axis('goalX', 'followX', this.flipX, f.cx, f.flippedX, W, 'parallaxX');
            this.cy = axis('goalY', 'followY', this.flipY, f.cy, f.flippedY, H, 'parallaxY');

            this.targetZoom = f.zoom;
            const out = f.zoom < this.zoom;
            const tau = (out ? o.zoomOutTime : o.zoomInTime) / 4;
            const k = tau > 0 ? 1 - Math.exp(-dt / tau) : 1;
            this.zoom += (f.zoom - this.zoom) * k;
            if (Math.abs(f.zoom - this.zoom) < 1e-4) this.zoom = f.zoom;
            this._applyTopLeft(view);
        },

        /** Snap to (cx, cy) with zoom (default 1) and clear parallax, like today's Camera.reset. */
        reset(cx, cy, view, zoom = 1) {
            this.cx = cx; this.cy = cy;
            this.zoom = zoom; this.targetZoom = zoom;
            this.parallaxX = 0; this.parallaxY = 0;
            this.lastShipX = cx; this.lastShipY = cy;
            this.multi = false;
            this.followX = cx; this.followY = cy;
            this.goalX = null; this.goalY = null;
            this.flipX = { start: 0, offset: 0, timer: 0 };
            this.flipY = { start: 0, offset: 0, timer: 0 };
            this._applyTopLeft(view);
        },

        worldToScreen(worldX, worldY) {
            return { x: (worldX - this.x) * this.zoom, y: (worldY - this.y) * this.zoom };
        }
    };
    return cam;
}
