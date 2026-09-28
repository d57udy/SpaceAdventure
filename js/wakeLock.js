// Screen Wake Lock: keep the screen on while a game runs (controller or keyboard play on a
// tablet or phone sends no touches, so the screen would dim and lock mid-round).
//
// sync(wanted) is called every frame with "the game is running" (playing, lobby, round
// intro). The lock is requested once when wanted, released when not (pause, menus). The
// browser drops the lock whenever the page is hidden; on visibilitychange back to visible it
// is requested again while still wanted. Feature-detected; every call is guarded, so a
// missing API, a rejected request (low battery, no permission) or a throwing release never
// breaks the game.

/**
 * @param {object} [o]
 * @param {Navigator|object} [o.navigator]
 * @param {Document|object} [o.document] - visibilityState + addEventListener('visibilitychange')
 * @returns {{sync: (wanted: boolean) => void, snapshot: () => object}}
 */
export function createWakeLock({ navigator: nav = globalThis.navigator, document: doc = globalThis.document } = {}) {
    let supported = false;
    try {
        supported = !!(nav && nav.wakeLock && typeof nav.wakeLock.request === 'function');
    } catch { supported = false; }

    const st = { wanted: false, held: false, requests: 0, releases: 0, errors: 0 };
    let sentinel = null;
    let pending = false; // a request is in flight
    let failed = false; // the last request failed: retry on the next start or return to the page

    const visible = () => {
        try { return !doc || doc.visibilityState === undefined || doc.visibilityState === 'visible'; } catch { return true; }
    };

    function release() {
        const s = sentinel;
        sentinel = null;
        st.held = false;
        if (!s) return;
        st.releases++;
        try {
            const p = s.release();
            if (p && typeof p.catch === 'function') p.catch(() => { st.errors++; });
        } catch { st.errors++; }
    }

    function request() {
        if (!supported || pending || failed || sentinel || !st.wanted || !visible()) return;
        pending = true;
        st.requests++;
        let p;
        try {
            p = nav.wakeLock.request('screen');
        } catch {
            pending = false;
            failed = true;
            st.errors++;
            return;
        }
        Promise.resolve(p).then((s) => {
            pending = false;
            if (!s) return;
            if (!st.wanted) { // no longer wanted while the request was pending
                sentinel = s;
                release();
                return;
            }
            sentinel = s;
            st.held = true;
            try {
                if (typeof s.addEventListener === 'function') {
                    // The browser releases it by itself when the page is hidden
                    s.addEventListener('release', () => {
                        if (sentinel === s) { sentinel = null; st.held = false; }
                    });
                }
            } catch { /* ignore */ }
        }, () => {
            pending = false;
            failed = true;
            st.errors++;
        });
    }

    if (supported && doc && typeof doc.addEventListener === 'function') {
        try {
            doc.addEventListener('visibilitychange', () => {
                if (visible()) { failed = false; request(); }
                else if (sentinel) { sentinel = null; st.held = false; } // released by the browser
            });
        } catch { /* ignore */ }
    }

    function sync(wanted) {
        if (!!wanted && !st.wanted) failed = false; // a new start retries
        st.wanted = !!wanted;
        if (!supported) return;
        if (st.wanted) request();
        else release();
    }

    return { sync, snapshot: () => ({ ...st, supported }) };
}
