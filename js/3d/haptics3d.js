// Vibration and controller rumble for 3D events (docs/plans/07-3d-game.md Phase 5), through
// the 2D modules: js/haptics.js (Vibration API, patterns, priorities, rate limit) and
// js/gamepad.js (dual-rumble). The shared settings apply: Vibration ('haptics') and
// Controller rumble ('rumble'). Rumble only goes to a controller the player is using.
// DOM-free: the Haptics instance, the gamepad poller and the settings are injected.

/** 3D event -> { haptic: HAPTIC_PATTERNS name, rumble: RUMBLE_PATTERNS name } (null = none). */
export const HAPTIC3D = Object.freeze({
    collect: Object.freeze({ haptic: 'collect', rumble: 'collect' }),
    hit: Object.freeze({ haptic: 'lifeLost', rumble: 'death' }),          // a life lost
    shieldHit: Object.freeze({ haptic: 'shieldHit', rumble: 'shieldHit' }),
    threat: Object.freeze({ haptic: 'threat', rumble: 'threat' }),
    rockDestroyed: Object.freeze({ haptic: null, rumble: 'redDestroyed' }),
    powerUp: Object.freeze({ haptic: 'powerUp', rumble: 'collect' }),
    hyperspace: Object.freeze({ haptic: 'hyperspace', rumble: null }),
    levelUp: Object.freeze({ haptic: 'levelUp', rumble: null }),
    bossWeakPoint: Object.freeze({ haptic: 'bossWeakPoint', rumble: 'bossHit' }),
    bossDefeated: Object.freeze({ haptic: 'bossDefeated', rumble: 'bossDefeated' }),
    gameOver: Object.freeze({ haptic: 'gameOver', rumble: 'death' }),
});

/**
 * @param {object} o
 * @param {object} [o.haptics] - a js/haptics.js Haptics (its enabled getter reads the setting)
 * @param {object} [o.gamepad] - a js/gamepad.js GamepadPoller (rumbleEvent(name, padIndex))
 * @param {object} [o.settings] - js/settings.js ('rumble')
 * @param {() => boolean} [o.usingController] - the player's last input was a controller
 */
export function createHaptics3d({ haptics = null, gamepad = null, settings = null, usingController = () => false } = {}) {
    const stats = { vibrations: 0, rumbles: 0, last: null };
    const safe = (fn) => { try { return fn(); } catch (e) { return false; } };
    const rumbleOn = () => !!(settings ? safe(() => settings.get('rumble')) : true);

    return {
        stats,
        /** Play a 3D event. Returns { vibrated, rumbled }. */
        event(name) {
            const def = HAPTIC3D[name];
            if (!def) return { vibrated: false, rumbled: false };
            const vibrated = !!(def.haptic && haptics && safe(() => haptics.play(def.haptic)));
            const rumbled = !!(def.rumble && gamepad && rumbleOn() && safe(() => usingController())
                && safe(() => gamepad.rumbleEvent(def.rumble, null)));
            if (vibrated) stats.vibrations++;
            if (rumbled) stats.rumbles++;
            if (vibrated || rumbled) stats.last = name;
            return { vibrated, rumbled };
        },
        /** Pause, page hidden, game over screen: cancel a running vibration. */
        stop() {
            if (haptics) safe(() => haptics.stop());
        },
    };
}

/** The real one for the 3D page: a Haptics on navigator.vibrate following the setting. */
export async function createBrowserHaptics3d({ settings, gamepad = null, usingController } = {}) {
    const { Haptics } = await import('../haptics.js');
    const haptics = new Haptics({ enabled: () => !!(settings && settings.get('haptics')) });
    return createHaptics3d({ haptics, gamepad, settings, usingController });
}
