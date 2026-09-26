// Multiplayer records: history, leaderboards and rivalries (this device only).
// Pure functions over plain arrays/objects; they never mutate their inputs.
// Storage (localStorage) stays in the caller. See docs/plans/05-local-multiplayer.md §6.

export const MP_KEYS = Object.freeze({
    history: 'spaceAdventure_mp_history_v1',
    boardCoop: 'spaceAdventure_mp_board_coop_v1',
    boardHarvest: 'spaceAdventure_mp_board_harvest_v1',
    rivalry: 'spaceAdventure_mp_rivalry_v1',
    ghostPrefix: 'spaceAdventure_ghost_v1_',
});

export const HISTORY_MAX = 20;
export const BOARD_MAX = 10;

const upper = (s) => String(s ?? '').trim().toUpperCase();

/**
 * Normalise a participant to { name, profile }. A plain string is a profiled
 * player whose profile is that name; profile null means a guest.
 */
function toParticipant(p) {
    if (typeof p === 'string') return { name: p, profile: p };
    if (p && typeof p === 'object') {
        return { name: p.name ?? p.profile ?? '', profile: p.profile === undefined ? (p.name ?? null) : p.profile };
    }
    return { name: '', profile: null };
}

/** Profiles (uppercased) named by a board entry or result: entry.profile and entry.players[].profile. */
function entryProfiles(entry) {
    const out = [];
    if (!entry || typeof entry !== 'object') return out;
    if ('profile' in entry && entry.profile) out.push(upper(entry.profile));
    if (Array.isArray(entry.players)) {
        for (const p of entry.players) {
            const { profile } = toParticipant(p);
            if (profile) out.push(upper(profile));
        }
    }
    return out;
}

/**
 * True when an entry belongs only to guests: entry.profile === null, or it has
 * players and none of them has a profile.
 */
export function isGuestEntry(entry) {
    if (!entry || typeof entry !== 'object') return true;
    if ('profile' in entry) return !entry.profile;
    if (Array.isArray(entry.players)) return entryProfiles(entry).length === 0;
    return false;
}

/** Prepend a result (newest first) and keep at most `max`. */
export function addHistory(list, result, max = HISTORY_MAX) {
    const base = Array.isArray(list) ? list : [];
    return [result, ...base].slice(0, Math.max(0, max));
}

/**
 * Insert an entry into a board sorted by `sortKey` (highest first; ties keep
 * older entries ahead) and trim to `max`. Guest-only entries are not added.
 * @returns {Array} new board
 */
export function addToBoard(board, entry, sortKey = 'score', max = BOARD_MAX) {
    const base = Array.isArray(board) ? board.slice() : [];
    if (!entry || isGuestEntry(entry) || !Number.isFinite(entry[sortKey])) return base.slice(0, max);
    let i = base.findIndex((e) => !(Number(e?.[sortKey]) >= entry[sortKey]));
    if (i === -1) i = base.length;
    base.splice(i, 0, entry);
    return base.slice(0, Math.max(0, max));
}

/** Would `value` make it onto the board? */
export function qualifiesForBoard(board, value, sortKey = 'score', max = BOARD_MAX) {
    if (!Number.isFinite(value)) return false;
    const base = Array.isArray(board) ? board : [];
    if (base.length < max) return true;
    return value > Number(base[max - 1]?.[sortKey]);
}

/** Order-independent key for a pair of names: sorted, uppercased, joined by '|'. */
export function rivalryKey(a, b) {
    return [upper(a), upper(b)].sort().join('|');
}

/**
 * Record a finished competitive round.
 * rivalry: { [pairKey]: { [mode]: { wins: { [NAME]: n }, draws: n, played: n } } }
 * @param {object} rivalry
 * @param {string} mode - e.g. 'harvest', 'duel', 'saucer'
 * @param {Array<string|{name:string, profile:string|null}>} names - participants; guests (profile null) are skipped
 * @param {string|null} winnerName - null for a draw
 * @returns {object} new rivalry object
 */
export function recordRivalry(rivalry, mode, names, winnerName) {
    const out = isPlainObject(rivalry) ? { ...rivalry } : {};
    const profiled = [];
    const seen = new Set();
    for (const p of Array.isArray(names) ? names : []) {
        const { profile } = toParticipant(p);
        if (!profile) continue;
        const key = upper(profile);
        if (!key || seen.has(key)) continue;
        seen.add(key);
        profiled.push(key);
    }
    const winner = winnerName == null ? null : upper(winnerName);
    for (let i = 0; i < profiled.length; i++) {
        for (let j = i + 1; j < profiled.length; j++) {
            const a = profiled[i];
            const b = profiled[j];
            // With a winner, only pairs that include the winner record anything
            if (winner !== null && winner !== a && winner !== b) continue;
            const key = rivalryKey(a, b);
            const pair = isPlainObject(out[key]) ? { ...out[key] } : {};
            const prev = isPlainObject(pair[mode]) ? pair[mode] : {};
            const rec = {
                wins: { ...(isPlainObject(prev.wins) ? prev.wins : {}) },
                draws: Number(prev.draws) || 0,
                played: (Number(prev.played) || 0) + 1,
            };
            if (winner === null) rec.draws += 1;
            else rec.wins[winner] = (Number(rec.wins[winner]) || 0) + 1;
            pair[mode] = rec;
            out[key] = pair;
        }
    }
    return out;
}

/**
 * Remove a user's data for "Reset Data": board entries that include the user,
 * and every rivalry pair that names them. History is kept (it is a log of
 * rounds, not a ranking). Any field missing from `records` is left out.
 * @param {{history?:Array, boards?:Object<string,Array>, rivalry?:object}} records
 * @param {string} username
 */
export function filterUser(records, username) {
    const user = upper(username);
    const out = {};
    if (!records || typeof records !== 'object') return out;
    if ('history' in records) out.history = Array.isArray(records.history) ? records.history.slice() : [];
    if ('boards' in records) {
        out.boards = {};
        for (const [id, board] of Object.entries(records.boards || {})) {
            out.boards[id] = filterBoard(board, user);
        }
    }
    if ('rivalry' in records) out.rivalry = filterRivalry(records.rivalry, user);
    return out;
}

/** Board without entries that include the user. */
export function filterBoard(board, username) {
    const user = upper(username);
    return (Array.isArray(board) ? board : []).filter((e) => !entryProfiles(e).includes(user));
}

/** Rivalry without pairs that name the user. */
export function filterRivalry(rivalry, username) {
    const user = upper(username);
    const out = {};
    for (const [key, val] of Object.entries(isPlainObject(rivalry) ? rivalry : {})) {
        if (!key.split('|').includes(user)) out[key] = val;
    }
    return out;
}

/** Local-storage keys of a user's ghosts, from a list of all keys. */
export function ghostKeysForUser(keys, username) {
    const prefix = `${MP_KEYS.ghostPrefix}${upper(username)}_`;
    return (Array.isArray(keys) ? keys : []).filter((k) => typeof k === 'string' && k.startsWith(prefix));
}

/**
 * JSON.parse with a validator; returns `empty` for missing, corrupt or invalid data.
 * @param {string|null} json
 * @param {(value:any) => boolean} [validate]
 * @param {any} [empty=[]]
 */
export function parseOrEmpty(json, validate = () => true, empty = []) {
    if (typeof json !== 'string' || json === '') return empty;
    try {
        const value = JSON.parse(json);
        return validate(value) ? value : empty;
    } catch {
        return empty;
    }
}

// Validators for parseOrEmpty
export const isHistory = (v) => Array.isArray(v) && v.every(isPlainObject);
export const isBoard = (v) => Array.isArray(v) && v.every((e) => isPlainObject(e) && Number.isFinite(e.score));
export const isRivalry = (v) => isPlainObject(v) && Object.values(v).every(isPlainObject);

function isPlainObject(v) {
    return v !== null && typeof v === 'object' && !Array.isArray(v);
}
