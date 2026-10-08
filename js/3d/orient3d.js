// Screen orientation for the 3D game (docs/plans/07-3d-game.md, Phases 5 and 6): the game is
// played in landscape. Where the browser allows it (Android in full screen or as an installed
// app) the orientation is locked to landscape while a game runs and unlocked when the player
// leaves it; iPhones can't lock, so they get a "turn sideways" hint instead. Reduced motion
// (the system setting) is read here too. DOM-free: the window and document are injected.

import { detectIos } from '../pwa.js';

const mediaMatches = (win, query) => {
    try { return !!(win && typeof win.matchMedia === 'function' && win.matchMedia(query).matches); } catch { return false; }
};

/** Installed app (home screen) or a page in full screen: where Android lets a page lock the orientation. */
export function canLockOrientation(win, doc) {
    const o = win && win.screen && win.screen.orientation;
    if (!o || typeof o.lock !== 'function') return false;
    const fullscreen = !!(doc && (doc.fullscreenElement || doc.webkitFullscreenElement));
    const standalone = mediaMatches(win, '(display-mode: standalone)') || mediaMatches(win, '(display-mode: fullscreen)')
        || !!(win.navigator && win.navigator.standalone === true);
    return fullscreen || standalone;
}

/** The portrait hint's text: iPhones can't lock, so they are asked to turn. */
export function rotateHint(win) {
    return detectIos(win && win.navigator) ? 'Turn your iPhone sideways: the 3D game plays in landscape' : 'Landscape recommended';
}

/** The system's "reduce motion" setting (fewer flashes, no hyperspace tunnel, no pulsing). */
export const prefersReducedMotion = (win) => mediaMatches(win, '(prefers-reduced-motion: reduce)');

/**
 * Landscape lock for the time a game runs.
 * @returns {{ lock(): Promise<boolean>, unlock(): void, readonly locked: boolean }}
 */
export function createOrientationLock({ win, doc }) {
    let locked = false;
    return {
        get locked() { return locked; },
        /** Lock to landscape when allowed; never throws, resolves whether it is locked. */
        lock() {
            if (locked) return Promise.resolve(true);
            if (!canLockOrientation(win, doc)) return Promise.resolve(false);
            try {
                const p = win.screen.orientation.lock('landscape');
                return Promise.resolve(p).then(() => { locked = true; return true; }, () => false);
            } catch {
                return Promise.resolve(false);
            }
        },
        /** Back to the device's own rotation (quit to the menu, Switch to 2D, page hidden). */
        unlock() {
            if (!locked) return;
            locked = false;
            try { win.screen.orientation.unlock(); } catch { /* ignore */ }
        },
    };
}
