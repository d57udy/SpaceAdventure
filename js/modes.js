/**
 * Game mode layer for local multiplayer (plan 05 §4).
 *
 * Pure module: each mode is a config object plus pure hooks that return
 * decisions over plain data. main.js applies the effects.
 *
 * Round data (`round`) used by the hooks is a plain object owned by main.js:
 *   { elapsed, timeLeft /* s, null when untimed *\/, phase: 'normal' | 'overtime' | 'suddenDeath',
 *     overtimeLeft, overtimeWinner /* player id or null *\/, difficulty: 'easy'|'medium'|'hard',
 *     target /* chosen win target, overrides the mode default *\/ }
 * Players are records from js/players.js (score, lives, out, stats.kills, id, ship).
 *
 * checkEnd(round, players) returns null while the round goes on, or
 *   { ended: true, outcome: 'gameOver' | 'win' | 'draw', winners: [ids] }
 *   { ended: false, startPhase: 'overtime' | 'suddenDeath', duration }  (tie at time up)
 */
import { wrapDelta } from './utils.js';

const ALL_POWER_UPS = ['rapid_fire', 'triple_shot', 'shield', 'speed_boost', 'magnet', 'extra_life', 'score_multiplier'];

/** Today's single-player numbers (main.js). */
export const SOLO_BASE = Object.freeze({
    baseAsteroids: 10,        // BASE_ASTEROIDS_PER_LEVEL
    asteroidsPerLevel: 3,     // ASTEROIDS_PER_LEVEL_INCREASE
    ufoMaxActive: 1,          // UFO.MaxActiveUFOs
    powerUpInterval: 20,      // POWERUP_SPAWN_INTERVAL
    ufoBaseInterval: 15       // UFO_SPAWN_BASE_INTERVAL
});

export const REVIVE = Object.freeze({
    radius: 70,             // px, reviver must be this close to the beacon
    time: 2,                // s to fill the bar
    drainRate: 2,           // bar drains this many times faster when out of range
    minReviverLives: 2,     // reviver needs at least this many lives
    cost: 1,                // lives the reviver pays
    revivedLives: 1,
    invulnerability: 3      // s for the revived player
});

const aliveOrLives = p => !p.out;
const ids = list => list.map(p => p.id);
const allOutOf = players => players.length > 0 && players.every(p => p.out);

function leaders(players, valueOf) {
    let best = -Infinity, out = [];
    for (const p of players) {
        const v = valueOf(p);
        if (v > best) { best = v; out = [p]; } else if (v === best) out.push(p);
    }
    return out;
}

function timeUp(round) {
    return round.timeLeft !== null && round.timeLeft !== undefined && round.timeLeft <= 0;
}

const noop = () => null;
const defaultHooks = {
    onStart: noop,
    onCollectGreen: () => ({ points: true }),
    onShootGreen: () => ({ denied: false }),
    onKill: (round, killer, victim) => (killer && victim && killer.id !== victim.id ? { credit: killer.id } : null),
    onDeath: noop,
    onTick: noop,
    checkEnd: (round, players) => (allOutOf(players) ? { ended: true, outcome: 'gameOver', winners: [] } : null)
};

/** Next player index in Take Turns who still has lives (starting after `current`), or -1. */
export function nextTurnIndex(players, current) {
    const n = players.length;
    for (let k = 1; k <= n; k++) {
        const i = (current + k) % n;
        if (!players[i].out && players[i].lives > 0) return i;
    }
    return -1;
}

const soloScaling = (n, level) => ({
    asteroidCount: SOLO_BASE.baseAsteroids + (level - 1) * SOLO_BASE.asteroidsPerLevel,
    bossHpMult: 1,
    bossAttackMult: 1,
    ufoIntervalMult: 1,
    ufoMaxActive: SOLO_BASE.ufoMaxActive,
    powerUpInterval: SOLO_BASE.powerUpInterval
});

/**
 * Co-op scaling. For 2 players (plan §4.2): 1.5x asteroids, boss HP 1.6x, boss attacks
 * 1.25x faster, UFOs 1.5x as often (interval x 1/1.5), up to 2 UFOs, power-ups every 16 s.
 * Extrapolated linearly per extra player for 3-4; n = 1 equals solo.
 */
const coopScaling = (n, level) => {
    const extra = Math.max(0, n - 1);
    const base = soloScaling(1, level);
    return {
        asteroidCount: Math.round(base.asteroidCount * (1 + 0.5 * extra)),
        bossHpMult: 1 + 0.6 * extra,
        bossAttackMult: 1 + 0.25 * extra,
        ufoIntervalMult: 1 / (1 + 0.5 * extra),
        ufoMaxActive: Math.max(1, Math.min(n, 4)),
        powerUpInterval: Math.max(10, SOLO_BASE.powerUpInterval - 4 * extra)
    };
};

export const MODES = {
    solo: {
        id: 'solo', name: 'Single Player', kind: 'solo',
        players: { min: 1, max: 1 },
        lives: { type: 'perPlayer', count: null /* from difficulty, as today */ },
        friendlyFire: false, shipBump: false, timer: null,
        winCondition: 'survive', target: null,
        upgradesApply: 'own', ddaEnabled: true, levelProgression: true, bosses: true,
        field: null,
        ufos: { enabled: true, interval: null /* today's formula */ },
        powerUps: { interval: 20, types: ALL_POWER_UPS },
        respawn: { placement: 'worldCentre', delay: 2, invulnerability: null /* ship default */, cancelOnFire: false },
        scaling: soloScaling,
        earnsCredits: true, earnsAchievements: true, leaderboard: 'highScores',
        hooks: { ...defaultHooks }
    },

    turns: {
        id: 'turns', name: 'Take Turns', kind: 'turns',
        players: { min: 2, max: 4 },
        lives: { type: 'perPlayer', count: null },
        friendlyFire: false, shipBump: false, timer: null,
        winCondition: 'highestScore', target: null,
        upgradesApply: 'own', ddaEnabled: true, levelProgression: true, bosses: true,
        field: null,
        ufos: { enabled: true, interval: null },
        powerUps: { interval: 20, types: ALL_POWER_UPS },
        respawn: { placement: 'worldCentre', delay: 2, invulnerability: null, cancelOnFire: false },
        scaling: soloScaling, // each player plays a single-player world
        earnsCredits: true, earnsAchievements: true, leaderboard: 'highScores',
        hooks: {
            ...defaultHooks,
            /** After `player` loses a life: hand over when someone else can play. */
            onDeath(round, player, players) {
                const idx = players.indexOf(player);
                const next = nextTurnIndex(players, idx);
                if (next === -1) return { turnChange: false };
                return { turnChange: next !== idx, nextIndex: next, minDelay: 1 };
            },
            checkEnd(round, players) {
                if (!allOutOf(players)) return null;
                return { ended: true, outcome: 'win', winners: ids(leaders(players, p => p.score)) };
            }
        }
    },

    coop: {
        id: 'coop', name: 'Co-op "Wingmen"', kind: 'coop',
        players: { min: 2, max: 4 },
        lives: { type: 'perPlayer', count: null },
        friendlyFire: false, shipBump: false, timer: null,
        winCondition: 'survive', target: null,
        upgradesApply: 'own', ddaEnabled: true, levelProgression: true, bosses: true,
        field: null,
        ufos: { enabled: true, interval: null },
        powerUps: { interval: 16, types: ALL_POWER_UPS },
        respawn: { placement: 'nearTeam', delay: 2, invulnerability: null, cancelOnFire: false },
        scaling: coopScaling,
        earnsCredits: true, earnsAchievements: true, leaderboard: 'coop',
        revive: REVIVE,
        hooks: {
            ...defaultHooks,
            onDeath(round, player) {
                return player.lives <= 0 ? { out: true, beacon: true } : { out: false };
            },
            checkEnd(round, players) {
                return allOutOf(players) ? { ended: true, outcome: 'gameOver', winners: ids(players) } : null;
            }
        }
    },

    harvest: {
        id: 'harvest', name: 'Harvest Race', kind: 'versus',
        players: { min: 2, max: 2 },
        lives: { type: 'unlimited', count: null },
        friendlyFire: false, shipBump: true,
        timer: { default: 180, options: [120, 180, 300], overtime: 20 },
        winCondition: 'highestScore', target: null,
        upgradesApply: 'none', ddaEnabled: false, levelProgression: false, bosses: false,
        field: { greens: 12, reds: 6, refillInterval: 1, minSpawnDistance: 250, fadeIn: 0.5 },
        ufos: { enabled: true, interval: 30 },
        powerUps: { interval: 12, types: ['shield', 'speed_boost', 'magnet', 'score_multiplier', 'triple_shot'] },
        respawn: { placement: 'furthestFromOpponents', delay: 3, invulnerability: 2, cancelOnFire: false, comboLost: true },
        scaling: () => ({
            asteroidCount: 18, bossHpMult: 1, bossAttackMult: 1,
            ufoIntervalMult: 30 / SOLO_BASE.ufoBaseInterval, ufoInterval: 30, ufoMaxActive: 1, powerUpInterval: 12
        }),
        earnsCredits: false, earnsAchievements: false, leaderboard: 'harvest',
        hooks: {
            ...defaultHooks,
            onCollectGreen(round, player) {
                if (round.phase === 'overtime') return { points: true, endRound: true, winner: player.id };
                return { points: true };
            },
            onShootGreen: () => ({ denied: true }),
            checkEnd(round, players) {
                if (round.phase === 'overtime') {
                    if (round.overtimeWinner) return { ended: true, outcome: 'win', winners: [round.overtimeWinner] };
                    if (round.overtimeLeft <= 0) return { ended: true, outcome: 'draw', winners: [] };
                    return null;
                }
                if (!timeUp(round)) return null;
                const top = leaders(players, p => p.score);
                if (top.length === 1) return { ended: true, outcome: 'win', winners: ids(top) };
                return { ended: false, startPhase: 'overtime', duration: 20 };
            }
        }
    },

    duel: {
        id: 'duel', name: 'Duel', kind: 'versus',
        players: { min: 2, max: 4 },
        lives: { type: 'unlimited', count: null },
        friendlyFire: true, shipBump: true,
        timer: { default: 240, options: [240] },
        winCondition: 'kills', target: { default: 5, options: [3, 5, 7, 10] },
        upgradesApply: 'none', ddaEnabled: false, levelProgression: false, bosses: false,
        field: { greens: 4, reds: 5, redSize: 'large', refillInterval: 1, minSpawnDistance: 250, fadeIn: 0.5 },
        ufos: { enabled: false, interval: null },
        powerUps: { interval: 15, types: ['rapid_fire', 'triple_shot', 'shield', 'speed_boost'] },
        respawn: { placement: 'furthestFromOpponents', delay: 2, invulnerability: 2, cancelOnFire: true },
        oneHitKill: true,
        scaling: () => ({
            asteroidCount: 9, bossHpMult: 1, bossAttackMult: 1,
            ufoIntervalMult: 1, ufoMaxActive: 0, powerUpInterval: 15
        }),
        earnsCredits: false, earnsAchievements: false, leaderboard: null,
        hooks: {
            ...defaultHooks,
            /** A green gives 4 s of shield, stacking to 8 s; no points. */
            onCollectGreen: () => ({ points: false, shieldSeconds: 4, shieldCap: 8 }),
            checkEnd(round, players) {
                const target = round.target ?? 5;
                const top = leaders(players, p => p.stats.kills);
                const best = top.length ? top[0].stats.kills : 0;
                if (best >= target && top.length === 1) return { ended: true, outcome: 'win', winners: ids(top) };
                if (round.phase === 'suddenDeath') {
                    return top.length === 1 ? { ended: true, outcome: 'win', winners: ids(top) } : null;
                }
                if (!timeUp(round)) return null;
                if (top.length === 1) return { ended: true, outcome: 'win', winners: ids(top) };
                return { ended: false, startPhase: 'suddenDeath', duration: null };
            }
        }
    },

    saucer: {
        id: 'saucer', name: 'Saucer', kind: 'versus',
        players: { min: 2, max: 2 },
        lives: { type: 'perPlayer', count: 3 },
        friendlyFire: false, shipBump: false,
        timer: { default: 150, options: [150] },
        winCondition: 'targetScore', target: { easy: 1800, medium: 2500, hard: 3500 },
        upgradesApply: 'none', ddaEnabled: false, levelProgression: true, bosses: false,
        field: null,
        ufos: { enabled: false, interval: null },
        powerUps: { interval: 20, types: ALL_POWER_UPS },
        respawn: { placement: 'worldCentre', delay: 2, invulnerability: null, cancelOnFire: false },
        saucer: { speed: 150, fireCooldown: 1, aimAssistDeg: 30, respawnDelay: 4, killPoints: 200 },
        scaling: (n, level) => ({ ...soloScaling(1, level), ufoMaxActive: 0 }),
        earnsCredits: false, earnsAchievements: false, leaderboard: null,
        hooks: {
            ...defaultHooks,
            /** players[0] flies the ship, players[1] is the saucer. */
            checkEnd(round, players) {
                const [pilot, saucer] = players;
                const target = typeof round.target === 'number'
                    ? round.target
                    : MODES.saucer.target[round.difficulty || 'medium'];
                if (pilot.score >= target) return { ended: true, outcome: 'win', winners: [pilot.id] };
                if (pilot.out || timeUp(round)) return { ended: true, outcome: 'win', winners: saucer ? [saucer.id] : [] };
                return null;
            }
        }
    },

    timeattack: {
        id: 'timeattack', name: 'Time Attack vs Ghost', kind: 'solo',
        players: { min: 1, max: 1 },
        lives: { type: 'perPlayer', count: 3 },
        friendlyFire: false, shipBump: false,
        timer: { default: 180, options: [180] },
        winCondition: 'highestScore', target: null,
        upgradesApply: 'none', ddaEnabled: false, levelProgression: true, bosses: true,
        field: null,
        ufos: { enabled: true, interval: null },
        powerUps: { interval: 20, types: ALL_POWER_UPS },
        respawn: { placement: 'worldCentre', delay: 2, invulnerability: null, cancelOnFire: false },
        courses: { min: 1, max: 10 },
        seeded: true,
        scaling: soloScaling,
        earnsCredits: false, earnsAchievements: false, leaderboard: 'ghost',
        hooks: {
            ...defaultHooks,
            checkEnd(round, players) {
                if (allOutOf(players) || timeUp(round)) {
                    return { ended: true, outcome: 'gameOver', winners: [] };
                }
                return null;
            }
        }
    }
};

const HOOK_NAMES = ['onStart', 'onCollectGreen', 'onShootGreen', 'onKill', 'onDeath', 'onTick', 'checkEnd'];
const REQUIRED_KEYS = ['id', 'name', 'kind', 'players', 'lives', 'friendlyFire', 'shipBump', 'timer',
    'winCondition', 'target', 'upgradesApply', 'ddaEnabled', 'levelProgression', 'bosses', 'field', 'ufos',
    'powerUps', 'respawn', 'scaling', 'earnsCredits', 'earnsAchievements', 'leaderboard', 'hooks'];
const PLACEMENTS = ['worldCentre', 'nearTeam', 'furthestFromOpponents'];
const SCALING_KEYS = ['asteroidCount', 'bossHpMult', 'bossAttackMult', 'ufoIntervalMult', 'ufoMaxActive', 'powerUpInterval'];

/**
 * Schema check for a mode config.
 * @returns {string[]} problems (empty when valid)
 */
export function validateMode(mode) {
    const errs = [];
    if (!mode || typeof mode !== 'object') return ['mode is not an object'];
    for (const k of REQUIRED_KEYS) if (!(k in mode)) errs.push(`missing ${k}`);
    if (typeof mode.id !== 'string' || !mode.id) errs.push('id must be a non-empty string');
    if (!['solo', 'turns', 'coop', 'versus'].includes(mode.kind)) errs.push(`bad kind ${mode.kind}`);
    const pl = mode.players || {};
    if (!(Number.isInteger(pl.min) && Number.isInteger(pl.max) && pl.min >= 1 && pl.max <= 4 && pl.min <= pl.max)) {
        errs.push('players must be integers with 1 <= min <= max <= 4');
    }
    if (!mode.lives || !['perPlayer', 'unlimited'].includes(mode.lives.type)) errs.push('lives.type invalid');
    for (const k of ['friendlyFire', 'shipBump', 'ddaEnabled', 'levelProgression', 'bosses', 'earnsCredits', 'earnsAchievements']) {
        if (typeof mode[k] !== 'boolean') errs.push(`${k} must be boolean`);
    }
    if (!['own', 'none'].includes(mode.upgradesApply)) errs.push('upgradesApply must be own or none');
    if (mode.timer !== null && !(mode.timer && mode.timer.default > 0)) errs.push('timer must be null or have default > 0');
    if (!mode.levelProgression && !mode.field) errs.push('modes without levels need field refill settings');
    if (!mode.ufos || typeof mode.ufos.enabled !== 'boolean') errs.push('ufos.enabled must be boolean');
    if (!mode.powerUps || !(mode.powerUps.interval > 0) || !Array.isArray(mode.powerUps.types)) errs.push('powerUps invalid');
    if (!mode.respawn || !PLACEMENTS.includes(mode.respawn.placement)) errs.push('respawn.placement invalid');
    if (mode.earnsCredits && mode.upgradesApply !== 'own') errs.push('credits only in modes where own upgrades apply');
    if (typeof mode.scaling !== 'function') errs.push('scaling must be a function');
    else {
        const s = mode.scaling(pl.max || 1, 1);
        for (const k of SCALING_KEYS) if (!(typeof s[k] === 'number' && Number.isFinite(s[k]))) errs.push(`scaling.${k} not a number`);
    }
    if (!mode.hooks) errs.push('hooks missing');
    else for (const h of HOOK_NAMES) if (typeof mode.hooks[h] !== 'function') errs.push(`hooks.${h} must be a function`);
    return errs;
}

export function getMode(id) {
    return MODES[id] || null;
}

/**
 * Per-mode numbers for n players at a level.
 * @returns {{asteroidCount, bossHpMult, bossAttackMult, ufoIntervalMult, ufoMaxActive, powerUpInterval}}
 *   bossAttackMult is a speed factor (divide the attack cooldown by it);
 *   ufoIntervalMult multiplies the UFO spawn interval.
 */
export function scaleForPlayers(mode, n, level) {
    const m = typeof mode === 'string' ? MODES[mode] : mode;
    if (!m) throw new Error(`unknown mode ${mode}`);
    return m.scaling(n, level);
}

/**
 * Pick a respawn point from `grid` (array of {x, y}).
 * Candidates at least `safeRadius` clear of every hazard ({x, y, radius?}) are preferred;
 * among those the one furthest (wrap-aware) from the nearest opponent ({x, y}) wins,
 * ties broken by hazard clearance. Without opponents the clearest point wins. If no
 * candidate is safe, the one with the most hazard clearance is used.
 */
export function pickSpawnPoint(grid, opponents, hazards, W, H, { safeRadius = 150 } = {}) {
    if (!grid || !grid.length) return null;
    const dist = (a, b) => Math.hypot(wrapDelta(a.x - b.x, W), wrapDelta(a.y - b.y, H));
    const scored = grid.map(pt => {
        let clearance = Infinity;
        for (const h of hazards || []) clearance = Math.min(clearance, dist(pt, h) - (h.radius || 0));
        let oppDist = Infinity;
        for (const o of opponents || []) oppDist = Math.min(oppDist, dist(pt, o));
        return { pt, clearance, oppDist };
    });
    const safe = scored.filter(s => s.clearance >= safeRadius);
    const hasOpp = opponents && opponents.length > 0;
    let pool = safe.length ? safe : scored;
    const better = (a, b) => {
        if (safe.length && hasOpp) {
            if (a.oppDist !== b.oppDist) return a.oppDist > b.oppDist;
            return a.clearance > b.clearance;
        }
        return a.clearance > b.clearance;
    };
    let best = pool[0];
    for (const s of pool) if (better(s, best)) best = s;
    return best.pt;
}

/** `count` points on a circle of `radius` around (cx, cy), wrapped into the world (nearTeam). */
export function ringSpawnGrid(cx, cy, radius, W, H, count = 8) {
    const pts = [];
    for (let i = 0; i < count; i++) {
        const a = (i / count) * Math.PI * 2;
        pts.push({ x: ((cx + Math.cos(a) * radius) % W + W) % W, y: ((cy + Math.sin(a) * radius) % H + H) % H });
    }
    return pts;
}

/** Evenly spaced cols x rows grid of cell centres over the world (furthestFromOpponents). */
export function worldSpawnGrid(W, H, cols = 4, rows = 4) {
    const pts = [];
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
        pts.push({ x: (c + 0.5) * W / cols, y: (r + 0.5) * H / rows });
    }
    return pts;
}

/**
 * Co-op revive bar (plan §4.2). Pure: returns a new state.
 * Fills while the reviver is in range and has at least 2 lives; drains twice as
 * fast otherwise; completes at 2 s (progress resets, caller applies costs).
 * @param {{progress:number}} state
 * @returns {{progress:number, completed:boolean, blocked:boolean}}
 *   blocked: in range but the reviver has too few lives.
 */
export function updateRevive(state, dt, inRange, reviverLives) {
    const progress = state && state.progress > 0 ? state.progress : 0;
    const canRevive = reviverLives >= REVIVE.minReviverLives;
    if (inRange && canRevive) {
        const next = progress + dt;
        if (next >= REVIVE.time) return { progress: 0, completed: true, blocked: false };
        return { progress: next, completed: false, blocked: false };
    }
    return {
        progress: Math.max(0, progress - dt * REVIVE.drainRate),
        completed: false,
        blocked: !!inRange && !canRevive
    };
}
