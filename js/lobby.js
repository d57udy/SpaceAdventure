// Multiplayer lobby logic (pure: no DOM, no globals). See docs/plans/05-local-multiplayer.md §10.2.
//
// Two kinds of lobby:
//   'seats' - one card per seat; players join with their own input (keyboard half, controller).
//             Built on a SeatTable (js/seats.js), normally the InputHandler's, so joining a seat
//             also routes that input to the seat.
//               Fire          not joined: join · joined: ready. The W A S D half takes P1 and
//                             the arrow keys P2 when free (seats.js preferredSeat), so each
//                             sits on their own side; controllers take the lowest free seat.
//               Hyperspace    joined: leave · ready: unready
//               Rotate L/R    joined: change colour (skips colours other seats hold)
//               Thrust        joined: next name (Guest N or a saved profile)
//             With at least `min` players joined and everyone ready, a 3 s countdown starts;
//             any join, leave or unready cancels it.
//   'count' - pass-and-play (Take Turns): one shared input, so it only asks how many players
//             and, optionally, their names (tap or keys). Works on touch devices.
//
// Names: the first seat to join gets the signed-in profile; others are "Guest N" and can
// cycle through the saved profiles on this device (no typing in the lobby). A profile is
// never used by two seats at once.

import { preferredSeat } from './seats.js';

export const LOBBY_COUNTDOWN = 3;

const upper = (s) => String(s ?? '').toUpperCase();

/** Lobby action for a raw input action (keyboard seat actions or controller menu actions). */
export function lobbyAction(action) {
    switch (action) {
        case 'fire': case 'menuSelect': return 'fire';
        case 'hyperspace': return 'back';
        case 'rotateLeft': case 'menuLeft': return 'colourPrev';
        case 'rotateRight': case 'menuRight': return 'colourNext';
        case 'thrust': case 'menuUp': return 'name';
        default: return null;
    }
}

export function guestName(seat) {
    return `Guest ${seat + 1}`;
}

function uniqueProfiles(profiles, currentUser) {
    const out = [];
    const seen = new Set();
    for (const p of [currentUser, ...(Array.isArray(profiles) ? profiles : [])]) {
        if (typeof p !== 'string' || !p.trim()) continue;
        const key = upper(p);
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(p);
    }
    return out;
}

// --- Seat lobby ---

/**
 * @param {object} o
 * @param {import('./seats.js').SeatTable} o.seats - seat table in seat (non-merged) mode
 * @param {number} [o.min=2] @param {number} [o.max=4] - players allowed by the mode
 * @param {string|null} o.currentUser - signed-in profile
 * @param {string[]} [o.profiles] - saved profiles on this device
 */
export function createSeatLobby({ seats, min = 2, max = 4, currentUser = null, profiles = [] } = {}) {
    return {
        kind: 'seats',
        seats,
        min,
        max: Math.min(max, seats ? seats.maxSeats : max),
        currentUser,
        profiles: uniqueProfiles(profiles, currentUser),
        cards: [null, null, null, null], // per seat: { name, profile, ready }
        countdown: null,
    };
}

export function joinedSeats(lobby) {
    const out = [];
    lobby.cards.forEach((c, seat) => { if (c) out.push(seat); });
    return out;
}

function takenProfiles(lobby, exceptSeat) {
    const set = new Set();
    lobby.cards.forEach((c, seat) => { if (c && c.profile && seat !== exceptSeat) set.add(upper(c.profile)); });
    return set;
}

/** Names a seat can cycle through: its guest name, then the profiles no other seat uses. */
export function nameOptions(lobby, seat) {
    const taken = takenProfiles(lobby, seat);
    return [
        { name: guestName(seat), profile: null },
        ...lobby.profiles.filter((p) => !taken.has(upper(p))).map((p) => ({ name: p, profile: p })),
    ];
}

function defaultIdentity(lobby, seat) {
    const user = lobby.currentUser;
    if (user && !takenProfiles(lobby, seat).has(upper(user))) return { name: user, profile: user };
    return { name: guestName(seat), profile: null };
}

function cancelCountdown(lobby) {
    lobby.countdown = null;
}

/** Everyone joined is ready and there are enough players. */
export function canStart(lobby) {
    const joined = joinedSeats(lobby);
    return joined.length >= lobby.min && joined.every((s) => lobby.cards[s].ready);
}

/**
 * Apply one source event ({ source, action }) from InputHandler.consumeSourceEvents().
 * @returns {{type:string, seat:number|null}|null} what happened (null: ignored)
 *   types: 'joined' | 'full' | 'ready' | 'unready' | 'left' | 'colour' | 'name'
 */
export function handleLobbyEvent(lobby, { source, action } = {}) {
    const act = lobbyAction(action);
    if (!act || !lobby.seats) return null;
    let seat = lobby.seats.seatOf(source);
    if (seat !== null && !lobby.cards[seat]) seat = null; // joined in the table but not in this lobby
    if (seat === null) {
        if (act !== 'fire') return null;
        if (joinedSeats(lobby).length >= lobby.max) return { type: 'full', seat: null };
        const prefer = preferredSeat(source);
        const s = lobby.seats.join(source, { prefer: prefer !== null && prefer < lobby.max ? prefer : null });
        if (s === null || s >= lobby.max) {
            if (s !== null) lobby.seats.leave(s);
            return { type: 'full', seat: null };
        }
        lobby.cards[s] = { ...defaultIdentity(lobby, s), ready: false };
        cancelCountdown(lobby);
        return { type: 'joined', seat: s };
    }
    const card = lobby.cards[seat];
    switch (act) {
        case 'fire':
            if (card.ready) return null;
            card.ready = true;
            return { type: 'ready', seat };
        case 'back':
            cancelCountdown(lobby);
            if (card.ready) {
                card.ready = false;
                return { type: 'unready', seat };
            }
            lobby.cards[seat] = null;
            lobby.seats.leave(seat);
            return { type: 'left', seat };
        case 'colourPrev':
        case 'colourNext':
            if (card.ready) return null;
            lobby.seats.cycleColour(seat, act === 'colourPrev' ? -1 : 1);
            return { type: 'colour', seat };
        case 'name': {
            if (card.ready) return null;
            cycleSeatName(lobby, seat, 1);
            return { type: 'name', seat };
        }
        default:
            return null;
    }
}

/** Step a joined seat's name through nameOptions. */
export function cycleSeatName(lobby, seat, dir = 1) {
    const card = lobby.cards[seat];
    if (!card) return null;
    const opts = nameOptions(lobby, seat);
    const i = opts.findIndex((o) => upper(o.profile) === upper(card.profile) && (o.profile || o.name === card.name));
    const next = opts[(((i === -1 ? 0 : i) + (dir < 0 ? -1 : 1)) % opts.length + opts.length) % opts.length];
    card.name = next.name;
    card.profile = next.profile;
    return next;
}

/**
 * Advance the start countdown. Starts it when canStart, cancels it otherwise.
 * @returns {'start'|null} 'start' once the countdown reaches zero
 */
export function tickLobby(lobby, dt) {
    if (lobby.kind !== 'seats') return null;
    if (!canStart(lobby)) {
        lobby.countdown = null;
        return null;
    }
    if (lobby.countdown === null) lobby.countdown = LOBBY_COUNTDOWN;
    lobby.countdown = Math.max(0, lobby.countdown - dt);
    return lobby.countdown <= 0 ? 'start' : null;
}

/** Joined players in seat order: [{ seat, source, colour, name, profile }]. */
export function seatLineup(lobby) {
    return joinedSeats(lobby).map((seat) => {
        const s = lobby.seats.seats[seat];
        const c = lobby.cards[seat];
        return { seat, source: s ? s.source : null, colour: s ? s.colour : seat, name: c.name, profile: c.profile };
    });
}

/**
 * Rebuild a line-up (rematch / change players): same seats, sources, colours and names,
 * joined but not ready. Entries whose profile is no longer allowed become guests.
 */
export function restoreSeatLineup(lobby, lineup) {
    lobby.seats.clear();
    lobby.cards = [null, null, null, null];
    for (const e of Array.isArray(lineup) ? lineup : []) {
        const seat = e && Number.isInteger(e.seat) ? e.seat : null;
        if (seat === null || seat < 0 || seat >= lobby.max || lobby.cards[seat] || !e.source) continue;
        if (lobby.seats.seatOf(e.source) !== null) continue;
        lobby.seats.seats[seat] = { source: e.source, colour: Number.isInteger(e.colour) ? e.colour : seat, reserved: false };
        const known = e.profile && lobby.profiles.some((p) => upper(p) === upper(e.profile))
            && !takenProfiles(lobby, seat).has(upper(e.profile));
        lobby.cards[seat] = known
            ? { name: e.profile, profile: e.profile, ready: false }
            : { name: guestName(seat), profile: null, ready: false };
    }
    lobby.countdown = null;
    return lobby;
}

// --- Count lobby (pass-and-play) ---

export function createCountLobby({ min = 2, max = 4, count = 2, currentUser = null, profiles = [] } = {}) {
    const lobby = {
        kind: 'count',
        min,
        max,
        count: Math.max(min, Math.min(max, count)),
        currentUser,
        profiles: uniqueProfiles(profiles, currentUser),
        names: [],
    };
    fillCountNames(lobby);
    return lobby;
}

function fillCountNames(lobby) {
    for (let i = 0; i < lobby.max; i++) {
        if (!lobby.names[i]) {
            lobby.names[i] = i === 0 && lobby.currentUser
                ? { name: lobby.currentUser, profile: lobby.currentUser }
                : { name: guestName(i), profile: null };
        }
    }
}

export function setPlayerCount(lobby, n) {
    lobby.count = Math.max(lobby.min, Math.min(lobby.max, n));
    return lobby.count;
}

export function changePlayerCount(lobby, dir) {
    const span = lobby.max - lobby.min + 1;
    const i = (((lobby.count - lobby.min + (dir < 0 ? -1 : 1)) % span) + span) % span;
    return setPlayerCount(lobby, lobby.min + i);
}

/** Names player i can cycle through: Guest i+1, then profiles no other player (of the count) uses. */
export function countNameOptions(lobby, i) {
    const taken = new Set();
    for (let k = 0; k < lobby.count; k++) {
        if (k !== i && lobby.names[k] && lobby.names[k].profile) taken.add(upper(lobby.names[k].profile));
    }
    return [
        { name: guestName(i), profile: null },
        ...lobby.profiles.filter((p) => !taken.has(upper(p))).map((p) => ({ name: p, profile: p })),
    ];
}

export function cycleCountName(lobby, i, dir = 1) {
    const cur = lobby.names[i];
    const opts = countNameOptions(lobby, i);
    const k = opts.findIndex((o) => (cur.profile ? upper(o.profile) === upper(cur.profile) : !o.profile));
    const next = opts[(((k === -1 ? 0 : k) + (dir < 0 ? -1 : 1)) % opts.length + opts.length) % opts.length];
    lobby.names[i] = { name: next.name, profile: next.profile };
    return next;
}

/** Players of a count lobby: [{ seat, name, profile, colour }]; a profile used twice becomes a guest. */
export function countLineup(lobby) {
    const seen = new Set();
    const out = [];
    for (let i = 0; i < lobby.count; i++) {
        let { name, profile } = lobby.names[i] || { name: guestName(i), profile: null };
        if (profile && seen.has(upper(profile))) { name = guestName(i); profile = null; }
        if (profile) seen.add(upper(profile));
        out.push({ seat: i, source: null, colour: i, name, profile });
    }
    return out;
}

/** Rebuild a count lobby from a saved line-up (rematch). */
export function restoreCountLineup(lobby, lineup) {
    const list = Array.isArray(lineup) ? lineup.slice(0, lobby.max) : [];
    if (list.length) setPlayerCount(lobby, list.length);
    list.forEach((e, i) => {
        const known = e && e.profile && lobby.profiles.some((p) => upper(p) === upper(e.profile));
        lobby.names[i] = known ? { name: e.profile, profile: e.profile } : { name: guestName(i), profile: null };
    });
    return lobby;
}

// --- Saved line-up (rematch), stored per browser tab ---

export const LINEUP_KEY = 'spaceAdventure_mp_lineup';

/** Plain data for sessionStorage. */
export function serializeLineup(modeId, kind, lineup) {
    return JSON.stringify({ modeId, kind, players: lineup.map(({ seat, source, colour, name, profile }) => ({ seat, source, colour, name, profile })) });
}

/** Parse a saved line-up; null when missing or corrupt. */
export function parseLineup(json) {
    if (typeof json !== 'string' || !json) return null;
    try {
        const v = JSON.parse(json);
        if (!v || typeof v !== 'object' || typeof v.modeId !== 'string' || !['seats', 'count'].includes(v.kind)) return null;
        if (!Array.isArray(v.players)) return null;
        const players = v.players.filter((p) => p && typeof p === 'object' && Number.isInteger(p.seat))
            .map((p) => ({
                seat: p.seat,
                source: typeof p.source === 'string' ? p.source : null,
                colour: Number.isInteger(p.colour) ? p.colour : p.seat,
                name: typeof p.name === 'string' ? p.name : guestName(p.seat),
                profile: typeof p.profile === 'string' && p.profile ? p.profile : null,
            }));
        return { modeId: v.modeId, kind: v.kind, players };
    } catch {
        return null;
    }
}
