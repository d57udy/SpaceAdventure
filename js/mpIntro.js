// Round intro card, multiplayer help text and accessibility helpers for local multiplayer.
// Pure module: no DOM, no globals. See docs/plans/05-local-multiplayer.md §12 and §14 (MP-7).
//
//   intro        before the first round of a lobby session every seat sees its own controls;
//                the round starts when every seat has pressed fire or after 8 s. Later rounds
//                of the same session (rematch, restart) show it for 2 s.
//   controls     per-source control lines (keyboard profile, controller glyphs, touch zone)
//   help         the keyboard profiles table for the Help screen
//   stereo pan   each player's fire/thrust sounds panned to their side (side by side only)

import { KEY_PROFILES } from './seats.js';

export const INTRO_FULL_SECONDS = 8;
export const INTRO_SHORT_SECONDS = 2;
/** Stereo position of a side-by-side player's sounds (-1 left … 1 right). */
export const STEREO_PAN = 0.6;

const KEY_NAMES = Object.freeze({
    Space: 'SPACE', Enter: 'ENTER', ShiftRight: 'RIGHT SHIFT', ShiftLeft: 'LEFT SHIFT',
    ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→',
    NumpadEnter: 'NUM ENTER',
});

/** Short printable name of a KeyboardEvent.code ('KeyW' -> 'W', 'Numpad8' -> 'NUM 8'). */
export function keyName(code) {
    const c = String(code || '');
    if (KEY_NAMES[c]) return KEY_NAMES[c];
    let m = /^Key([A-Z])$/.exec(c);
    if (m) return m[1];
    m = /^Digit(\d)$/.exec(c);
    if (m) return m[1];
    m = /^Numpad(\d)$/.exec(c);
    if (m) return `NUM ${m[1]}`;
    return c.toUpperCase();
}

const isNumpad = (code) => /^Numpad/.test(code);
const main = (codes) => codes.filter(c => !isNumpad(c));

/**
 * The keys of a keyboard profile ('kbLeft' | 'kbRight') as display strings, or null.
 * Numpad alternates are listed separately (numpad), so the main line stays short.
 * @returns {{thrust:string, turn:string, hyperspace:string, fire:string, numpad:string}|null}
 */
export function keyboardControls(source) {
    const prof = KEY_PROFILES[source];
    if (!prof) return null;
    const names = (codes) => main(codes).map(keyName);
    // Numpad alternates in the order thrust · turn · hyperspace · fire, e.g. '8 · 4 6 · 5 · ENTER'
    const pad = (a) => prof[a].filter(isNumpad).map(c => keyName(c).replace(/^NUM /, ''))[0] || '';
    const groups = [pad('thrust'), [pad('rotateLeft'), pad('rotateRight')].filter(Boolean).join(' '), pad('hyperspace'), pad('fire')];
    const numpad = groups.every(g => !g) ? '' : groups.filter(Boolean).join(' · ');
    return {
        thrust: names(prof.thrust).join(' or '),
        turn: `${names(prof.rotateLeft)[0]} ${names(prof.rotateRight)[0]}`,
        hyperspace: names(prof.hyperspace).join(' or '),
        fire: names(prof.fire).join(' or '),
        numpad,
    };
}

/** Kind of a lobby source: 'keys', 'pad', 'touch' or null. */
export function sourceKindOf(source) {
    const s = String(source || '');
    if (KEY_PROFILES[s]) return 'keys';
    if (/^pad:\d+$/.test(s)) return 'pad';
    if (s === 'touch:a' || s === 'touch:b') return 'touch';
    return null;
}

/**
 * Lines of a seat's controls card.
 * @param {string} source - 'kbLeft', 'kbRight', 'pad:<n>', 'touch:a', 'touch:b'
 * @param {object} [o]
 * @param {{fire:string, hyperspace:string}} [o.pad] - controller glyphs (Ⓐ, Ⓑ; ✕, ○ …)
 * @param {'outer'|'inner'} [o.fireSide] - touch: where the fire button sits
 * @param {'ship'|'saucer'|null} [o.role] - Saucer mode: which side this seat plays; the saucer
 *   steers in absolute directions and has no hyperspace
 * @returns {{kind:string|null, lines:string[]}}
 */
export function controlsCard(source, { pad = { fire: 'Ⓐ', hyperspace: 'Ⓑ' }, fireSide = 'outer', role = null } = {}) {
    const kind = sourceKindOf(source);
    if (role === 'saucer') return saucerCard(source, kind, pad);
    const card = shipCard(source, kind, pad, fireSide);
    if (role === 'ship' && card.kind) card.lines.unshift('You fly the SHIP');
    return card;
}

function saucerCard(source, kind, pad) {
    const head = 'You steer the SAUCER';
    if (kind === 'keys') {
        const prof = KEY_PROFILES[source];
        const first = (a) => keyName(main(prof[a])[0]);
        const dirs = [first('thrust'), first('rotateLeft'), first('hyperspace'), first('rotateRight')].join(' ');
        return { kind, lines: [head, `${dirs} steer`, `${keyboardControls(source).fire} fire`] };
    }
    if (kind === 'pad') return { kind, lines: [head, 'Stick steers', `${pad.fire} or RT fire`] };
    if (kind === 'touch') return { kind, lines: [head, 'Drag here to steer', 'FIRE: red button'] };
    return { kind: null, lines: [] };
}

function shipCard(source, kind, pad, fireSide) {
    if (kind === 'keys') {
        const k = keyboardControls(source);
        return { kind, lines: [`${k.thrust} thrust · ${k.turn} turn`, `${k.hyperspace} hyperspace`, `${k.fire} fire`] };
    }
    if (kind === 'pad') {
        const n = Number(String(source).slice(4)) + 1;
        return { kind, lines: [`Controller ${n}: stick steers`, `${pad.fire} or RT fire`, `${pad.hyperspace} hyperspace`] };
    }
    if (kind === 'touch') {
        return { kind, lines: ['Drag here to steer', `FIRE: red button (${fireSide === 'inner' ? 'inner' : 'outer'} side)`, 'Star button: hyperspace'] };
    }
    return { kind: null, lines: [] };
}

/**
 * One line of rules for the intro card.
 * @param {string} modeId
 * @param {{target?:number, roundSeconds?:number, fallback?:string}} [o]
 */
export function introRulesLine(modeId, { target = null, roundSeconds = null, fallback = '' } = {}) {
    switch (modeId) {
        case 'coop':
            return 'Co-op: one team score. Fly close to a fallen wingman to revive them.';
        case 'harvest': {
            const t = Number.isFinite(roundSeconds) && roundSeconds > 0 ? ` in ${formatMinutes(roundSeconds)}` : '';
            return `Harvest Race: most crystals${t} wins. Shoot a crystal to deny it.`;
        }
        case 'duel':
            return `Duel: first to ${Number.isFinite(target) && target > 0 ? target : 5} kills. One hit kills.`;
        case 'saucer': {
            const pts = Number.isFinite(target) && target > 0 ? `${target} points` : 'the target score';
            const t = Number.isFinite(roundSeconds) && roundSeconds > 0 ? ` in ${formatMinutes(roundSeconds)}` : '';
            return `Saucer: the ship needs ${pts}${t}. The saucer stops it.`;
        }
        default:
            return fallback || '';
    }
}

function formatMinutes(s) {
    const m = Math.floor(s / 60);
    const r = Math.round(s % 60);
    return `${m}:${String(r).padStart(2, '0')}`;
}

/**
 * Identity of a lobby session for the intro: the mode and the inputs of its players. A later
 * round with the same key (rematch, restart) gets the short intro.
 */
export function introSessionKey(modeId, sources) {
    return `${modeId}|${(sources || []).map(s => String(s ?? '')).join(',')}`;
}

/**
 * A round intro for `count` players. full: the first round of a lobby session (8 s, waits
 * for fire), else the short 2 s card.
 */
export function createIntro(count, { full = true } = {}) {
    const n = Math.max(0, Math.floor(Number(count) || 0));
    const duration = full ? INTRO_FULL_SECONDS : INTRO_SHORT_SECONDS;
    return { full: !!full, duration, timeLeft: duration, ready: Array.from({ length: n }, () => false) };
}

/** Mark player `index` ready (fire pressed). Returns true when it changed. */
export function introPressFire(intro, index) {
    if (!intro || !Number.isInteger(index) || index < 0 || index >= intro.ready.length || intro.ready[index]) return false;
    intro.ready[index] = true;
    return true;
}

export function introAllReady(intro) {
    return !!intro && intro.ready.length > 0 && intro.ready.every(Boolean);
}

/** Advance the intro clock. Returns true when the round should start. */
export function tickIntro(intro, dt) {
    if (!intro) return true;
    if (introAllReady(intro)) return true;
    const d = Number(dt);
    if (Number.isFinite(d) && d > 0) intro.timeLeft = Math.max(0, intro.timeLeft - d);
    return intro.timeLeft <= 0;
}

/** Keyboard profiles table for the Help screen: [{action, p1, p2}]. */
export function keyboardTable() {
    const a = keyboardControls('kbLeft');
    const b = keyboardControls('kbRight');
    return [
        { action: 'Thrust', p1: a.thrust, p2: b.thrust },
        { action: 'Turn', p1: a.turn, p2: b.turn },
        { action: 'Hyperspace', p1: a.hyperspace, p2: b.hyperspace },
        { action: 'Fire', p1: a.fire, p2: b.fire },
        { action: 'Numpad', p1: '–', p2: b.numpad },
    ];
}

/**
 * Stereo pan for a player's sounds: only in the side-by-side layout with the setting on.
 * @param {'left'|'right'|null} column - the player's side
 */
export function stereoPan(column, { enabled = true, layout = null } = {}) {
    if (!enabled || layout !== 'sides') return 0;
    if (column === 'left') return -STEREO_PAN;
    if (column === 'right') return STEREO_PAN;
    return 0;
}

/** Pan of the one shared thrust loop: the mean pan of the thrusting players. */
export function thrustPan(pans) {
    const list = (pans || []).filter(Number.isFinite);
    if (!list.length) return 0;
    return list.reduce((s, v) => s + v, 0) / list.length;
}
