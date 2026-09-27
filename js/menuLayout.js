// Layout maths for the canvas menu screens. Pure: no DOM, no globals.
//
// The canvas is a square of 90% of the smaller window side, so on a phone (390 x 844) the
// whole game is about 351 x 351 logical pixels. Menu screens must fit their rows, and above
// all their Back / exit row, into that height: a touch player has no Escape key.

/** Smallest height (logical px) of an exit / Back tap region. */
export const MIN_EXIT_TAP = 34;

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
