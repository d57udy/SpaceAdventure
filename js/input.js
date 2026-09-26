// Unified input: keyboard, on-screen touch buttons (pointer events, multi-touch),
// taps/clicks on the canvas (used for menu selection) and game controllers (js/gamepad.js).
import { GamepadPoller, mergePads } from './gamepad.js';

const INACTIVE_STICK = Object.freeze({ active: false, angle: 0, magnitude: 0 });
export const INPUT_CONTEXTS = Object.freeze(['game', 'menu', 'pause']);

export class InputHandler {
    // options.getLogicalSize: () => ({ width, height }) of the canvas in game (logical) pixels.
    // Taps are mapped into that space; without it they stay in CSS pixels. (The backing
    // store is larger than the logical size on HiDPI screens, so canvas.width is not used.)
    // options.gamepadPoller: a GamepadPoller (injected in tests); defaults to one reading
    // navigator.getGamepads().
    constructor(canvas = null, { getLogicalSize = null, gamepadPoller = null } = {}) {
        this.canvas = canvas;
        this.getLogicalSize = getLogicalSize;
        // Game controllers: polled once per frame by pollGamepads(). Every controller is
        // reported separately by the poller (for local multiplayer later); single-player
        // merges them, so any controller drives the one ship.
        this.gamepad = gamepadPoller || new GamepadPoller();
        this.context = 'menu'; // 'game' | 'menu' | 'pause': selects the controller mapping
        this.gamepadHeld = new Set(); // continuous actions held on a controller this frame
        this.gamepadPressed = new Set(); // actions newly pressed on a controller this frame
        this.gamepadStick = INACTIVE_STICK; // left stick (game context only)
        this.gamepadResult = null; // last per-pad poll result { pads, activeIndex, ... }
        this.gamepadMerged = null; // last merged result (single-player)
        this.gamepadEvents = []; // { type: 'connected' | 'disconnected', index, id, family, mapping }
        this.lastInputSource = null; // 'keyboard' | 'touch' | 'mouse' | 'gamepad'
        this.keys = {}; // Continuous state from the keyboard (thrust, rotate, fire)
        this.singlePressActions = {}; // Consumable actions (hyperspace, pause, menu nav, typing)
        this.keyProcessed = {}; // Prevents keyboard auto-repeat for single press
        this.pointerActions = new Map(); // pointerId -> action held by an on-screen button
        this.pendingTaps = []; // Taps/clicks on the canvas in logical canvas coordinates
        this.charQueue = []; // Typed characters in order (username entry)
        this.latched = new Set(); // Continuous actions pressed this frame (so quick taps still count)
        // Drag-to-steer virtual joystick: a finger pressed in the .joystick-zone becomes the
        // stick's centre; dragging away from it gives a direction and a strength (0..1).
        this.joystickRadius = 60; // CSS pixels of drag for full strength
        this.joystick = { pointerId: null, originX: 0, originY: 0, x: 0, y: 0 };

        // Define key mappings (Action Name -> Keys)
        this.keyToAction = {
            thrust: ['ArrowUp', 'w', 'W'],
            rotateLeft: ['ArrowLeft', 'a', 'A'],
            rotateRight: ['ArrowRight', 'd', 'D'],
            fire: [' ', 'Space'], // Space bar
            hyperspace: ['h', 'H', 'ArrowDown', 's', 'S'],
            pause: ['p', 'P'],
            enter: ['Enter'],
            escape: ['Escape'],
            toggleMute: ['m', 'M'],
            // Menu-specific actions (can overlap with game actions)
            menuUp: ['ArrowUp', 'w', 'W'],
            menuDown: ['ArrowDown', 's', 'S'],
            menuLeft: ['ArrowLeft', 'a', 'A'],
            menuRight: ['ArrowRight', 'd', 'D'],
            menuSelect: ['Enter', ' ', 'Space'],
            // Keys for prompt input
            backspace: ['Backspace'],
        };
        for (const char of 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789') {
            this.keyToAction[`key_${char}`] = char === char.toLowerCase() ? [char] : [char, char.toLowerCase()];
        }

        // Reverse map for quick lookup (Key -> Action Names)
        this.actionForKey = {};
        for (const action in this.keyToAction) {
            this.keyToAction[action].forEach(key => {
                if (!this.actionForKey[key]) this.actionForKey[key] = [];
                this.actionForKey[key].push(action);
            });
        }

        // Actions that are held down rather than consumed once
        this.continuousActionNames = new Set(['thrust', 'rotateLeft', 'rotateRight', 'fire']);

        Object.keys(this.keyToAction).forEach(action => {
            this.keys[action] = false;
            this.singlePressActions[action] = false;
        });

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

    isContinuous(action) {
        return this.continuousActionNames.has(action);
    }

    handleKeyEvent(event, isPressed) {
        // Let text fields (username entry) receive keys normally
        const target = event.target;
        if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return;

        if (isPressed) this.lastInputSource = 'keyboard';
        const actions = this.actionForKey[event.key];
        if (!actions) return;

        const shouldPreventDefault = actions.some(action =>
            ['thrust', 'rotateLeft', 'rotateRight', 'fire', 'hyperspace', 'enter', 'menuUp', 'menuDown', 'menuLeft', 'menuRight', 'backspace'].includes(action)
        );
        if (shouldPreventDefault) event.preventDefault();

        actions.forEach(action => {
            if (this.isContinuous(action)) {
                if (isPressed) this.latched.add(action);
                this.keys[action] = isPressed;
            } else if (isPressed && !this.keyProcessed[action]) {
                this.singlePressActions[action] = true;
                this.keyProcessed[action] = true;
                if (action.startsWith('key_')) this.charQueue.push(action.slice(4));
            } else if (!isPressed) {
                this.keyProcessed[action] = false;
            }
        });
    }

    // --- Pointer (touch / mouse / pen) ---

    buttonAt(clientX, clientY) {
        const el = document.elementFromPoint(clientX, clientY);
        return el && el.closest ? el.closest('.touch-btn[data-action]') : null;
    }

    setButtonActive(action, active) {
        document.querySelectorAll(`.touch-btn[data-action="${action}"]`).forEach(btn => {
            btn.classList.toggle('active', active);
        });
    }

    pressPointerAction(pointerId, action) {
        this.pointerActions.set(pointerId, action);
        if (this.isContinuous(action)) this.latched.add(action);
        else this.singlePressActions[action] = true;
        this.setButtonActive(action, true);
    }

    releasePointer(pointerId) {
        const action = this.pointerActions.get(pointerId);
        if (action === undefined) return;
        this.pointerActions.delete(pointerId);
        if (![...this.pointerActions.values()].includes(action)) {
            this.setButtonActive(action, false);
        }
    }

    handlePointerDown(event) {
        this.lastInputSource = event.pointerType === 'mouse' ? 'mouse' : 'touch';
        const zone = event.target.closest ? event.target.closest('.joystick-zone') : null;
        if (zone) {
            event.preventDefault();
            if (this.joystick.pointerId === null) {
                this.joystick.pointerId = event.pointerId;
                this.joystick.originX = this.joystick.x = event.clientX;
                this.joystick.originY = this.joystick.y = event.clientY;
                this.updateJoystickVisual(true);
            }
            return;
        }
        const button = event.target.closest ? event.target.closest('.touch-btn[data-action]') : null;
        if (button) {
            event.preventDefault();
            // Allow the finger to slide between buttons (e.g. rotate left -> rotate right)
            if (button.hasPointerCapture && button.hasPointerCapture(event.pointerId)) {
                button.releasePointerCapture(event.pointerId);
            }
            this.pressPointerAction(event.pointerId, button.dataset.action);
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

    handlePointerMove(event) {
        if (event.pointerId === this.joystick.pointerId) {
            this.joystick.x = event.clientX;
            this.joystick.y = event.clientY;
            this.updateJoystickVisual(true);
            return;
        }
        const current = this.pointerActions.get(event.pointerId);
        if (current === undefined || !this.isContinuous(current)) return;
        const button = this.buttonAt(event.clientX, event.clientY);
        const next = button ? button.dataset.action : null;
        // Slide onto another continuous control: switch; slide off everything: keep holding
        if (next && next !== current && this.isContinuous(next)) {
            this.releasePointer(event.pointerId);
            this.pressPointerAction(event.pointerId, next);
        }
    }

    handlePointerUp(event) {
        if (event.pointerId === this.joystick.pointerId) {
            this.releaseJoystick();
            return;
        }
        this.releasePointer(event.pointerId);
    }

    releaseJoystick() {
        this.joystick.pointerId = null;
        this.updateJoystickVisual(false);
    }

    // Current stick state: angle in radians (0 = right, y down like the canvas) and
    // magnitude 0..1 (clamped at joystickRadius).
    // Falls back to the controller's left stick while playing (a touch stick wins).
    getJoystick() {
        const j = this.joystick;
        if (j.pointerId === null) {
            const g = this.gamepadStick;
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

    // Move the on-screen stick base/knob (optional DOM elements) to follow the finger
    updateJoystickVisual(active) {
        if (typeof document === 'undefined' || !document.getElementById) return;
        const base = document.getElementById('joystick-base');
        const knob = document.getElementById('joystick-knob');
        if (!base || !knob) return;
        base.classList.toggle('active', active);
        if (!active) {
            // Back to the resting hint position defined in CSS
            base.style.left = '';
            base.style.top = '';
            knob.style.transform = '';
            return;
        }
        const j = this.joystick;
        const { angle, magnitude } = this.getJoystick();
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
        if (context !== 'game') this.gamepadStick = INACTIVE_STICK;
    }

    // Poll every controller once per frame (before taps and key handling). Held actions feed
    // isPressed(), new presses the one-shot queue (continuous ones are latched so a quick
    // press still counts). Returns { result (per pad), merged }.
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
        this.gamepadHeld = new Set([...merged.held].filter(a => this.isContinuous(a)));
        this.gamepadPressed = merged.pressed;
        this.gamepadStick = this.context === 'game' ? merged.stick : INACTIVE_STICK;
        for (const action of merged.pressed) {
            if (this.isContinuous(action)) this.latched.add(action);
            else this.singlePressActions[action] = true;
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
        this.gamepadHeld = new Set();
        this.gamepadPressed = new Set();
        this.gamepadStick = INACTIVE_STICK;
    }

    // Release everything (window blur, tab hidden, state changes)
    releaseAll() {
        this.suppressGamepad();
        for (const action in this.keys) this.keys[action] = false;
        for (const action in this.keyProcessed) this.keyProcessed[action] = false;
        for (const action of this.pointerActions.values()) this.setButtonActive(action, false);
        this.pointerActions.clear();
        this.latched.clear();
        this.releaseJoystick();
    }

    // Drop queued one-shot actions and taps (called on game state transitions so a key
    // pressed in one screen, e.g. 'S' while typing a name, doesn't fire in the next)
    clearPending() {
        for (const action in this.singlePressActions) this.singlePressActions[action] = false;
        this.pendingTaps.length = 0;
        this.charQueue.length = 0;
        this.latched.clear();
        // Controller buttons held now (e.g. the Ⓐ that pressed "Start") must not act again
        // in the next screen until they are released and pressed again.
        this.suppressGamepad();
    }

    // Called once per game frame after input has been read
    endFrame() {
        this.latched.clear();
    }

    // Programmatically trigger a one-shot action (used by tap handling)
    triggerAction(action) {
        this.singlePressActions[action] = true;
    }

    // Check continuous state (keyboard or any finger holding the button)
    isPressed(action) {
        if (this.keys[action] || this.latched.has(action) || this.gamepadHeld.has(action)) return true;
        for (const held of this.pointerActions.values()) {
            if (held === action) return true;
        }
        return false;
    }

    // Check and consume single-press state
    consumeAction(action) {
        if (this.singlePressActions[action]) {
            this.singlePressActions[action] = false;
            return true;
        }
        return false;
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
