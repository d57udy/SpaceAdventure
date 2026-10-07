// Game controller support (Gamepad API). DOM-free: getGamepads and the clock are injected.
// The poller reports every controller separately (needed for local multiplayer);
// mergePads() folds them into one result for single-player.

// Standard mapping button indices (by position, not label).
export const GP = Object.freeze({
    A: 0, B: 1, X: 2, Y: 3,
    LB: 4, RB: 5, LT: 6, RT: 7,
    VIEW: 8, MENU: 9, LS: 10, RS: 11,
    UP: 12, DOWN: 13, LEFT: 14, RIGHT: 15,
    HOME: 16,
});

export const STICK_DEADZONE = 0.15;
export const TRIGGER_THRESHOLD = 0.35;
export const BUTTON_THRESHOLD = 0.5;
export const MENU_STICK_ON = 0.6;
export const MENU_STICK_OFF = 0.4;
export const MENU_REPEAT_DELAY = 400;
export const MENU_REPEAT_INTERVAL = 140;

// Actions that auto-repeat while held (menus only).
export const REPEAT_ACTIONS = Object.freeze(['menuUp', 'menuDown', 'menuLeft', 'menuRight']);

// Context -> action -> sources. A source is a button index or 'stick:<dir>'.
export const CONTEXT_MAPPINGS = Object.freeze({
    game: Object.freeze({
        fire: [GP.A, GP.RT],
        thrust: [GP.LT, GP.UP],
        rotateLeft: [GP.LEFT],
        rotateRight: [GP.RIGHT],
        hyperspace: [GP.B, GP.DOWN],
        pause: [GP.MENU],
        skipTutorial: [GP.VIEW],
    }),
    menu: Object.freeze({
        menuUp: [GP.UP, 'stick:up'],
        menuDown: [GP.DOWN, 'stick:down'],
        menuLeft: [GP.LEFT, 'stick:left'],
        menuRight: [GP.RIGHT, 'stick:right'],
        menuSelect: [GP.A, GP.MENU],
        escape: [GP.B],
        replayTutorial: [GP.Y],
        toggleMute: [GP.VIEW],
    }),
    // Pause menu: like menu, but Start resumes (pause toggles) instead of selecting.
    pause: Object.freeze({
        menuUp: [GP.UP, 'stick:up'],
        menuDown: [GP.DOWN, 'stick:down'],
        menuLeft: [GP.LEFT, 'stick:left'],
        menuRight: [GP.RIGHT, 'stick:right'],
        menuSelect: [GP.A],
        escape: [GP.B],
        pause: [GP.MENU],
        toggleMute: [GP.VIEW],
    }),
});

// Rumble strengths per game event (strong motor, weak motor, duration ms).
export const RUMBLE_PATTERNS = Object.freeze({
    death: { strong: 0.8, weak: 0.3, ms: 350 },
    redDestroyed: { strong: 0, weak: 0.25, ms: 60 },
    bossHit: { strong: 0, weak: 0.4, ms: 80 },
    bossDefeated: { strong: 0.6, weak: 0.4, ms: 500 },
    collect: { strong: 0, weak: 0.15, ms: 40 },
    threat: { strong: 0, weak: 0.3, ms: 50 }, // 3D: a rock or UFO on a collision course
    shieldHit: { strong: 0.3, weak: 0.3, ms: 120 },
});

// Radial deadzone on a raw stick: below `deadzone` it is inactive; above, the magnitude
// is rescaled to 0..1 (and clamped, so diagonals of square gates never exceed 1).
// Returns { active, x, y, angle, magnitude } with angle 0 = right, +y down like the canvas.
export function radialDeadzone(x, y, deadzone = STICK_DEADZONE) {
    x = Number.isFinite(x) ? x : 0;
    y = Number.isFinite(y) ? y : 0;
    const raw = Math.hypot(x, y);
    if (raw <= deadzone) return { active: false, x: 0, y: 0, angle: 0, magnitude: 0 };
    const magnitude = Math.min(1, (Math.min(raw, 1) - deadzone) / (1 - deadzone));
    const angle = Math.atan2(y, x);
    return { active: true, x: Math.cos(angle) * magnitude, y: Math.sin(angle) * magnitude, angle, magnitude };
}

// 'xbox' | 'playstation' | 'nintendo' | 'generic', from Gamepad.id.
export function controllerFamily(id) {
    const s = String(id || '').toLowerCase();
    if (/xbox|xinput|x-box|vendor: 045e|045e-/.test(s)) return 'xbox';
    if (/playstation|dualsense|dualshock|sony|vendor: 054c|054c-|^wireless controller/.test(s)) return 'playstation';
    if (/nintendo|switch|joy-con|pro controller|vendor: 057e|057e-/.test(s)) return 'nintendo';
    return 'generic';
}

// Friendly name for toasts: drops Chrome's "(STANDARD GAMEPAD Vendor: ... )" suffix.
export function controllerName(id) {
    const s = String(id || '').replace(/\s*\((?:STANDARD GAMEPAD|Vendor)[^)]*\)\s*$/i, '').trim();
    return s || 'Controller';
}

const GLYPHS = {
    xbox: { [GP.A]: 'A', [GP.B]: 'B', [GP.X]: 'X', [GP.Y]: 'Y' },
    playstation: { [GP.A]: '✕', [GP.B]: '○', [GP.X]: '□', [GP.Y]: '△' },
    nintendo: { [GP.A]: 'B', [GP.B]: 'A', [GP.X]: 'Y', [GP.Y]: 'X' }, // labels swapped vs position
    generic: { [GP.A]: '●', [GP.B]: '●', [GP.X]: '●', [GP.Y]: '●' },
};
const SHARED_GLYPHS = {
    [GP.LB]: 'LB', [GP.RB]: 'RB', [GP.LT]: 'LT', [GP.RT]: 'RT',
    [GP.VIEW]: 'View', [GP.MENU]: 'Start', [GP.UP]: '↑', [GP.DOWN]: '↓', [GP.LEFT]: '←', [GP.RIGHT]: '→',
};

// Label to draw for a button position on a given controller family.
export function buttonGlyph(family, button) {
    const face = GLYPHS[family] || GLYPHS.generic;
    return face[button] ?? SHARED_GLYPHS[button] ?? '?';
}

function defaultGetGamepads() {
    try {
        if (typeof navigator !== 'undefined' && navigator && typeof navigator.getGamepads === 'function') {
            return navigator.getGamepads();
        }
    } catch (e) { /* SecurityError in insecure contexts */ }
    return [];
}

function defaultNow() {
    return typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now();
}

function buttonDown(button, index) {
    if (button === undefined || button === null) return false;
    const value = typeof button === 'number' ? button : (Number(button.value) || 0);
    const pressed = typeof button === 'object' ? !!button.pressed : false;
    if (index === GP.LT || index === GP.RT) return value > TRIGGER_THRESHOLD;
    return pressed || value > BUTTON_THRESHOLD;
}

const STICK_DIRS = ['up', 'down', 'left', 'right'];
function dirComponent(dir, x, y) {
    switch (dir) {
        case 'up': return -y;
        case 'down': return y;
        case 'left': return -x;
        default: return x;
    }
}

function emptyMerged() {
    return {
        index: null, id: null, family: null, held: new Set(), pressed: new Set(),
        stick: { active: false, x: 0, y: 0, angle: 0, magnitude: 0 },
    };
}

// Fold per-pad results into one for single-player: held/pressed are the union of every
// pad; the stick and identity come from the most recently active pad.
export function mergePads(result, activeIndex = result ? result.activeIndex : null) {
    const merged = emptyMerged();
    if (!result || !Array.isArray(result.pads) || result.pads.length === 0) return merged;
    for (const p of result.pads) {
        p.held.forEach(a => merged.held.add(a));
        p.pressed.forEach(a => merged.pressed.add(a));
    }
    const lead = result.pads.find(p => p.index === activeIndex)
        || result.pads.find(p => p.stick.active)
        || result.pads[0];
    merged.index = lead.index;
    merged.id = lead.id;
    merged.family = lead.family;
    merged.stick = lead.stick.active ? lead.stick
        : (result.pads.find(p => p.stick.active)?.stick ?? lead.stick);
    return merged;
}

export class GamepadPoller {
    constructor({ getGamepads = defaultGetGamepads, now = defaultNow, mappings = CONTEXT_MAPPINGS } = {}) {
        this.getGamepads = getGamepads;
        this.now = now;
        this.mappings = mappings;
        this.states = new Map(); // index -> per-pad state
        this.activeIndex = null;
        this.lastContext = null;
    }

    _list() {
        let list;
        try { list = this.getGamepads(); } catch (e) { return []; }
        if (!list) return [];
        const out = [];
        for (let i = 0; i < list.length; i++) {
            const gp = list[i];
            if (!gp || gp.connected === false) continue;
            out.push({ gp, index: Number.isInteger(gp.index) ? gp.index : i });
        }
        return out;
    }

    _newState(gp) {
        return {
            id: gp.id || '',
            family: controllerFamily(gp.id),
            suppressed: new Set(), // button indices ignored until released
            suppressedDirs: new Set(),
            stickDirs: new Set(), // latched menu directions (hysteresis)
            prevButtons: new Set(),
            prevStickDirs: new Set(),
            repeatAt: new Map(),
            lastActive: -Infinity,
            announced: false, // 'connected' reported yet (suppressHeld can create the state first)
        };
    }

    // Poll all controllers for an input context ('game' | 'menu' | 'pause').
    poll(context = 'game') {
        const now = this.now();
        const mapping = this.mappings[context] || this.mappings.game;
        this.lastContext = context;
        const seen = new Set();
        const pads = [];
        const connected = [];
        const disconnected = [];
        let anyInput = false;

        for (const { gp, index } of this._list()) {
            seen.add(index);
            let st = this.states.get(index);
            if (st && st.id !== (gp.id || '')) {
                disconnected.push({ index, id: st.id, family: st.family });
                st = null;
            }
            if (!st) {
                st = this._newState(gp);
                this.states.set(index, st);
            }
            if (!st.announced) {
                st.announced = true;
                connected.push({ index, id: st.id, family: st.family, mapping: gp.mapping || '' });
            }

            // Raw buttons (with suppression until release)
            const down = new Set();
            const buttons = gp.buttons || [];
            for (let i = 0; i < buttons.length; i++) {
                const isDown = buttonDown(buttons[i], i);
                if (st.suppressed.has(i)) {
                    if (!isDown) st.suppressed.delete(i);
                    continue;
                }
                if (isDown) down.add(i);
            }
            const risingButtons = new Set([...down].filter(b => !st.prevButtons.has(b)));
            const rising = risingButtons.size > 0;
            st.prevButtons = down;

            // Stick
            const axes = gp.axes || [];
            const stick = radialDeadzone(axes[0], axes[1]);
            const rx = Number.isFinite(axes[0]) ? axes[0] : 0;
            const ry = Number.isFinite(axes[1]) ? axes[1] : 0;
            for (const dir of STICK_DIRS) {
                const c = dirComponent(dir, rx, ry);
                const other = dir === 'up' || dir === 'down' ? Math.abs(rx) : Math.abs(ry);
                if (st.suppressedDirs.has(dir)) {
                    if (c < MENU_STICK_OFF) st.suppressedDirs.delete(dir);
                    st.stickDirs.delete(dir);
                    continue;
                }
                if (st.stickDirs.has(dir)) {
                    if (c < MENU_STICK_OFF) st.stickDirs.delete(dir);
                } else if (c > MENU_STICK_ON && c >= other) {
                    st.stickDirs.add(dir);
                }
            }

            // Actions: held while any source is down; pressed only on a source's rising
            // edge, so something held across a context change never counts as a new press.
            const risingDirs = new Set([...st.stickDirs].filter(d => !st.prevStickDirs.has(d)));
            st.prevStickDirs = new Set(st.stickDirs);
            const held = new Set();
            const pressed = new Set();
            for (const action of Object.keys(mapping)) {
                for (const src of mapping[action]) {
                    let on = false;
                    let rose = false;
                    if (typeof src === 'number') {
                        on = down.has(src);
                        rose = on && risingButtons.has(src);
                    } else if (typeof src === 'string' && src.startsWith('stick:')) {
                        const dir = src.slice(6);
                        on = st.stickDirs.has(dir);
                        rose = on && risingDirs.has(dir);
                    }
                    if (on) held.add(action);
                    if (rose) pressed.add(action);
                }
            }
            for (const action of REPEAT_ACTIONS) {
                if (!held.has(action)) { st.repeatAt.delete(action); continue; }
                if (pressed.has(action)) st.repeatAt.set(action, now + MENU_REPEAT_DELAY);
                else if (now >= (st.repeatAt.get(action) ?? Infinity)) {
                    pressed.add(action);
                    st.repeatAt.set(action, now + MENU_REPEAT_INTERVAL);
                }
            }

            const active = rising || pressed.size > 0 || stick.active;
            if (active) {
                st.lastActive = now;
                anyInput = true;
                // Buttons switch the active pad at once; a stick only once the current
                // pad has been idle for a moment (so two resting sticks don't flicker).
                const current = this.states.get(this.activeIndex);
                if (this.activeIndex === null || rising || pressed.size > 0 ||
                    !current || now - current.lastActive > 500) {
                    this.activeIndex = index;
                }
            }
            pads.push({
                index, id: st.id, family: st.family,
                mapping: gp.mapping || '', standard: gp.mapping === 'standard',
                held, pressed, stick, active,
                buttons: down,
            });
        }

        for (const [index, st] of [...this.states]) {
            if (!seen.has(index)) {
                disconnected.push({ index, id: st.id, family: st.family });
                this.states.delete(index);
            }
        }
        if (this.activeIndex !== null && !this.states.has(this.activeIndex)) {
            this.activeIndex = pads.length ? pads[0].index : null;
        }
        if (this.activeIndex === null && pads.length) this.activeIndex = pads[0].index;

        pads.sort((a, b) => a.index - b.index);
        return { pads, connected, disconnected, anyInput, activeIndex: this.activeIndex, context };
    }

    // Convenience: poll and merge for single-player.
    pollMerged(context = 'game') {
        const result = this.poll(context);
        return { ...result, merged: mergePads(result) };
    }

    // Ignore everything currently held until it is released (state transitions, so the
    // Ⓐ that pressed "Start" doesn't also fire). Optionally only one pad.
    suppressHeld(padIndex = null) {
        const list = this._list();
        for (const { gp, index } of list) {
            if (padIndex !== null && index !== padIndex) continue;
            let st = this.states.get(index);
            if (!st) { st = this._newState(gp); this.states.set(index, st); }
            const buttons = gp.buttons || [];
            for (let i = 0; i < buttons.length; i++) if (buttonDown(buttons[i], i)) st.suppressed.add(i);
            const axes = gp.axes || [];
            const rx = Number.isFinite(axes[0]) ? axes[0] : 0;
            const ry = Number.isFinite(axes[1]) ? axes[1] : 0;
            for (const dir of STICK_DIRS) {
                if (dirComponent(dir, rx, ry) >= MENU_STICK_OFF) st.suppressedDirs.add(dir);
            }
            st.stickDirs.clear();
            st.prevStickDirs = new Set();
            st.prevButtons = new Set();
            st.repeatAt.clear();
        }
    }

    get connectedCount() {
        return this.states.size;
    }

    // Dual-rumble on one controller (padIndex null = most recently active). Returns true
    // if an effect was requested; a no-op without a vibrationActuator (Firefox, some pads).
    rumble(padIndex, strong, weak, ms) {
        const index = padIndex === null || padIndex === undefined ? this.activeIndex : padIndex;
        if (index === null || index === undefined) return false;
        const entry = this._list().find(e => e.index === index);
        const act = entry && entry.gp.vibrationActuator;
        if (!act || typeof act.playEffect !== 'function') return false;
        const clamp = v => Math.min(1, Math.max(0, Number(v) || 0));
        try {
            const p = act.playEffect('dual-rumble', {
                startDelay: 0,
                duration: Math.max(0, Math.round(Number(ms) || 0)),
                strongMagnitude: clamp(strong),
                weakMagnitude: clamp(weak),
            });
            if (p && typeof p.catch === 'function') p.catch(() => {});
            return true;
        } catch (e) {
            return false;
        }
    }

    // Rumble a named game event from RUMBLE_PATTERNS.
    rumbleEvent(name, padIndex = null) {
        const r = RUMBLE_PATTERNS[name];
        return r ? this.rumble(padIndex, r.strong, r.weak, r.ms) : false;
    }
}
