// Phase 0 3D cockpit prototype (docs/plans/06-3d-mode.md §6 and §8). Entry point, loaded by
// js/main.js with a dynamic import ONLY when the page is opened with ?3d=1, so the 2D game
// never downloads any 3D file. This module owns the page while it runs: its own DOM layer,
// input, fixed-step loop and the read-only test hook window.__spaceAdventure.game3d.
//
// URL options: ?3d=1 (required), &seed3d=N (repeatable layout), &layout3d=range (one red
// rock straight ahead and one crystal behind: used by the browser tests), &lowres3d=1
// (tests only: fixed half-resolution drawing buffer, no antialiasing, 1x HUD, so a software
// renderer on CI keeps a usable frame rate; real devices never get it).
//
// Start never waits for motion: the game starts at once with the chosen control type. If no
// motion reading arrives within NO_DATA_MS of wall time (no sensor, permission denied or
// still being asked), it switches to Joystick and switches back when readings arrive.

import { createSettings } from '../settings.js';
import { createWakeLock } from '../wakeLock.js';
import { radialDeadzone, GP, TRIGGER_THRESHOLD, BUTTON_THRESHOLD } from '../gamepad.js';
import { createSim, stepSim, drainEvents, simCounts, nextId, SIM } from './sim3d.js';
import { makeRock } from './world3d.js';
import { vLen } from './math3d.js';
import {
    createLook, stepLook, recentre, setMode, calibrate, setLevelHorizon, lookAngles, CONTROL_MODES,
} from './look.js';
import {
    createOrientationSource, requestMotionPermission, motionPermissionNeeded, isPortrait, screenAngle,
} from './sensors.js';
import { drawCockpit, drawCrosshair, drawHudText, drawJoystick, drawFlash } from './hud3d.js';

const MODE_LABELS = { direct: 'Direct', rate: 'Rate', joystick: 'Joystick' };
const MODE_HELP = {
    direct: 'Direct: the phone is the ship. Turn, tilt and roll the phone and the ship does the same.',
    rate: 'Rate: tilt the phone away from where you held it at the start to keep turning (like a joystick).',
    joystick: 'Joystick: drag on the left half to turn, ⟲ ⟳ to roll. Desktop: click to capture the mouse, W/↑ thrust, Space/F fire, A/D or Q/E roll, Esc release.',
};
const NO_DATA_MS = 1500;
const STICK_RADIUS = 64;
const MAX_STEPS = 6;

/** Drawing-buffer pixel ratio cap: 1.5, and 1.0 on phones with very dense screens (DPR > 2). */
export function basePixelRatio(dpr) {
    const d = Number.isFinite(dpr) && dpr > 0 ? dpr : 1;
    return d > 2 ? 1 : Math.min(d, 1.5);
}

/** Adaptive render scale step (once per second while playing). */
export function nextRenderScale(scale, fps, goodSeconds) {
    if (fps < 45 && scale > 0.5) return { scale: Math.max(0.5, +(scale - 0.1).toFixed(2)), goodSeconds: 0 };
    if (fps >= 57) {
        const g = goodSeconds + 1;
        if (g >= 3 && scale < 1) return { scale: Math.min(1, +(scale + 0.1).toFixed(2)), goodSeconds: 0 };
        return { scale, goodSeconds: g };
    }
    return { scale, goodSeconds: 0 };
}

const CSS = `
body.proto3d { padding: 0 !important; }
body.proto3d > *:not(#proto3d) { display: none !important; }
#proto3d { position: fixed; inset: 0; background: #000; overflow: hidden; touch-action: none; color: #fff;
  font-family: Arial, sans-serif; user-select: none; -webkit-user-select: none; -webkit-touch-callout: none; }
#proto3d canvas { position: absolute; inset: 0; width: 100%; height: 100%; display: block; }
#p3-hud { pointer-events: none; }
/* style.css paints every canvas black; the HUD must stay see-through over the 3D scene */
#proto3d #p3-hud { background: transparent !important; }
#proto3d button { font: inherit; color: #fff; cursor: pointer; -webkit-tap-highlight-color: transparent; }
.p3-btn { position: absolute; width: 84px; height: 84px; border-radius: 50%; touch-action: none;
  background: rgba(255,255,255,0.12); border: 2px solid rgba(255,255,255,0.4); font-size: 15px; font-weight: bold; }
.p3-btn.p3-on { background: rgba(255,255,255,0.35); }
#p3-thrust { left: calc(16px + env(safe-area-inset-left, 0px)); bottom: calc(16px + env(safe-area-inset-bottom, 0px)); }
#p3-fire { right: calc(16px + env(safe-area-inset-right, 0px)); bottom: calc(16px + env(safe-area-inset-bottom, 0px));
  background: rgba(255,80,80,0.22); }
#proto3d.p3-joystick #p3-thrust { left: auto; right: calc(116px + env(safe-area-inset-right, 0px)); }
.p3-roll { display: none; width: 64px; height: 64px; font-size: 26px; }
#proto3d.p3-joystick.p3-free .p3-roll { display: block; }
#p3-roll-left { right: calc(96px + env(safe-area-inset-right, 0px)); bottom: calc(116px + env(safe-area-inset-bottom, 0px)); }
#p3-roll-right { right: calc(16px + env(safe-area-inset-right, 0px)); bottom: calc(116px + env(safe-area-inset-bottom, 0px)); }
#p3-stick-zone { position: absolute; left: 0; top: 22%; bottom: 0; width: 45%; display: none; touch-action: none; }
#proto3d.p3-joystick #p3-stick-zone { display: block; }
#p3-topbar { position: absolute; top: calc(8px + env(safe-area-inset-top, 0px)); right: calc(8px + env(safe-area-inset-right, 0px));
  display: flex; gap: 8px; }
.p3-small { min-width: 48px; min-height: 44px; padding: 0 12px; border-radius: 10px; background: rgba(20,30,50,0.7);
  border: 1px solid rgba(255,255,255,0.35); font-size: 14px; }
#p3-portrait-banner { position: absolute; left: 50%; top: calc(56px + env(safe-area-inset-top, 0px)); transform: translateX(-50%);
  background: rgba(60,40,0,0.75); padding: 6px 12px; border-radius: 8px; font-size: 13px; }
#p3-menu { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center;
  background: rgba(0,0,12,0.72); overflow: auto; }
.p3-panel { max-width: 600px; width: calc(100% - 32px); padding: 12px 16px; text-align: center; }
.p3-panel h1 { font-size: 24px; margin: 4px 0 2px; color: #9fffd0; }
.p3-panel p { margin: 6px 0; font-size: 14px; color: #c8d8e8; }
.p3-row { display: flex; flex-wrap: wrap; gap: 8px; justify-content: center; margin: 8px 0; align-items: center; }
.p3-choice { min-height: 44px; padding: 0 14px; border-radius: 10px; background: rgba(255,255,255,0.08);
  border: 1px solid rgba(255,255,255,0.35); }
.p3-choice[aria-pressed="true"] { background: rgba(80,220,160,0.35); border-color: #8fffc8; }
#p3-start { min-height: 56px; padding: 0 28px; font-size: 20px; font-weight: bold; border-radius: 12px;
  background: #1f8a5a; border: 2px solid #8fffc8; }
#p3-msg { color: #ffd27a; min-height: 1.2em; }
#p3-portrait-note { color: #ffd27a; }
.p3-hidden { display: none !important; }
#proto3d.p3-menu-open .p3-game { display: none !important; }
#proto3d:not(.p3-menu-open) #p3-menu { display: none !important; }
`;

const HTML = `
<canvas id="p3-canvas"></canvas>
<canvas id="p3-hud"></canvas>
<div id="p3-stick-zone" class="p3-game" aria-label="Joystick area"></div>
<button type="button" id="p3-thrust" class="p3-btn p3-game" aria-label="Thrust">THRUST</button>
<button type="button" id="p3-fire" class="p3-btn p3-game" aria-label="Fire">FIRE</button>
<button type="button" id="p3-roll-left" class="p3-btn p3-roll p3-game" aria-label="Roll left">⟲</button>
<button type="button" id="p3-roll-right" class="p3-btn p3-roll p3-game" aria-label="Roll right">⟳</button>
<div id="p3-topbar" class="p3-game">
  <button type="button" id="p3-recentre" class="p3-small" aria-label="Recentre">Recentre</button>
  <button type="button" id="p3-mode" class="p3-small" aria-label="Control type">Direct</button>
  <button type="button" id="p3-level" class="p3-small" aria-label="Level horizon">Level: off</button>
  <button type="button" id="p3-pause" class="p3-small" aria-label="Pause">II</button>
</div>
<div id="p3-portrait-banner" class="p3-game p3-hidden">Landscape recommended</div>
<div id="p3-menu">
  <div class="p3-panel">
    <h1>3D prototype</h1>
    <p id="p3-status">Phase 0 feel test: fly into green crystals, shoot red rocks.</p>
    <div class="p3-row" role="group" aria-label="Control type">
      <button type="button" class="p3-choice" id="p3-mode-direct" data-mode="direct">Direct</button>
      <button type="button" class="p3-choice" id="p3-mode-rate" data-mode="rate">Rate</button>
      <button type="button" class="p3-choice" id="p3-mode-joystick" data-mode="joystick">Joystick</button>
    </div>
    <p id="p3-mode-help"></p>
    <div class="p3-row">
      <button type="button" class="p3-choice" id="p3-menu-level" aria-pressed="false">Level horizon: off</button>
      <span>Sensitivity</span>
      <button type="button" class="p3-choice" id="p3-sens-down" aria-label="Less sensitive">−</button>
      <span id="p3-sens">5</span>
      <button type="button" class="p3-choice" id="p3-sens-up" aria-label="More sensitive">+</button>
    </div>
    <p>Hold the phone comfortably, then tap Start: that position becomes "straight ahead". Recentre or double-tap resets it.</p>
    <p id="p3-portrait-note" class="p3-hidden">Landscape recommended: turn the phone sideways.</p>
    <p id="p3-msg" role="status"></p>
    <div class="p3-row">
      <button type="button" id="p3-start">Tap to start</button>
      <button type="button" class="p3-choice p3-hidden" id="p3-restart">Restart</button>
      <button type="button" class="p3-choice" id="p3-back2d">Back to 2D</button>
    </div>
  </div>
</div>
`;

/**
 * Take over the page and run the prototype.
 * @param {object} [o]
 * @param {Window} [o.win]
 * @param {Function} [o.createRenderer] - (canvas) => renderer; unit tests pass a fake (default: render3d.js)
 */
export async function startPrototype({ win = window, createRenderer = null } = {}) {
    const doc = win.document;
    const params = new URLSearchParams(win.location.search);
    const seedParam = parseInt(params.get('seed3d'), 10);
    const seed = Number.isFinite(seedParam) ? seedParam : (Date.now() & 0x7fffffff);
    const layout = params.get('layout3d');
    const lowres = params.get('lowres3d') === '1';

    const style = doc.createElement('style');
    style.textContent = CSS;
    doc.head.appendChild(style);
    doc.body.classList.add('proto3d');
    const root = doc.createElement('div');
    root.id = 'proto3d';
    root.className = 'p3-menu-open';
    root.innerHTML = HTML;
    doc.body.appendChild(root);
    const $ = (id) => root.querySelector('#' + id);

    const settings = createSettings();
    const wakeLock = createWakeLock({ navigator: win.navigator, document: doc });
    const source = createOrientationSource({ win, preferSensor: settings.get('sensor3d') === 'auto' });

    // --- state
    let screen = 'menu'; // menu | playing | paused | over
    let permission = 'unknown'; // unknown | granted | denied | not-required | unavailable
    let message = '';
    let messageUntil = 0;
    let clock = 0; // time of the last frame (rAF clock, wall time)
    let motionSince = 0; // wall time (ms) the current wait for motion readings began
    let noDataWarned = false;
    let sim = null;
    let look = createLook({
        mode: settings.get('control3d'), levelHorizon: settings.get('levelHorizon3d'), sensitivity: settings.get('sensitivity3d'),
    });
    let renderer = null;
    let error = null;
    let fps = 0, frameCount = 0, fpsT = 0;
    let frames = 0, steps = 0; // test hook: frames drawn and fixed sim steps run
    let renderScale = 1, goodSeconds = 0, scaleT = 0;
    let pixelRatio = 1;
    let acc = 0, lastT = 0;
    let flashHit = 0, flashCollect = 0;
    let lastSource = null, lastAngle = screenAngle(win);
    let lastTap = { t: 0, x: 0, y: 0 };
    let mouseDX = 0, mouseDY = 0;
    const held = { thrust: false, fire: false, rollLeft: false, rollRight: false };
    const keys = new Set();
    const stick = { active: false, id: null, cx: 0, cy: 0, x: 0, y: 0, radius: STICK_RADIUS };
    let pad = { x: 0, y: 0, roll: 0, thrust: false, fire: false, pause: false };
    let cssW = 1, cssH = 1;

    const chosenMode = () => settings.get('control3d');
    const motionOk = () => permission === 'granted' || permission === 'not-required';
    const motionReady = () => motionOk() && source.hasData;
    const noMotion = () => permission === 'denied' || permission === 'unavailable';
    /** Still within the grace period after Start (or a mode change) without readings? */
    const motionGrace = (now = performance.now()) => !!motionSince && !noMotion() && now - motionSince < NO_DATA_MS;
    function effectiveMode(now) {
        const c = chosenMode();
        if (c === 'joystick') return 'joystick';
        return motionReady() || motionGrace(now) ? c : 'joystick';
    }
    function say(text, ms = 4000) {
        message = text;
        messageUntil = performance.now() + ms;
        $('p3-msg').textContent = text;
    }

    // --- renderer
    const canvas = $('p3-canvas');
    const hud = $('p3-hud');
    const hctx = hud.getContext('2d');
    try {
        const factory = createRenderer || (await import('./render3d.js')).createRenderer3d;
        renderer = factory(canvas, { antialias: !lowres });
    } catch (e) {
        error = String(e && e.message || e);
        say('3D could not start on this device (WebGL 2 not available). Use Back to 2D.', 1e9);
        $('p3-start').disabled = true;
    }

    function resize() {
        cssW = Math.max(1, win.innerWidth);
        cssH = Math.max(1, win.innerHeight);
        pixelRatio = lowres ? 0.5 : basePixelRatio(win.devicePixelRatio) * renderScale;
        if (renderer) renderer.setSize(cssW, cssH, pixelRatio);
        const hdpr = lowres ? 1 : Math.min(win.devicePixelRatio || 1, 2);
        hud.width = Math.round(cssW * hdpr);
        hud.height = Math.round(cssH * hdpr);
        hctx.setTransform(hdpr, 0, 0, hdpr, 0, 0);
        const portrait = isPortrait(win);
        $('p3-portrait-note').classList.toggle('p3-hidden', !portrait);
        $('p3-portrait-banner').classList.toggle('p3-hidden', !portrait);
    }
    win.addEventListener('resize', resize);
    resize();

    // --- simulation
    function newSim() {
        if (layout === 'range') {
            sim = createSim({ seed, field: false });
            const [x, y, z] = sim.ship.pos;
            sim.rocks.push(makeRock({ id: nextId(sim), kind: 'red', size: 'large', pos: [x, y, z - 300], vel: [0, 0, 0], rand: sim.rand }));
            sim.rocks.push(makeRock({ id: nextId(sim), kind: 'green', pos: [x, y, z + 220], vel: [0, 0, 0], rand: sim.rand }));
        } else {
            sim = createSim({ seed });
        }
    }
    newSim();

    // --- menu UI
    function refreshUi() {
        const c = chosenMode();
        for (const m of CONTROL_MODES) $('p3-mode-' + m).setAttribute('aria-pressed', String(m === c));
        $('p3-mode-help').textContent = MODE_HELP[c];
        const lv = settings.get('levelHorizon3d');
        $('p3-menu-level').textContent = `Level horizon: ${lv ? 'on' : 'off'}`;
        $('p3-menu-level').setAttribute('aria-pressed', String(lv));
        $('p3-level').textContent = `Level: ${lv ? 'on' : 'off'}`;
        $('p3-sens').textContent = String(settings.get('sensitivity3d'));
        const eff = effectiveMode();
        $('p3-mode').textContent = MODE_LABELS[eff] + (eff !== c ? '*' : '');
        root.classList.toggle('p3-joystick', eff === 'joystick');
        root.classList.toggle('p3-free', !lv);
        const label = screen === 'paused' ? 'Resume' : screen === 'over' ? 'Play again' : (c !== 'joystick' && permission === 'unknown' && motionPermissionNeeded(win) ? 'Enable motion & start' : 'Tap to start');
        $('p3-start').textContent = label;
        $('p3-restart').classList.toggle('p3-hidden', screen !== 'paused');
    }

    function permissionMessage() {
        if (permission === 'denied') return 'Motion access denied: using Joystick. iPhone: allow Motion & Orientation Access, then reload.';
        if (permission === 'unavailable') return 'No motion sensor in this browser: using Joystick.';
        if (permission === 'unknown') return 'Waiting for motion access: using Joystick for now.';
        return '';
    }

    let motionRequest = null;
    /**
     * Ask for motion access if needed (synchronously inside a click handler: iOS) and start
     * the motion source once allowed. Never awaited by Start: the answer may take a while
     * (or never come), so the game reads `permission` / readings as they arrive.
     */
    function ensureMotion(mode) {
        if (mode !== 'joystick' && motionOk()) source.start();
        if (mode === 'joystick' || permission !== 'unknown') return Promise.resolve(permission);
        if (motionRequest) return motionRequest;
        motionRequest = requestMotionPermission(win).then((r) => {
            permission = r;
            motionRequest = null;
            if (motionOk()) source.start();
            const m = permissionMessage();
            if (m) say(m, 6000);
            refreshUi();
            return r;
        }, () => { motionRequest = null; return permission; });
        return motionRequest;
    }

    function begin() {
        if (screen === 'over' || screen === 'menu') {
            if (screen === 'over') newSim();
            motionSince = performance.now();
            noDataWarned = false;
            $('p3-status').textContent = 'Phase 0 feel test: fly into green crystals, shoot red rocks.';
            look = createLook({ mode: look.mode, levelHorizon: settings.get('levelHorizon3d'), sensitivity: settings.get('sensitivity3d') });
        }
        screen = 'playing';
        root.classList.remove('p3-menu-open');
        // The pose held at Start is "straight ahead"
        const dq = motionReady() ? source.quat() : null;
        setMode(look, effectiveMode(), dq);
        if (dq) recentre(look, dq);
        lastT = 0;
        acc = 0;
        refreshUi();
    }

    function pause() {
        if (screen !== 'playing') return;
        screen = 'paused';
        releaseAll();
        root.classList.add('p3-menu-open');
        try { if (doc.pointerLockElement) doc.exitPointerLock(); } catch { /* ignore */ }
        refreshUi();
    }

    function gameOver() {
        screen = 'over';
        releaseAll();
        root.classList.add('p3-menu-open');
        $('p3-status').textContent = `Game over. Score ${sim.score}.`;
        refreshUi();
    }

    function releaseAll() {
        held.thrust = held.fire = held.rollLeft = held.rollRight = false;
        stick.active = false; stick.id = null; stick.x = stick.y = 0;
        keys.clear();
        root.querySelectorAll('.p3-on').forEach((b) => b.classList.remove('p3-on'));
    }

    function doRecentre() {
        recentre(look, motionReady() ? source.quat() : null);
        say('Recentred', 1200);
    }

    function chooseMode(m) {
        if (!CONTROL_MODES.includes(m)) return;
        settings.set('control3d', m);
        ensureMotion(m);
        if (screen === 'playing' && m !== 'joystick' && !motionReady()) {
            motionSince = performance.now();
            noDataWarned = false;
        }
        refreshUi();
    }

    function toggleLevel() {
        const on = !settings.get('levelHorizon3d');
        settings.set('levelHorizon3d', on);
        setLevelHorizon(look, on, motionReady() ? source.quat() : null);
        refreshUi();
    }

    $('p3-start').addEventListener('click', () => {
        if (!renderer) return;
        ensureMotion(chosenMode()); // must run inside the click (iOS); never awaited
        begin(); // start at once: no data within NO_DATA_MS switches to Joystick (frame loop)
    });
    $('p3-restart').addEventListener('click', () => { newSim(); screen = 'menu'; begin(); });
    $('p3-back2d').addEventListener('click', () => {
        const u = new URL(win.location.href);
        u.searchParams.delete('3d');
        u.searchParams.delete('seed3d');
        u.searchParams.delete('layout3d');
        win.location.replace(u.toString());
    });
    for (const m of CONTROL_MODES) $('p3-mode-' + m).addEventListener('click', () => chooseMode(m));
    $('p3-menu-level').addEventListener('click', toggleLevel);
    $('p3-sens-down').addEventListener('click', () => { look.sensitivity = settings.set('sensitivity3d', settings.get('sensitivity3d') - 1); refreshUi(); });
    $('p3-sens-up').addEventListener('click', () => { look.sensitivity = settings.set('sensitivity3d', settings.get('sensitivity3d') + 1); refreshUi(); });

    // --- in-game buttons
    $('p3-recentre').addEventListener('click', doRecentre);
    $('p3-mode').addEventListener('click', () => {
        const i = CONTROL_MODES.indexOf(chosenMode());
        chooseMode(CONTROL_MODES[(i + 1) % CONTROL_MODES.length]);
        say(`Control: ${MODE_LABELS[chosenMode()]}`, 1500);
    });
    $('p3-level').addEventListener('click', toggleLevel);
    $('p3-pause').addEventListener('click', pause);

    function holdButton(id, key) {
        const el = $(id);
        const down = (e) => {
            e.preventDefault();
            held[key] = true;
            el.classList.add('p3-on');
            try { el.setPointerCapture(e.pointerId); } catch { /* ignore */ }
        };
        const up = () => { held[key] = false; el.classList.remove('p3-on'); };
        el.addEventListener('pointerdown', down);
        el.addEventListener('pointerup', up);
        el.addEventListener('pointercancel', up);
        el.addEventListener('lostpointercapture', up);
        el.addEventListener('contextmenu', (e) => e.preventDefault());
    }
    holdButton('p3-thrust', 'thrust');
    holdButton('p3-fire', 'fire');
    holdButton('p3-roll-left', 'rollLeft');
    holdButton('p3-roll-right', 'rollRight');

    // --- joystick (left half, floating: the stick centre is where the thumb lands)
    const zone = $('p3-stick-zone');
    zone.addEventListener('pointerdown', (e) => {
        if (stick.active) return;
        e.preventDefault();
        stick.active = true;
        stick.id = e.pointerId;
        stick.cx = e.clientX;
        stick.cy = e.clientY;
        stick.x = stick.y = 0;
        try { zone.setPointerCapture(e.pointerId); } catch { /* ignore */ }
    });
    zone.addEventListener('pointermove', (e) => {
        if (!stick.active || e.pointerId !== stick.id) return;
        let dx = (e.clientX - stick.cx) / STICK_RADIUS;
        let dy = (e.clientY - stick.cy) / STICK_RADIUS;
        const m = Math.hypot(dx, dy);
        if (m > 1) { dx /= m; dy /= m; }
        stick.x = dx;
        stick.y = dy;
    });
    const stickUp = (e) => {
        if (e.pointerId !== stick.id) return;
        stick.active = false; stick.id = null; stick.x = stick.y = 0;
    };
    zone.addEventListener('pointerup', stickUp);
    zone.addEventListener('pointercancel', stickUp);

    // --- free area: double-tap recentres; a mouse click captures the pointer (desktop)
    canvas.style.touchAction = 'none';
    root.addEventListener('pointerdown', (e) => {
        if (e.target !== hud && e.target !== canvas && e.target !== root) return;
        if (screen !== 'playing') return;
        const now = performance.now();
        if (now - lastTap.t < 320 && Math.hypot(e.clientX - lastTap.x, e.clientY - lastTap.y) < 50) {
            doRecentre();
            lastTap.t = 0;
        } else {
            lastTap = { t: now, x: e.clientX, y: e.clientY };
        }
        if (e.pointerType === 'mouse') {
            if (doc.pointerLockElement === root) { if (e.button === 0) held.fire = true; }
            else { try { const p = root.requestPointerLock(); if (p && p.catch) p.catch(() => {}); } catch { /* ignore */ } }
        }
    });
    root.addEventListener('pointerup', (e) => { if (e.pointerType === 'mouse' && doc.pointerLockElement === root) held.fire = false; });
    doc.addEventListener('mousemove', (e) => {
        if (doc.pointerLockElement !== root || screen !== 'playing') return;
        mouseDX += e.movementX || 0;
        mouseDY += e.movementY || 0;
    });
    root.addEventListener('contextmenu', (e) => e.preventDefault());

    // --- keyboard
    const KEYMAP = {
        KeyW: 'thrust', ArrowUp: 'thrust', Space: 'fire', KeyF: 'fire',
        KeyA: 'rollLeft', KeyQ: 'rollLeft', KeyD: 'rollRight', KeyE: 'rollRight',
        ArrowLeft: 'yawLeft', ArrowRight: 'yawRight', ArrowDown: 'pitchDown',
    };
    win.addEventListener('keydown', (e) => {
        if (KEYMAP[e.code]) { keys.add(KEYMAP[e.code]); if (screen === 'playing') e.preventDefault(); }
        if (e.repeat) return;
        if (e.code === 'KeyP') { if (screen === 'playing') pause(); else if (screen === 'paused') begin(); }
        if (e.code === 'KeyR' && screen === 'playing') doRecentre();
        if (e.code === 'KeyL') toggleLevel();
        if (e.code === 'KeyM') $('p3-mode').click();
        if ((e.code === 'Enter') && screen !== 'playing' && renderer) $('p3-start').click();
    });
    win.addEventListener('keyup', (e) => { if (KEYMAP[e.code]) keys.delete(KEYMAP[e.code]); });

    // --- lifecycle
    doc.addEventListener('visibilitychange', () => { if (doc.hidden) pause(); });
    win.addEventListener('blur', () => releaseAll());

    // --- controller (first standard-mapping pad)
    let padPauseWas = false;
    function pollPad() {
        pad = { x: 0, y: 0, roll: 0, thrust: false, fire: false };
        let pads = [];
        try { pads = win.navigator.getGamepads ? [...win.navigator.getGamepads()] : []; } catch { pads = []; }
        const gp = pads.find((p) => p && p.connected);
        if (!gp) return;
        const b = (i) => { const x = gp.buttons[i]; return !!x && (x.pressed || x.value > BUTTON_THRESHOLD); };
        const l = radialDeadzone(gp.axes[0], gp.axes[1]);
        const r = radialDeadzone(gp.axes[2], gp.axes[3]);
        pad.x = l.x; pad.y = l.y; pad.roll = r.x;
        pad.thrust = (gp.buttons[GP.RT] && gp.buttons[GP.RT].value > TRIGGER_THRESHOLD) || b(GP.LT);
        pad.fire = b(GP.A) || b(GP.RB);
        const p = b(GP.MENU);
        if (p && !padPauseWas) { if (screen === 'playing') pause(); else if (screen === 'paused') begin(); }
        padPauseWas = p;
    }

    // --- main loop
    function stepOnce(dt, device) {
        const k = (n) => (keys.has(n) ? 1 : 0);
        const roll = (held.rollRight ? 1 : 0) - (held.rollLeft ? 1 : 0) + k('rollRight') - k('rollLeft') + pad.roll;
        const stickX = (stick.active ? stick.x : 0) + pad.x + k('yawRight') - k('yawLeft');
        const stickY = (stick.active ? stick.y : 0) + pad.y + k('pitchDown');
        stepLook(look, {
            device,
            stickX: Math.max(-1, Math.min(1, stickX)),
            stickY: Math.max(-1, Math.min(1, stickY)),
            roll: Math.max(-1, Math.min(1, roll)),
            mouseDX, mouseDY,
        }, dt);
        mouseDX = mouseDY = 0;
        stepSim(sim, { q: look.q, thrust: held.thrust || keys.has('thrust') || pad.thrust, fire: held.fire || keys.has('fire') || pad.fire }, dt);
        for (const ev of drainEvents(sim)) {
            if (ev.type === 'collect') { flashCollect = 1; if (renderer) renderer.burst(ev.pos, 'collect'); vibrate(15); }
            else if (ev.type === 'split') { if (renderer) renderer.burst(ev.pos, ev.byShip ? 'hit' : 'split'); }
            else if (ev.type === 'hit') { flashHit = 1; vibrate(120); }
            else if (ev.type === 'gameover') gameOver();
        }
    }

    function vibrate(ms) {
        if (!settings.get('haptics')) return;
        try { if (win.navigator.vibrate) win.navigator.vibrate(ms); } catch { /* ignore */ }
    }

    function frame(t) {
        win.requestAnimationFrame(frame);
        const now = t || performance.now();
        clock = now;
        const dtReal = lastT ? Math.min(0.1, (now - lastT) / 1000) : 0;
        lastT = now;

        // Frame rate and adaptive render scale
        frameCount++;
        frames++;
        if (now - fpsT >= 500) { fps = (frameCount * 1000) / (now - fpsT || 1); frameCount = 0; fpsT = now; }
        if (screen === 'playing' && !lowres && now - scaleT >= 1000) {
            scaleT = now;
            const n = nextRenderScale(renderScale, fps, goodSeconds);
            goodSeconds = n.goodSeconds;
            if (n.scale !== renderScale) { renderScale = n.scale; resize(); }
        }

        pollPad();
        // Motion source / screen rotation changes: recentre so the view does not jump
        const src = source.source;
        const ang = screenAngle(win);
        if ((src !== lastSource && lastSource !== null) || ang !== lastAngle) {
            if (motionReady()) recentre(look, source.quat());
        }
        lastSource = src;
        lastAngle = ang;

        const eff = effectiveMode(now);
        const device = chosenMode() !== 'joystick' && motionReady() ? source.quat() : null;
        if (eff !== look.mode) { setMode(look, eff, device); refreshUi(); }
        // The first reading is the neutral pose: take it on the frame it arrives, not on the
        // next sim step (a second reading could replace it before then)
        if (device && eff !== 'joystick') calibrate(look, device);
        if (screen === 'playing' && chosenMode() !== 'joystick' && !motionReady() && !noDataWarned && !motionGrace(now)) {
            noDataWarned = true;
            say(permissionMessage() || 'No motion sensor found: using Joystick.', 5000);
        }

        if (screen === 'playing') {
            acc += dtReal;
            let n = 0;
            while (acc >= SIM.dt && n < MAX_STEPS) { stepOnce(SIM.dt, device); acc -= SIM.dt; n++; }
            if (n === MAX_STEPS) acc = 0;
            steps += n;
        }
        wakeLock.sync(screen === 'playing');
        if (message && now > messageUntil) { message = ''; $('p3-msg').textContent = ''; }
        flashHit = Math.max(0, flashHit - dtReal * 2);
        flashCollect = Math.max(0, flashCollect - dtReal * 3);

        if (renderer) renderer.render({ shipPos: sim.ship.pos, q: look.q, rocks: sim.rocks, bullets: sim.bullets, dt: dtReal });
        drawOverlay();
    }

    function drawOverlay() {
        hctx.clearRect(0, 0, cssW, cssH);
        drawFlash(hctx, cssW, cssH, flashHit, flashCollect);
        drawCockpit(hctx, cssW, cssH);
        drawCrosshair(hctx, cssW, cssH, sim.ship.invulnerable > 0 ? 'rgba(255,140,140,0.9)' : undefined);
        drawHudText(hctx, cssW, cssH, {
            score: sim.score, lives: sim.lives, mode: look.mode, chosenMode: chosenMode(), levelHorizon: look.level,
            fps, renderScale, speed: vLen(sim.ship.vel), message: screen === 'playing' ? message : '',
        }, { top: 0, left: 0, right: 0 });
        drawJoystick(hctx, stick);
    }

    // --- read-only test hook
    const r4 = (v) => Math.round(v * 1e4) / 1e4;
    function snapshot() {
        const a = lookAngles(look);
        return {
            loaded: !!renderer,
            error,
            screen,
            mode: effectiveMode(clock || undefined),
            lookMode: look.mode, // the mode the last frame actually applied
            chosenMode: chosenMode(),
            menuOpen: root.classList.contains('p3-menu-open'),
            frames,
            steps,
            time: r4(sim.time),
            lowres,
            levelHorizon: look.level,
            sensitivity: look.sensitivity,
            permission,
            sensorSource: source.source,
            motionData: source.hasData,
            portrait: isPortrait(win),
            quat: look.q.map(r4),
            yaw: r4(a.yaw), pitch: r4(a.pitch), roll: r4(a.roll),
            shipPos: sim.ship.pos.map(r4),
            shipVel: sim.ship.vel.map(r4),
            speed: r4(vLen(sim.ship.vel)),
            score: sim.score,
            lives: sim.lives,
            over: sim.over,
            counts: simCounts(sim),
            stats: { ...sim.stats },
            fps: Math.round(fps * 10) / 10,
            renderScale,
            pixelRatio,
            drawCalls: renderer ? renderer.drawCalls : 0,
            three: renderer ? renderer.three : null,
            seed,
            message,
            stick: { active: stick.active, x: r4(stick.x), y: r4(stick.y) },
        };
    }
    const hook = win.__spaceAdventure || (win.__spaceAdventure = {});
    Object.defineProperty(hook, 'game3d', { get: snapshot, configurable: true });
    hook.probe3d = () => (renderer
        ? renderer.probeLitPixels({ shipPos: sim.ship.pos, q: look.q, rocks: sim.rocks, bullets: sim.bullets, dt: 0 })
        : null);

    refreshUi();
    win.requestAnimationFrame(frame);
    return { snapshot };
}
