// World size from the view size (pure: no DOM, no globals).
//
// The world wraps around and the camera follows the ship, so the world must be larger than the
// view on both axes. Rule (2026-09, adaptive screens):
//
//   1. 1.5 views per axis (WORLD_SCREENS), as with the old square canvas: a square view gives
//      exactly the old world, so desktop-square and saved Time Attack ghosts are unchanged.
//   2. Each side at least MIN_WORLD_SIDE, so spawn clearances and big rocks fit on tiny views.
//   3. The world's long side is at most MAX_WORLD_ASPECT (16:9) times its short side: a tall
//      phone (412 x 892 view) would otherwise get a skinny 618 x 1338 world where a ship is
//      never more than a few hundred px from a rock sideways. The short axis grows (never
//      shrinks) until the ratio holds: 753 x 1338 for that phone. 4:3, 16:10 and 16:9 screens
//      are not affected.
//
// Asteroid count: at 1.5 views per axis the view always shows the same share of the world
// (1 / 2.25), so a level's asteroid count gives the same number of rocks on screen at any size.
// Where rule 2 or 3 made the world bigger than 1.5 views, the count is scaled by the extra area
// (asteroidScale = world area / (2.25 x view area)) so the on-screen share stays the same:
// 1.22x on that phone (12 rocks instead of 10 at level 1), 1 on 4:3, 16:10 and 16:9 screens.
// It is capped at MAX_ASTEROID_SCALE for extreme (32:9) screens.

export const WORLD_SCREENS = 1.5;
export const MAX_WORLD_ASPECT = 16 / 9;
export const MIN_WORLD_SIDE = 480;
export const MAX_ASTEROID_SCALE = 2;

/**
 * @param {number} viewW logical view width
 * @param {number} viewH logical view height
 * @returns {{width:number, height:number, asteroidScale:number}}
 */
export function computeWorldSize(viewW, viewH) {
    const vw = Math.max(1, Number.isFinite(viewW) ? viewW : 1);
    const vh = Math.max(1, Number.isFinite(viewH) ? viewH : 1);
    let width = Math.max(MIN_WORLD_SIDE, vw * WORLD_SCREENS);
    let height = Math.max(MIN_WORLD_SIDE, vh * WORLD_SCREENS);
    if (width > height * MAX_WORLD_ASPECT) height = width / MAX_WORLD_ASPECT;
    else if (height > width * MAX_WORLD_ASPECT) width = height / MAX_WORLD_ASPECT;
    const share = (width * height) / (WORLD_SCREENS * WORLD_SCREENS * vw * vh);
    const asteroidScale = Math.min(MAX_ASTEROID_SCALE, Math.max(1, share));
    return { width, height, asteroidScale };
}

/** A level's asteroid count for a world (at least the base count; 0 stays 0). */
export function scaledAsteroidCount(count, asteroidScale = 1) {
    const n = Math.max(0, Math.floor(Number(count) || 0));
    const s = Number.isFinite(asteroidScale) ? Math.max(1, asteroidScale) : 1;
    return Math.round(n * s);
}
