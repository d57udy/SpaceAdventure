// Canvas sizing for sharp rendering on HiDPI (retina) screens, and the in-game HUD corners.
// Pure: no DOM, no globals.
//
// The canvas fills the space it is given: the safe-area viewport (inside the notch and the
// rounded corners) minus any bars reserved around it (local multiplayer on a touch tablet keeps
// its controls and HUD panels in side bars, or in bars above and below in the facing layout;
// js/mpView.js mpReserve). Any aspect ratio: a portrait phone, a landscape tablet, an
// ultra-wide monitor. Width and height are logical (CSS) pixels; the backing store is each axis
// times the device pixel ratio, capped at maxScale.
export const MAX_RENDER_SCALE = 2;

/**
 * @param {number} availW width of the safe-area viewport (CSS px)
 * @param {number} availH height of the safe-area viewport (CSS px)
 * @param {number} dpr window.devicePixelRatio
 * @param {number} [maxScale] backing-store cap (lowered by the adaptive fallback)
 * @param {{left?:number, right?:number, top?:number, bottom?:number}} [reserve] bars kept free
 * @returns {{width:number, height:number, scale:number, scaleX:number, scaleY:number,
 *            backingWidth:number, backingHeight:number}}
 *   width/height: logical size; scaleX/scaleY: exact backing / CSS ratio per axis (no sub-pixel
 *   drift between the two); scale: the capped device pixel ratio actually used (= scaleX up to
 *   rounding).
 */
export function computeCanvasSize(availW, availH, dpr, maxScale = MAX_RENDER_SCALE, reserve = {}) {
    const r = reserve || {};
    const w = Math.max(0, Math.floor(num(availW) - num(r.left) - num(r.right)));
    const h = Math.max(0, Math.floor(num(availH) - num(r.top) - num(r.bottom)));
    const cap = Math.min(Math.max(dpr || 1, 1), Math.max(maxScale || 1, 1));
    const backingWidth = Math.round(w * cap);
    const backingHeight = Math.round(h * cap);
    const scaleX = w > 0 ? backingWidth / w : cap;
    const scaleY = h > 0 ? backingHeight / h : cap;
    return { width: w, height: h, scale: scaleX, scaleX, scaleY, backingWidth, backingHeight };
}

function num(v) {
    return Number.isFinite(v) ? v : 0;
}

/** Radar size (logical px): 20% of the shorter view side, between 70 and 120. */
export function radarSize(viewW, viewH) {
    return Math.round(Math.max(70, Math.min(120, Math.min(viewW, viewH) * 0.2)));
}

/**
 * Where the in-game canvas HUD goes: the radar and the status lines ("Asteroids: n",
 * "Difficulty: ..."). Keyboard / controller: radar bottom right, status bottom left (as always).
 * Touch controls showing: they overlay the canvas corners (steer bottom left, fire cluster
 * bottom right), so the radar moves to the bottom centre and the status lines sit above it.
 * @returns {{radar:{x:number, y:number, size:number},
 *            asteroids:{x:number, y:number, align:string}, dda:{x:number, y:number, align:string}}}
 *   radar x/y: top-left corner of its square.
 */
export function playHudLayout(viewW, viewH, { touch = false } = {}) {
    const size = radarSize(viewW, viewH);
    if (!touch) {
        return {
            radar: { x: viewW - size - 15, y: viewH - size - 15, size },
            asteroids: { x: 10, y: viewH - 10, align: 'left' },
            dda: { x: 130, y: viewH - 10, align: 'left' },
        };
    }
    const x = Math.round((viewW - size) / 2);
    const y = viewH - size - 12;
    return {
        radar: { x, y, size },
        asteroids: { x: viewW / 2, y: y - 8, align: 'center' },
        dda: { x: viewW / 2, y: y - 24, align: 'center' },
    };
}
