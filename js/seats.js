// Input sources and player seats for local multiplayer.
// Pure module: no DOM, no globals. See docs/plans/05-local-multiplayer.md §8 and §10.
//
// Source: a physical input: 'kbLeft', 'kbRight', 'pad:<index>', 'touch:a', 'touch:b'.
// Seat:   a player slot 0..3.
// Bindings use KeyboardEvent.code (physical key position) so AZERTY/QWERTZ work.
// Ctrl, Cmd, Alt and Option are never bound.

export const MAX_SEATS = 4;
export const MAX_TOUCH_SEATS = 2;

export const KEY_PROFILES = Object.freeze({
    kbLeft: Object.freeze({
        thrust: ['KeyW'],
        rotateLeft: ['KeyA'],
        rotateRight: ['KeyD'],
        hyperspace: ['KeyS'],
        fire: ['Space', 'KeyF'],
    }),
    kbRight: Object.freeze({
        thrust: ['ArrowUp', 'Numpad8'],
        rotateLeft: ['ArrowLeft', 'Numpad4'],
        rotateRight: ['ArrowRight', 'Numpad6'],
        hyperspace: ['ArrowDown', 'Numpad5', 'Numpad2'],
        fire: ['Enter', 'NumpadEnter', 'Numpad0', 'ShiftRight'],
    }),
});

/** Extra bindings only in merged (single-player) mode; they belong to kbLeft. */
export const MERGED_EXTRA = Object.freeze({
    hyperspace: ['KeyH'],
});
const MERGED_EXTRA_SOURCE = 'kbLeft';

/** Actions not bound to a seat: anyone can pause, mute and navigate menus. */
export const SHARED_CODES = Object.freeze({
    pause: ['KeyP'],
    escape: ['Escape'],
    toggleMute: ['KeyM'],
    menuUp: ['ArrowUp', 'KeyW'],
    menuDown: ['ArrowDown', 'KeyS'],
    menuLeft: ['ArrowLeft', 'KeyA'],
    menuRight: ['ArrowRight', 'KeyD'],
    menuSelect: ['Enter', 'NumpadEnter', 'Space'],
    enter: ['Enter', 'NumpadEnter'],
    backspace: ['Backspace'],
    // T: never a flying key (Enter is kbRight's fire and would skip training with the first shot)
    skipTutorial: ['KeyT'],
});

// Precomputed code → [{source, action}] tables
const SEAT_TABLE = new Map();
for (const [source, profile] of Object.entries(KEY_PROFILES)) {
    for (const [action, codes] of Object.entries(profile)) {
        for (const code of codes) {
            if (!SEAT_TABLE.has(code)) SEAT_TABLE.set(code, []);
            SEAT_TABLE.get(code).push(Object.freeze({ source, action }));
        }
    }
}
const MERGED_TABLE = new Map([...SEAT_TABLE].map(([k, v]) => [k, v.slice()]));
for (const [action, codes] of Object.entries(MERGED_EXTRA)) {
    for (const code of codes) {
        if (!MERGED_TABLE.has(code)) MERGED_TABLE.set(code, []);
        MERGED_TABLE.get(code).push(Object.freeze({ source: MERGED_EXTRA_SOURCE, action }));
    }
}
const SHARED_TABLE = new Map();
for (const [action, codes] of Object.entries(SHARED_CODES)) {
    for (const code of codes) {
        if (!SHARED_TABLE.has(code)) SHARED_TABLE.set(code, []);
        SHARED_TABLE.get(code).push(action);
    }
}
const EMPTY = Object.freeze([]);

/**
 * Seat-bound bindings for a physical key.
 * @param {string} code - KeyboardEvent.code
 * @param {boolean} [merged=false] - single-player: also includes MERGED_EXTRA (H = hyperspace)
 * @returns {ReadonlyArray<{source:string, action:string}>}
 */
export function lookupCode(code, merged = false) {
    return (merged ? MERGED_TABLE : SEAT_TABLE).get(code) || EMPTY;
}

/** Shared (seatless) actions for a physical key, e.g. 'KeyP' → ['pause']. */
export function lookupShared(code) {
    return SHARED_TABLE.get(code) || EMPTY;
}

/** 'keyboard' | 'gamepad' | 'touch' | null */
export function sourceKind(source) {
    if (typeof source !== 'string') return null;
    if (source === 'kbLeft' || source === 'kbRight') return 'keyboard';
    if (/^pad:\d+$/.test(source)) return 'gamepad';
    if (source === 'touch:a' || source === 'touch:b') return 'touch';
    return null;
}

/**
 * Hide the on-screen touch controls because a controller is the last input? Only when every
 * input drives one ship (merged mode) or no touch seat has joined: in a mixed round a touch
 * player keeps their controls while someone else plays with a controller. Pure.
 * @param {string|null} lastInputSource 'keyboard' | 'touch' | 'mouse' | 'gamepad' | null
 * @param {{merged:boolean, seats:Array<{source:string|null}|null>}|null} table SeatTable.snapshot()-like
 */
export function hideTouchForGamepad(lastInputSource, table) {
    if (lastInputSource !== 'gamepad') return false;
    if (!table || table.merged) return true;
    return !(table.seats || []).some((s) => s && sourceKind(s.source) === 'touch');
}

/**
 * Rotate a vector by `deg` degrees (screen coordinates, clockwise for positive
 * angles since y points down). Exact for multiples of 90.
 */
export function rotateVector(dx, dy, deg) {
    const d = ((deg % 360) + 360) % 360;
    let x;
    let y;
    if (d === 0) { x = dx; y = dy; }
    else if (d === 90) { x = -dy; y = dx; }
    else if (d === 180) { x = -dx; y = -dy; }
    else if (d === 270) { x = dy; y = -dx; }
    else {
        const r = (d * Math.PI) / 180;
        const c = Math.cos(r);
        const s = Math.sin(r);
        x = dx * c - dy * s;
        y = dx * s + dy * c;
    }
    return { x: x + 0, y: y + 0 }; // + 0 turns -0 into 0
}

/**
 * Stick state from a drag offset (finger minus stick origin).
 * @returns {{active:boolean, angle:number, magnitude:number}} angle in radians
 *   (atan2, 0 = right), magnitude clamped to [0, 1].
 */
export function stickFromDrag(dx, dy, radius) {
    const dist = Math.hypot(dx || 0, dy || 0);
    if (!(dist > 0) || !(radius > 0)) return { active: false, angle: 0, magnitude: 0 };
    return { active: true, angle: Math.atan2(dy, dx), magnitude: Math.min(1, dist / radius) };
}

/**
 * Which reserved seat a returning source takes (plan §10.4). Pure.
 * Priority: the seat whose controller had the same index and id (the same controller plugged
 * back in); then the seat of the same index (the browser may rename a controller); then the
 * lowest reserved seat.
 * @param {Array<{reserved?:boolean, reservedFrom?:{source:string|null, id:string|null}}|null>} seats
 * @param {string} source e.g. 'pad:1'
 * @param {string|null} [id] Gamepad.id of that controller
 * @returns {number|null}
 */
export function pickRejoinSeat(seats, source, id = null) {
    const reserved = [];
    (seats || []).forEach((s, i) => { if (s && s.reserved) reserved.push(i); });
    if (!reserved.length) return null;
    const from = (i) => seats[i].reservedFrom || {};
    const exact = reserved.find((i) => from(i).source === source && id != null && from(i).id === String(id));
    if (exact !== undefined) return exact;
    const sameSource = reserved.find((i) => from(i).source === source);
    if (sameSource !== undefined) return sameSource;
    return reserved[0];
}

/**
 * Which source sits in which seat.
 *   merged mode (single-player): every source drives seat 0.
 *   seat mode: sources join seats; a reserved seat keeps its colour while its
 *   controller is disconnected and is taken back by the next source that joins.
 */
export class SeatTable {
    constructor({ maxSeats = MAX_SEATS, maxTouchSeats = MAX_TOUCH_SEATS, colourCount = MAX_SEATS } = {}) {
        this.maxSeats = maxSeats;
        this.maxTouchSeats = maxTouchSeats;
        this.colourCount = colourCount;
        this.merged = true;
        this.seats = new Array(maxSeats).fill(null); // { source, colour, reserved }
    }

    /** Switch between merged (single-player) and seat mode. Entering merged clears seats. */
    setMerged(merged) {
        this.merged = !!merged;
        if (this.merged) this.clear();
    }

    clear() {
        this.seats.fill(null);
    }

    /** Seat of a source: 0 in merged mode, else its joined seat or null. */
    seatOf(source) {
        if (this.merged) return sourceKind(source) ? 0 : null;
        const i = this.seats.findIndex((s) => s && s.source === source);
        return i === -1 ? null : i;
    }

    /** Sources driving a seat. In merged mode seat 0 returns ['*'] (every source). */
    sourcesOf(seat) {
        if (this.merged) return seat === 0 ? ['*'] : [];
        const s = this.seats[seat];
        return s && s.source ? [s.source] : [];
    }

    /**
     * Join a source. Returns its seat (existing seat if already joined), or null
     * when full, in merged mode, for an unknown source, or for a third touch source.
     * A reserved seat (disconnected controller) is taken first.
     */
    join(source) {
        if (this.merged || !sourceKind(source)) return null;
        const existing = this.seatOf(source);
        if (existing !== null) return existing;
        if (sourceKind(source) === 'touch' && this.touchCount() >= this.maxTouchSeats) return null;
        const reserved = this.seats.findIndex((s) => s && s.reserved);
        if (reserved !== -1) {
            const { reservedFrom, ...rest } = this.seats[reserved];
            this.seats[reserved] = { ...rest, source, reserved: false };
            return reserved;
        }
        const free = this.seats.findIndex((s) => s === null);
        if (free === -1) return null;
        this.seats[free] = { source, colour: this.freeColour(free), reserved: false };
        return free;
    }

    /** Leave by source or seat number (also drops a reserved seat). Returns the freed seat or null. */
    leave(sourceOrSeat) {
        const seat = typeof sourceOrSeat === 'number' ? sourceOrSeat : this.seatOf(sourceOrSeat);
        if (this.merged || seat === null || seat < 0 || seat >= this.maxSeats || !this.seats[seat]) return null;
        this.seats[seat] = null;
        return seat;
    }

    /**
     * Keep a seat (and colour) while its source is gone, e.g. a controller disconnected mid-round.
     * `meta.id` (the controller's Gamepad.id) is remembered with the old source, so the same
     * controller gets its own seat back first (see pickRejoinSeat).
     */
    reserve(seat, meta = {}) {
        const s = this.seats[seat];
        if (this.merged || !s) return false;
        const from = s.reserved ? s.reservedFrom : { source: s.source, id: meta && meta.id != null ? String(meta.id) : null };
        this.seats[seat] = { ...s, source: null, reserved: true, reservedFrom: from || { source: null, id: null } };
        return true;
    }

    isReserved(seat) {
        return !!(this.seats[seat] && this.seats[seat].reserved);
    }

    /** Seats kept for a disconnected controller, lowest first. */
    reservedSeats() {
        const out = [];
        this.seats.forEach((s, i) => { if (s && s.reserved) out.push(i); });
        return out;
    }

    /**
     * A source (an unjoined controller pressing Ⓐ mid-round) takes back a reserved seat:
     * the seat it held itself if its index and id match, else the lowest reserved seat.
     * Returns the seat, or null (merged mode, already seated, nothing reserved).
     */
    rejoin(source, id = null) {
        if (this.merged || !sourceKind(source) || this.seatOf(source) !== null) return null;
        const seat = pickRejoinSeat(this.seats, source, id);
        if (seat === null) return null;
        const { reservedFrom, ...rest } = this.seats[seat];
        this.seats[seat] = { ...rest, source, reserved: false };
        return seat;
    }

    touchCount() {
        return this.seats.filter((s) => s && sourceKind(s.source) === 'touch').length;
    }

    /** Number of occupied seats (joined or reserved). */
    get count() {
        return this.seats.filter(Boolean).length;
    }

    colourOf(seat) {
        return this.seats[seat] ? this.seats[seat].colour : null;
    }

    /** Lowest colour index not taken, preferring the seat's own index. */
    freeColour(preferred = 0) {
        const taken = new Set(this.seats.filter(Boolean).map((s) => s.colour));
        if (!taken.has(preferred) && preferred < this.colourCount) return preferred;
        for (let c = 0; c < this.colourCount; c++) if (!taken.has(c)) return c;
        return preferred;
    }

    /** Step a seat's colour by dir (+1/-1), skipping colours other seats hold. Returns the new index. */
    cycleColour(seat, dir = 1) {
        const s = this.seats[seat];
        if (!s) return null;
        const taken = new Set(this.seats.filter((o, i) => o && i !== seat).map((o) => o.colour));
        let c = s.colour;
        for (let n = 0; n < this.colourCount; n++) {
            c = (((c + (dir < 0 ? -1 : 1)) % this.colourCount) + this.colourCount) % this.colourCount;
            if (!taken.has(c)) break;
        }
        this.seats[seat] = { ...s, colour: c };
        return c;
    }

    /** Plain copy for the test hook and the lobby. */
    snapshot() {
        return {
            merged: this.merged,
            seats: this.seats.map((s, seat) => (s ? {
                seat, source: s.source, colour: s.colour, reserved: s.reserved,
                ...(s.reserved ? { reservedFrom: { ...(s.reservedFrom || { source: null, id: null }) } } : {}),
            } : null)),
        };
    }
}
