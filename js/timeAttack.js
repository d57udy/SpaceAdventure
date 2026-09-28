// Time Attack vs Ghost helpers (plan 05 §4.6, §6, MP-6).
// Pure module: no DOM, no globals. main.js owns the run, the recorder and the drawing.
//
// Stored ghost record (local storage, key from ghostStorageKey in js/ghost.js):
//   { v, viewSize, worldWidth, worldHeight, durationMs, score, data,   // from encodeGhost
//     owner, course, difficulty, date }                                // added here
import { mulberry32, levelSeed, courseSeed, hashSeed } from './rng.js';
import { GHOST_VERSION } from './ghost.js';

export const TIME_ATTACK = Object.freeze({
    runSeconds: 180,
    courseMin: 1,
    courseMax: 10,
    viewSizeTolerance: 0.1, // a ghost from a screen more than 10% bigger or smaller gets a notice
});

// Owner: a player name (js/names.js: letters of any script and digits, upper case)
const GHOST_KEY_RE = /^spaceAdventure_ghost_v1_([\p{L}\p{M}\p{N}]+)_(\d+)_([a-z]+)$/u;

/** Course number clamped to 1..10 (bad input gives 1). */
export function clampCourse(n) {
    const c = Math.round(Number(n));
    if (!Number.isFinite(c)) return TIME_ATTACK.courseMin;
    return Math.max(TIME_ATTACK.courseMin, Math.min(TIME_ATTACK.courseMax, c));
}

/** Next/previous course, wrapping 10 → 1 and 1 → 10. */
export function stepCourse(course, dir) {
    const span = TIME_ATTACK.courseMax - TIME_ATTACK.courseMin + 1;
    const i = clampCourse(course) - TIME_ATTACK.courseMin + (dir < 0 ? -1 : 1);
    return TIME_ATTACK.courseMin + ((i % span) + span) % span;
}

/**
 * Seeded randomness for one run: a stable `rand` function whose stream is replaced per level
 * (levelSeed(courseSeed(course, difficulty), level)), so every level of a course starts the
 * same way however the previous level went.
 */
export function createSeededWorld(course, difficulty) {
    const seed = courseSeed(clampCourse(course), difficulty);
    let stream = mulberry32(levelSeed(seed, 1));
    const world = {
        seed,
        level: 1,
        rand: () => stream(),
        reseed(level) {
            world.level = level;
            stream = mulberry32(levelSeed(seed, level));
        },
    };
    return world;
}

/** Parse a ghost storage key into { owner, course, difficulty } (null for other keys). */
export function parseGhostKey(key) {
    const m = GHOST_KEY_RE.exec(typeof key === 'string' ? key : '');
    return m ? { owner: m[1], course: Number(m[2]), difficulty: m[3] } : null;
}

/** Keys of every profile's ghost for a course and difficulty. */
export function ghostKeysForCourse(keys, course, difficulty) {
    const c = clampCourse(course);
    const d = String(difficulty).toLowerCase();
    return (Array.isArray(keys) ? keys : []).filter((k) => {
        const p = parseGhostKey(k);
        return !!p && p.course === c && p.difficulty === d;
    });
}

/**
 * Loose check of a stored record (decodeGhost does the real validation). Optional fields
 * must have the right type when present: localStorage can hold anything.
 */
export function isGhostRecord(v) {
    if (!v || typeof v !== 'object' || Array.isArray(v)) return false;
    const optional = (x, type) => x === undefined || x === null || typeof x === type;
    return v.v === GHOST_VERSION && typeof v.data === 'string' && Number.isFinite(v.score) && v.score >= 0 &&
        optional(v.owner, 'string') && optional(v.difficulty, 'string') &&
        (v.date === undefined || v.date === null || Number.isFinite(v.date)) &&
        (v.course === undefined || v.course === null || Number.isFinite(v.course));
}

/** The encoded ghost plus who flew it, on which course, and when. */
export function makeGhostRecord(encoded, { owner, course, difficulty, date = Date.now() }) {
    return {
        ...encoded,
        owner: String(owner).toUpperCase(),
        course: clampCourse(course),
        difficulty: String(difficulty).toLowerCase(),
        date,
    };
}

/** A run replaces the stored best only with a strictly higher score. */
export function isBetterRun(score, existing) {
    if (!isGhostRecord(existing)) return true;
    return (Math.floor(score) || 0) > existing.score;
}

/**
 * The ghost to race: the best stored run on this device for the course, any profile.
 * @param {{key:string, record:any}[]} entries - stored records (invalid ones are skipped)
 * @returns {null | {key, owner, record}} highest score; ties go to the earlier run
 */
export function pickBestGhost(entries) {
    let best = null;
    for (const e of Array.isArray(entries) ? entries : []) {
        if (!e || !isGhostRecord(e.record)) continue;
        const parsed = parseGhostKey(e.key);
        const owner = String(e.record.owner || (parsed && parsed.owner) || '').toUpperCase();
        if (!best || e.record.score > best.record.score ||
            (e.record.score === best.record.score && (e.record.date || 0) < (best.record.date || 0))) {
            best = { key: e.key, owner, record: e.record };
        }
    }
    return best;
}

/** True when the recording's screen size differs from ours by more than the tolerance. */
export function viewSizeDiffers(recorded, current, tolerance = TIME_ATTACK.viewSizeTolerance) {
    if (!(recorded > 0) || !(current > 0)) return false;
    return Math.abs(recorded - current) / recorded > tolerance;
}

/** Your score minus the ghost's at the same moment (positive = ahead). */
export function paceDelta(score, ghostScore) {
    return (Math.floor(score) || 0) - (Math.floor(ghostScore) || 0);
}

/** "Ghost +140" (ahead), "Ghost -80" (behind), "Ghost ±0". */
export function formatPace(delta) {
    if (delta > 0) return `Ghost +${delta}`;
    if (delta < 0) return `Ghost -${Math.abs(delta)}`;
    return 'Ghost ±0';
}

/** "2:05" from seconds (rounded up, never negative). */
export function formatClock(seconds) {
    const s = Math.max(0, Math.ceil(Number(seconds) || 0));
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** A stable colour for a profile from a list (the ghost owner's colour). */
export function ownerColour(owner, colours) {
    if (!Array.isArray(colours) || colours.length === 0) return '#FFFFFF';
    return colours[hashSeed(String(owner).toUpperCase()) % colours.length];
}

/**
 * Result summary for the Results screen.
 * @param {{score:number, ghost: null | {owner:string, score:number}, newBest:boolean, previousBest:number|null}} o
 * @returns {{banner:string, lines:string[], delta:number|null}}
 */
export function summarizeRun({ score, ghost, newBest, previousBest = null }) {
    const lines = [];
    let delta = null;
    if (ghost) {
        delta = paceDelta(score, ghost.score);
        const verdict = delta > 0 ? `beat by ${delta}` : delta < 0 ? `short by ${-delta}` : 'tied';
        lines.push(`Ghost (${ghost.owner}): ${ghost.score} · you ${score} · ${verdict}`);
    } else {
        lines.push('No ghost yet on this course');
    }
    if (newBest) lines.push(previousBest === null ? 'Your first run here is saved as your ghost' : `New personal best (was ${previousBest})`);
    const banner = newBest ? 'NEW BEST!' : (delta !== null && delta > 0 ? 'GHOST BEATEN!' : 'TIME ATTACK OVER');
    return { banner, lines, delta };
}
