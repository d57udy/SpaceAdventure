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

// Physical key code for a typed key on a US layout (what browsers send as event.code)
function codeFor(key) {
    if (key === ' ') return 'Space';
    if (/^[a-zA-Z]$/.test(key)) return `Key${key.toUpperCase()}`;
    if (/^[0-9]$/.test(key)) return `Digit${key}`;
    return key;
}

function keyEvent(key, target = null, code = codeFor(key), extra = {}) {
    return { key, code, target, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; }, ...extra };
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

test('ArrowLeft/A and ArrowRight/D also give single-press menuLeft/menuRight', () => {
    const { win, input } = setup();
    for (const [key, action, rotate] of [['ArrowLeft', 'menuLeft', 'rotateLeft'], ['a', 'menuLeft', 'rotateLeft'],
        ['ArrowRight', 'menuRight', 'rotateRight'], ['D', 'menuRight', 'rotateRight']]) {
        const ev = keyEvent(key);
        win.dispatch('keydown', ev);
        assert.equal(input.isPressed(rotate), true, key);
        assert.equal(input.consumeAction(action), true, key);
        assert.equal(input.consumeAction(action), false, `${key} consumed once`);
        win.dispatch('keydown', keyEvent(key)); // auto-repeat does not retrigger
        assert.equal(input.consumeAction(action), false, `${key} repeat`);
        win.dispatch('keyup', keyEvent(key));
        assert.equal(ev.defaultPrevented, true, key);
    }
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

test('Enter and Space on a focused DOM button activate the button, not the game', () => {
    const { win, input } = setup();
    const button = { tagName: 'BUTTON', classList: { contains: (c) => c === 'app-btn' } };
    for (const key of ['Enter', ' ']) {
        const ev = keyEvent(key, button);
        win.dispatch('keydown', ev);
        assert.equal(ev.defaultPrevented, false, `${key}: the browser must be allowed to click the button`);
        input.endFrame();
        assert.equal(input.consumeAction('menuSelect'), false, `${key}: no menu select`);
        assert.equal(input.isPressed('fire'), false, `${key}: no fire`);
        win.dispatch('keyup', keyEvent(key, button));
    }
    const numpad = keyEvent('Enter', button, 'NumpadEnter');
    win.dispatch('keydown', numpad);
    assert.equal(numpad.defaultPrevented, false);
    // Other keys on a button still drive the game (arrows keep moving the menu)
    const arrow = keyEvent('ArrowDown', button);
    win.dispatch('keydown', arrow);
    assert.equal(arrow.defaultPrevented, true);
    // Space on the canvas still fires
    win.dispatch('keydown', keyEvent(' ', { tagName: 'CANVAS' }));
    assert.equal(input.isPressed('fire'), true);
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

test('touchstart on an .app-btn (Full screen / Install) is never prevented', () => {
    const { doc } = setup();
    // A real browser: .app-btn elements are not .touch-btn, so the selector does not match them
    const appBtn = { target: { closest: (sel) => (sel.includes(':not(.app-btn)') ? null : {}) },
        defaultPrevented: false, preventDefault() { this.defaultPrevented = true; } };
    doc.dispatch('touchstart', appBtn);
    assert.equal(appBtn.defaultPrevented, false);
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
    for (const action of ['thrust', 'rotateLeft', 'rotateRight', 'fire', 'hyperspace', 'pause', 'enter',
        'escape', 'toggleMute', 'menuUp', 'menuDown', 'menuLeft', 'menuRight', 'menuSelect', 'backspace']) {
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

// --- Game controllers ------------------------------------------------------

const { GamepadPoller, GP } = await import('../../js/gamepad.js');

class FakePad {
    constructor(index = 0, id = 'Xbox Wireless Controller (STANDARD GAMEPAD Vendor: 045e Product: 0b13)') {
        this.index = index;
        this.id = id;
        this.mapping = 'standard';
        this.connected = true;
        this.buttons = Array.from({ length: 17 }, () => ({ pressed: false, value: 0 }));
        this.axes = [0, 0, 0, 0];
    }
    press(b, value = 1) { this.buttons[b] = { pressed: value > 0.5, value }; return this; }
    release(b) { this.buttons[b] = { pressed: false, value: 0 }; return this; }
    stick(x, y) { this.axes[0] = x; this.axes[1] = y; return this; }
}

function setupPads(pads = [new FakePad()]) {
    const env = { list: pads, t: 0 };
    const poller = new GamepadPoller({ getGamepads: () => env.list, now: () => env.t });
    const { input, doc } = setup(null, { gamepadPoller: poller });
    return { env, input, doc, pad: pads[0] };
}

function joystickZone() {
    const zone = { closest: (sel) => (sel === '.joystick-zone' ? zone : null) };
    return zone;
}

test('gamepad: held A fires in the game context; a new press is latched for the frame', () => {
    const { input, pad } = setupPads();
    input.setContext('game');
    pad.press(GP.A);
    input.pollGamepads();
    assert.equal(input.isPressed('fire'), true);
    input.endFrame();
    input.pollGamepads();
    assert.equal(input.isPressed('fire'), true, 'still held');
    pad.release(GP.A);
    input.pollGamepads();
    assert.equal(input.isPressed('fire'), false);
});

test('gamepad: menu presses feed one-shot actions (A = menuSelect, B = escape)', () => {
    const { input, pad } = setupPads();
    input.setContext('menu');
    pad.press(GP.A);
    input.pollGamepads();
    assert.equal(input.consumeAction('menuSelect'), true);
    assert.equal(input.consumeAction('menuSelect'), false);
    assert.equal(input.gamepadJustPressed('menuSelect'), true);
    input.pollGamepads();
    assert.equal(input.consumeAction('menuSelect'), false, 'held is not a new press');
    pad.release(GP.A).press(GP.B);
    input.pollGamepads();
    assert.equal(input.consumeAction('escape'), true);
    assert.equal(input.isPressed('fire'), false, 'no fire outside the game context');
});

test('gamepad: Ⓐ that selected Start does not fire after the state change (clearPending suppresses it)', () => {
    const { input, pad } = setupPads();
    input.setContext('menu');
    pad.press(GP.A);
    input.pollGamepads();
    assert.equal(input.consumeAction('menuSelect'), true);
    input.clearPending(); // state transition
    input.setContext('game');
    input.pollGamepads();
    assert.equal(input.isPressed('fire'), false);
    pad.release(GP.A);
    input.pollGamepads();
    pad.press(GP.A);
    input.pollGamepads();
    assert.equal(input.isPressed('fire'), true, 'a fresh press fires');
});

test('gamepad: releaseAll() also suppresses held controller buttons', () => {
    const { input, pad } = setupPads();
    input.setContext('game');
    pad.press(GP.RT);
    input.pollGamepads();
    assert.equal(input.isPressed('fire'), true);
    input.releaseAll();
    assert.equal(input.isPressed('fire'), false);
    input.endFrame();
    input.pollGamepads();
    assert.equal(input.isPressed('fire'), false);
});

test('getJoystick(): controller stick while playing; the touch stick wins when both are active', () => {
    const { input, pad } = setupPads();
    pad.stick(0.7, 0);
    input.setContext('menu');
    input.pollGamepads();
    assert.equal(input.getJoystick().active, false, 'menus use the stick for navigation only');
    input.setContext('game');
    input.pollGamepads();
    const j = input.getJoystick();
    assert.equal(j.active, true);
    assert.ok(Math.abs(j.angle) < 1e-9);
    assert.ok(Math.abs(j.magnitude - (0.7 - 0.15) / 0.85) < 1e-9);
    // A finger on the drag-to-steer zone takes over
    input.handlePointerDown(pointerEvent(joystickZone(), 5, { clientX: 100, clientY: 100 }));
    input.handlePointerMove(pointerEvent(null, 5, { clientX: 100, clientY: 160 }));
    const t = input.getJoystick();
    assert.ok(Math.abs(t.angle - Math.PI / 2) < 1e-9, 'touch stick points down');
    input.handlePointerUp(pointerEvent(null, 5));
    assert.equal(input.getJoystick().source, 'gamepad');
});

test('lastInputSource follows keyboard, touch, mouse and controller input', () => {
    const { input, pad, win } = { ...setupPads() };
    assert.equal(input.lastInputSource, null);
    globalThis.window.dispatch('keydown', keyEvent('ArrowUp'));
    assert.equal(input.lastInputSource, 'keyboard');
    input.handlePointerDown(pointerEvent({}, 1));
    assert.equal(input.lastInputSource, 'touch');
    input.handlePointerDown(pointerEvent({}, 2, { pointerType: 'mouse' }));
    assert.equal(input.lastInputSource, 'mouse');
    input.pollGamepads();
    assert.equal(input.lastInputSource, 'mouse', 'an idle controller does not take over');
    pad.press(GP.B);
    input.pollGamepads();
    assert.equal(input.lastInputSource, 'gamepad');
    void win;
});

test('gamepad connect/disconnect events and info', () => {
    const { input, env } = setupPads();
    input.pollGamepads();
    let ev = input.consumeGamepadEvents();
    assert.deepEqual(ev.map(e => e.type), ['connected']);
    assert.equal(ev[0].family, 'xbox');
    assert.deepEqual(input.gamepadInfo(), {
        connected: true, count: 1, index: 0, id: env.list[0].id, family: 'xbox', mapping: 'standard',
    });
    assert.deepEqual(input.consumeGamepadEvents(), []);
    env.list = [null];
    input.pollGamepads();
    ev = input.consumeGamepadEvents();
    assert.deepEqual(ev.map(e => e.type), ['disconnected']);
    assert.equal(input.gamepadInfo().connected, false);
});

test('two controllers are merged in single-player: either one drives the ship', () => {
    const a = new FakePad(0);
    const b = new FakePad(1, 'DualSense Wireless Controller');
    const { input } = setupPads([a, b]);
    input.setContext('game');
    b.press(GP.LT);
    a.press(GP.RT);
    input.pollGamepads();
    assert.equal(input.isPressed('thrust'), true);
    assert.equal(input.isPressed('fire'), true);
    assert.equal(input.gamepadResult.pads.length, 2, 'per-pad results are kept');
});

test('setContext() ignores unknown contexts (falls back to menu)', () => {
    const { input } = setupPads();
    input.setContext('game');
    input.setContext('bogus');
    assert.equal(input.context, 'menu');
});

// --- Seats: physical keys, per-key holds, seat routing (plan §8, §13.1) -----

const { PALM_IDLE_MS, PALM_MOVE_PX, SOURCE_EVENT_LIMIT, codeOf } = await import('../../js/input.js');

const down = (win, key, code) => win.dispatch('keydown', keyEvent(key, null, code));
const up = (win, key, code) => win.dispatch('keyup', keyEvent(key, null, code));

// Seat mode with the given sources joined in order (seat 0, 1, ...)
function seatSetup(sources = ['kbLeft', 'kbRight'], options = undefined) {
    const env = setup(null, options);
    env.input.setMerged(false);
    for (const s of sources) env.input.seats.join(s);
    return env;
}

function zoneEl(zone = 'a') {
    const zoneWrap = { dataset: { zone } };
    const el = {};
    el.closest = (sel) => (sel === '.joystick-zone' ? el : sel === '[data-zone]' ? zoneWrap : null);
    return el;
}

function zoneButton(action, zone) {
    const btn = makeButton(action);
    const zoneWrap = { dataset: { zone } };
    btn.closest = (sel) => (sel.includes('.touch-btn') ? btn : sel === '[data-zone]' ? zoneWrap : null);
    return btn;
}

test('keys match by physical position (event.code): AZERTY Z/Q steer like W/A', () => {
    const { win, input } = setup();
    down(win, 'z', 'KeyW');
    assert.equal(input.isPressed('thrust'), true);
    down(win, 'q', 'KeyA');
    assert.equal(input.isPressed('rotateLeft'), true);
    // typing still uses the typed character
    assert.equal(input.consumeLastCharKey(), 'Z');
    assert.equal(input.consumeLastCharKey(), 'Q');
    up(win, 'z', 'KeyW');
    up(win, 'q', 'KeyA');
    input.endFrame();
    assert.equal(input.isPressed('thrust'), false);
    assert.equal(input.isPressed('rotateLeft'), false);
    // QWERTZ: the key labelled Y sits where Z is; typing gives Y, no game action
    down(win, 'y', 'KeyZ');
    assert.equal(input.consumeLastCharKey(), 'Y');
    input.endFrame();
    for (const a of ['thrust', 'rotateLeft', 'rotateRight', 'fire']) assert.equal(input.isPressed(a), false);
});

test('merged mode: both key sets, F and numpad keys drive seat 0', () => {
    const { win, input } = setup();
    for (const [code, action] of [['KeyW', 'thrust'], ['ArrowUp', 'thrust'], ['Numpad8', 'thrust'],
        ['KeyF', 'fire'], ['Space', 'fire'], ['Numpad4', 'rotateLeft'], ['Numpad6', 'rotateRight']]) {
        down(win, '', code);
        assert.equal(input.isPressed(action), true, code);
        assert.equal(input.isPressed(action, 0), true, code);
        assert.equal(input.isPressed(action, 1), false, `${code} not seat 1`);
        up(win, '', code);
        input.endFrame();
        assert.equal(input.isPressed(action), false, `${code} released`);
    }
    for (const code of ['KeyS', 'ArrowDown', 'KeyH', 'Numpad5']) {
        down(win, '', code);
        assert.equal(input.consumeAction('hyperspace'), true, code);
        up(win, '', code);
    }
});

test('modifier combinations (Ctrl, Cmd, Alt) are left to the browser', () => {
    const { win, input } = setup();
    for (const mod of ['ctrlKey', 'metaKey', 'altKey']) {
        const ev = keyEvent('w', null, 'KeyW', { [mod]: true });
        win.dispatch('keydown', ev);
        assert.equal(ev.defaultPrevented, false, mod);
        assert.equal(input.isPressed('thrust'), false, mod);
        assert.equal(input.consumeLastCharKey(), null, mod);
        up(win, 'w', 'KeyW');
    }
});

test('regression: holding ← and tapping A keeps turning left', () => {
    const { win, input } = setup();
    down(win, 'ArrowLeft', 'ArrowLeft');
    down(win, 'a', 'KeyA');
    up(win, 'a', 'KeyA');
    input.endFrame();
    assert.equal(input.isPressed('rotateLeft'), true, '← is still held');
    up(win, 'ArrowLeft', 'ArrowLeft');
    input.endFrame();
    assert.equal(input.isPressed('rotateLeft'), false);
});

test('regression: holding S does not block ↓ hyperspace (merged and for P2)', () => {
    {
        const { win, input } = setup();
        down(win, 's', 'KeyS');
        assert.equal(input.consumeAction('hyperspace'), true);
        down(win, 'ArrowDown', 'ArrowDown');
        assert.equal(input.consumeAction('hyperspace'), true, 'a second key triggers again');
        down(win, 's', 'KeyS'); // auto-repeat of the held S
        assert.equal(input.consumeAction('hyperspace'), false);
    }
    {
        const { win, input } = seatSetup();
        down(win, 's', 'KeyS');
        down(win, 'ArrowDown', 'ArrowDown');
        assert.equal(input.consumeAction('hyperspace', 0), true, 'P1');
        assert.equal(input.consumeAction('hyperspace', 1), true, 'P2');
        assert.equal(input.consumeAction('hyperspace', 0), false);
        assert.equal(input.consumeAction('hyperspace', 1), false);
    }
});

test('event.repeat never retriggers a one-shot', () => {
    const { win, input } = setup();
    win.dispatch('keydown', keyEvent('p', null, 'KeyP', { repeat: true }));
    assert.equal(input.consumeAction('pause'), false);
});

test('a key held through releaseAll() holds again on auto-repeat, without one-shots', () => {
    const { win, input } = setup();
    down(win, 'ArrowUp', 'ArrowUp');
    assert.equal(input.consumeAction('menuUp'), true);
    input.releaseAll(); // e.g. Start pressed while holding ↑
    input.endFrame();
    assert.equal(input.isPressed('thrust'), false);
    win.dispatch('keydown', keyEvent('ArrowUp', null, 'ArrowUp', { repeat: true }));
    input.endFrame();
    assert.equal(input.isPressed('thrust'), true, 'thrust resumes');
    assert.equal(input.consumeAction('menuUp'), false, 'no menu step from auto-repeat');
    win.dispatch('keydown', keyEvent('s', null, 'KeyS', { repeat: true }));
    assert.equal(input.consumeAction('hyperspace'), false, 'no hyperspace from auto-repeat');
    up(win, 'ArrowUp', 'ArrowUp');
    input.endFrame();
    assert.equal(input.isPressed('thrust'), false);
});

test('seat mode: W drives seat 0 only, ↑ seat 1 only; H is not bound', () => {
    const { win, input } = seatSetup();
    down(win, 'w', 'KeyW');
    assert.equal(input.isPressed('thrust', 0), true);
    assert.equal(input.isPressed('thrust', 1), false);
    up(win, 'w', 'KeyW');
    input.endFrame();
    down(win, 'ArrowUp', 'ArrowUp');
    assert.equal(input.isPressed('thrust', 0), false);
    assert.equal(input.isPressed('thrust', 1), true);
    assert.equal(input.isPressed('thrust'), false, 'no seat = seat 0');
    down(win, 'h', 'KeyH');
    assert.equal(input.consumeAction('hyperspace', 0), false, 'H only in single-player');
    assert.equal(input.consumeLastCharKey(), 'W');
    assert.equal(input.consumeLastCharKey(), 'H', 'but it still types');
});

test('A + → at the same time turn P1 left and P2 right', () => {
    const { win, input } = seatSetup();
    down(win, 'a', 'KeyA');
    down(win, 'ArrowRight', 'ArrowRight');
    input.endFrame();
    assert.equal(input.isPressed('rotateLeft', 0), true);
    assert.equal(input.isPressed('rotateRight', 0), false);
    assert.equal(input.isPressed('rotateRight', 1), true);
    assert.equal(input.isPressed('rotateLeft', 1), false);
});

test('seat one-shots do not leak to another seat', () => {
    const { win, input } = seatSetup();
    down(win, 'ArrowDown', 'ArrowDown');
    assert.equal(input.consumeAction('hyperspace', 0), false);
    assert.equal(input.consumeAction('hyperspace'), false, 'omitted seat means seat 0');
    assert.equal(input.consumeAction('hyperspace', 2), false);
    assert.equal(input.consumeAction('hyperspace', 1), true);
});

test('shared actions: anyone can pause; who pressed is recorded', () => {
    const { win, input } = seatSetup();
    // Enter is P2 fire and also menu select / enter (shared, recorded as seat 1)
    down(win, 'Enter', 'Enter');
    assert.equal(input.isPressed('fire', 1), true);
    assert.equal(input.pressedBy('menuSelect'), 1);
    assert.equal(input.consumeAction('menuSelect', 0), false, 'not pressed by seat 0');
    assert.equal(input.consumeAction('menuSelect', 1), true);
    assert.equal(input.consumeAction('enter'), true, 'no seat: anyone');
    // Space is P1 fire and menu select
    down(win, ' ', 'Space');
    assert.equal(input.pressedBy('menuSelect'), 0);
    // P is not in either key set: nobody in particular
    down(win, 'p', 'KeyP');
    assert.equal(input.pressedBy('pause'), null);
    assert.equal(input.consumeAction('pause'), true);
    // merged mode records seat 0
    const m = setup();
    down(m.win, 'p', 'KeyP');
    assert.equal(m.input.pressedBy('pause'), 0);
});

test('quick taps last one frame, per seat', () => {
    const { win, input } = seatSetup();
    down(win, 'Enter', 'Enter');
    up(win, 'Enter', 'Enter');
    assert.equal(input.isPressed('fire', 1), true);
    assert.equal(input.isPressed('fire', 0), false);
    input.endFrame();
    assert.equal(input.isPressed('fire', 1), false);
});

test('unjoined inputs only produce lobby (source) events', () => {
    const { win, input } = seatSetup(['kbLeft']);
    down(win, 'ArrowUp', 'ArrowUp');
    down(win, 'Enter', 'Enter');
    for (let seat = 0; seat < 4; seat++) {
        assert.equal(input.isPressed('thrust', seat), false, `seat ${seat}`);
        assert.equal(input.isPressed('fire', seat), false, `seat ${seat}`);
    }
    down(win, 'ArrowDown', 'ArrowDown');
    for (let seat = 0; seat < 4; seat++) assert.equal(input.consumeAction('hyperspace', seat), false);
    assert.deepEqual(input.consumeSourceEvents(), [
        { source: 'kbRight', action: 'thrust', seat: null },
        { source: 'kbRight', action: 'fire', seat: null },
        { source: 'kbRight', action: 'hyperspace', seat: null },
    ]);
    assert.deepEqual(input.consumeSourceEvents(), []);
    // joined sources report their seat
    down(win, 'w', 'KeyW');
    assert.deepEqual(input.consumeSourceEvents(), [{ source: 'kbLeft', action: 'thrust', seat: 0 }]);
    // P2 joins; the next Enter press drives seat 1
    up(win, 'Enter', 'Enter');
    assert.equal(input.seats.join('kbRight'), 1);
    down(win, 'Enter', 'Enter');
    assert.equal(input.isPressed('fire', 1), true);
});

test('source events are cleared by clearPending() and capped', () => {
    const { win, input } = seatSetup([]);
    down(win, 'w', 'KeyW');
    input.clearPending();
    assert.deepEqual(input.consumeSourceEvents(), []);
    for (let i = 0; i < SOURCE_EVENT_LIMIT + 10; i++) {
        down(win, 'w', 'KeyW');
        up(win, 'w', 'KeyW');
    }
    assert.equal(input.consumeSourceEvents().length, SOURCE_EVENT_LIMIT);
});

test('setMerged() switches routing and releases held input', () => {
    const { win, input } = setup();
    down(win, 'ArrowUp', 'ArrowUp');
    input.setMerged(false);
    input.endFrame();
    assert.equal(input.isPressed('thrust'), false);
    input.seats.join('kbRight');
    up(win, 'ArrowUp', 'ArrowUp');
    down(win, 'ArrowUp', 'ArrowUp');
    assert.equal(input.isPressed('thrust', 0), true, 'kbRight joined first: seat 0');
    input.setMerged(true);
    down(win, 'w', 'KeyW');
    assert.equal(input.isPressed('thrust', 0), true);
});

test('releaseSeat() releases one seat and leaves the other', () => {
    const { win, doc, input } = seatSetup(['kbLeft', 'kbRight', 'touch:a']);
    const fire = zoneButton('fire', 'a');
    doc.buttons.push(fire);
    down(win, 'w', 'KeyW');
    down(win, 'ArrowUp', 'ArrowUp');
    down(win, 'ArrowDown', 'ArrowDown');
    doc.dispatch('pointerdown', pointerEvent(fire, 3));
    doc.dispatch('pointerdown', pointerEvent(zoneEl('a'), 4, { clientX: 10, clientY: 10 }));
    assert.equal(input.isPressed('fire', 2), true);
    assert.equal(input.getJoystick(2).active, true);

    input.releaseSeat(1);
    input.endFrame();
    assert.equal(input.isPressed('thrust', 1), false);
    assert.equal(input.consumeAction('hyperspace', 1), false);
    assert.equal(input.isPressed('thrust', 0), true, 'P1 still thrusting');
    down(win, 'ArrowUp', 'ArrowUp'); // auto-repeat of the still-down key does not re-press
    assert.equal(input.isPressed('thrust', 1), false);

    input.releaseSeat(2);
    assert.equal(input.isPressed('fire', 2), false);
    assert.equal(fire.classList.contains('active'), false);
    assert.equal(input.getJoystick(2).active, false);
    assert.equal(input.isPressed('thrust', 0), true);
});

// --- Seats: touch zones ------------------------------------------------------

test('zone B touch drives seat 1 (stick and buttons); zone A seat 0', () => {
    const { doc, input } = seatSetup(['touch:a', 'touch:b']);
    input.joystickRadius = 60;
    doc.dispatch('pointerdown', pointerEvent(zoneEl('b'), 1, { clientX: 100, clientY: 100 }));
    doc.dispatch('pointermove', pointerEvent(null, 1, { clientX: 100, clientY: 40 }));
    assert.equal(input.getJoystick(0).active, false);
    const j = input.getJoystick(1);
    assert.equal(j.active, true);
    assert.ok(near(j.angle, -Math.PI / 2));
    assert.equal(j.magnitude, 1);

    const fireB = zoneButton('fire', 'b');
    const fireA = zoneButton('fire', 'a');
    doc.buttons.push(fireA, fireB);
    doc.dispatch('pointerdown', pointerEvent(fireB, 2));
    assert.equal(input.isPressed('fire', 1), true);
    assert.equal(input.isPressed('fire', 0), false);
    assert.equal(fireB.classList.contains('active'), true);
    assert.equal(fireA.classList.contains('active'), false, 'only zone B lights up');
    doc.dispatch('pointerdown', pointerEvent(zoneButton('hyperspace', 'b'), 3));
    assert.equal(input.consumeAction('hyperspace', 0), false);
    assert.equal(input.consumeAction('hyperspace', 1), true);
    doc.dispatch('pointerdown', pointerEvent(zoneButton('pause', 'b'), 4));
    assert.equal(input.pressedBy('pause'), 1);
});

test('merged mode: elements without data-zone are zone a and drive seat 0', () => {
    const { doc, input } = setup();
    doc.dispatch('pointerdown', pointerEvent(zoneEl('a'), 1, { clientX: 0, clientY: 0 }));
    assert.equal(input.getJoystick().active, true);
    assert.equal(input.getJoystick(0).active, true);
    assert.equal(input.joystick.pointerId, 1);
    assert.equal(input.zoneOf({ closest: () => null }), 'a');
    assert.equal(input.zoneOf(null), 'a');
});

test('an unjoined touch zone only produces lobby events', () => {
    const { doc, input } = seatSetup(['touch:a']);
    doc.dispatch('pointerdown', pointerEvent(zoneEl('b'), 1, { clientX: 0, clientY: 0 }));
    const fireB = zoneButton('fire', 'b');
    doc.buttons.push(fireB);
    doc.dispatch('pointerdown', pointerEvent(fireB, 2));
    for (let seat = 0; seat < 4; seat++) {
        assert.equal(input.getJoystick(seat).active, false);
        assert.equal(input.isPressed('fire', seat), false);
    }
    assert.equal(fireB.classList.contains('active'), false);
    assert.deepEqual(input.consumeSourceEvents(), [
        { source: 'touch:b', action: 'stick', seat: null },
        { source: 'touch:b', action: 'fire', seat: null },
    ]);
});

function clockSetup(sources) {
    const clock = { t: 1000 };
    const env = seatSetup(sources, { now: () => clock.t });
    env.input.joystickRadius = 60;
    return { ...env, clock };
}

test('palm rule: a finger resting 500 ms loses the stick to a new finger in its zone', () => {
    const { doc, input, clock } = clockSetup(['touch:a', 'touch:b']);
    doc.dispatch('pointerdown', pointerEvent(zoneEl('a'), 1, { clientX: 100, clientY: 100 }));
    doc.dispatch('pointermove', pointerEvent(null, 1, { clientX: 100 + PALM_MOVE_PX, clientY: 100 })); // within tolerance
    clock.t += PALM_IDLE_MS - 1;
    doc.dispatch('pointerdown', pointerEvent(zoneEl('a'), 2, { clientX: 300, clientY: 300 }));
    assert.equal(input.seatState[0].stick.pointerId, 1, 'too early: the owner keeps it');
    clock.t += 1;
    doc.dispatch('pointerdown', pointerEvent(zoneEl('a'), 3, { clientX: 300, clientY: 300 }));
    assert.equal(input.seatState[0].stick.pointerId, 3, 'resting palm taken over');
    assert.equal(input.getJoystick(0).magnitude, 0, 'new origin');
    // the palm lifting or moving no longer affects the stick
    doc.dispatch('pointermove', pointerEvent(null, 1, { clientX: 900, clientY: 900 }));
    doc.dispatch('pointerup', pointerEvent(null, 1));
    assert.equal(input.getJoystick(0).active, true);
    assert.equal(input.getJoystick(0).magnitude, 0);
    doc.dispatch('pointermove', pointerEvent(null, 3, { clientX: 330, clientY: 300 }));
    assert.ok(near(input.getJoystick(0).magnitude, 0.5));
    // the other zone's stick is independent
    assert.equal(input.getJoystick(1).active, false);
});

test('palm rule: a moving owner keeps the stick', () => {
    const { doc, input, clock } = clockSetup(['touch:a']);
    doc.dispatch('pointerdown', pointerEvent(zoneEl('a'), 1, { clientX: 100, clientY: 100 }));
    for (let i = 1; i <= 5; i++) {
        clock.t += 300;
        doc.dispatch('pointermove', pointerEvent(null, 1, { clientX: 100 + i * (PALM_MOVE_PX + 1), clientY: 100 }));
    }
    clock.t += PALM_IDLE_MS - 1;
    doc.dispatch('pointerdown', pointerEvent(zoneEl('a'), 2, { clientX: 300, clientY: 300 }));
    assert.equal(input.seatState[0].stick.pointerId, 1);
});

test('a stick finger sliding into the other half keeps its seat', () => {
    const { doc, input } = clockSetup(['touch:a', 'touch:b']);
    doc.dispatch('pointerdown', pointerEvent(zoneEl('a'), 1, { clientX: 100, clientY: 100 }));
    doc.elementAtPoint = zoneEl('b');
    doc.dispatch('pointermove', pointerEvent(null, 1, { clientX: 700, clientY: 100 }));
    assert.equal(input.getJoystick(0).active, true);
    assert.ok(near(input.getJoystick(0).angle, 0));
    assert.equal(input.getJoystick(1).active, false);
    // zone B can still start its own stick
    doc.dispatch('pointerdown', pointerEvent(zoneEl('b'), 2, { clientX: 700, clientY: 300 }));
    assert.equal(input.getJoystick(1).active, true);
    doc.dispatch('pointerup', pointerEvent(null, 1));
    assert.equal(input.getJoystick(0).active, false);
    assert.equal(input.getJoystick(1).active, true);
});

test('sliding onto the other player\'s fire button does not press it', () => {
    const { doc, input } = seatSetup(['touch:a', 'touch:b']);
    const leftA = zoneButton('rotateLeft', 'a');
    const fireA = zoneButton('fire', 'a');
    const fireB = zoneButton('fire', 'b');
    doc.buttons.push(leftA, fireA, fireB);
    doc.dispatch('pointerdown', pointerEvent(leftA, 5));
    doc.elementAtPoint = fireB;
    doc.dispatch('pointermove', pointerEvent(null, 5, { clientX: 1, clientY: 1 }));
    input.endFrame();
    assert.equal(input.isPressed('fire', 1), false);
    assert.equal(input.isPressed('fire', 0), false);
    assert.equal(input.isPressed('rotateLeft', 0), true, 'keeps holding its own button');
    assert.equal(fireB.classList.contains('active'), false);
    // its own zone's fire button works
    doc.elementAtPoint = fireA;
    doc.dispatch('pointermove', pointerEvent(null, 5, { clientX: 2, clientY: 2 }));
    input.endFrame();
    assert.equal(input.isPressed('fire', 0), true);
    assert.equal(input.isPressed('rotateLeft', 0), false);
    assert.equal(fireA.classList.contains('active'), true);
    assert.equal(fireB.classList.contains('active'), false);
});

test('a finger and a key holding the same action release independently', () => {
    const { win, doc, input } = setup();
    const fire = makeButton('fire');
    doc.buttons.push(fire);
    doc.dispatch('pointerdown', pointerEvent(fire, 1));
    down(win, ' ', 'Space');
    up(win, ' ', 'Space');
    input.endFrame();
    assert.equal(input.isPressed('fire'), true, 'finger still holds fire');
    doc.dispatch('pointerup', pointerEvent(fire, 1));
    input.endFrame();
    assert.equal(input.isPressed('fire'), false);
});

test('releaseJoysticks() releases every seat; releaseJoystick() is an alias', () => {
    const { doc, input } = seatSetup(['touch:a', 'touch:b']);
    doc.dispatch('pointerdown', pointerEvent(zoneEl('a'), 1, { clientX: 0, clientY: 0 }));
    doc.dispatch('pointerdown', pointerEvent(zoneEl('b'), 2, { clientX: 0, clientY: 0 }));
    input.releaseJoysticks();
    assert.equal(input.getJoystick(0).active, false);
    assert.equal(input.getJoystick(1).active, false);
    doc.dispatch('pointerdown', pointerEvent(zoneEl('b'), 3, { clientX: 0, clientY: 0 }));
    input.releaseJoystick();
    assert.equal(input.getJoystick(1).active, false);
    assert.deepEqual(input.getJoystick(7), { active: false, angle: 0, magnitude: 0 }, 'unknown seat');
});

test('zone b stick visuals use the -b element ids', () => {
    const { doc } = seatSetup(['touch:a', 'touch:b']);
    const els = {};
    for (const id of ['joystick-base', 'joystick-knob', 'joystick-base-b', 'joystick-knob-b']) {
        const classes = new Set();
        els[id] = { style: {}, classList: { toggle(c, on) { on ? classes.add(c) : classes.delete(c); }, contains: (c) => classes.has(c) } };
    }
    doc.getElementById = (id) => els[id] || null;
    doc.dispatch('pointerdown', pointerEvent(zoneEl('b'), 1, { clientX: 40, clientY: 50 }));
    assert.equal(els['joystick-base-b'].classList.contains('active'), true);
    assert.equal(els['joystick-base-b'].style.left, '40px');
    assert.equal(els['joystick-base'].classList.contains('active'), false);
});

// --- Seats: controllers ------------------------------------------------------

test('fake controller on seat 1 fires for seat 1 only', () => {
    const a = new FakePad(0);
    const b = new FakePad(1, 'DualSense Wireless Controller');
    const { input } = setupPads([a, b]);
    input.setMerged(false);
    input.seats.join('kbLeft');
    assert.equal(input.seats.join('pad:1'), 1);
    input.setContext('game');
    b.press(GP.A);
    input.pollGamepads();
    assert.equal(input.isPressed('fire', 1), true);
    assert.equal(input.isPressed('fire', 0), false);
    b.release(GP.A).press(GP.B);
    input.endFrame();
    input.pollGamepads();
    assert.equal(input.isPressed('fire', 1), false);
    assert.equal(input.consumeAction('hyperspace', 0), false);
    assert.equal(input.consumeAction('hyperspace', 1), true);
    b.release(GP.B).press(GP.MENU);
    input.pollGamepads();
    assert.equal(input.pressedBy('pause'), 1, 'who paused');
    // the unjoined pad only produces lobby events
    input.consumeSourceEvents();
    input.endFrame();
    a.press(GP.A);
    input.pollGamepads();
    for (let seat = 0; seat < 4; seat++) assert.equal(input.isPressed('fire', seat), false, `seat ${seat}`);
    assert.deepEqual(input.consumeSourceEvents(), [{ source: 'pad:0', action: 'fire', seat: null }]);
});

test('controller sticks drive their own seat; rotated for a facing seat, touch sticks not', () => {
    const a = new FakePad(0);
    const b = new FakePad(1);
    const { input, doc } = setupPads([a, b]);
    input.setMerged(false);
    input.seats.join('pad:0');
    input.seats.join('pad:1');
    input.seats.join('touch:b'); // seat 2
    input.setContext('game');
    input.setSeatOrientation(1, 180);
    input.setSeatOrientation(2, 180);
    a.stick(0.7, 0);
    b.stick(0.7, 0);
    input.pollGamepads();
    const j0 = input.getJoystick(0);
    const j1 = input.getJoystick(1);
    assert.equal(j0.source, 'gamepad');
    assert.ok(near(j0.angle, 0), `seat 0 ${j0.angle}`);
    assert.ok(near(Math.abs(j1.angle), Math.PI), `seat 1 rotated ${j1.angle}`);
    assert.ok(near(j1.magnitude, j0.magnitude));
    // touch: a drag to the right on the glass stays "right" for the facing player
    input.joystickRadius = 60;
    doc.dispatch('pointerdown', pointerEvent(zoneEl('b'), 9, { clientX: 100, clientY: 100 }));
    doc.dispatch('pointermove', pointerEvent(null, 9, { clientX: 130, clientY: 100 }));
    assert.ok(near(input.getJoystick(2).angle, 0));
    // sticks are only reported while playing
    input.setContext('menu');
    assert.equal(input.getJoystick(1).active, false);
});

test('merged mode: the union of every controller drives seat 0 (stick rotated by seat 0 orientation)', () => {
    const a = new FakePad(0);
    const b = new FakePad(1);
    const { input } = setupPads([a, b]);
    input.setContext('game');
    a.press(GP.RT);
    b.stick(0, 0.9);
    input.pollGamepads();
    assert.equal(input.isPressed('fire'), true);
    assert.equal(input.isPressed('fire', 1), false);
    assert.ok(near(input.getJoystick().angle, Math.PI / 2));
    input.setSeatOrientation(0, 180);
    input.pollGamepads();
    assert.ok(near(input.getJoystick().angle, -Math.PI / 2));
});

test('codeOf() falls back to the typed key when event.code is empty', () => {
    assert.equal(codeOf({ code: 'KeyQ', key: 'a' }), 'KeyQ');
    assert.equal(codeOf({ code: '', key: 'w' }), 'KeyW');
    assert.equal(codeOf({ key: ' ' }), 'Space');
    assert.equal(codeOf({ key: '5' }), 'Digit5');
    assert.equal(codeOf({ key: 'ArrowUp' }), 'ArrowUp');
    assert.equal(codeOf({ key: '' }), '');
    assert.equal(codeOf({}), '');
});

test('hyperspace keys and buttons also read as held (Saucer steering) but press only once', () => {
    const { win, input } = seatSetup(['kbLeft', 'kbRight']);
    win.dispatch('keydown', keyEvent('ArrowDown'));
    assert.equal(input.isPressed('hyperspace', 1), true);
    assert.equal(input.isPressed('hyperspace', 0), false);
    assert.equal(input.consumeAction('hyperspace', 1), true);
    input.endFrame();
    win.dispatch('keydown', keyEvent('ArrowDown', null, 'ArrowDown', { repeat: true })); // auto-repeat
    assert.equal(input.isPressed('hyperspace', 1), true, 'still held');
    assert.equal(input.consumeAction('hyperspace', 1), false, 'no second jump');
    win.dispatch('keyup', keyEvent('ArrowDown'));
    input.endFrame();
    assert.equal(input.isPressed('hyperspace', 1), false);
    // A controller's Ⓑ / D-pad down on its seat
    const a = new FakePad(0);
    const { input: padInput } = setupPads([a]);
    padInput.setMerged(false);
    padInput.seats.join('kbLeft');
    padInput.seats.join('pad:0');
    padInput.setContext('game');
    a.press(GP.DOWN);
    padInput.pollGamepads();
    assert.equal(padInput.isPressed('hyperspace', 1), true);
    assert.equal(padInput.consumeAction('hyperspace', 1), true);
    padInput.endFrame();
    padInput.pollGamepads();
    assert.equal(padInput.isPressed('hyperspace', 1), true);
    assert.equal(padInput.consumeAction('hyperspace', 1), false);
    a.release(GP.DOWN);
    padInput.pollGamepads();
    assert.equal(padInput.isPressed('hyperspace', 1), false);
});

test('pushSourceEvent (touch join pads): a lobby event with the source seat, no seat action', () => {
    const { input } = seatSetup([]);
    input.pushSourceEvent('touch:a', 'fire');
    assert.deepEqual(input.consumeSourceEvents(), [{ source: 'touch:a', action: 'fire', seat: null }]);
    assert.equal(input.lastInputSource, 'touch');
    assert.equal(input.seats.join('touch:b'), 0);
    input.pushSourceEvent('touch:b', 'hyperspace');
    assert.deepEqual(input.consumeSourceEvents(), [{ source: 'touch:b', action: 'hyperspace', seat: 0 }]);
    assert.equal(input.consumeAction('hyperspace', 0), false);
    assert.equal(input.isPressed('fire', 0), false);
});

test('a keyup whose target is an INPUT still releases a key held in the game', () => {
    const { win, input } = setup();
    win.dispatch('keydown', keyEvent('w', { tagName: 'CANVAS' }));
    input.endFrame();
    assert.equal(input.isPressed('thrust'), true);
    // Focus moved to the username field before the key was released
    win.dispatch('keyup', keyEvent('w', { tagName: 'INPUT' }));
    input.endFrame();
    assert.equal(input.isPressed('thrust'), false);
    // And the key can be pressed again (its repeat guard was cleared)
    win.dispatch('keydown', keyEvent('w', { tagName: 'CANVAS' }));
    assert.equal(input.isPressed('thrust'), true);
});

test('the typed-character queue is bounded and only fills while text entry is on', async () => {
    const { CHAR_QUEUE_LIMIT } = await import('../../js/input.js');
    const { win, input } = setup();
    const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    for (const ch of letters) {
        win.dispatch('keydown', keyEvent(ch.toLowerCase()));
        win.dispatch('keyup', keyEvent(ch.toLowerCase()));
    }
    assert.equal(input.charQueue.length, CHAR_QUEUE_LIMIT);
    assert.equal(input.charQueue[0], letters[letters.length - CHAR_QUEUE_LIMIT]); // oldest dropped
    input.setTextEntry(false);
    assert.equal(input.charQueue.length, 0);
    win.dispatch('keydown', keyEvent('q'));
    win.dispatch('keyup', keyEvent('q'));
    assert.equal(input.charQueue.length, 0);
    assert.equal(input.consumeAction('key_Q'), true); // single-letter shortcuts still work
    input.setTextEntry(true);
    win.dispatch('keydown', keyEvent('z'));
    assert.equal(input.consumeLastCharKey(), 'Z');
});

test('Meta down or up releases every held key (macOS swallows keyups while Cmd is down)', () => {
    const { win, input } = setup();
    win.dispatch('keydown', keyEvent('w'));
    win.dispatch('keydown', keyEvent('ArrowLeft'));
    input.endFrame();
    assert.equal(input.isPressed('thrust'), true);
    assert.equal(input.isPressed('rotateLeft'), true);
    win.dispatch('keydown', keyEvent('Meta', null, 'MetaLeft', { metaKey: true }));
    input.endFrame();
    assert.equal(input.isPressed('thrust'), false);
    assert.equal(input.isPressed('rotateLeft'), false);
    // Pressing again works (no stale repeat guard)
    win.dispatch('keydown', keyEvent('w'));
    assert.equal(input.isPressed('thrust'), true);
    win.dispatch('keyup', keyEvent('Meta', null, 'MetaLeft'));
    input.endFrame();
    assert.equal(input.isPressed('thrust'), false);
});

test('palm rule: a steadily held deflection (outside the deadzone) is never taken over', () => {
    const { doc, input, clock } = clockSetup(['touch:a']);
    doc.dispatch('pointerdown', pointerEvent(zoneEl('a'), 1, { clientX: 100, clientY: 100 }));
    doc.dispatch('pointermove', pointerEvent(null, 1, { clientX: 145, clientY: 100 })); // 0.75 of the radius
    clock.t += PALM_IDLE_MS * 4; // held perfectly still for 2 s
    doc.dispatch('pointerdown', pointerEvent(zoneEl('a'), 2, { clientX: 300, clientY: 300 }));
    assert.equal(input.seatState[0].stick.pointerId, 1, 'the steering finger keeps the stick');
    assert.ok(near(input.getJoystick(0).magnitude, 0.75));
    // Back near the centre (inside the deadzone) and idle: now a new finger may take it
    doc.dispatch('pointermove', pointerEvent(null, 1, { clientX: 105, clientY: 100 }));
    clock.t += PALM_IDLE_MS;
    doc.dispatch('pointerdown', pointerEvent(zoneEl('a'), 3, { clientX: 300, clientY: 300 }));
    assert.equal(input.seatState[0].stick.pointerId, 3);
});
