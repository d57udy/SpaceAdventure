// Ghost recording and playback for Time Attack vs Ghost.
// Pure module: no DOM, no globals. See docs/plans/05-local-multiplayer.md §4.6 and §6.
//
// Binary layout (little endian), then base64:
//   header (8 bytes): magic 'G','H' | format version u8 | reserved u8 |
//                     sampleCount u16 | scoreCount u16
//   samples (6 bytes each): x u16 | y u16 | rotation u8 | flags u8 (bit0 thrust, bit1 alive)
//   scores (4 bytes each): score u32, one per second of game time
// x and y are fractions of the world size (0..65535), so a ghost recorded on
// another screen size still plays back in the right place relatively.

export const GHOST_VERSION = 1;
export const SAMPLE_INTERVAL_MS = 100;
export const SCORE_INTERVAL_MS = 1000;

const HEADER_BYTES = 8;
const SAMPLE_BYTES = 6;
const SCORE_BYTES = 4;
const MAX_COUNT = 0xFFFF;
const FLAG_THRUST = 1;
const FLAG_ALIVE = 2;
const TWO_PI = Math.PI * 2;
// A jump longer than this (fraction of the world, after wrapping) is a
// hyperspace or respawn: snap instead of interpolating.
const SNAP_FRACTION = 0.25;

// ---------- base64 (browser btoa/atob, Buffer fallback in node) ----------

export function bytesToBase64(bytes) {
    if (typeof globalThis.btoa === 'function') {
        let bin = '';
        const CHUNK = 0x8000;
        for (let i = 0; i < bytes.length; i += CHUNK) {
            bin += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
        }
        return globalThis.btoa(bin);
    }
    return globalThis.Buffer.from(bytes).toString('base64');
}

export function base64ToBytes(str) {
    if (typeof str !== 'string' || !/^[A-Za-z0-9+/]*={0,2}$/.test(str) || str.length % 4 !== 0) {
        throw new Error('invalid base64');
    }
    if (typeof globalThis.atob === 'function') {
        const bin = globalThis.atob(str);
        const out = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
        return out;
    }
    return new Uint8Array(globalThis.Buffer.from(str, 'base64'));
}

// ---------- quantisation helpers ----------

function toFrac16(value, size) {
    if (!(size > 0) || !Number.isFinite(value)) return 0;
    let f = (value / size) % 1;
    if (f < 0) f += 1;
    return Math.round(f * 65536) & 0xFFFF;
}

function toRot8(rad) {
    if (!Number.isFinite(rad)) return 0;
    let r = rad % TWO_PI;
    if (r < 0) r += TWO_PI;
    return Math.round((r / TWO_PI) * 256) & 0xFF;
}

function wrapFracDelta(d) {
    if (d > 0.5) return d - 1;
    if (d < -0.5) return d + 1;
    return d;
}

function wrap01(f) {
    f %= 1;
    return f < 0 ? f + 1 : f;
}

// ---------- recorder ----------

/**
 * Records a ship every 100 ms of accumulated game time, and the score every second.
 *   const rec = new GhostRecorder({ worldWidth, worldHeight, viewSize });
 *   rec.update(dtMs, { x, y, rotation, thrusting, alive }, score);   // each frame
 *   const ghost = rec.encode();   // { v, viewSize, worldWidth, worldHeight, durationMs, score, data }
 */
export class GhostRecorder {
    constructor({ worldWidth, worldHeight, viewSize = 0 } = {}) {
        this.worldWidth = worldWidth;
        this.worldHeight = worldHeight;
        this.viewSize = viewSize;
        this.reset();
    }

    reset() {
        this.elapsedMs = 0;
        this.nextSampleMs = 0;
        this.nextScoreMs = 0;
        this.samples = []; // [x16, y16, rot8, flags] flattened
        this.scores = [];
        this.score = 0;
    }

    get sampleCount() { return this.samples.length / 4; }

    /**
     * Advance game time and record samples that fall due.
     * @param {number} dtMs - game time since the last call (paused time excluded by the caller)
     * @param {{x:number,y:number,rotation:number,thrusting?:boolean,alive?:boolean}|null} ship
     * @param {number} score - current score
     */
    update(dtMs, ship, score = 0) {
        if (!(dtMs >= 0)) dtMs = 0;
        this.score = Math.max(0, Math.floor(score) || 0);
        // Sample at t = 0, 100, 200, ... as game time reaches them
        while (this.nextSampleMs <= this.elapsedMs + dtMs && this.sampleCount < MAX_COUNT) {
            this.pushSample(ship);
            this.nextSampleMs += SAMPLE_INTERVAL_MS;
        }
        while (this.nextScoreMs <= this.elapsedMs + dtMs && this.scores.length < MAX_COUNT) {
            this.scores.push(this.score);
            this.nextScoreMs += SCORE_INTERVAL_MS;
        }
        this.elapsedMs += dtMs;
    }

    pushSample(ship) {
        const alive = !!ship && ship.alive !== false;
        if (!ship) {
            // No ship (between lives): repeat the last position, marked dead
            const n = this.samples.length;
            if (n >= 4) this.samples.push(this.samples[n - 4], this.samples[n - 3], this.samples[n - 2], 0);
            else this.samples.push(0, 0, 0, 0);
            return;
        }
        const flags = (ship.thrusting ? FLAG_THRUST : 0) | (alive ? FLAG_ALIVE : 0);
        this.samples.push(
            toFrac16(ship.x, this.worldWidth),
            toFrac16(ship.y, this.worldHeight),
            toRot8(ship.rotation),
            flags,
        );
    }

    /** Duration covered by the recorded samples, in ms. */
    get durationMs() {
        return Math.max(0, (this.sampleCount - 1) * SAMPLE_INTERVAL_MS);
    }

    encode() {
        return encodeGhost({
            samples: this.samples,
            scores: this.scores,
            viewSize: this.viewSize,
            worldWidth: this.worldWidth,
            worldHeight: this.worldHeight,
            durationMs: this.durationMs,
            score: this.score,
        });
    }
}

/**
 * Pack raw samples into the stored form.
 * @returns {{v:number, viewSize:number, worldWidth:number, worldHeight:number, durationMs:number, score:number, data:string}}
 */
export function encodeGhost({ samples, scores = [], viewSize = 0, worldWidth = 0, worldHeight = 0, durationMs, score = 0 }) {
    const sampleCount = Math.min(MAX_COUNT, Math.floor(samples.length / 4));
    const scoreCount = Math.min(MAX_COUNT, scores.length);
    const buf = new Uint8Array(HEADER_BYTES + sampleCount * SAMPLE_BYTES + scoreCount * SCORE_BYTES);
    const dv = new DataView(buf.buffer);
    buf[0] = 0x47; // 'G'
    buf[1] = 0x48; // 'H'
    buf[2] = GHOST_VERSION;
    buf[3] = 0;
    dv.setUint16(4, sampleCount, true);
    dv.setUint16(6, scoreCount, true);
    let o = HEADER_BYTES;
    for (let i = 0; i < sampleCount; i++) {
        dv.setUint16(o, samples[i * 4] & 0xFFFF, true);
        dv.setUint16(o + 2, samples[i * 4 + 1] & 0xFFFF, true);
        buf[o + 4] = samples[i * 4 + 2] & 0xFF;
        buf[o + 5] = samples[i * 4 + 3] & 0xFF;
        o += SAMPLE_BYTES;
    }
    for (let i = 0; i < scoreCount; i++) {
        dv.setUint32(o, Math.max(0, Math.min(0xFFFFFFFF, Math.floor(scores[i]) || 0)), true);
        o += SCORE_BYTES;
    }
    return {
        v: GHOST_VERSION,
        viewSize,
        worldWidth,
        worldHeight,
        durationMs: durationMs ?? Math.max(0, (sampleCount - 1) * SAMPLE_INTERVAL_MS),
        score: Math.max(0, Math.floor(score) || 0),
        data: bytesToBase64(buf),
    };
}

/**
 * Unpack a stored ghost (object or its JSON string). Returns null for anything corrupt.
 * @returns {null | {v, viewSize, worldWidth, worldHeight, durationMs, score,
 *                   sampleCount, xs: Float64Array, ys: Float64Array, rots: Float64Array,
 *                   thrust: Uint8Array, alive: Uint8Array, scores: Uint32Array}}
 *   xs/ys are fractions of the world in [0, 1); rots are radians in [0, 2π).
 */
export function decodeGhost(input) {
    try {
        const g = typeof input === 'string' ? JSON.parse(input) : input;
        if (!g || typeof g !== 'object' || g.v !== GHOST_VERSION || typeof g.data !== 'string') return null;
        const bytes = base64ToBytes(g.data);
        if (bytes.length < HEADER_BYTES || bytes[0] !== 0x47 || bytes[1] !== 0x48 || bytes[2] !== GHOST_VERSION) return null;
        const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
        const sampleCount = dv.getUint16(4, true);
        const scoreCount = dv.getUint16(6, true);
        if (sampleCount < 1) return null;
        if (bytes.length !== HEADER_BYTES + sampleCount * SAMPLE_BYTES + scoreCount * SCORE_BYTES) return null;
        const xs = new Float64Array(sampleCount);
        const ys = new Float64Array(sampleCount);
        const rots = new Float64Array(sampleCount);
        const thrust = new Uint8Array(sampleCount);
        const alive = new Uint8Array(sampleCount);
        let o = HEADER_BYTES;
        for (let i = 0; i < sampleCount; i++) {
            xs[i] = dv.getUint16(o, true) / 65536;
            ys[i] = dv.getUint16(o + 2, true) / 65536;
            rots[i] = (bytes[o + 4] / 256) * TWO_PI;
            const f = bytes[o + 5];
            if (f & ~(FLAG_THRUST | FLAG_ALIVE)) return null;
            thrust[i] = f & FLAG_THRUST ? 1 : 0;
            alive[i] = f & FLAG_ALIVE ? 1 : 0;
            o += SAMPLE_BYTES;
        }
        const scores = new Uint32Array(scoreCount);
        for (let i = 0; i < scoreCount; i++) {
            scores[i] = dv.getUint32(o, true);
            o += SCORE_BYTES;
        }
        const num = (v, d = 0) => (Number.isFinite(v) && v >= 0 ? v : d);
        return {
            v: g.v,
            viewSize: num(g.viewSize),
            worldWidth: num(g.worldWidth),
            worldHeight: num(g.worldHeight),
            durationMs: (sampleCount - 1) * SAMPLE_INTERVAL_MS,
            score: num(g.score),
            sampleCount,
            xs, ys, rots, thrust, alive, scores,
        };
    } catch {
        return null;
    }
}

/**
 * Plays a decoded ghost back in the current world.
 *   const player = new GhostPlayer(decodeGhost(stored), { worldWidth, worldHeight });
 *   player.sampleAt(tMs) → { x, y, rotation, thrusting, alive, score, done }
 */
export class GhostPlayer {
    constructor(decoded, { worldWidth, worldHeight } = {}) {
        if (!decoded || !(decoded.sampleCount > 0)) throw new Error('GhostPlayer needs a decoded ghost');
        this.ghost = decoded;
        this.worldWidth = worldWidth ?? decoded.worldWidth;
        this.worldHeight = worldHeight ?? decoded.worldHeight;
    }

    get durationMs() { return this.ghost.durationMs; }

    /** Score of the ghost at game time t (steps once per second). */
    scoreAt(tMs) {
        const s = this.ghost.scores;
        if (!s.length) return 0;
        const i = Math.max(0, Math.min(s.length - 1, Math.floor(Math.max(0, tMs) / SCORE_INTERVAL_MS)));
        return s[i];
    }

    /** Wrap-aware interpolated ghost state at game time t (ms). Clamped to the recording. */
    sampleAt(tMs) {
        const g = this.ghost;
        const last = g.sampleCount - 1;
        const pos = Math.max(0, Number.isFinite(tMs) ? tMs : 0) / SAMPLE_INTERVAL_MS;
        const i = Math.min(last, Math.floor(pos));
        const j = Math.min(last, i + 1);
        const frac = i === j ? 0 : Math.min(1, pos - i);
        let fx = g.xs[i];
        let fy = g.ys[i];
        let rot = g.rots[i];
        if (frac > 0 && g.alive[i] && g.alive[j]) {
            const dx = wrapFracDelta(g.xs[j] - g.xs[i]);
            const dy = wrapFracDelta(g.ys[j] - g.ys[i]);
            if (Math.abs(dx) <= SNAP_FRACTION && Math.abs(dy) <= SNAP_FRACTION) {
                fx = wrap01(fx + dx * frac);
                fy = wrap01(fy + dy * frac);
                let dr = (g.rots[j] - g.rots[i]) % TWO_PI;
                if (dr > Math.PI) dr -= TWO_PI;
                if (dr < -Math.PI) dr += TWO_PI;
                rot = (rot + dr * frac + TWO_PI) % TWO_PI;
            }
        }
        return {
            x: fx * this.worldWidth,
            y: fy * this.worldHeight,
            rotation: rot,
            thrusting: !!g.thrust[i],
            alive: !!g.alive[i],
            score: this.scoreAt(tMs),
            done: pos >= last,
        };
    }
}

/** Local-storage key for a profile's best ghost on a course (plan §6). */
export function ghostStorageKey(username, course, difficulty) {
    return `spaceAdventure_ghost_v1_${String(username).toUpperCase()}_${course}_${String(difficulty).toLowerCase()}`;
}

// Short aliases
export { encodeGhost as encode, decodeGhost as decode };
