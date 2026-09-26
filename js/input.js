// Unified input: keyboard, on-screen touch buttons (pointer events, multi-touch)
// and taps/clicks on the canvas (used for menu selection).
export class InputHandler {
    constructor(canvas = null) {
        this.canvas = canvas;
        this.keys = {}; // Continuous state from the keyboard (thrust, rotate, fire)
        this.singlePressActions = {}; // Consumable actions (hyperspace, pause, menu nav, typing)
        this.keyProcessed = {}; // Prevents keyboard auto-repeat for single press
        this.pointerActions = new Map(); // pointerId -> action held by an on-screen button
        this.pendingTaps = []; // Taps/clicks on the canvas in canvas pixel coordinates
        this.charQueue = []; // Typed characters in order (username entry)
        this.latched = new Set(); // Continuous actions pressed this frame (so quick taps still count)

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

        const actions = this.actionForKey[event.key];
        if (!actions) return;

        const shouldPreventDefault = actions.some(action =>
            ['thrust', 'rotateLeft', 'rotateRight', 'fire', 'hyperspace', 'enter', 'menuUp', 'menuDown', 'backspace'].includes(action)
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
            this.pendingTaps.push({
                x: (event.clientX - rect.left) * (this.canvas.width / rect.width),
                y: (event.clientY - rect.top) * (this.canvas.height / rect.height),
            });
        }
    }

    handlePointerMove(event) {
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
        this.releasePointer(event.pointerId);
    }

    // Release everything (window blur, tab hidden, state changes)
    releaseAll() {
        for (const action in this.keys) this.keys[action] = false;
        for (const action in this.keyProcessed) this.keyProcessed[action] = false;
        for (const action of this.pointerActions.values()) this.setButtonActive(action, false);
        this.pointerActions.clear();
        this.latched.clear();
    }

    // Drop queued one-shot actions and taps (called on game state transitions so a key
    // pressed in one screen, e.g. 'S' while typing a name, doesn't fire in the next)
    clearPending() {
        for (const action in this.singlePressActions) this.singlePressActions[action] = false;
        this.pendingTaps.length = 0;
        this.charQueue.length = 0;
        this.latched.clear();
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
        if (this.keys[action] || this.latched.has(action)) return true;
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
