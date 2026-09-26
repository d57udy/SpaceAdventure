// Rules maths for the competitive local multiplayer modes (pure: no DOM, no globals).
// See docs/plans/05-local-multiplayer.md §2 (friendly fire, ship bump), §4.3 Harvest Race,
// §4.4 Duel and §11 (round timer).
//
//   ship bump      elastic bounce between two ships (equal mass), wrap-aware, per-pair cooldown
//   field refill   levels are off: keep the greens and reds topped up, spawning away from ships
//   round options  the lobby's per-mode choice (Harvest round length, Duel kill target)
//   round timer    the centre-top clock, its flash in the last 10 s, overtime / sudden death
import { wrapDelta } from './utils.js';
import { formatClock } from './timeAttack.js';

export { formatClock };

// --- Ship bump (plan §2) ---

export const BUMP = Object.freeze({
    restitution: 0.9,      // share of the closing speed kept after the bounce
    cooldown: 0.25,        // s before the same pair can bump again
    minPushSpeed: 60,      // px/s each ship gets when they overlap without closing (e.g. a jump)
});

/** Order-independent key for a pair of ids. */
export function bumpPairKey(a, b) {
    return String(a) < String(b) ? `${a}|${b}` : `${b}|${a}`;
}

/**
 * Elastic bump between two round ships of equal mass in a W x H wrapping world.
 * Pure: returns the new velocities and positions (overlap removed, half each way), or null
 * when the ships don't touch. Ships moving apart already keep their velocities; ships that
 * overlap without closing (one jumped onto the other) are pushed apart at `minPushSpeed`.
 * @param {{x:number, y:number, velX:number, velY:number, radius:number}} a
 * @param {{x:number, y:number, velX:number, velY:number, radius:number}} b
 * @returns {null | {a:{x,y,velX,velY}, b:{x,y,velX,velY}, nx:number, ny:number, impulse:number}}
 */
export function bumpShips(a, b, W, H, { restitution = BUMP.restitution, minPushSpeed = BUMP.minPushSpeed } = {}) {
    const dx = wrapDelta(b.x - a.x, W);
    const dy = wrapDelta(b.y - a.y, H);
    const dist = Math.hypot(dx, dy);
    const minDist = (a.radius || 0) + (b.radius || 0);
    if (!(dist < minDist)) return null;
    // Normal from a to b (any direction when they sit exactly on top of each other)
    const nx = dist > 1e-9 ? dx / dist : 1;
    const ny = dist > 1e-9 ? dy / dist : 0;
    // Closing speed along the normal (positive: approaching)
    const closing = (a.velX - b.velX) * nx + (a.velY - b.velY) * ny;
    let va = { velX: a.velX, velY: a.velY };
    let vb = { velX: b.velX, velY: b.velY };
    let impulse = 0;
    if (closing > 0) {
        // Equal masses: each ship gets half of (1 + e) times the closing speed
        impulse = ((1 + restitution) * closing) / 2;
        va = { velX: a.velX - impulse * nx, velY: a.velY - impulse * ny };
        vb = { velX: b.velX + impulse * nx, velY: b.velY + impulse * ny };
    }
    // Overlapping without separating fast enough: push apart
    const sep = (vb.velX - va.velX) * nx + (vb.velY - va.velY) * ny;
    if (sep < 2 * minPushSpeed && closing <= 0) {
        const add = (2 * minPushSpeed - sep) / 2;
        va = { velX: va.velX - add * nx, velY: va.velY - add * ny };
        vb = { velX: vb.velX + add * nx, velY: vb.velY + add * ny };
        impulse = Math.max(impulse, add);
    }
    const push = (minDist - dist) / 2 + 0.5;
    const wrap = (v, size) => (size > 0 ? ((v % size) + size) % size : v);
    return {
        a: { x: wrap(a.x - nx * push, W), y: wrap(a.y - ny * push, H), ...va },
        b: { x: wrap(b.x + nx * push, W), y: wrap(b.y + ny * push, H), ...vb },
        nx, ny, impulse,
    };
}

/**
 * Advance pair cooldowns (seconds left per pair key); drops the ones that ran out.
 * @param {Map<string, number>} cooldowns - mutated
 */
export function tickBumpCooldowns(cooldowns, dt) {
    for (const [k, v] of cooldowns) {
        const left = v - dt;
        if (left <= 0) cooldowns.delete(k);
        else cooldowns.set(k, left);
    }
    return cooldowns;
}

// --- Field refill (plan §4.3, §4.4) ---

/** Living greens and reds (fading-in ones count: they are on their way). */
export function countField(asteroids) {
    let greens = 0;
    let reds = 0;
    for (const a of asteroids || []) {
        if (!a || a.isAlive === false) continue;
        if (a.type === 'green') greens++;
        else if (a.type === 'red') reds++;
    }
    return { greens, reds };
}

/**
 * How many greens and reds to add so the field is back at its targets.
 * @param {{greens:number, reds:number}} counts - from countField
 * @param {{greens:number, reds:number}} field - the mode's targets
 * @param {number} [maxPerTick=Infinity] - cap per refill tick (spreads a big refill out)
 */
export function planFieldRefill(counts, field, maxPerTick = Infinity) {
    const g = Math.max(0, (field.greens || 0) - (counts.greens || 0));
    const r = Math.max(0, (field.reds || 0) - (counts.reds || 0));
    const greens = Math.min(g, maxPerTick);
    const reds = Math.min(r, Math.max(0, maxPerTick - greens));
    return { greens, reds };
}

/**
 * A spawn point at least `minDist` (wrap-aware) from every point in `avoid` (the ships),
 * found by `tries` random draws. Returns null if none of them is far enough.
 * @param {{x:number, y:number}[]} avoid
 * @param {() => number} [rand]
 */
export function findFieldSpawn(avoid, W, H, minDist, rand = Math.random, tries = 30) {
    for (let i = 0; i < tries; i++) {
        const x = rand() * W;
        const y = rand() * H;
        const ok = (avoid || []).every(p => Math.hypot(wrapDelta(x - p.x, W), wrapDelta(y - p.y, H)) >= minDist);
        if (ok) return { x, y };
    }
    return null;
}

/** Where the ships of a versus round start: side by side across the world centre. */
export function versusStartPoint(slot, count, W, H) {
    const spread = W * 0.3;
    const x = count > 1 ? W / 2 + (slot / (count - 1) - 0.5) * spread : W / 2;
    return { x, y: H / 2 };
}

// --- Lobby options ---

/**
 * The per-mode option shown in the lobby, or null.
 *   harvest: round length (s); duel: kills to win.
 */
export function modeOption(mode) {
    if (!mode) return null;
    if (mode.id === 'harvest' && mode.timer && Array.isArray(mode.timer.options) && mode.timer.options.length > 1) {
        return { key: 'roundSeconds', label: 'Round', values: mode.timer.options.slice(), default: mode.timer.default };
    }
    if (mode.winCondition === 'kills' && mode.target && Array.isArray(mode.target.options)) {
        return { key: 'target', label: 'First to', values: mode.target.options.slice(), default: mode.target.default };
    }
    return null;
}

/** Display text for an option value ("3:00", "5 kills"). */
export function formatOption(option, value) {
    if (!option) return '';
    if (option.key === 'roundSeconds') return formatClock(value);
    if (option.key === 'target') return `${value} kills`;
    return String(value);
}

/** Next value in a list (wraps both ways); an unknown current value starts at the first. */
export function cycleValue(values, current, dir = 1) {
    if (!Array.isArray(values) || values.length === 0) return current;
    const i = values.indexOf(current);
    if (i === -1) return values[0];
    const n = values.length;
    return values[(((i + (dir < 0 ? -1 : 1)) % n) + n) % n];
}

/** Options for a new round of `mode`: the chosen values or the mode's defaults. */
export function roundOptionsFor(mode, chosen = {}) {
    const opt = modeOption(mode);
    const out = {};
    if (opt) {
        const v = chosen && chosen[opt.key];
        out[opt.key] = opt.values.includes(v) ? v : opt.default;
    }
    return out;
}

// --- Round timer (plan §11) ---

export const TIMER_FLASH_SECONDS = 10;

/**
 * What the centre-top round clock shows.
 * @param {{timeLeft:number|null, phase:string, overtimeLeft:number|null}} round
 * @param {number} [now] - seconds, for the flash (on for the first half of each second)
 * @returns {null | {text:string, label:string|null, flash:boolean, urgent:boolean}}
 *   urgent: the last 10 s (or overtime / sudden death); flash: urgent and in the "on" half
 */
export function roundClock(round, now = 0) {
    if (!round) return null;
    const blink = (Math.floor(now * 2) % 2) === 0;
    if (round.phase === 'overtime') {
        const left = round.overtimeLeft ?? 0;
        return { text: formatClock(left), label: 'OVERTIME', urgent: true, flash: blink };
    }
    if (round.phase === 'suddenDeath') {
        return { text: 'SUDDEN DEATH', label: null, urgent: true, flash: blink };
    }
    if (round.timeLeft === null || round.timeLeft === undefined) return null;
    const urgent = round.timeLeft <= TIMER_FLASH_SECONDS;
    return { text: formatClock(round.timeLeft), label: null, urgent, flash: urgent && blink };
}
