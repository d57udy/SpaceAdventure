/**
 * Wraps the position of an entity around the screen edges.
 * @param {object} entity - The entity object (must have x, y properties).
 * @param {number} canvasWidth - The width of the canvas.
 * @param {number} canvasHeight - The height of the canvas.
 */
export function wrapAroundEdges(entity, canvasWidth, canvasHeight) {
    if (entity.x < 0) {
        entity.x = canvasWidth;
    }
    if (entity.x > canvasWidth) {
        entity.x = 0;
    }
    if (entity.y < 0) {
        entity.y = canvasHeight;
    }
    if (entity.y > canvasHeight) {
        entity.y = 0;
    }
}

/**
 * Converts degrees to radians.
 * @param {number} degrees
 * @returns {number} radians
 */
export function degToRad(degrees) {
    return degrees * (Math.PI / 180);
}

/**
 * Generates a random number within a range.
 * @param {number} min
 * @param {number} max
 * @param {(() => number)|null} [rng] - optional seeded generator (js/rng.js); Math.random when omitted
 * @returns {number}
 */
export function randomRange(min, max, rng = null) {
    return (rng || Math.random)() * (max - min) + min;
}

/**
 * Returns the shortest signed delta along one axis of a wrapping world.
 * If size is not a positive number, the delta is returned unchanged.
 * @param {number} delta
 * @param {number} size - World size along this axis (0 = no wrapping).
 * @returns {number}
 */
export function wrapDelta(delta, size) {
    if (!(size > 0)) return delta;
    if (delta > size / 2) return delta - size;
    if (delta < -size / 2) return delta + size;
    return delta;
}

/**
 * True when (x, y) is closer than `radius` to any of `points`, measuring the shortest way
 * across a W x H wrapping world (a point just across the world edge counts as close).
 * @param {{x:number,y:number}[]} points
 */
export function isNearAny(x, y, points, radius, W, H) {
    return points.some(p => Math.hypot(wrapDelta(x - p.x, W), wrapDelta(y - p.y, H)) < radius);
}
