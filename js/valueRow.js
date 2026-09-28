// "◂ value ▸" rows (Settings, main-menu Difficulty, lobby options, Time Attack setup).
// Pure layout and hit-testing: no DOM, no globals.
//
// A value row has two arrow targets at its ends: ◂ steps the value back, ▸ steps it
// forward. The rest of the row (label and value in the middle) steps forward too, like
// Enter. Drawing and tapping use the same numbers, so the glyph is always over its target.

/** Smallest width (logical px) of an arrow target: a fingertip. */
export const MIN_ARROW_W = 44;
/** Arrow target width as a share of the row on wide rows. */
export const ARROW_FRACTION = 0.18;

/**
 * Where the ◂ / ▸ targets and the middle (label + value) of a row sit.
 * Arrows are max(MIN_ARROW_W, ARROW_FRACTION * w) wide, but never more than a third of the
 * row each, so a very narrow row still has a middle.
 * @returns {{arrowW:number, left:{x:number,w:number,cx:number}, right:{x:number,w:number,cx:number},
 *   inner:{x:number,w:number}}}
 */
export function valueRowArrows(x, w) {
    const width = Math.max(0, w);
    const arrowW = Math.min(width / 3, Math.max(MIN_ARROW_W, width * ARROW_FRACTION));
    return {
        arrowW,
        left: { x, w: arrowW, cx: x + arrowW / 2 },
        right: { x: x + width - arrowW, w: arrowW, cx: x + width - arrowW / 2 },
        inner: { x: x + arrowW, w: width - 2 * arrowW },
    };
}

/** Which part of a value row a tap at `tapX` hit: 'left' (◂), 'right' (▸) or 'centre'. */
export function valueRowHit(tapX, x, w) {
    const a = valueRowArrows(x, w);
    if (tapX < a.inner.x) return 'left';
    if (tapX >= a.right.x) return 'right';
    return 'centre';
}

/** Step for a tap at `tapX`: -1 on ◂, +1 on ▸ and on the middle of the row. */
export function valueRowStep(tapX, x, w) {
    return valueRowHit(tapX, x, w) === 'left' ? -1 : 1;
}
