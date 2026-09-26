// Seeded random numbers for Time Attack courses and identical Take Turns layouts.
// Pure module: no DOM, no globals. See docs/plans/05-local-multiplayer.md §4.6 and §7.

/**
 * Mulberry32: small, fast 32-bit PRNG.
 * @param {number} seed - any number; only the low 32 bits are used
 * @returns {() => number} function returning floats in [0, 1)
 */
export function mulberry32(seed) {
    let a = seed >>> 0;
    return function next() {
        a = (a + 0x6D2B79F5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

/**
 * FNV-1a 32-bit hash of a string (with a final avalanche), for turning names
 * such as "course:3:medium" into seeds.
 * @param {string} str
 * @returns {number} unsigned 32-bit integer
 */
export function hashSeed(str) {
    const s = String(str);
    let h = 0x811C9DC5;
    for (let i = 0; i < s.length; i++) {
        h ^= s.charCodeAt(i);
        h = Math.imul(h, 0x01000193);
    }
    return fmix32(h);
}

/**
 * Seed for one level of a run, stable for the same (runSeed, level).
 * @param {number} runSeed
 * @param {number} level
 * @returns {number} unsigned 32-bit integer
 */
export function levelSeed(runSeed, level) {
    const mixed = ((runSeed >>> 0) ^ Math.imul((level | 0) + 1, 0x9E3779B1)) >>> 0;
    return fmix32(mixed);
}

/**
 * Convenience: the run seed for a Time Attack course at a difficulty.
 * @param {number} course - 1..10
 * @param {string} difficulty
 */
export function courseSeed(course, difficulty) {
    return hashSeed(`course:${course}:${String(difficulty).toLowerCase()}`);
}

/** Random float in [min, max) from a generator returned by mulberry32. */
export function rngRange(rand, min, max) {
    return min + rand() * (max - min);
}

/** Random integer in [min, max] (inclusive) from a generator. */
export function rngInt(rand, min, max) {
    return min + Math.floor(rand() * (max - min + 1));
}

// MurmurHash3 finaliser
function fmix32(h) {
    h ^= h >>> 16;
    h = Math.imul(h, 0x85EBCA6B);
    h ^= h >>> 13;
    h = Math.imul(h, 0xC2B2AE35);
    h ^= h >>> 16;
    return h >>> 0;
}
