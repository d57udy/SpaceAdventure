// Unified input: keyboard, on-screen touch buttons (pointer events, multi-touch),
// taps/clicks on the canvas (used for menu selection) and game controllers (js/gamepad.js).
//
// Input is routed per seat (player slot 0..3, see js/seats.js and
// docs/plans/05-local-multiplayer.md §8):
//   - a source is a physical input: 'kbLeft', 'kbRight', 'pad:<index>', 'touch:a', 'touch:b';
//   - in merged mode (single-player, the default) every source drives seat 0, so both key
//     sets, every controller and the touch controls work as one;
//   - shared actions (pause, escape, mute, menu navigation, select, typing) are not bound
//     to a seat: anyone can navigate menus.
// Seat-bound keys are matched by KeyboardEvent.code (physical key position) so AZERTY and
// QWERTZ keyboards work; typing (username prompt) still uses the typed character (event.key).
import { GamepadPoller, mergePads } from './gamepad.js';
import {
    SeatTable, MAX_SEATS, lookupCode, lookupShared, rotateVector,
} from './seats.js';

const INACTIVE_STICK = Object.freeze({ active: false, angle: 0, magnitude: 0 });
export const INPUT_CONTEXTS = Object.freeze(['game', 'menu', 'pause']);

/** Held actions (a key/finger/button holds them down). */
export const CONTINUOUS_ACTIONS = Object.freeze(['thrust', 'rotateLeft', 'rotateRight', 'fire']);
/** One-shot actions that belong to a seat (everything else one-shot is shared). */
export const SEAT_ONE_SHOTS = Object.freeze(['hyperspace']);
/** Palm rule: a stick finger that moved less than this many CSS px ... */
export const PALM_MOVE_PX = 6;
/** ... for this long (ms) can be taken over by a new finger in the same zone. */
export const PALM_IDLE_MS = 500;
/** Source events kept for the lobby when nobody reads them. */
export const SOURCE_EVENT_LIMIT = 64;

const DEFAULT_ZONE = 'a';
const TYPED_CHAR = /^[A-Za-z0-9]$/;
// Shared actions whose keys should not scroll/activate the page.
const PREVENT_SHARED = new Set(['menuUp', 'menuDown', 'menuLeft', 'menuRight', 'menuSelect', 'enter', 'backspace']);

function defaultNow() {
    return typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now();
}

// Physical key code for an event. Some virtual keyboards leave `code` empty; fall back to
// the code of the typed character so those keys still work (layout-dependent, like before).
export function codeOf(event) {
    if (event.code) return event.code;
    const key = event.key;
    if (typeof key !== 'string' || key === '') return '';
    if (key === ' ') return 'Space';
    if (/^[a-zA-Z]$/.test(key)) return `Key${key.toUpperCase()}`;
    if (/^[0-9]$/.test(key)) return `Digit${key}`;
    return key; // Arrow*, Enter, Escape, Backspace ... share their key and code names
}

function newStick() {
    return { pointerId: null, zone: DEFAULT_ZONE, originX: 0, originY: 0, x: 0, y: 0, anchorX: 0, anchorY: 0, anchorAt: 0 };
}

function newSeatState() {
    return {
        held: new Map(), // action -> Set of tokens ('key:KeyA', 'ptr:3') holding it down
        latched: new Set(), // continuous actions pressed this frame (quick taps still count)
        pressed: new Set(), // seat one-shots waiting to be consumed (hyperspace)
        padHeld: new Set(), // continuous actions held on this seat's controller(s)
        padStick: INACTIVE_STICK, // this seat's controller stick (game context only)
        stick: newStick(), // drag-to-steer touch stick
        orientation: 0, // degrees; 180 for a player facing across a flat tablet
    };
}

export class InputHandler {
    // options.getLogicalSize: () => ({ width, height }) of the canvas in game (logical) pixels.
    // Taps are mapped into that space; without it they stay in CSS pixels. (The backing
    // store is larger than the logical size on HiDPI screens, so canvas.width is not used.)
    // options.gamepadPoller: a GamepadPoller (injected in tests); defaults to one reading
    // navigator.getGamepads().
    // options.now: clock in ms (injected in tests) for the palm takeover rule.
    constructor(canvas = null, { getLogicalSize = null, gamepadPoller = null, now = defaultNow } = {}) {
        this.canvas = canvas;
        this.getLogicalSize = getLogicalSize;
        this.now = now;
        // Which source drives which seat. Merged (single-player) by default.
        this.seats = new SeatTable();
        this.seatState = Array.from({ length: MAX_SEATS }, newSeatState);
        // Game controllers: polled once per frame by pollGamepads(). Every controller is
        // reported separately by the poller; merged mode folds them into seat 0.
        this.gamepad = gamepadPoller || new GamepadPoller();
        this.context = 'menu'; // 'game' | 'menu' | 'pause': selects the controller mapping
        this.gamepadPressed = new Set(); // actions newly pressed on any controller this frame
        this.gamepadResult = null; // last per-pad poll result { pads, activeIndex, ... }
        this.gamepadMerged = null; // last merged result (all pads)
        this.gamepadEvents = []; // { type: 'connected' | 'disconnected', index, id, family, mapping }
        this.lastInputSource = null; // 'keyboard' | 'touch' | 'mouse' | 'gamepad'

        this.continuousActionNames = new Set(CONTINUOUS_ACTIONS);
        this.singlePressActions = {}; // shared one-shots (pause, menu nav, typing, ...) -> bool
        this.sharedPressSeat = {}; // shared action -> seat that pressed it last (null if unknown)
        this.downCodes = new Set(); // physical keys down now (edge detection, auto-repeat guard)
        this.codeHolds = new Map(); // code -> [{ seat, action }] held by that key
        this.pointerActions = new Map(); // pointerId -> action held by an on-screen button
        this.pointerInfo = new Map(); // pointerId -> { seat, zone } for button pointers
        this.pendingTaps = []; // Taps/clicks on the canvas in logical canvas coordinates
        this.charQueue = []; // Typed characters in order (username entry)
        this.sourceEvents = []; // { source, action, seat } per press, for lobby joining
        // Drag-to-steer virtual joystick: a finger pressed in a .joystick-zone becomes the
        // stick's centre; dragging away from it gives a direction and a strength (0..1).
        this.joystickRadius = 60; // CSS pixels of drag for full strength

        this._keydownHandler = (e) => this.handleKeyEvent(e, true);
        this._keyupHandler = (e) => this.handleKeyEvent(e, false);
        this._pointerDownHandler = (e) => this.handlePointerDown(e);
        this._pointerMoveHandler = (e) => this.handlePointerMove(e);
        this._pointerUpHandler = (e) => this.handlePointerUp(e);
        this._releaseAllHandler = () => this.releaseAll();
        this._preventTouchDefault = (e) => {
            // Stop iOS double-tap zoom, scrolling and long-press callouts on game surfaces
            if (e.target.closest && e.target.closest('.touch-btn, canvas')) e.preventDefault();
        };

        window.addEventListener('keydown', this._keydownHandler);
        window.addEventListener('keyup', this._keyupHandler);
        document.addEventListener('pointerdown', this._pointerDownHandler, { passive: false });
        document.addEventListener('pointermove', this._pointerMoveHandler);
        document.addEventListener('pointerup', this._pointerUpHandler);
        document.addEventListener('pointercancel', this._pointerUpHandler);
        document.addEventListener('touchstart', this._preventTouchDefault, { passive: false });
        document.addEventListener('touchmove', this._preventTouchDefault, { passive: false });
        // Keys/fingers released while the window is not focused would otherwise stay "stuck"
        window.addEventListener('blur', this._releaseAllHandler);
    }

    // Seat 0's touch stick (single-player compatibility).
    get joystick() {
        return this.seatState[0].stick;
    }

    isContinuous(action) {
        return this.continuousActionNames.has(action);
    }

    isSeatAction(action) {
        return this.isContinuous(action) || SEAT_ONE_SHOTS.includes(action);
    }

    // --- Seats ---

    // Switch between merged (single-player) and seat mode. Held input is released because it
    // was routed under the old table.
    setMerged(merged) {
        this.seats.setMerged(merged);
        this.releaseAll();
    }

    // Degrees to rotate this seat's controller stick (180 for a player facing across a flat
    // tablet). Touch sticks are never rotated: finger direction on the glass already matches.
    setSeatOrientation(seat, deg) {
        const s = this.seatState[seat];
        if (s) s.orientation = Number.isFinite(deg) ? deg : 0;
    }

    _seatOf(source) {
        return this.seats.seatOf(source);
    }

    _pushSourceEvent(source, action, seat) {
        this.sourceEvents.push({ source, action, seat });
        if (this.sourceEvents.length > SOURCE_EVENT_LIMIT) this.sourceEvents.shift();
    }

    // Press events per source since the last call: [{ source, action, seat }], seat null when
    // the source has not joined. The lobby uses these to join and ready up.
    consumeSourceEvents() {
        const out = this.sourceEvents;
        this.sourceEvents = [];
        return out;
    }

    _hold(seat, action, token) {
        const s = this.seatState[seat];
        let set = s.held.get(action);
        if (!set) s.held.set(action, (set = new Set()));
        set.add(token);
        s.latched.add(action);
    }

    _unhold(seat, action, token) {
        const set = this.seatState[seat].held.get(action);
        if (set) set.delete(token);
    }

    _pressShared(action, seat) {
        this.singlePressActions[action] = true;
        this.sharedPressSeat[action] = seat;
    }

    // A one-shot or held press from a source already resolved to a seat.
    _pressSeatAction(seat, action, token) {
        if (this.isContinuous(action)) {
            if (token) this._hold(seat, action, token);
            else this.seatState[seat].latched.add(action);
        } else if (SEAT_ONE_SHOTS.includes(action)) {
            this.seatState[seat].pressed.add(action);
        } else {
            this._pressShared(action, seat);
        }
    }

    // Release everything a seat holds (a player leaving, dropping a reserved controller).
    releaseSeat(seat) {
        const s = this.seatState[seat];
        if (!s) return;
        s.held.clear();
        s.latched.clear();
        s.pressed.clear();
        s.padHeld = new Set();
        s.padStick = INACTIVE_STICK;
        for (const [code, holds] of this.codeHolds) {
            const rest = holds.filter(h => h.seat !== seat);
            if (rest.length) this.codeHolds.set(code, rest);
            else this.codeHolds.delete(code); // the key stays down: no retrigger until keyup
        }
        for (const [id, info] of [...this.pointerInfo]) {
            if (info.seat !== seat) continue;
            const action = this.pointerActions.get(id);
            this.pointerActions.delete(id);
            this.pointerInfo.delete(id);
            if (action !== undefined) this._refreshButton(action, info.zone);
        }
        this._releaseStick(seat);
    }

    // --- Keyboard ---

    handleKeyEvent(event, isPressed) {
        // Let text fields (username entry) receive keys normally
        const target = event.target;
        if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return;

        const code = codeOf(event);
        if (!code) return;

        if (!isPressed) {
            this.downCodes.delete(code);
            const holds = this.codeHolds.get(code);
            if (holds) {
                for (const h of holds) this._unhold(h.seat, h.action, `key:${code}`);
                this.codeHolds.delete(code);
            }
            return;
        }

        this.lastInputSource = 'keyboard';
        // Ctrl, Cmd, Alt and Option combinations belong to the browser/OS (Cmd+W closes the tab)
        if (event.ctrlKey || event.metaKey || event.altKey) return;

        const merged = this.seats.merged;
        const bindings = lookupCode(code, merged);
        const shared = lookupShared(code);
        const typed = typeof event.key === 'string' && TYPED_CHAR.test(event.key);
        if (bindings.length === 0 && shared.length === 0 && !typed) return;

        if (bindings.length > 0 || shared.some(a => PREVENT_SHARED.has(a))) event.preventDefault();

        // Edge detection per physical key: auto-repeat (or a second keydown without keyup)
        // never retriggers, but another key bound to the same action does.
        if (this.downCodes.has(code)) return;
        this.downCodes.add(code);

        const holds = [];
        if (event.repeat) {
            // A key held through releaseAll() (state change, blur): its auto-repeat holds the
            // continuous actions again, but one-shots need a fresh press.
            for (const { source, action } of bindings) {
                const seat = this._seatOf(source);
                if (seat === null || !this.isContinuous(action)) continue;
                this._hold(seat, action, `key:${code}`);
                holds.push({ seat, action });
            }
            if (holds.length) this.codeHolds.set(code, holds);
            return;
        }
        for (const { source, action } of bindings) {
            const seat = this._seatOf(source);
            this._pushSourceEvent(source, action, seat);
            if (seat === null) continue; // unjoined: lobby events only
            this._pressSeatAction(seat, action, `key:${code}`);
            if (this.isContinuous(action)) holds.push({ seat, action });
        }
        if (holds.length) this.codeHolds.set(code, holds);

        // Shared actions: who pressed them is known only when the key has one seat
        const seats = [...new Set(bindings.map(b => this._seatOf(b.source)))];
        const by = merged ? 0 : (seats.length === 1 ? seats[0] : null);
        for (const action of shared) this._pressShared(action, by);

        if (typed) {
            const char = event.key.toUpperCase();
            this.singlePressActions[`key_${char}`] = true;
            this.charQueue.push(char);
        }
    }

    // --- Pointer (touch / mouse / pen) ---

    // Zone ('a' | 'b') of an element: the nearest [data-zone] ancestor, 'a' when there is none.
    zoneOf(el) {
        const z = el && el.closest ? el.closest('[data-zone]') : null;
        return (z && z.dataset && z.dataset.zone) || DEFAULT_ZONE;
    }

    buttonAt(clientX, clientY) {
        const el = document.elementFromPoint(clientX, clientY);
        return el && el.closest ? el.closest('.touch-btn[data-action]') : null;
    }

    setButtonActive(action, active, zone = null) {
        document.querySelectorAll(`.touch-btn[data-action="${action}"]`).forEach(btn => {
            if (zone !== null && this.zoneOf(btn) !== zone) return;
            btn.classList.toggle('active', active);
        });
    }

    // Button highlight on while any pointer in that zone still holds the action
    _refreshButton(action, zone) {
        for (const [id, held] of this.pointerActions) {
            if (held === action && this.pointerInfo.get(id)?.zone === zone) return;
        }
        this.setButtonActive(action, false, zone);
    }

    pressPointerAction(pointerId, action, zone = DEFAULT_ZONE) {
        const source = `touch:${zone}`;
        const seat = this._seatOf(source);
        this._pushSourceEvent(source, action, seat);
        if (seat === null) return; // unjoined zone: lobby events only
        this.pointerActions.set(pointerId, action);
        this.pointerInfo.set(pointerId, { seat, zone });
        this._pressSeatAction(seat, action, this.isContinuous(action) ? `ptr:${pointerId}` : null);
        this.setButtonActive(action, true, zone);
    }

    releasePointer(pointerId) {
        const action = this.pointerActions.get(pointerId);
        if (action === undefined) return;
        const info = this.pointerInfo.get(pointerId);
        this.pointerActions.delete(pointerId);
        this.pointerInfo.delete(pointerId);
        if (info) {
            if (this.isContinuous(action)) this._unhold(info.seat, action, `ptr:${pointerId}`);
            this._refreshButton(action, info.zone);
        }
    }

    handlePointerDown(event) {
        this.lastInputSource = event.pointerType === 'mouse' ? 'mouse' : 'touch';
        const zoneEl = event.target.closest ? event.target.closest('.joystick-zone') : null;
        if (zoneEl) {
            event.preventDefault();
            this._stickDown(event, this.zoneOf(zoneEl));
            return;
        }
        const button = event.target.closest ? event.target.closest('.touch-btn[data-action]') : null;
        if (button) {
            event.preventDefault();
            // Allow the finger to slide between buttons (e.g. rotate left -> rotate right)
            if (button.hasPointerCapture && button.hasPointerCapture(event.pointerId)) {
                button.releasePointerCapture(event.pointerId);
            }
            this.pressPointerAction(event.pointerId, button.dataset.action, this.zoneOf(button));
            return;
        }
        if (this.canvas && event.target === this.canvas) {
            event.preventDefault();
            if (event.pointerType === 'mouse' && event.button !== 0) return;
            const rect = this.canvas.getBoundingClientRect();
            if (rect.width === 0 || rect.height === 0) return;
            const logical = this.getLogicalSize ? this.getLogicalSize() : null;
            const sx = logical && logical.width > 0 ? logical.width / rect.width : 1;
            const sy = logical && logical.height > 0 ? logical.height / rect.height : 1;
            this.pendingTaps.push({
                x: (event.clientX - rect.left) * sx,
                y: (event.clientY - rect.top) * sy,
            });
        }
    }

    // A finger landing in a stick zone. It takes the zone's seat stick if free, or if the
    // current owner has rested (palm rule: moved at most PALM_MOVE_PX for PALM_IDLE_MS).
    _stickDown(event, zone) {
        const source = `touch:${zone}`;
        const seat = this._seatOf(source);
        this._pushSourceEvent(source, 'stick', seat);
        if (seat === null) return;
        const j = this.seatState[seat].stick;
        const now = this.now();
        if (j.pointerId !== null && now - j.anchorAt < PALM_IDLE_MS) return;
        j.pointerId = event.pointerId;
        j.zone = zone;
        j.originX = j.x = j.anchorX = event.clientX;
        j.originY = j.y = j.anchorY = event.clientY;
        j.anchorAt = now;
        this.updateJoystickVisual(true, seat);
    }

    _stickSeatOf(pointerId) {
        for (let seat = 0; seat < this.seatState.length; seat++) {
            if (this.seatState[seat].stick.pointerId === pointerId) return seat;
        }
        return null;
    }

    handlePointerMove(event) {
        const stickSeat = this._stickSeatOf(event.pointerId);
        if (stickSeat !== null) {
            // The finger keeps steering its seat even if it slides into the other half
            const j = this.seatState[stickSeat].stick;
            j.x = event.clientX;
            j.y = event.clientY;
            if (Math.hypot(j.x - j.anchorX, j.y - j.anchorY) > PALM_MOVE_PX) {
                j.anchorX = j.x;
                j.anchorY = j.y;
                j.anchorAt = this.now();
            }
            this.updateJoystickVisual(true, stickSeat);
            return;
        }
        const current = this.pointerActions.get(event.pointerId);
        if (current === undefined || !this.isContinuous(current)) return;
        const info = this.pointerInfo.get(event.pointerId);
        const button = this.buttonAt(event.clientX, event.clientY);
        // Slides only switch between the same player's (zone's) buttons
        const next = button && (!info || this.zoneOf(button) === info.zone) ? button.dataset.action : null;
        // Slide onto another continuous control: switch; slide off everything: keep holding
        if (next && next !== current && this.isContinuous(next)) {
            this.releasePointer(event.pointerId);
            this.pressPointerAction(event.pointerId, next, info ? info.zone : DEFAULT_ZONE);
        }
    }

    handlePointerUp(event) {
        const stickSeat = this._stickSeatOf(event.pointerId);
        if (stickSeat !== null) {
            this._releaseStick(stickSeat);
            return;
        }
        this.releasePointer(event.pointerId);
    }

    _releaseStick(seat) {
        const j = this.seatState[seat].stick;
        j.pointerId = null;
        this.updateJoystickVisual(false, seat);
    }

    // Release every touch stick (resize, orientation change).
    releaseJoysticks() {
        for (let seat = 0; seat < this.seatState.length; seat++) this._releaseStick(seat);
    }

    releaseJoystick() {
        this.releaseJoysticks();
    }

    // Current stick state for a seat: angle in radians (0 = right, y down like the canvas)
    // and magnitude 0..1 (clamped at joystickRadius). Falls back to the seat's controller
    // stick while playing (a touch stick wins).
    getJoystick(seat = 0) {
        const s = this.seatState[seat];
        if (!s) return { active: false, angle: 0, magnitude: 0 };
        const j = s.stick;
        if (j.pointerId === null) {
            const g = s.padStick;
            if (this.context === 'game' && g && g.active) {
                return { active: true, angle: g.angle, magnitude: g.magnitude, source: 'gamepad' };
            }
            return { active: false, angle: 0, magnitude: 0 };
        }
        const dx = j.x - j.originX;
        const dy = j.y - j.originY;
        const dist = Math.hypot(dx, dy);
        return {
            active: true,
            angle: Math.atan2(dy, dx),
            magnitude: Math.min(1, dist / this.joystickRadius),
        };
    }

    // Move the on-screen stick base/knob (optional DOM elements) to follow the finger.
    // Zone a uses #joystick-base/#joystick-knob; other zones #joystick-base-<zone>/...
    updateJoystickVisual(active, seat = 0) {
        if (typeof document === 'undefined' || !document.getElementById) return;
        const s = this.seatState[seat];
        if (!s) return;
        const j = s.stick;
        const suffix = j.zone === DEFAULT_ZONE ? '' : `-${j.zone}`;
        const base = document.getElementById(`joystick-base${suffix}`);
        const knob = document.getElementById(`joystick-knob${suffix}`);
        if (!base || !knob) return;
        base.classList.toggle('active', active);
        if (!active) {
            // Back to the resting hint position defined in CSS
            base.style.left = '';
            base.style.top = '';
            knob.style.transform = '';
            return;
        }
        const { angle, magnitude } = this.getJoystick(seat);
        const r = magnitude * this.joystickRadius;
        base.style.left = `${j.originX}px`;
        base.style.top = `${j.originY}px`;
        knob.style.transform = `translate(calc(-50% + ${Math.cos(angle) * r}px), calc(-50% + ${Math.sin(angle) * r}px))`;
    }

    // --- Game controllers ---

    // Which controller mapping applies ('game' while playing, 'pause', 'menu' elsewhere)
    setContext(context) {
        if (!INPUT_CONTEXTS.includes(context)) context = 'menu';
        if (context === this.context) return;
        this.context = context;
        if (context !== 'game') for (const s of this.seatState) s.padStick = INACTIVE_STICK;
    }

    _rotatedStick(stick, seat) {
        const deg = this.seatState[seat].orientation;
        if (!stick || !stick.active || !deg) return stick;
        const v = rotateVector(stick.x, stick.y, deg);
        return { ...stick, x: v.x, y: v.y, angle: Math.atan2(v.y, v.x) };
    }

    // Poll every controller once per frame (before taps and key handling). Held actions feed
    // isPressed(), new presses the one-shot queues (continuous ones are latched so a quick
    // press still counts). Merged mode: every pad drives seat 0; seat mode: each pad drives
    // its joined seat, unjoined pads only produce source events. Returns { result, merged }.
    pollGamepads() {
        let result;
        try {
            result = this.gamepad.poll(this.context);
        } catch (e) {
            return { result: null, merged: null };
        }
        const merged = mergePads(result);
        this.gamepadResult = result;
        this.gamepadMerged = merged;
        for (const c of result.connected) this.gamepadEvents.push({ type: 'connected', ...c });
        for (const d of result.disconnected) this.gamepadEvents.push({ type: 'disconnected', ...d });
        this.gamepadPressed = merged.pressed;
        const inGame = this.context === 'game';

        for (const s of this.seatState) {
            s.padHeld = new Set();
            s.padStick = INACTIVE_STICK;
        }
        for (const pad of result.pads) {
            const source = `pad:${pad.index}`;
            const seat = this._seatOf(source);
            for (const action of pad.pressed) this._pushSourceEvent(source, action, seat);
            if (seat === null) continue;
            const s = this.seatState[seat];
            for (const a of pad.held) if (this.isContinuous(a)) s.padHeld.add(a);
            if (!this.seats.merged && inGame && pad.stick.active && !s.padStick.active) {
                s.padStick = this._rotatedStick(pad.stick, seat);
            }
            if (!this.seats.merged) for (const action of pad.pressed) this._pressSeatAction(seat, action, null);
        }
        if (this.seats.merged) {
            // One merged stick (most recently active pad) and one press per action, as before
            if (inGame) this.seatState[0].padStick = this._rotatedStick(merged.stick, 0);
            for (const action of merged.pressed) this._pressSeatAction(0, action, null);
        }
        if (result.anyInput) this.lastInputSource = 'gamepad';
        return { result, merged };
    }

    // Connect/disconnect events since the last call.
    consumeGamepadEvents() {
        const out = this.gamepadEvents;
        this.gamepadEvents = [];
        return out;
    }

    // Was this action newly pressed on a controller during the last poll?
    gamepadJustPressed(action) {
        return this.gamepadPressed.has(action);
    }

    // { connected, id, family, mapping, index, count } for the most recently active controller
    gamepadInfo() {
        const r = this.gamepadResult;
        const pads = r ? r.pads : [];
        const lead = pads.find(p => p.index === r.activeIndex) || pads[0] || null;
        return {
            connected: pads.length > 0,
            count: pads.length,
            index: lead ? lead.index : null,
            id: lead ? lead.id : null,
            family: lead ? lead.family : null,
            mapping: lead ? lead.mapping : null,
        };
    }

    // Ignore controller buttons/stick directions held right now until they are released
    suppressGamepad() {
        try { this.gamepad.suppressHeld(); } catch (e) { /* ignore */ }
        this.gamepadPressed = new Set();
        for (const s of this.seatState) {
            s.padHeld = new Set();
            s.padStick = INACTIVE_STICK;
        }
    }

    // Release everything (window blur, tab hidden, state changes)
    releaseAll() {
        this.suppressGamepad();
        this.downCodes.clear();
        this.codeHolds.clear();
        for (const [id, action] of this.pointerActions) {
            const info = this.pointerInfo.get(id);
            this.setButtonActive(action, false, info ? info.zone : null);
        }
        this.pointerActions.clear();
        this.pointerInfo.clear();
        for (const s of this.seatState) {
            s.held.clear();
            s.latched.clear();
        }
        this.releaseJoysticks();
    }

    // Drop queued one-shot actions, taps and source events (called on game state transitions
    // so a key pressed in one screen, e.g. 'S' while typing a name, doesn't fire in the next)
    clearPending() {
        for (const action in this.singlePressActions) this.singlePressActions[action] = false;
        this.sharedPressSeat = {};
        this.pendingTaps.length = 0;
        this.charQueue.length = 0;
        this.sourceEvents = [];
        for (const s of this.seatState) {
            s.latched.clear();
            s.pressed.clear();
        }
        // Controller buttons held now (e.g. the Ⓐ that pressed "Start") must not act again
        // in the next screen until they are released and pressed again.
        this.suppressGamepad();
    }

    // Called once per game frame after input has been read
    endFrame() {
        for (const s of this.seatState) s.latched.clear();
    }

    // Programmatically trigger a one-shot action (used by tap handling)
    triggerAction(action, seat = 0) {
        if (SEAT_ONE_SHOTS.includes(action)) {
            if (this.seatState[seat]) this.seatState[seat].pressed.add(action);
        } else {
            this._pressShared(action, null);
        }
    }

    // Continuous state for a seat (seat 0 when omitted): any key, finger or controller
    // button holding the action, or a press latched this frame.
    isPressed(action, seat = 0) {
        const s = this.seatState[seat];
        if (!s) return false;
        const set = s.held.get(action);
        return (set !== undefined && set.size > 0) || s.latched.has(action) || s.padHeld.has(action);
    }

    // Check and consume a one-shot. Seat actions (hyperspace) are per seat (seat 0 when
    // omitted). Shared actions (pause, menus, typing) are for anyone; with an explicit seat
    // they are consumed only if that seat pressed them.
    consumeAction(action, seat) {
        if (SEAT_ONE_SHOTS.includes(action)) {
            const s = this.seatState[seat ?? 0];
            return !!s && s.pressed.delete(action);
        }
        if (!this.singlePressActions[action]) return false;
        if (seat !== undefined && seat !== null && this.sharedPressSeat[action] !== seat) return false;
        this.singlePressActions[action] = false;
        return true;
    }

    // Seat that last pressed a shared action (e.g. who paused), or null when unknown.
    pressedBy(action) {
        return this.sharedPressSeat[action] ?? null;
    }

    consumeTap() {
        return this.pendingTaps.shift() || null;
    }

    // Get last pressed character key for the username prompt
    consumeLastCharKey() {
        // Typed order first, so fast typing isn't reordered or deduplicated
        if (this.charQueue.length > 0) {
            const char = this.charQueue.shift();
            this.singlePressActions[`key_${char}`] = false;
            return char;
        }
        for (const char of 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789') {
            if (this.consumeAction(`key_${char}`)) return char;
        }
        return null;
    }

    destroy() {
        window.removeEventListener('keydown', this._keydownHandler);
        window.removeEventListener('keyup', this._keyupHandler);
        document.removeEventListener('pointerdown', this._pointerDownHandler);
        document.removeEventListener('pointermove', this._pointerMoveHandler);
        document.removeEventListener('pointerup', this._pointerUpHandler);
        document.removeEventListener('pointercancel', this._pointerUpHandler);
        document.removeEventListener('touchstart', this._preventTouchDefault);
        document.removeEventListener('touchmove', this._preventTouchDefault);
        window.removeEventListener('blur', this._releaseAllHandler);
    }
}
