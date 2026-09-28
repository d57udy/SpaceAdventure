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
 * - parallaxX/Y accumulate the camera's movement (ship movement in single-player) for the
 *   starfield.
 *
 * With one target and `singleInstant` (the default: single-player, Take Turns) the camera
 * behaves exactly like today's: instant snap, zoom 1, parallax from wrapped ship deltas, and
 * cx/cy are not normalised.
 *
 * Otherwise (simultaneous modes, 2026-09-28) it tracks continuously: every target (by `id`)
 * keeps an UNWRAPPED position, advanced each frame by the wrapped delta of its world position,
 * so nobody ever "switches sides" of the world. The centre (also unwrapped internally) follows
 * the midpoint of the unwrapped covering interval with light smoothing and crosses the world
 * edge as smoothly as single-player scrolling. A target that (re)appears, or jumps more than a
 * quarter of the world in one frame (hyperspace), is re-anchored to its image nearest the
 * current centre. Zoom eases out as the targets spread, down to the floor
 * max(minZoom, view/world). The leash (leashBox, applyLeash) keeps ships inside the view at
 * that floor. With no targets it holds.
 *
 * coverCandidates / axisCover / chooseCentreAxis / frameTargets below frame a static set of
 * points on the circle (smallest cover, optional hysteresis); the camera itself no longer uses
 * the half-world flip.
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
    singleInstant: true, // one target: today's instant follow
    containMargin: 15,   // px, hard limit: a settled target never gets closer to the view edge
    reanchor: 0.25       // fraction of the world: a bigger jump in one frame re-anchors the target
});

/** Soft-edge (leash) tuning. */
export const LEASH_DEFAULTS = Object.freeze({
    margin: 25,          // px inside the visible edge at minimum zoom
    overshoot: 20,       // px a soft leash may stretch past the edge
    damping: 0.04,       // s, time constant that kills outward velocity past a soft edge
    spring: 200          // 1/s^2, pull back per px of stretch (soft)
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
    return Math.max(zoomFloor(view, minZoom), Math.min(1, z));
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


/** Signed shortest offset from `ref` to `v` on a circle of circumference `size` (any number of laps). */
function circDelta(v, ref, size) {
    if (!(size > 0)) return v - ref;
    return mod(v - ref + size / 2, size) - size / 2;
}

/** The image of world coordinate `v` nearest to `ref` (ref may be unwrapped). */
export function unwrapNear(v, ref, size) {
    return ref + circDelta(v, ref, size);
}

/** Lowest zoom: max(minZoom, view/world) per axis, so nothing is drawn twice. */
export function zoomFloor(view, minZoom = CAMERA_DEFAULTS.minZoom) {
    let floor = minZoom;
    if (view.worldWidth > 0) floor = Math.max(floor, view.width / view.worldWidth);
    if (view.worldHeight > 0) floor = Math.max(floor, view.height / view.worldHeight);
    return floor;
}

/**
 * Advance per-target unwrapped positions (continuous tracking). `tracks` is a Map id ->
 * {ux, uy, lastX, lastY, fresh}; it is updated in place and targets that are gone are dropped.
 * New targets, and targets that moved more than `reanchor` of the world in one step, are
 * anchored to their image nearest (refX, refY).
 * @returns {{id, ux, uy, fresh:boolean}[]} in the order of `targets`
 */
export function unwrapTargets(tracks, targets, refX, refY, W, H, { reanchor = 0.25, freshTime = 0, dt = 0 } = {}) {
    const seen = new Set();
    const out = [];
    targets.forEach((t, i) => {
        const id = t.id !== undefined && t.id !== null ? t.id : `#${i}`;
        seen.add(id);
        let tr = tracks.get(id);
        if (tr) {
            const dx = circDelta(t.x, tr.lastX, W);
            const dy = circDelta(t.y, tr.lastY, H);
            const jump = (W > 0 && Math.abs(dx) > reanchor * W) || (H > 0 && Math.abs(dy) > reanchor * H);
            if (jump) {
                tr = null;
            } else {
                tr.ux += dx;
                tr.uy += dy;
                tr.fresh = Math.max(0, tr.fresh - dt);
            }
        }
        if (!tr) {
            tr = { ux: unwrapNear(t.x, refX, W), uy: unwrapNear(t.y, refY, H), fresh: freshTime };
            tracks.set(id, tr);
        }
        tr.lastX = t.x;
        tr.lastY = t.y;
        out.push({ id, ux: tr.ux, uy: tr.uy, fresh: tr.fresh > 0 });
    });
    for (const id of [...tracks.keys()]) if (!seen.has(id)) tracks.delete(id);
    return out;
}

/**
 * The soft edge: centre ± (visible half-extent at the minimum zoom − margin) per axis. The
 * box is in the camera's coordinates: unwrap a world point near (cx, cy) before comparing.
 * left/top may be negative (wrap when converting back to world coordinates).
 */
export function leashBox(cx, cy, view, { margin = LEASH_DEFAULTS.margin, minZoom = CAMERA_DEFAULTS.minZoom } = {}) {
    const f = zoomFloor(view, minZoom);
    const halfW = Math.max(0, view.width / (2 * f) - margin);
    const halfH = Math.max(0, view.height / (2 * f) - margin);
    return { cx, cy, halfW, halfH, left: cx - halfW, top: cy - halfH, width: 2 * halfW, height: 2 * halfH };
}

/**
 * Hold a moving point inside `box` (unwrapped coordinates, like the box).
 * Hard: clamp onto the edge and remove the outward velocity.
 * Soft: past the edge the outward velocity is damped strongly and a spring pulls back; the
 * stretch never exceeds `overshoot` px.
 * @param {{x:number,y:number,vx?:number,vy?:number}} s
 * @returns {{x, y, vx, vy, pressing:boolean, edges:string[]}} edges: 'left' | 'right' | 'top' | 'bottom'
 */
export function applyLeash(s, box, { soft = false, dt = 1 / 60, ...opts } = {}) {
    const o = { ...LEASH_DEFAULTS, ...opts };
    const out = { x: s.x, y: s.y, vx: s.vx || 0, vy: s.vy || 0, pressing: false, edges: [] };
    const axis = (pk, vk, c, h, lowEdge, highEdge) => {
        const d = out[pk] - c;
        const over = Math.abs(d) - h;
        if (!(over > 1e-6)) return; // (rounding at the edge is not a push)
        const sign = d > 0 ? 1 : -1;
        out.pressing = true;
        out.edges.push(sign > 0 ? highEdge : lowEdge);
        const outward = out[vk] * sign; // > 0: moving further out
        if (!soft) {
            out[pk] = c + sign * h;
            if (outward > 0) out[vk] = 0;
            return;
        }
        if (outward > 0) out[vk] *= o.damping > 0 ? Math.exp(-dt / o.damping) : 0;
        out[vk] -= sign * o.spring * over * dt;
        if (over > o.overshoot) {
            out[pk] = c + sign * (h + o.overshoot);
            if (out[vk] * sign > 0) out[vk] = 0;
        }
    };
    axis('x', 'vx', box.cx, box.halfW, 'left', 'right');
    axis('y', 'vy', box.cy, box.halfH, 'top', 'bottom');
    return out;
}

/**
 * Leash a world entity ({x, y, velX, velY}, world coordinates in [0, W)) in place.
 * @returns {{pressing:boolean, edges:string[]}}
 */
export function leashEntity(entity, box, W, H, opts = {}) {
    const x = unwrapNear(entity.x, box.cx, W);
    const y = unwrapNear(entity.y, box.cy, H);
    const r = applyLeash({ x, y, vx: entity.velX, vy: entity.velY }, box, opts);
    entity.x = W > 0 ? mod(r.x, W) : r.x;
    entity.y = H > 0 ? mod(r.y, H) : r.y;
    if (entity.velX !== undefined) entity.velX = r.vx;
    if (entity.velY !== undefined) entity.velY = r.vy;
    return { pressing: r.pressing, edges: r.edges };
}

/** The world point (wrapped) of (x, y) pulled inside `box` shrunk by `inset`. */
export function clampToBox(x, y, box, W, H, inset = 0) {
    const hw = Math.max(0, box.halfW - inset), hh = Math.max(0, box.halfH - inset);
    const ux = Math.min(box.cx + hw, Math.max(box.cx - hw, unwrapNear(x, box.cx, W)));
    const uy = Math.min(box.cy + hh, Math.max(box.cy - hh, unwrapNear(y, box.cy, H)));
    return { x: W > 0 ? mod(ux, W) : ux, y: H > 0 ? mod(uy, H) : uy };
}

/**
 * cols x rows points spread evenly over `box` shrunk by `inset`, corners included, wrapped
 * into the world (respawns furthest from the opponents).
 */
export function boxSpawnGrid(box, W, H, cols = 4, rows = 4, inset = 40) {
    const w = Math.max(0, box.width - 2 * inset), h = Math.max(0, box.height - 2 * inset);
    const at = (i, n, len) => (n > 1 ? i * len / (n - 1) : len / 2);
    const pts = [];
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
        const x = box.left + inset + at(c, cols, w);
        const y = box.top + inset + at(r, rows, h);
        pts.push({ x: W > 0 ? mod(x, W) : x, y: H > 0 ? mod(y, H) : y });
    }
    return pts;
}

/** Create a camera. See the module comment for conventions. */
export function createCamera(options = {}) {
    const o = { ...CAMERA_DEFAULTS, ...options };

    const cam = {
        x: 0, y: 0, cx: 0, cy: 0, zoom: 1,
        parallaxX: 0, parallaxY: 0,
        lastShipX: null, lastShipY: null,   // single-target tracking (today's fields)
        multi: false,                       // last update used continuous tracking
        tracks: new Map(),                  // id -> unwrapped track (continuous mode)
        targetZoom: 1,
        options: o,

        /** True while the camera tracks continuously (simultaneous modes). */
        get continuous() { return this.multi; },

        _applyTopLeft(view) {
            this.x = this.cx - view.width / (2 * this.zoom);
            this.y = this.cy - view.height / (2 * this.zoom);
        },

        /**
         * @param {{x:number,y:number,id?:string}[]} targets living ships (and beacons when they fit)
         * @param {number} dt seconds
         * @param {{width:number,height:number,worldWidth:number,worldHeight:number}} view
         */
        update(targets, dt, view) {
            const n = targets ? targets.length : 0;
            if (n === 0) { // hold; whoever comes back is re-anchored
                this.tracks.clear();
                return;
            }

            if (n === 1 && o.singleInstant) {
                const t = targets[0];
                if (this.multi) {
                    // Coming from continuous tracking: no parallax jump.
                    this.lastShipX = t.x; this.lastShipY = t.y;
                    this.tracks.clear();
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
                this._applyTopLeft(view);
                return;
            }

            const W = view.worldWidth, H = view.worldHeight;
            if (!this.multi) {
                this.multi = true;
                this.cx = W > 0 ? mod(this.cx, W) : this.cx;
                this.cy = H > 0 ? mod(this.cy, H) : this.cy;
                this.tracks.clear();
                this.lastShipX = null; this.lastShipY = null;
            }

            const us = unwrapTargets(this.tracks, targets, this.cx, this.cy, W, H,
                { reanchor: o.reanchor, freshTime: o.zoomOutTime, dt });
            let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
            for (const u of us) {
                minX = Math.min(minX, u.ux); maxX = Math.max(maxX, u.ux);
                minY = Math.min(minY, u.uy); maxY = Math.max(maxY, u.uy);
            }
            const alpha = o.smoothing > 0 ? 1 - Math.exp(-dt / o.smoothing) : 1;
            const dx = ((minX + maxX) / 2 - this.cx) * alpha;
            const dy = ((minY + maxY) / 2 - this.cy) * alpha;
            this.cx += dx; this.cy += dy;
            this.parallaxX += dx; this.parallaxY += dy;

            // Zoom: fit every target around the actual (smoothed) centre, eased; and never let a
            // settled target get closer than containMargin to the edge (fresh ones, e.g. just after
            // hyperspace, are eased in instead of popping the zoom).
            let ex = 0, ey = 0, sx = 0, sy = 0;
            for (const u of us) {
                const ax = Math.abs(u.ux - this.cx), ay = Math.abs(u.uy - this.cy);
                ex = Math.max(ex, ax); ey = Math.max(ey, ay);
                if (!u.fresh) { sx = Math.max(sx, ax); sy = Math.max(sy, ay); }
            }
            const goal = requiredZoom(2 * ex, 2 * ey, view, o);
            this.targetZoom = goal;
            const tau = (goal < this.zoom ? o.zoomOutTime : o.zoomInTime) / 4;
            const k = tau > 0 ? 1 - Math.exp(-dt / tau) : 1;
            this.zoom += (goal - this.zoom) * k;
            if (Math.abs(goal - this.zoom) < 1e-4) this.zoom = goal;
            const contain = requiredZoom(2 * sx, 2 * sy, view, { margin: o.containMargin, minZoom: o.minZoom });
            if (this.zoom > contain) this.zoom = contain;

            // Keep the numbers small: shift the centre and every track by whole worlds
            const shift = (key, trackKey, size) => {
                if (!(size > 0)) return;
                const laps = Math.floor(this[key] / size);
                if (!laps) return;
                this[key] -= laps * size;
                for (const tr of this.tracks.values()) tr[trackKey] -= laps * size;
            };
            shift('cx', 'ux', W);
            shift('cy', 'uy', H);
            this._applyTopLeft(view);
        },

        /**
         * Zoom that would frame `points` ({x, y} world coordinates, taken at their images
         * nearest the current centre) around the current centre, before easing.
         */
        previewZoom(points, view) {
            let ex = 0, ey = 0;
            for (const p of points) {
                ex = Math.max(ex, Math.abs(circDelta(p.x, this.cx, view.worldWidth)));
                ey = Math.max(ey, Math.abs(circDelta(p.y, this.cy, view.worldHeight)));
            }
            return requiredZoom(2 * ex, 2 * ey, view, o);
        },

        /** The soft edge around the current centre (see leashBox). */
        leashBox(view, opts = {}) {
            return leashBox(this.cx, this.cy, view, { minZoom: o.minZoom, ...opts });
        },

        /** Snap to (cx, cy) with zoom (default 1) and clear parallax, like today's Camera.reset. */
        reset(cx, cy, view, zoom = 1) {
            this.cx = cx; this.cy = cy;
            this.zoom = zoom; this.targetZoom = zoom;
            this.parallaxX = 0; this.parallaxY = 0;
            this.lastShipX = cx; this.lastShipY = cy;
            this.multi = false;
            this.tracks.clear();
            this._applyTopLeft(view);
        },

        worldToScreen(worldX, worldY) {
            return { x: (worldX - this.x) * this.zoom, y: (worldY - this.y) * this.zoom };
        }
    };
    return cam;
}
