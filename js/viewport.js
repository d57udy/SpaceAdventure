// Canvas sizing for sharp rendering on HiDPI (retina) screens.
// The canvas is a square of 90% of the smaller window side in CSS (logical) pixels;
// its backing store is that size times the device pixel ratio, capped at maxScale.
export const MAX_RENDER_SCALE = 2;

export function computeCanvasSize(innerW, innerH, dpr, maxScale = MAX_RENDER_SCALE) {
    const css = Math.floor(Math.min(innerW, innerH) * 0.9);
    const scale = Math.min(Math.max(dpr || 1, 1), Math.max(maxScale || 1, 1));
    const backing = Math.round(css * scale);
    // Exact ratio of backing to CSS pixels avoids sub-pixel drift between the two
    return { css, scale: css > 0 ? backing / css : scale, backing };
}
