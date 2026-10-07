// Haptic feedback through the Vibration API (Android browsers; iOS and desktop lack it).
// DOM-free: navigator, clock, storage and the enabled flag are injected.

export const HAPTICS_KEY = 'spaceAdventure_haptics';

// pattern: ms (number) or [on, off, on, ...]; higher priority may interrupt lower;
// gap: minimum ms between two plays of the same event.
export const HAPTIC_PATTERNS = Object.freeze({
    collect: { pattern: 12, priority: 1, gap: 70 },
    powerUp: { pattern: [20, 40, 20], priority: 2, gap: 150 },
    shieldHit: { pattern: 40, priority: 3, gap: 150 },
    bossWeakPoint: { pattern: 25, priority: 2, gap: 100 },
    hyperspace: { pattern: [15, 30, 40], priority: 2, gap: 0 },
    levelUp: { pattern: [30, 60, 30, 60, 60], priority: 3, gap: 0 },
    lifeLost: { pattern: [120, 60, 200], priority: 4, gap: 0 },
    bossDefeated: { pattern: [60, 40, 60, 40, 220], priority: 4, gap: 0 },
    gameOver: { pattern: [200, 100, 350], priority: 5, gap: 0 },
    threat: { pattern: [10, 50, 10], priority: 2, gap: 1000 }, // 3D: a rock or UFO on a collision course
    enabled: { pattern: 30, priority: 5, gap: 0 }, // confirmation tick when switched on
});

export const HAPTICS_MAX_PER_SECOND = 8;

export function patternDuration(pattern) {
    if (typeof pattern === 'number') return Math.max(0, pattern);
    return pattern.reduce((sum, ms) => sum + Math.max(0, ms), 0);
}

function defaultNow() {
    return typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now();
}

function readStoredEnabled(storage) {
    if (!storage) return null;
    try {
        const raw = storage.getItem(HAPTICS_KEY);
        if (raw === 'true' || raw === '1') return true;
        if (raw === 'false' || raw === '0') return false;
    } catch (e) { /* ignore */ }
    return null;
}

export class Haptics {
    // options:
    //   nav      navigator-like object (default globalThis.navigator)
    //   now      () => ms clock (default performance.now)
    //   enabled  boolean, or a getter () => boolean (e.g. () => settings.get('haptics'))
    //   storage  optional localStorage-like object; setEnabled() persists to HAPTICS_KEY
    constructor({ nav, now = defaultNow, enabled, storage = null } = {}) {
        this.nav = nav !== undefined ? nav : (typeof navigator !== 'undefined' ? navigator : null);
        this.now = now;
        this.storage = storage;
        if (typeof enabled === 'function') {
            this._enabledGetter = enabled;
            this._enabled = true;
        } else {
            this._enabledGetter = null;
            const stored = readStoredEnabled(storage);
            this._enabled = typeof enabled === 'boolean' ? enabled : (stored ?? true);
        }
        this.lastPlayed = new Map(); // event name -> time
        this.recent = []; // timestamps of vibrate() calls within the last second
        this.activeUntil = 0;
        this.activePriority = 0;
        this.stats = { calls: 0, dropped: 0, errors: 0, stops: 0, last: null };
    }

    get supported() {
        return !!this.nav && typeof this.nav.vibrate === 'function';
    }

    get enabled() {
        if (this._enabledGetter) {
            try { return !!this._enabledGetter(); } catch (e) { return false; }
        }
        return this._enabled;
    }

    // Returns false when the user has not interacted with the page yet (Chrome blocks
    // vibrate() then and logs a warning). Browsers without userActivation are assumed OK.
    get hasUserActivation() {
        const ua = this.nav && this.nav.userActivation;
        if (!ua || typeof ua.hasBeenActive !== 'boolean') return true;
        return ua.hasBeenActive;
    }

    setEnabled(on) {
        on = !!on;
        if (!this._enabledGetter) this._enabled = on;
        if (this.storage) {
            try { this.storage.setItem(HAPTICS_KEY, String(on)); } catch (e) { /* ignore */ }
        }
        if (on) this.play('enabled');
        else this.stop();
        return on;
    }

    _vibrate(pattern) {
        try {
            const r = this.nav.vibrate(pattern);
            return r !== false;
        } catch (e) {
            this.stats.errors++;
            return false;
        }
    }

    // Play a named pattern. Returns true if vibrate() was called and accepted.
    play(name) {
        const def = Object.prototype.hasOwnProperty.call(HAPTIC_PATTERNS, name) ? HAPTIC_PATTERNS[name] : null;
        if (!def || !this.supported || !this.enabled || !this.hasUserActivation) return false;
        const t = this.now();

        const last = this.lastPlayed.get(name);
        if (def.gap > 0 && last !== undefined && t - last < def.gap) {
            this.stats.dropped++;
            return false;
        }
        if (t < this.activeUntil && def.priority < this.activePriority) {
            this.stats.dropped++;
            return false;
        }
        this.recent = this.recent.filter(ts => t - ts < 1000);
        if (this.recent.length >= HAPTICS_MAX_PER_SECOND) {
            this.stats.dropped++;
            return false;
        }

        const ok = this._vibrate(def.pattern);
        this.recent.push(t);
        this.lastPlayed.set(name, t);
        if (!ok) return false;
        this.stats.calls++;
        this.stats.last = name;
        this.activeUntil = t + patternDuration(def.pattern);
        this.activePriority = def.priority;
        return true;
    }

    // Cancel any running vibration (pause, tab hidden, game over screen).
    stop() {
        this.activeUntil = 0;
        this.activePriority = 0;
        if (!this.supported || !this.hasUserActivation) return false;
        this.stats.stops++;
        return this._vibrate(0);
    }
}
