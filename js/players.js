/**
 * Player list model for local multiplayer (plan 05 §1.1).
 *
 * Pure module: no DOM, no globals. Side effects that main.js used to do inline
 * (floating texts, sounds) are returned as data so the caller can apply them.
 */
import { wrapDelta } from './utils.js';

/** Seat colours (avoid green, red and purple, which asteroids and UFOs use). */
export const PLAYER_COLOURS = Object.freeze(['#00E5FF', '#FF9F1C', '#FF4FD8', '#FFE14D']);

/** Power-up ids that have a duration (extra_life is instant, so it has no timer). */
export const TIMED_POWER_UPS = Object.freeze([
    'rapid_fire', 'triple_shot', 'shield', 'speed_boost', 'magnet', 'score_multiplier'
]);

export const EXTRA_LIFE_SCORE = 10000;

/**
 * Per-player combo. Same rules as ComboSystem in main.js:
 * multiplier 2x at 5, 3x at 10, 4x at 20; streak bonus of milestone*100 at
 * 5, 10, 15, 25, 50, 100; the combo breaks 3 s after the last collection.
 * Instead of spawning floating texts it returns what happened.
 */
export class Combo {
    constructor() {
        this.maxTime = 3;
        this.streakMilestones = [5, 10, 15, 25, 50, 100];
        this.reset();
    }

    static multiplierFor(count) {
        if (count >= 20) return 4;
        if (count >= 10) return 3;
        if (count >= 5) return 2;
        return 1;
    }

    /** @returns {{streakBonus:number, milestone:number, count:number, multiplier:number}} */
    addCollection() {
        this.count++;
        this.timer = this.maxTime;
        this.multiplier = Combo.multiplierFor(this.count);
        for (const milestone of this.streakMilestones) {
            if (this.count === milestone && milestone > this.lastMilestone) {
                this.lastMilestone = milestone;
                return { streakBonus: milestone * 100, milestone, count: this.count, multiplier: this.multiplier };
            }
        }
        return { streakBonus: 0, milestone: 0, count: this.count, multiplier: this.multiplier };
    }

    /**
     * Break the combo. `lost` is true when main.js would show "Combo Lost!" (count was 5 or more).
     * @returns {{lost:boolean, count:number}}
     */
    break() {
        const count = this.count;
        this.reset();
        return { lost: count >= 5, count };
    }

    /**
     * Advance the timer. Returns the break() result when the combo expires this tick, else null.
     */
    update(dt) {
        if (this.timer > 0) {
            this.timer -= dt;
            if (this.timer <= 0) return this.break();
        }
        return null;
    }

    reset() {
        this.count = 0;
        this.multiplier = 1;
        this.timer = 0;
        this.lastMilestone = 0;
    }
}

function emptyPowerUps() {
    const p = {};
    for (const k of TIMED_POWER_UPS) p[k] = 0;
    return p;
}

function emptyStats() {
    return {
        greens: 0, redsShot: 0, ufos: 0, kills: 0, deaths: 0, shots: 0, hits: 0,
        bestCombo: 0, revivesGiven: 0, greensDenied: 0, creditsEarned: 0
    };
}

/**
 * Create a player record. `upgrades` is an UpgradeState (js/upgrades.js) or null.
 */
export function createPlayer({
    id, slot = 0, name = 'PLAYER', profile = null, colour, bindingId = null, lives = 3, upgrades = null
} = {}) {
    return {
        id: id ?? `p${slot + 1}`,
        slot,
        name,
        profile,
        colour: colour ?? PLAYER_COLOURS[slot % PLAYER_COLOURS.length],
        bindingId,
        input: null,
        ship: null,
        score: 0,
        lives,
        respawnTimer: 0,
        nextExtraLifeScore: EXTRA_LIFE_SCORE,
        combo: new Combo(),
        powerUps: emptyPowerUps(),
        stickHeading: null,
        upgrades,
        out: false,
        beacon: null,
        stats: emptyStats()
    };
}

/**
 * Count down power-up timers in place. Each expiring key is reported exactly once
 * (timers are clamped to 0 and zero timers are skipped).
 * @returns {string[]} keys that expired during this tick
 */
export function tickPowerUps(powerUps, dt) {
    const expired = [];
    for (const key of Object.keys(powerUps)) {
        const t = powerUps[key];
        if (t > 0) {
            const next = t - dt;
            if (next <= 0) {
                powerUps[key] = 0;
                expired.push(key);
            } else {
                powerUps[key] = next;
            }
        }
    }
    return expired;
}

/** A player is living when not out and their ship exists and is alive. */
export function isLiving(p) {
    return !!p && !p.out && !!p.ship && p.ship.isAlive !== false;
}

export function livingPlayers(players) {
    return players.filter(isLiving);
}

/**
 * Nearest living ship to (x, y) using wrap-aware distance in a W x H world.
 * Ships that are not invulnerable are preferred; an invulnerable ship is returned
 * only when every living ship is invulnerable.
 * @returns {object|null} the ship
 */
export function nearestLivingShip(x, y, players, W, H) {
    let best = null, bestD = Infinity, bestInv = true;
    for (const p of players) {
        if (!isLiving(p)) continue;
        const s = p.ship;
        const dx = wrapDelta(s.x - x, W);
        const dy = wrapDelta(s.y - y, H);
        const d = dx * dx + dy * dy;
        const inv = !!s.isInvulnerable;
        if ((bestInv && !inv) || (inv === bestInv && d < bestD)) {
            best = s; bestD = d; bestInv = inv;
        }
    }
    return best;
}

export function teamScore(players) {
    return players.reduce((sum, p) => sum + (p.score || 0), 0);
}

/** True when there is at least one player and every player is out. */
export function allOut(players) {
    return players.length > 0 && players.every(p => p.out);
}
