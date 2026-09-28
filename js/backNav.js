// Android back button / browser Back (history API).
//
// Without this, Back in the installed app (display: fullscreen) closes the app from any
// screen, and in a browser tab it leaves the page; a paused run lives only in memory.
//
// While the game is anywhere but the main menu (or the first-visit name prompt) one extra
// history entry, the "guard", sits on top of the page's own entry. Same URL, so the address
// bar, service worker scope and update reload are untouched: only history.state marks it.
// Back pops the guard (a popstate, no page load) and the game treats it like Escape:
//   playing          -> pause
//   paused           -> stay paused (Resume is a deliberate tap or key)
//   tutorial question, Game Over -> main menu
//   sub-screens      -> their own Back (Settings, Help, lobby, ...)
// and the guard is pushed again while the game still is off the main menu. Returning to the
// main menu with the game's own buttons removes the guard (history.back()), so from the menu
// one Back leaves the app as users expect.
//
// Pure pieces (wantsGuard, backAction) are unit-tested; createBackNav takes the window
// objects it uses so tests can pass fakes.

export const GUARD_KEY = 'spaceAdventureBack';

// String values of GameState in main.js
const ROOT_STATES = new Set(['menu', 'prompt_user']);
// Screens where Back does nothing (the moment passes by itself or needs a choice)
const IGNORE_STATES = new Set(['paused', 'round_end']);
// Screens whose Escape does something else (the tutorial question's Escape = "Skip" starts
// a game; Game Over has no Escape): Back returns to the main menu
const MENU_STATES = new Set(['tutorial_ask', 'game_over']);

/**
 * Should a guard entry be on the history stack in this state?
 * @param {string} state - GameState value
 * @param {{resetConfirm?: boolean}} [flags] - the menu's "Reset progress?" dialog is open
 */
export function wantsGuard(state, flags = {}) {
    if (state === 'menu') return !!flags.resetConfirm;
    return !ROOT_STATES.has(state);
}

/**
 * What Back means in a state: 'pause' | 'escape' (the screen's own Escape) | 'menu' | 'none' |
 * 'leave'.
 * 'leave' = the browser already left the guard and nothing needs doing (main menu).
 * @param {string} state
 * @param {{resetConfirm?: boolean}} [flags]
 */
export function backAction(state, flags = {}) {
    if (!wantsGuard(state, flags)) return 'leave';
    if (state === 'playing') return 'pause';
    if (IGNORE_STATES.has(state)) return 'none';
    if (MENU_STATES.has(state)) return 'menu';
    return 'escape';
}

/** True when a history state object is this game's guard entry. */
export function isGuardState(s) {
    return !!s && typeof s === 'object' && s[GUARD_KEY] === true;
}

/**
 * The history controller.
 * @param {object} o
 * @param {History} o.history
 * @param {() => string} o.getUrl - current URL (location.href), reused for pushState
 * @param {(type: string, fn: Function) => void} o.listen - window.addEventListener
 * @param {() => {state: string, resetConfirm?: boolean}} o.getContext
 * @param {(action: string) => void} o.onBack - 'pause' | 'escape' | 'menu'
 * @param {() => number} [o.now]
 * @returns {{sync: () => void, snapshot: () => object}}
 */
export function createBackNav({ history, getUrl, listen, getContext, onBack, now = () => Date.now() }) {
    const st = { guarded: false, pendingBack: 0, pushes: 0, backs: 0, pops: 0, lastAction: null };
    const PENDING_TIMEOUT_MS = 1500;
    if (!history || typeof history.pushState !== 'function') {
        return { sync() {}, snapshot: () => ({ ...st, supported: false }) };
    }

    // A reload (e.g. the PWA update) keeps history.state: a guard from the previous page load
    // is not ours to pop (going back into another document's entry would load the page again),
    // so forget it and start clean.
    try {
        if (isGuardState(history.state)) history.replaceState(null, '', getUrl());
    } catch { /* ignore */ }

    const safe = (fn) => { try { fn(); } catch { /* history can throw (e.g. too many calls) */ } };

    listen('popstate', (e) => {
        st.pops++;
        if (st.pendingBack) {
            // Our own history.back() (returned to the menu): nothing to do
            st.pendingBack = 0;
            st.guarded = isGuardState(e && e.state);
            return;
        }
        st.guarded = isGuardState(e && e.state);
        const ctx = getContext();
        const action = backAction(ctx.state, ctx);
        st.lastAction = action;
        if (action === 'pause' || action === 'escape' || action === 'menu') onBack(action);
        // The next sync() pushes the guard again while it is still wanted
    });

    function sync() {
        if (st.pendingBack && now() - st.pendingBack > PENDING_TIMEOUT_MS) st.pendingBack = 0;
        if (st.pendingBack) return; // wait for our back() to land before pushing again
        const ctx = getContext();
        const want = wantsGuard(ctx.state, ctx);
        if (want && !st.guarded) {
            safe(() => {
                history.pushState({ [GUARD_KEY]: true }, '', getUrl());
                st.guarded = true;
                st.pushes++;
            });
        } else if (!want && st.guarded) {
            safe(() => {
                st.pendingBack = now() || 1;
                st.guarded = false;
                st.backs++;
                history.back();
            });
        }
    }

    return { sync, snapshot: () => ({ ...st, supported: true }) };
}
