// Layout maths for the canvas menu screens. Pure: no DOM, no globals.
//
// The canvas fills the screen at any aspect ratio (js/viewport.js): 412 x 892 on a portrait
// phone, 892 x 412 in landscape, 1280 x 800 on a laptop, 3440 x 1440 on an ultra-wide monitor.
// Menu screens are drawn in a centred content column (menuColumn) that uses the full height;
// they must fit their rows, and above all their Back / exit row, into it: a touch player has
// no Escape key. Tap targets are at least MIN_TAP (44 px, the usual touch guideline).

/** Smallest height (logical px) of a tap target, exit / Back rows included. */
export const MIN_TAP = 44;
/** Smallest height (logical px) of an exit / Back tap region. */
export const MIN_EXIT_TAP = MIN_TAP;
/** The menu column is at least this wide (when the view is) and at most the view height. */
export const MENU_COLUMN_MIN = 640;

/**
 * The content column menus are drawn in: centred, the full height (less any DOM overlays such
 * as the app bar or an update notice that cover it, `insets`), roughly the old square (as wide
 * as the view is tall) but at least MENU_COLUMN_MIN wide when the view allows. A portrait phone
 * uses its whole width; a laptop gets an 800 px column in the middle of 1280.
 * @param {{top?:number, bottom?:number}} [insets] view px kept free above / below
 * @returns {{x:number, y:number, w:number, h:number}}
 */
export function menuColumn(viewW, viewH, insets = {}) {
    const w = Math.min(viewW, Math.max(MENU_COLUMN_MIN, viewH));
    const top = Math.max(0, insets.top || 0);
    const bottom = Math.max(0, insets.bottom || 0);
    // Never give up more than a quarter of the height to overlays
    const cut = Math.min(top + bottom, viewH * 0.25);
    const k = top + bottom > 0 ? cut / (top + bottom) : 0;
    return { x: (viewW - w) / 2, y: top * k, w, h: viewH - cut };
}

/**
 * View px that DOM overlays (app bar, update toast, install hint) cover at the top and bottom
 * of the menu column, so menu rows are never drawn under them (they would swallow the taps).
 * All rectangles in page px ({left, top, right, bottom}); `canvas` is the canvas element's
 * box and `column` the column in view px. Overlays that do not overlap the column
 * horizontally, or are empty (hidden), are ignored. An overlay whose centre is in the upper
 * half pushes the top down; one in the lower half pushes the bottom up.
 * @param {number} [scale=1] view px per page px (1 unless the canvas is CSS-scaled)
 * @returns {{top:number, bottom:number}}
 */
export function overlayInsets(canvas, column, overlays, scale = 1, gap = 4) {
    let top = 0;
    let bottom = 0;
    if (!canvas) return { top, bottom };
    const colLeft = canvas.left + column.x / scale;
    const colRight = colLeft + column.w / scale;
    const midY = (canvas.top + canvas.bottom) / 2;
    for (const o of overlays || []) {
        if (!o || !(o.right > o.left) || !(o.bottom > o.top)) continue;
        if (o.right <= colLeft || o.left >= colRight) continue;
        if (o.bottom <= canvas.top || o.top >= canvas.bottom) continue;
        if ((o.top + o.bottom) / 2 < midY) top = Math.max(top, (o.bottom - canvas.top) * scale + gap);
        else bottom = Math.max(bottom, (canvas.bottom - o.top) * scale + gap);
    }
    return { top, bottom };
}

/**
 * Font size (px) that fits text measured at `px` wide `measured` into `maxWidth`: unchanged if
 * it fits, else shrunk in proportion, never below `minPx` (fillText's maxWidth then squeezes it).
 */
export function fitFontPx(px, measured, maxWidth, minPx = 10) {
    if (!(measured > maxWidth) || !(maxWidth > 0)) return px;
    return Math.max(minPx, Math.floor((px * maxWidth) / measured));
}

/**
 * Lay out `count` menu rows between `top` and `bottom` in a column `width` wide: one column
 * at a pitch between minPitch and maxPitch when they fit; otherwise two (or up to maxCols)
 * side by side columns, filled top to bottom; if even those do not fit, the pitch shrinks.
 * @returns {{cols:number, perCol:number, pitch:number, colW:number, fits:boolean,
 *            cells:Array<{x:number, y:number, w:number, h:number}>}} x relative to the column
 */
export function menuGrid({ count, top, bottom, width, minPitch = MIN_TAP, maxPitch = 52, maxCols = 2, minColW = 150 }) {
    const n = Math.max(0, Math.floor(count || 0));
    const avail = Math.max(0, bottom - top);
    let cols = 1;
    while (cols < maxCols && Math.ceil(n / cols) * minPitch > avail && width / (cols + 1) >= minColW) cols++;
    const perCol = Math.max(1, Math.ceil(n / cols));
    const pitch = n === 0 ? 0 : Math.min(maxPitch, avail / perCol);
    const colW = width / cols;
    const cells = [];
    for (let i = 0; i < n; i++) {
        const c = Math.floor(i / perCol);
        const r = i % perCol;
        cells.push({ x: c * colW, y: top + r * pitch, w: colW, h: pitch });
    }
    return { cols, perCol, pitch, colW, fits: pitch >= minPitch - 1e-9, cells };
}

/**
 * Gap (px) left between stacked rows of pitch `pitch`: `maxGap` normally, shrunk (down to
 * `minGap`) when the pitch is tight so the row itself (pitch - gap) stays `minH` tall.
 */
export function rowGap(pitch, minH = MIN_TAP, maxGap = 5, minGap = 2) {
    return Math.min(maxGap, Math.max(minGap, pitch - minH));
}

/** Screens shorter than this use the compact title and tighter spacing. */
export const COMPACT_HEIGHT = 480;

export function isCompact(viewHeight) {
    return viewHeight < COMPACT_HEIGHT;
}

/**
 * Screen title placement (drawScreenTitle): baseline, fonts, and where content starts.
 * @returns {{titleY:number, titleFont:string, subtitleY:number, subtitleFont:string, contentTop:number}}
 */
export function screenTitleLayout(viewHeight, hasSubtitle = false) {
    if (isCompact(viewHeight)) {
        const titleY = Math.round(viewHeight * 0.1);
        return {
            titleY, titleFont: '28px Arial', subtitleY: titleY + 20, subtitleFont: '14px Arial',
            contentTop: titleY + (hasSubtitle ? 34 : 22),
        };
    }
    const titleY = viewHeight * 0.12;
    return {
        titleY, titleFont: '36px Arial', subtitleY: titleY + 28, subtitleFont: '16px Arial',
        contentTop: titleY + (hasSubtitle ? 50 : 30),
    };
}

/**
 * Stack `count` rows between `top` and `bottom`, the last row being Back (or another exit).
 * Rows keep their preferred pitch `maxStep` when they fit; otherwise the pitch shrinks evenly
 * so that everything, the last row included, stays inside [top, bottom]. The last row is
 * clamped to [lastMin, lastMax] (e.g. a smaller Back box under large mode boxes, or a Back
 * row that must stay tall enough to tap) and the other rows share what is left.
 *
 * @param {{count:number, top:number, bottom:number, maxStep:number, lastMin?:number, lastMax?:number}} o
 * @returns {{step:number, rows:Array<{y:number, h:number}>, fits:boolean}}
 *   step: pitch of the non-last rows; rows[i].y is the top of row i and rows[i].h its pitch
 *   (callers subtract their own gap); fits: every row got its preferred size.
 */
export function stackRows({ count, top, bottom, maxStep, lastMin = 0, lastMax = Infinity }) {
    const n = Math.max(0, Math.floor(count || 0));
    if (n === 0) return { step: 0, rows: [], fits: true };
    const avail = Math.max(0, bottom - top);
    const wantLast = Math.min(lastMax, Math.max(lastMin, maxStep));
    let lastH;
    let step;
    if (n === 1) {
        lastH = Math.min(wantLast, avail);
        step = lastH;
    } else {
        const uniform = avail / n;
        // The last row: its preferred size if the rest can still get theirs, else squeeze
        lastH = Math.min(wantLast, Math.max(lastMin, Math.min(uniform, lastMax)), avail);
        if ((n - 1) * maxStep + wantLast <= avail) lastH = wantLast;
        step = Math.min(maxStep, Math.max(0, (avail - lastH) / (n - 1)));
    }
    const rows = [];
    for (let i = 0; i < n - 1; i++) rows.push({ y: top + i * step, h: step });
    rows.push({ y: top + (n - 1) * step, h: lastH });
    const fits = step >= maxStep - 1e-9 && lastH >= wantLast - 1e-9;
    return { step, rows, fits };
}

/**
 * Is a tap region usable as an exit: inside the view and at least `minH` tall?
 * @param {{x:number, y:number, w:number, h:number}} r
 */
export function exitRegionOk(r, viewWidth, viewHeight, minH = 30) {
    if (!r) return false;
    const eps = 0.5;
    return r.x >= -eps && r.y >= -eps && r.x + r.w <= viewWidth + eps && r.y + r.h <= viewHeight + eps
        && r.h >= minH && r.w >= minH;
}
