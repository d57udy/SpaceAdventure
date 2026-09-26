import { test } from 'node:test';
import assert from 'node:assert/strict';

// --- Minimal browser fakes -------------------------------------------------
function makeTarget() {
    const handlers = {};
    return {
        handlers,
        addEventListener(type, fn) { (handlers[type] ||= []).push(fn); },
        removeEventListener(type, fn) {
            handlers[type] = (handlers[type] || []).filter(h => h !== fn);
        },
        dispatch(type, event) { (handlers[type] || []).forEach(h => h(event)); },
    };
}

function installFakes() {
    const win = makeTarget();
    const doc = makeTarget();
    doc.buttons = [];
    doc.elementAtPoint = null;
    doc.querySelectorAll = (sel) => {
        const m = sel.match(/data-action="([^"]+)"/);
        return doc.buttons.filter(b => m && b.dataset.action === m[1]);
    };
    doc.elementFromPoint = () => doc.elementAtPoint;
    globalThis.window = win;
    globalThis.document = doc;
    return { win, doc };
}

installFakes();
const { InputHandler } = await import('../../js/input.js');

function setup(canvas = null, options = undefined) {
    const env = installFakes();
    const input = new InputHandler(canvas, options);
    return { ...env, input };
}

function keyEvent(key, target = null) {
    return { key, target, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; } };
}

function makeButton(action) {
    const classes = new Set();
    const btn = {
        dataset: { action },
        classList: {
            toggle(c, on) { on ? classes.add(c) : classes.delete(c); },
            contains: (c) => classes.has(c),
        },
        hasPointerCapture: () => false,
        releasePointerCapture() {},
    };
    btn.closest = (sel) => (sel.includes('.touch-btn') ? btn : null);
    return btn;
}

function pointerEvent(target, pointerId, extra = {}) {
    return {
        target, pointerId, pointerType: 'touch', button: 0,
        defaultPrevented: false, preventDefault() { this.defaultPrevented = true; },
        ...extra,
    };
}

// --- Keyboard --------------------------------------------------------------

test('registers keyboard and pointer listeners; destroy() removes them', () => {
    const { win, doc, input } = setup();
    assert.equal(win.handlers.keydown.length, 1);
    assert.equal(win.handlers.keyup.length, 1);
    assert.equal(win.handlers.blur.length, 1);
    assert.equal(doc.handlers.pointerdown.length, 1);
    input.destroy();
    assert.equal(win.handlers.keydown.length, 0);
    assert.equal(win.handlers.blur.length, 0);
    assert.equal(doc.handlers.pointerdown.length, 0);
    assert.equal(doc.handlers.pointercancel.length, 0);
});

test('continuous actions (thrust/rotate/fire) set on keydown and cleared on keyup', () => {
    const { win, input } = setup();
    for (const [key, action] of [['ArrowUp', 'thrust'], ['a', 'rotateLeft'], ['D', 'rotateRight'], [' ', 'fire']]) {
        input.endFrame(); assert.equal(input.isPressed(action), false);
        const ev = keyEvent(key);
        win.dispatch('keydown', ev);
        assert.equal(input.isPressed(action), true, `${key} -> ${action}`);
        assert.equal(ev.defaultPrevented, true);
        // Continuous actions are not consumable one-shots
        assert.equal(input.consumeAction(action), false);
        win.dispatch('keyup', keyEvent(key));
        input.endFrame(); assert.equal(input.isPressed(action), false);
    }
});

test('single-press actions are consumed once', () => {
    const { win, input } = setup();
    win.dispatch('keydown', keyEvent('h'));
    assert.equal(input.consumeAction('hyperspace'), true);
    assert.equal(input.consumeAction('hyperspace'), false);

    win.dispatch('keydown', keyEvent('p'));
    assert.equal(input.consumeAction('pause'), true);
    assert.equal(input.consumeAction('pause'), false);

    win.dispatch('keydown', keyEvent('Enter'));
    assert.equal(input.consumeAction('menuSelect'), true);
    assert.equal(input.consumeAction('enter'), true);
    assert.equal(input.consumeAction('menuSelect'), false);
});

test('auto-repeat keydown does not retrigger a single-press action until keyup', () => {
    const { win, input } = setup();
    win.dispatch('keydown', keyEvent('H'));
    assert.equal(input.consumeAction('hyperspace'), true);
    win.dispatch('keydown', keyEvent('H')); // auto-repeat
    win.dispatch('keydown', keyEvent('H'));
    assert.equal(input.consumeAction('hyperspace'), false);
    win.dispatch('keyup', keyEvent('H'));
    win.dispatch('keydown', keyEvent('H'));
    assert.equal(input.consumeAction('hyperspace'), true);
});

test('a key mapped to both continuous and single actions drives both (ArrowUp -> thrust + menuUp)', () => {
    const { win, input } = setup();
    win.dispatch('keydown', keyEvent('ArrowUp'));
    assert.equal(input.isPressed('thrust'), true);
    assert.equal(input.consumeAction('menuUp'), true);
});

test('keys whose target is an INPUT (or TEXTAREA) are ignored', () => {
    const { win, input } = setup();
    for (const tagName of ['INPUT', 'TEXTAREA']) {
        const ev = keyEvent('w', { tagName });
        win.dispatch('keydown', ev);
        input.endFrame(); assert.equal(input.isPressed('thrust'), false);
        assert.equal(input.consumeAction('key_W'), false);
        assert.equal(ev.defaultPrevented, false);
    }
    // non-input targets are handled
    win.dispatch('keydown', keyEvent('w', { tagName: 'CANVAS' }));
    assert.equal(input.isPressed('thrust'), true);
});

test('unmapped keys are ignored without preventing default', () => {
    const { win, input } = setup();
    const ev = keyEvent('F5');
    win.dispatch('keydown', ev);
    assert.equal(ev.defaultPrevented, false);
    assert.equal(Object.values(input.singlePressActions).some(Boolean), false);
});

test('clearPending() drops queued single-press actions and taps', () => {
    const { win, input } = setup();
    win.dispatch('keydown', keyEvent('p'));
    win.dispatch('keydown', keyEvent('s'));
    input.pendingTaps.push({ x: 1, y: 2 });
    input.clearPending();
    assert.equal(input.consumeAction('pause'), false);
    assert.equal(input.consumeAction('hyperspace'), false);
    assert.equal(input.consumeLastCharKey(), null);
    assert.equal(input.consumeTap(), null);
});

test('clearPending() does not re-arm a held key (still needs keyup)', () => {
    const { win, input } = setup();
    win.dispatch('keydown', keyEvent('p'));
    input.clearPending();
    win.dispatch('keydown', keyEvent('p')); // auto-repeat
    assert.equal(input.consumeAction('pause'), false);
});

test('releaseAll() clears held keys, repeat guards and pointer holds', () => {
    const { win, doc, input } = setup();
    const btn = makeButton('fire');
    doc.buttons.push(btn);
    win.dispatch('keydown', keyEvent('ArrowUp'));
    win.dispatch('keydown', keyEvent('h'));
    input.consumeAction('hyperspace');
    doc.dispatch('pointerdown', pointerEvent(btn, 1));
    assert.equal(btn.classList.contains('active'), true);

    input.releaseAll();
    input.endFrame(); assert.equal(input.isPressed('thrust'), false);
    input.endFrame(); assert.equal(input.isPressed('fire'), false);
    assert.equal(btn.classList.contains('active'), false);
    assert.equal(input.pointerActions.size, 0);
    // repeat guard reset: next keydown triggers again
    win.dispatch('keydown', keyEvent('h'));
    assert.equal(input.consumeAction('hyperspace'), true);
});

test('window blur releases everything', () => {
    const { win, input } = setup();
    win.dispatch('keydown', keyEvent('ArrowLeft'));
    win.dispatch('blur', {});
    input.endFrame(); assert.equal(input.isPressed('rotateLeft'), false);
});

test('triggerAction() queues a one-shot action', () => {
    const { input } = setup();
    input.triggerAction('menuSelect');
    assert.equal(input.consumeAction('menuSelect'), true);
    assert.equal(input.consumeAction('menuSelect'), false);
});

test('consumeLastCharKey() returns uppercase chars for letters and digits', () => {
    const { win, input } = setup();
    win.dispatch('keydown', keyEvent('q'));
    assert.equal(input.consumeLastCharKey(), 'Q');
    assert.equal(input.consumeLastCharKey(), null);
    win.dispatch('keydown', keyEvent('Z'));
    assert.equal(input.consumeLastCharKey(), 'Z');
    win.dispatch('keydown', keyEvent('7'));
    assert.equal(input.consumeLastCharKey(), '7');
});

// --- Pointer ---------------------------------------------------------------

test('pointerdown on a touch button presses its action; pointerup releases it', () => {
    const { doc, input } = setup();
    const btn = makeButton('thrust');
    doc.buttons.push(btn);
    const ev = pointerEvent(btn, 7);
    doc.dispatch('pointerdown', ev);
    assert.equal(ev.defaultPrevented, true);
    assert.equal(input.isPressed('thrust'), true);
    assert.equal(btn.classList.contains('active'), true);
    doc.dispatch('pointerup', pointerEvent(btn, 7));
    input.endFrame(); assert.equal(input.isPressed('thrust'), false);
    assert.equal(btn.classList.contains('active'), false);
});

test('pointercancel also releases the pointer', () => {
    const { doc, input } = setup();
    const btn = makeButton('fire');
    doc.dispatch('pointerdown', pointerEvent(btn, 3));
    doc.dispatch('pointercancel', pointerEvent(btn, 3));
    input.endFrame(); assert.equal(input.isPressed('fire'), false);
});

test('pointerdown on a single-press button queues a one-shot action', () => {
    const { doc, input } = setup();
    const btn = makeButton('hyperspace');
    doc.dispatch('pointerdown', pointerEvent(btn, 1));
    assert.equal(input.consumeAction('hyperspace'), true);
    assert.equal(input.consumeAction('hyperspace'), false);
});

test('two pointers holding the same action are released one at a time', () => {
    const { doc, input } = setup();
    const btn = makeButton('fire');
    doc.buttons.push(btn);
    doc.dispatch('pointerdown', pointerEvent(btn, 1));
    doc.dispatch('pointerdown', pointerEvent(btn, 2));
    doc.dispatch('pointerup', pointerEvent(btn, 1));
    assert.equal(input.isPressed('fire'), true);
    assert.equal(btn.classList.contains('active'), true);
    doc.dispatch('pointerup', pointerEvent(btn, 2));
    input.endFrame(); assert.equal(input.isPressed('fire'), false);
    assert.equal(btn.classList.contains('active'), false);
});

test('pointerup for an unknown pointer is a no-op', () => {
    const { doc, input } = setup();
    const btn = makeButton('fire');
    doc.dispatch('pointerdown', pointerEvent(btn, 1));
    doc.dispatch('pointerup', pointerEvent(btn, 99));
    assert.equal(input.isPressed('fire'), true);
});

test('sliding a finger from one continuous button to another switches action', () => {
    const { doc, input } = setup();
    const left = makeButton('rotateLeft');
    const right = makeButton('rotateRight');
    doc.buttons.push(left, right);
    doc.dispatch('pointerdown', pointerEvent(left, 5));
    doc.elementAtPoint = right;
    doc.dispatch('pointermove', pointerEvent(null, 5, { clientX: 1, clientY: 1 }));
    input.endFrame(); assert.equal(input.isPressed('rotateLeft'), false);
    assert.equal(input.isPressed('rotateRight'), true);
    assert.equal(left.classList.contains('active'), false);
    assert.equal(right.classList.contains('active'), true);
    // sliding off everything keeps holding
    doc.elementAtPoint = null;
    doc.dispatch('pointermove', pointerEvent(null, 5, { clientX: 999, clientY: 999 }));
    assert.equal(input.isPressed('rotateRight'), true);
});

function makeCanvas() {
    const canvas = {
        width: 1600, height: 1200,
        getBoundingClientRect: () => ({ left: 100, top: 50, width: 800, height: 600 }),
    };
    return canvas;
}

test('canvas taps map to logical pixels regardless of the backing-store size', () => {
    // Backing 1600x1200 (HiDPI), CSS rect 800x600 at (100, 50), logical 800x600
    const canvas = makeCanvas();
    const { doc, input } = setup(canvas, { getLogicalSize: () => ({ width: 800, height: 600 }) });
    const ev = pointerEvent(canvas, 1, { clientX: 300, clientY: 200 });
    doc.dispatch('pointerdown', ev);
    assert.equal(ev.defaultPrevented, true);
    assert.deepEqual(input.consumeTap(), { x: 200, y: 150 });
    assert.equal(input.consumeTap(), null);
    canvas.width = 800; canvas.height = 600; // backing size is irrelevant
    doc.dispatch('pointerdown', pointerEvent(canvas, 2, { clientX: 300, clientY: 200 }));
    assert.deepEqual(input.consumeTap(), { x: 200, y: 150 });
});

test('canvas taps scale to a logical size different from the CSS size', () => {
    const canvas = makeCanvas();
    const { doc, input } = setup(canvas, { getLogicalSize: () => ({ width: 400, height: 300 }) });
    doc.dispatch('pointerdown', pointerEvent(canvas, 1, { clientX: 300, clientY: 200 }));
    assert.deepEqual(input.consumeTap(), { x: 100, y: 75 });
});

test('canvas taps without a logical-size provider fall back to CSS pixels', () => {
    const canvas = makeCanvas();
    const { doc, input } = setup(canvas);
    doc.dispatch('pointerdown', pointerEvent(canvas, 1, { clientX: 300, clientY: 200 }));
    assert.deepEqual(input.consumeTap(), { x: 200, y: 150 });
});

test('canvas taps: non-primary mouse buttons and zero-size rects are ignored', () => {
    const canvas = makeCanvas();
    const { doc, input } = setup(canvas);
    doc.dispatch('pointerdown', pointerEvent(canvas, 1, { pointerType: 'mouse', button: 2, clientX: 300, clientY: 200 }));
    assert.equal(input.consumeTap(), null);
    canvas.getBoundingClientRect = () => ({ left: 0, top: 0, width: 0, height: 0 });
    doc.dispatch('pointerdown', pointerEvent(canvas, 1, { clientX: 300, clientY: 200 }));
    assert.equal(input.consumeTap(), null);
});

test('pointerdown on some other element does nothing', () => {
    const { doc, input } = setup(makeCanvas());
    const other = { closest: () => null };
    const ev = pointerEvent(other, 1, { clientX: 1, clientY: 1 });
    doc.dispatch('pointerdown', ev);
    assert.equal(ev.defaultPrevented, false);
    assert.equal(input.consumeTap(), null);
    assert.equal(input.pointerActions.size, 0);
});

test('touchstart on game surfaces is prevented, elsewhere it is not', () => {
    const { doc } = setup();
    const onGame = { target: { closest: () => ({}) }, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; } };
    const offGame = { target: { closest: () => null }, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; } };
    doc.dispatch('touchstart', onGame);
    doc.dispatch('touchstart', offGame);
    assert.equal(onGame.defaultPrevented, true);
    assert.equal(offGame.defaultPrevented, false);
});

test('a press released within the same frame still counts until endFrame() (quick taps fire)', () => {
    const { doc, input } = setup();
    const btn = makeButton('fire');
    doc.buttons.push(btn);
    doc.dispatch('pointerdown', pointerEvent(btn, 7));
    doc.dispatch('pointerup', pointerEvent(btn, 7));
    assert.equal(input.isPressed('fire'), true);
    input.endFrame();
    assert.equal(input.isPressed('fire'), false);
});

test('consumeLastCharKey() keeps typed order and repeated letters', () => {
    const { win, input } = setup();
    for (const k of ['z', 'y', 'x', 'w']) {
        win.dispatch('keydown', keyEvent(k));
        win.dispatch('keyup', keyEvent(k));
    }
    win.dispatch('keydown', keyEvent('a'));
    win.dispatch('keyup', keyEvent('a'));
    win.dispatch('keydown', keyEvent('a'));
    const typed = [];
    let c;
    while ((c = input.consumeLastCharKey())) typed.push(c);
    assert.equal(typed.join(''), 'ZYXWAA');
});


// --- Drag-to-steer joystick -------------------------------------------------

function makeZone() {
    const zone = {};
    zone.closest = (sel) => (sel === '.joystick-zone' ? zone : null);
    return zone;
}

const near = (a, b, eps = 1e-9) => Math.abs(a - b) < eps;

function pressZone(doc, pointerId = 1, x = 100, y = 200) {
    const zone = makeZone();
    const ev = pointerEvent(zone, pointerId, { clientX: x, clientY: y });
    doc.dispatch('pointerdown', ev);
    return { zone, ev };
}

test('joystick is inactive by default', () => {
    const { input } = setup();
    assert.deepEqual(input.getJoystick(), { active: false, angle: 0, magnitude: 0 });
});

test('pointerdown in the joystick zone activates the stick at magnitude 0 and prevents default', () => {
    const { doc, input } = setup();
    const { ev } = pressZone(doc, 1, 100, 200);
    assert.equal(ev.defaultPrevented, true);
    const j = input.getJoystick();
    assert.equal(j.active, true);
    assert.equal(j.magnitude, 0);
    assert.equal(input.joystick.originX, 100);
    assert.equal(input.joystick.originY, 200);
});

test('dragging sets angle and magnitude (clamped to 1)', () => {
    const { doc, input } = setup();
    input.joystickRadius = 60;
    pressZone(doc, 1, 100, 200);

    doc.dispatch('pointermove', pointerEvent(null, 1, { clientX: 130, clientY: 200 }));
    let j = input.getJoystick();
    assert.ok(near(j.angle, 0), `angle ${j.angle}`);
    assert.ok(near(j.magnitude, 0.5), `magnitude ${j.magnitude}`);

    doc.dispatch('pointermove', pointerEvent(null, 1, { clientX: 100, clientY: 400 }));
    j = input.getJoystick();
    assert.ok(near(j.angle, Math.PI / 2), `angle ${j.angle}`);
    assert.equal(j.magnitude, 1);

    // left and up use canvas conventions (y down)
    doc.dispatch('pointermove', pointerEvent(null, 1, { clientX: 70, clientY: 200 }));
    assert.ok(near(Math.abs(input.getJoystick().angle), Math.PI));
    doc.dispatch('pointermove', pointerEvent(null, 1, { clientX: 100, clientY: 170 }));
    assert.ok(near(input.getJoystick().angle, -Math.PI / 2));
});

test('a second pointer pressing the zone while the stick is held is ignored', () => {
    const { doc, input } = setup();
    input.joystickRadius = 60;
    pressZone(doc, 1, 100, 200);
    const { ev } = pressZone(doc, 2, 500, 500);
    assert.equal(ev.defaultPrevented, true);
    assert.equal(input.joystick.pointerId, 1);
    assert.equal(input.joystick.originX, 100);
    assert.equal(input.joystick.originY, 200);

    // moves from the second pointer do not affect the stick
    doc.dispatch('pointermove', pointerEvent(null, 2, { clientX: 900, clientY: 900 }));
    assert.equal(input.getJoystick().magnitude, 0);

    // releasing the second pointer does not release the stick
    doc.dispatch('pointerup', pointerEvent(null, 2));
    assert.equal(input.getJoystick().active, true);
    doc.dispatch('pointercancel', pointerEvent(null, 2));
    assert.equal(input.getJoystick().active, true);

    // owner still drives it
    doc.dispatch('pointermove', pointerEvent(null, 1, { clientX: 130, clientY: 200 }));
    assert.ok(near(input.getJoystick().magnitude, 0.5));
});

test('pointerup of the owning pointer releases the stick', () => {
    const { doc, input } = setup();
    pressZone(doc, 4);
    doc.dispatch('pointerup', pointerEvent(null, 4));
    assert.deepEqual(input.getJoystick(), { active: false, angle: 0, magnitude: 0 });
    assert.equal(input.joystick.pointerId, null);
});

test('pointercancel of the owning pointer releases the stick', () => {
    const { doc, input } = setup();
    pressZone(doc, 4);
    doc.dispatch('pointercancel', pointerEvent(null, 4));
    assert.equal(input.getJoystick().active, false);
});

test('after release a new pointer can take the stick with a new origin', () => {
    const { doc, input } = setup();
    pressZone(doc, 1, 100, 200);
    doc.dispatch('pointerup', pointerEvent(null, 1));
    pressZone(doc, 2, 300, 50);
    assert.equal(input.joystick.pointerId, 2);
    assert.equal(input.joystick.originX, 300);
    assert.equal(input.joystick.originY, 50);
    assert.equal(input.getJoystick().magnitude, 0);
});

test('releaseAll() and window blur release the joystick', () => {
    const { win, doc, input } = setup();
    pressZone(doc, 1);
    input.releaseAll();
    assert.equal(input.getJoystick().active, false);

    pressZone(doc, 2);
    assert.equal(input.getJoystick().active, true);
    win.dispatch('blur', {});
    assert.equal(input.getJoystick().active, false);
});

test('the joystick pointer does not register any button/continuous action', () => {
    const { doc, input } = setup();
    input.joystickRadius = 60;
    pressZone(doc, 1);
    doc.dispatch('pointermove', pointerEvent(null, 1, { clientX: 160, clientY: 200 }));
    for (const action of Object.keys(input.keyToAction)) {
        assert.equal(input.isPressed(action), false, action);
        assert.equal(input.consumeAction(action), false, action);
    }
    assert.equal(input.pointerActions.size, 0);
    assert.equal(input.consumeTap(), null);
});

test('a joystick pointerdown on the canvas-like zone does not create a tap', () => {
    const canvas = makeCanvas();
    const { doc, input } = setup(canvas);
    pressZone(doc, 1, 300, 200);
    assert.equal(input.consumeTap(), null);
});

test('touch buttons work independently while the joystick is held (multi-touch)', () => {
    const { doc, input } = setup();
    input.joystickRadius = 60;
    const fire = makeButton('fire');
    doc.buttons.push(fire);
    pressZone(doc, 1, 100, 200);
    doc.dispatch('pointerdown', pointerEvent(fire, 2));
    assert.equal(input.isPressed('fire'), true);
    assert.equal(fire.classList.contains('active'), true);

    doc.dispatch('pointermove', pointerEvent(null, 1, { clientX: 130, clientY: 200 }));
    assert.ok(near(input.getJoystick().magnitude, 0.5));
    assert.equal(input.isPressed('fire'), true);

    // releasing the button keeps the stick; releasing the stick keeps nothing else
    doc.dispatch('pointerup', pointerEvent(fire, 2));
    input.endFrame();
    assert.equal(input.isPressed('fire'), false);
    assert.equal(input.getJoystick().active, true);

    doc.dispatch('pointerdown', pointerEvent(fire, 3));
    doc.dispatch('pointerup', pointerEvent(null, 1));
    assert.equal(input.getJoystick().active, false);
    assert.equal(input.isPressed('fire'), true);
});

test('pointerdown on a zone does not treat it as a touch button even if it also matches one', () => {
    const { doc, input } = setup();
    const zone = { dataset: { action: 'fire' } };
    zone.closest = (sel) => (sel === '.joystick-zone' || sel.includes('.touch-btn') ? zone : null);
    doc.dispatch('pointerdown', pointerEvent(zone, 1, { clientX: 0, clientY: 0 }));
    assert.equal(input.getJoystick().active, true);
    assert.equal(input.isPressed('fire'), false);
});

test('updateJoystickVisual is safe when document.getElementById is missing', () => {
    const { doc, input } = setup();
    assert.equal(doc.getElementById, undefined);
    assert.doesNotThrow(() => {
        pressZone(doc, 1);
        doc.dispatch('pointermove', pointerEvent(null, 1, { clientX: 150, clientY: 200 }));
        doc.dispatch('pointerup', pointerEvent(null, 1));
        input.updateJoystickVisual(true);
        input.updateJoystickVisual(false);
        input.releaseAll();
    });
});

test('updateJoystickVisual is safe when getElementById returns null', () => {
    const { doc, input } = setup();
    doc.getElementById = () => null;
    assert.doesNotThrow(() => {
        pressZone(doc, 1);
        doc.dispatch('pointermove', pointerEvent(null, 1, { clientX: 150, clientY: 200 }));
        doc.dispatch('pointerup', pointerEvent(null, 1));
        input.releaseAll();
    });
    // only one of the two elements present
    const base = { classList: { toggle() {} }, style: {} };
    doc.getElementById = (id) => (id === 'joystick-base' ? base : null);
    assert.doesNotThrow(() => input.updateJoystickVisual(true));
    assert.deepEqual(base.style, {});
});

test('updateJoystickVisual positions base and knob when the elements exist', () => {
    const { doc, input } = setup();
    input.joystickRadius = 60;
    const makeEl = () => {
        const classes = new Set();
        return {
            style: {},
            classList: { toggle(c, on) { on ? classes.add(c) : classes.delete(c); }, contains: (c) => classes.has(c) },
        };
    };
    const base = makeEl();
    const knob = makeEl();
    doc.getElementById = (id) => ({ 'joystick-base': base, 'joystick-knob': knob })[id] || null;

    pressZone(doc, 1, 100, 200);
    assert.equal(base.classList.contains('active'), true);
    assert.equal(base.style.left, '100px');
    assert.equal(base.style.top, '200px');

    doc.dispatch('pointermove', pointerEvent(null, 1, { clientX: 400, clientY: 200 }));
    // knob clamped to the radius
    assert.match(knob.style.transform, /calc\(-50% \+ 60px\)/);

    doc.dispatch('pointerup', pointerEvent(null, 1));
    assert.equal(base.classList.contains('active'), false);
    assert.equal(base.style.left, '');
    assert.equal(base.style.top, '');
    assert.equal(knob.style.transform, '');
});
