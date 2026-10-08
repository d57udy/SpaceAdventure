// The 3D game page (docs/plans/07-3d-game.md §5). Entry point, loaded by js/main.js with a
// dynamic import ONLY when the page is opened with ?3d=1, so the 2D game never downloads any
// 3D file. This module owns the page while it runs: its own DOM layer, the menus (ui3d.js),
// input, fixed-step loop and the read-only test hook window.__spaceAdventure.game3d.
// (js/3d/proto3d.js re-exports it under the prototype's name.)
//
// URL options: ?3d=1 (required), &seed3d=N (repeatable layout), &layout3d=range (one red
// rock straight ahead and one crystal behind: used by the browser tests), &layout3d=far
// (one red rock FAR_ROCK_DISTANCE straight ahead: past the original fog end), &layout3d=last
// (level 1 down to a small crystal and a small red rock straight ahead), &layout3d=ufo (one
// UFO 400 straight ahead, holding still and not firing), &layout3d=boss (level 2 with only the
// boss left, holding still 700 ahead, its outer weak points already gone and the core down
// to one shot: a test shortcut), &layout3d=doom (a quick game over: 1 life, a small crystal at
// the ship, a large red rock 300 ahead flying at it, arriving in about 2 s), &layout3d=blocked
// (level 1 with no rock left, only a still UFO beyond the view distance keeping it going),
// &layout3d=busy (level 2 with the boss, two UFOs, two power-ups and rocks in view: draw calls), &layout3d=powerup (a triple-shot power-up 60 ahead, a red rock 500 ahead), &lowres3d=1
// (tests only: fixed half-resolution drawing buffer, no antialiasing, 1x HUD, so a software
// renderer on CI keeps a usable frame rate; real devices never get it).
//
// Start never waits for motion: the game starts at once with the chosen control type. If no
// motion reading arrives within NO_DATA_MS of wall time (no sensor, permission denied or
// still being asked), it switches to Joystick and switches back when readings arrive.
//
// Phase 2 (docs/plans/07-3d-game.md): one adaptive difficulty tracker (rules3d.js
// createAdaptive3d, fed by sim3d.js) with its HUD label; the aids it switches (assist3d.js:
// target brackets, lead marker, crystal arrow, threat warnings); sound (audio3d.js) and
// vibration / rumble (haptics3d.js) for the game events; explosion debris; the frame-rate
// check with its offer to switch to 2D and graphics-context loss handling (perf3d.js).
//
// Phases 4 and 5: the menus, pause menu, game over and prompts are ui3d.js (an overlay; the
// game buttons hide while it shows); progress3d.js (through ui.progress) gets the scoring
// events, levels and achievements, and its upgrades go into the sim (shipMods3d) and the
// turn rate (look.js); the first-game tutorial (tutorial3d.js) runs in its own quiet sim;
// the settings apply live (field of view, invert, vignette, left-handed layout and the rest).

import { createSettings } from '../settings.js';
import { PersistenceManager } from '../persistence.js';
import { BUILD_VERSION } from '../version.js';
import { createUi3d } from './ui3d.js';
import { shipMods3d } from './progress3d.js';
import { Tutorial3d, detectInputKind3d, recordTutorial3dDone } from './tutorial3d.js';
import { createOrientationLock, rotateHint, prefersReducedMotion } from './orient3d.js';
import { createWakeLock } from '../wakeLock.js';
import {
    radialDeadzone, GP, TRIGGER_THRESHOLD, BUTTON_THRESHOLD, RUMBLE_PATTERNS, MENU_STICK_ON as MENU_STICK,
    MENU_REPEAT_DELAY, MENU_REPEAT_INTERVAL,
} from '../gamepad.js';
import { URL_2D, writeLastMode } from '../mode3d.js';
import {
    createSim, stepSim, drainEvents, simCounts, nextId, rocksLeft, showAllTargets, adaptiveInfo, aimTargets, bossBody, activeEffects,
    hyperspaceState, SIM,
} from './sim3d.js';
import { createAdaptive3d } from './rules3d.js';
import { POWERUP3D, powerUpScale } from './powerup3d.js';
import { crosshairTarget, leadPoint, projectLocal, crystalArrowOptions } from './assist3d.js';
import { createPerfMonitor, createContextLossTracker } from './perf3d.js';
import { createBrowserAudio3d } from './audio3d.js';
import { createBrowserHaptics3d } from './haptics3d.js';
import { makeRock, worldFor, nearestDelta, randomUnit, wrapPos, VIEW_DISTANCES } from './world3d.js';
import { vLen, vAdd, vScale, qRotate, qConj, qAngle, forwardOf } from './math3d.js';
import {
    createLook, stepLook, recentre, setMode, calibrate, setLevelHorizon, lookAngles, CONTROL_MODES,
} from './look.js';
import {
    createOrientationSource, requestMotionPermission, motionPermissionNeeded, isPortrait, screenAngle,
} from './sensors.js';
import {
    drawCrosshair, drawHudText, drawJoystick, drawFlash, drawRadar, drawEdgeMarker, drawBanner, drawDamage, damageAngle,
    drawTargetBrackets, drawLeadMarker, drawHitMarker, drawPowerUpChips, drawBossBar, drawVignette, vignetteAlpha,
    drawToast, drawTutorialBox, drawRadarPulse,
} from './hud3d.js';
import { buildRadar, edgeMarker, radarLayout, remainingMarkers } from './radar3d.js';
import { findPalette } from '../palette.js';

const MODE_LABELS = { direct: 'Direct', rate: 'Rate', joystick: 'Joystick' };
const NO_DATA_MS = 1500;
const MIN_RENDER_SCALE = 0.5; // nextRenderScale's floor (perf3d.js offers 2D below 30 fps there)
const FALLBACK_MS = 2500;     // the context-loss message shows this long before 2D opens
const UFO_COLOR = '#B266FF';  // purple saucer (plan 07 §2.4)
const BOSS_COLOR = '#FF8844';
const POWERUP_COLOR = '#FFD24A';
const STICK_RADIUS = 64;
const MAX_STEPS = 6;
export const FAR_ROCK_DISTANCE = 1000; // &layout3d=far: beyond the original fog end (720)

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
#proto3d button { font: inherit; color: #fff; cursor: pointer; -webkit-tap-highlight-color: transparent;
  text-shadow: 0 1px 2px rgba(0,0,0,0.9); }
.p3-btn { position: absolute; width: 84px; height: 84px; border-radius: 50%; touch-action: none;
  background: rgba(255,255,255,0.12); border: 2px solid rgba(255,255,255,0.4); font-size: 15px; font-weight: bold; }
.p3-btn.p3-on { background: rgba(255,255,255,0.35); }
#p3-thrust { left: calc(16px + env(safe-area-inset-left, 0px)); bottom: calc(16px + env(safe-area-inset-bottom, 0px)); }
#p3-fire { right: calc(16px + env(safe-area-inset-right, 0px)); bottom: calc(16px + env(safe-area-inset-bottom, 0px));
  background: rgba(255,80,80,0.22); }
#p3-hyper { width: 56px; height: 56px; font-size: 11px; right: calc(108px + env(safe-area-inset-right, 0px));
  bottom: calc(16px + env(safe-area-inset-bottom, 0px)); background: rgba(120,160,255,0.2); }
#p3-hyper.p3-cool { opacity: 0.45; }
#proto3d.p3-joystick #p3-hyper { right: calc(16px + env(safe-area-inset-right, 0px)); bottom: calc(108px + env(safe-area-inset-bottom, 0px)); }
#proto3d.p3-joystick.p3-free #p3-hyper { bottom: calc(188px + env(safe-area-inset-bottom, 0px)); }
#proto3d.p3-joystick #p3-thrust { left: auto; right: calc(116px + env(safe-area-inset-right, 0px)); }
.p3-roll { display: none; width: 64px; height: 64px; font-size: 26px; }
#proto3d.p3-joystick.p3-free .p3-roll { display: block; }
#p3-roll-left { right: calc(96px + env(safe-area-inset-right, 0px)); bottom: calc(116px + env(safe-area-inset-bottom, 0px)); }
#p3-roll-right { right: calc(16px + env(safe-area-inset-right, 0px)); bottom: calc(116px + env(safe-area-inset-bottom, 0px)); }
#p3-stick-zone { position: absolute; left: 0; top: 22%; bottom: 0; width: 45%; display: none; touch-action: none; }
#proto3d.p3-joystick #p3-stick-zone { display: block; }
#p3-insets { position: absolute; visibility: hidden; pointer-events: none; width: 0; height: 0;
  padding: env(safe-area-inset-top, 0px) env(safe-area-inset-right, 0px) env(safe-area-inset-bottom, 0px) env(safe-area-inset-left, 0px); }
#p3-topbar { position: absolute; top: calc(8px + env(safe-area-inset-top, 0px)); right: calc(8px + env(safe-area-inset-right, 0px));
  display: flex; gap: 8px; }
.p3-small { min-width: 48px; min-height: 44px; padding: 0 12px; border-radius: 10px; background: rgba(20,30,50,0.7);
  border: 1px solid rgba(255,255,255,0.35); font-size: 14px; }
#p3-portrait-banner { position: absolute; left: 50%; top: calc(56px + env(safe-area-inset-top, 0px)); transform: translateX(-50%);
  background: rgba(60,40,0,0.75); padding: 6px 12px; border-radius: 8px; font-size: 13px; z-index: 40; pointer-events: none;
  max-width: calc(100% - 32px); text-align: center; }
.p3-hidden { display: none !important; }
/* Left-handed layout: the buttons and the stick change sides */
#proto3d.p3-left #p3-thrust { left: auto; right: calc(16px + env(safe-area-inset-right, 0px)); }
#proto3d.p3-left #p3-fire { right: auto; left: calc(16px + env(safe-area-inset-left, 0px)); }
#proto3d.p3-left #p3-hyper { right: auto; left: calc(108px + env(safe-area-inset-left, 0px)); }
#proto3d.p3-left.p3-joystick #p3-thrust { right: auto; left: calc(116px + env(safe-area-inset-left, 0px)); }
#proto3d.p3-left.p3-joystick #p3-hyper { left: calc(16px + env(safe-area-inset-left, 0px)); }
#proto3d.p3-left #p3-roll-left { right: auto; left: calc(16px + env(safe-area-inset-left, 0px)); }
#proto3d.p3-left #p3-roll-right { right: auto; left: calc(96px + env(safe-area-inset-left, 0px)); }
#proto3d.p3-left #p3-stick-zone { left: auto; right: 0; }
/* Tutorial: the control it talks about pulses */
@keyframes p3-pulse { 0%, 100% { box-shadow: 0 0 0 0 rgba(255,210,122,0.9); } 50% { box-shadow: 0 0 0 10px rgba(255,210,122,0); } }
.p3-hl { animation: p3-pulse 1s ease-in-out infinite; border-color: #ffd27a !important; }
@media (prefers-reduced-motion: reduce) { .p3-hl { animation: none; box-shadow: 0 0 0 4px rgba(255,210,122,0.9); } }
/* Pointer lock (desktop): no cursor over the view */
#proto3d.p3-locked { cursor: none; }
#p3-skip { display: none; }
#proto3d.p3-tutorial #p3-skip { display: block; }
/* The menus (ui3d.js) cover the game: no game buttons while they show */
#proto3d.u3d-open .p3-game { display: none !important; }
`;

const HTML = `
<canvas id="p3-canvas"></canvas>
<canvas id="p3-hud"></canvas>
<div id="p3-stick-zone" class="p3-game" aria-label="Joystick area"></div>
<div id="p3-insets" aria-hidden="true"></div>
<button type="button" id="p3-thrust" class="p3-btn p3-game" aria-label="Thrust">THRUST</button>
<button type="button" id="p3-fire" class="p3-btn p3-game" aria-label="Fire">FIRE</button>
<button type="button" id="p3-hyper" class="p3-btn p3-game" aria-label="Hyperspace">HYPER</button>
<button type="button" id="p3-roll-left" class="p3-btn p3-roll p3-game" aria-label="Roll left">⟲</button>
<button type="button" id="p3-roll-right" class="p3-btn p3-roll p3-game" aria-label="Roll right">⟳</button>
<div id="p3-topbar" class="p3-game">
  <button type="button" id="p3-skip" class="p3-small" aria-label="Skip training">Skip</button>
  <button type="button" id="p3-recentre" class="p3-small" aria-label="Recentre">Recentre</button>
  <button type="button" id="p3-mode" class="p3-small" aria-label="Control type">Direct</button>
  <button type="button" id="p3-level" class="p3-small" aria-label="Level horizon">Level: off</button>
  <button type="button" id="p3-pause" class="p3-small" aria-label="Pause">II</button>
</div>
<div id="p3-portrait-banner" class="p3-hidden" role="status">Landscape recommended</div>
`;

/**
 * Take over the page and run the 3D game.
 * @param {object} [o]
 * @param {Window} [o.win]
 * @param {Function} [o.createRenderer] - (canvas) => renderer; unit tests pass a fake (default: render3d.js)
 * @param {Function} [o.onSound] - (name) => void: every game sound event ('threat', 'hit', 'shieldHit',
 *   'collect', 'wasted', 'split', 'level', 'extraLife', 'respawn', 'gameover'), besides the real audio
 * @param {Function} [o.createAudio] - async ({ settings, range }) => audio3d.js object; default: the
 *   browser audio when the page has Web Audio (never in unit tests: their fake window has none)
 * @param {Function} [o.createHaptics] - async ({ settings, gamepad, usingController, nav }) =>
 *   haptics3d.js object; default: the browser one on the page's navigator
 * @param {object} [o.persistence] - PersistenceManager (profiles, boards, credits); unit tests pass one
 *   over a fake storage (default: a new one on the page's localStorage)
 * @param {object} [o.storage] - localStorage for the last-mode flag (default: win.localStorage)
 */
export async function startGame3d({
    win = window, createRenderer = null, onSound = null, createAudio = undefined, createHaptics = undefined,
    persistence = null, storage = undefined,
} = {}) {
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
    root.className = '';
    root.innerHTML = HTML;
    doc.body.appendChild(root);
    const $ = (id) => root.querySelector('#' + id);

    const settings = createSettings();
    const pm = persistence || new PersistenceManager();
    const pageStorage = () => {
        if (storage !== undefined) return storage;
        try { return win.localStorage || null; } catch { return null; }
    };
    const difficultyName = () => settings.get('difficulty'); // shared Easy / Medium / Hard (default Medium)
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
    let peakDrawCalls = 0; // test hook: the most draw calls of a frame while playing (plan 07 §5: < 25)
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
    let radar = { front: [], rear: [] }, edge = null, layoutR = radarLayout(1, 1);
    let threatIds = new Set(), threatBuzzAt = 0;
    let markers = [], few = false;
    let damage = { angle: 0, alpha: 0 };
    let hitMarker = 0;
    let hyperspaceAt = null, shieldHitAt = -1e9; // sim time of the last jump / shield hit (renderer effects)
    let target = null, targetScreen = null, leadScreen = null;
    let padActive = null, usingPad = false;
    let perfPrompt = false;
    let fallbackAt = 0;
    let vignette = 0; // fast-turn vignette strength (0..1, smoothed)
    let lastQ = null; // ship orientation one frame ago (tutorial: how far the player looked)
    let lastGestureAt = -1e9; // wall time of the last tap / click / key (motion permission needs one)
    let lastInputSource = null; // 'touch' | 'mouse' | 'keyboard' | 'gamepad' (Help and tutorial wording)
    let progress = null; // ui.progress at the start of the current game (progress3d.js)
    let toastSeen = 0, toast = null; // achievement toasts: how many of the game's unlocks were shown
    const tutorial = new Tutorial3d();
    let tutorialTarget = null; // id of the rock the tutorial asked for
    let tutorialFire = false; // fire held last step (the tutorial's 'confirm' is a new press)
    const adaptive = createAdaptive3d(); // the 3D game's one adaptive difficulty tracker (reset per game)
    const perf = createPerfMonitor();
    const ctxLoss = createContextLossTracker();
    let audio = null, haptics = null;
    let ui = null; // the menus (ui3d.js), created once the page is set up
    const orientLock = createOrientationLock({ win, doc }); // landscape while a game runs (Android full screen / app)
    const reducedMotion = prefersReducedMotion(win); // fewer flashes, no hyperspace tunnel, no pulsing
    const guard = (fn) => { try { return fn(); } catch { return null; /* sound and vibration must not break the game */ } };

    // Controller rumble on the pad in use (haptics3d.js asks only while it is the last input)
    const padRumble = {
        rumbleEvent(name) {
            const r = RUMBLE_PATTERNS[name];
            const act = padActive && padActive.vibrationActuator;
            if (!r || !act || typeof act.playEffect !== 'function') return false;
            const p = act.playEffect('dual-rumble', { startDelay: 0, duration: r.ms, strongMagnitude: r.strong, weakMagnitude: r.weak });
            if (p && p.catch) p.catch(() => {});
            return true;
        },
    };

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
    }

    // --- renderer
    const canvas = $('p3-canvas');
    const hud = $('p3-hud');
    const hctx = hud.getContext('2d');
    let factory = null;
    try {
        factory = createRenderer || (await import('./render3d.js')).createRenderer3d;
        renderer = factory(canvas, { antialias: !lowres, world: worldFor(settings.get('viewDistance3d')) });
    } catch (e) {
        error = String(e && e.message || e);
        say('3D could not start on this device (WebGL 2 not available). Use Switch to 2D.', 1e9);
    }

    // Sound and vibration: built once, never awaited by the game (it runs silently until then)
    try {
        const makeAudio = createAudio !== undefined ? createAudio
            : (win.AudioContext || win.webkitAudioContext ? createBrowserAudio3d : null);
        if (makeAudio) audio = await makeAudio({ settings, range: worldFor(settings.get('viewDistance3d')).fogFar });
    } catch { audio = null; }
    try {
        const makeHaptics = createHaptics !== undefined ? createHaptics : createBrowserHaptics3d;
        if (makeHaptics) haptics = await makeHaptics({ settings, gamepad: padRumble, usingController: () => usingPad, nav: win.navigator });
    } catch { haptics = null; }

    // Graphics context loss (perf3d.js): pause, rebuild on restore, 2D when it doesn't come back
    const nowS = () => (clock || performance.now()) / 1000; // the frame clock, as tick() in the loop
    canvas.addEventListener('webglcontextlost', (e) => {
        if (e && e.preventDefault) e.preventDefault(); // otherwise the browser never restores it
        const r = ctxLoss.lost(nowS());
        pause();
        say(r.message, 1e9);
        if (ui) ui.prompt({ title: 'Graphics', text: r.message, buttons: [{ id: 'ok', label: 'OK' }] });
    });
    canvas.addEventListener('webglcontextrestored', () => {
        if (!ctxLoss.restored(nowS()).rebuild || !factory) return;
        try {
            if (renderer && renderer.dispose) renderer.dispose();
            renderer = factory(canvas, { antialias: !lowres, world: worldFor(viewName()) });
            if (renderer.setWorld) renderer.setWorld(worldFor(viewName()));
            applyLook();
            resize();
            say('Graphics restored.', 2000);
        } catch (e) {
            error = String(e && e.message || e);
        }
    });

    function resize() {
        cssW = Math.max(1, win.innerWidth);
        cssH = Math.max(1, win.innerHeight);
        pixelRatio = lowres ? 0.5 : basePixelRatio(win.devicePixelRatio) * renderScale;
        if (renderer) renderer.setSize(cssW, cssH, pixelRatio);
        const hdpr = lowres ? 1 : Math.min(win.devicePixelRatio || 1, 2);
        hud.width = Math.round(cssW * hdpr);
        hud.height = Math.round(cssH * hdpr);
        hctx.setTransform(hdpr, 0, 0, hdpr, 0, 0);
        relayoutRadar();
        const banner = $('p3-portrait-banner');
        banner.classList.toggle('p3-hidden', !isPortrait(win));
        banner.textContent = rotateHint(win); // iPhones can't lock the orientation: ask to turn
    }
    function relayoutRadar() {
        // Safe-area insets come from the CSS env() values the buttons use
        // (read from a hidden probe padded by them)
        const probe = $('p3-insets');
        const cs = probe && win.getComputedStyle ? win.getComputedStyle(probe) : null;
        const px = (n) => (cs ? parseFloat(cs[n]) || 0 : 0);
        layoutR = radarLayout(cssW, cssH, {
            rollButtons: root.classList.contains('p3-joystick') && root.classList.contains('p3-free'),
            insets: { top: px('paddingTop'), right: px('paddingRight'), bottom: px('paddingBottom'), left: px('paddingLeft') },
            side: settings.get('leftHanded3d') ? 'left' : 'right', // the radar moves away from the buttons
        });
    }
    win.addEventListener('resize', resize);
    resize();

    // --- simulation
    const viewName = () => settings.get('viewDistance3d');
    /**
     * A new simulation for the next game. mods: ship upgrades (progress3d shipMods3d);
     * tutorial: the training's quiet world (no field, no UFOs, no timed power-ups, lives
     * that never run out, no score).
     */
    function newSim({ mods = null, tutorial: training = false } = {}) {
        const view = viewName();
        if (renderer && renderer.setWorld) renderer.setWorld(worldFor(view));
        if (audio) guard(() => audio.setRange(worldFor(view).fogFar));
        adaptive.reset(); // as 2D: a new game starts Balanced
        hyperspaceAt = null;
        shieldHitAt = -1e9;
        const opts = { seed, view, difficulty: difficultyName(), adaptive, mods };
        tutorialTarget = null;
        if (training) {
            sim = createSim({ ...opts, field: false, lives: 99, ufos: false, powerUps: false });
        } else if (layout === 'far') {
            sim = createSim({ ...opts, field: false });
            const [x, y, z] = sim.ship.pos;
            sim.rocks.push(makeRock({ id: nextId(sim), kind: 'red', size: 'large', pos: [x, y, z - FAR_ROCK_DISTANCE], vel: [0, 0, 0], rand: sim.rand }));
        } else if (layout === 'range') {
            sim = createSim({ ...opts, field: false });
            const [x, y, z] = sim.ship.pos;
            sim.rocks.push(makeRock({ id: nextId(sim), kind: 'red', size: 'large', pos: [x, y, z - 300], vel: [0, 0, 0], rand: sim.rand }));
            sim.rocks.push(makeRock({ id: nextId(sim), kind: 'green', pos: [x, y, z + 220], vel: [0, 0, 0], rand: sim.rand }));
        } else if (layout === 'last') {
            // A real level down to its last two: a small crystal 100 ahead, a small red rock 1000 ahead
            // (far enough that the ship, coasting after the crystal, stops well before it)
            sim = createSim(opts);
            const [x, y, z] = sim.ship.pos;
            sim.incoming.left = 0;
            sim.rocks = [
                makeRock({ id: nextId(sim), kind: 'green', size: 'small', pos: [x, y, z - 100], vel: [0, 0, 0], rand: sim.rand }),
                makeRock({ id: nextId(sim), kind: 'red', size: 'small', pos: [x, y, z - 1000], vel: [0, 0, 0], rand: sim.rand }),
            ];
        } else if (layout === 'ufo') {
            sim = createSim({ ...opts, field: false });
            const [x, y, z] = sim.ship.pos;
            const u = sim.ufoSys.spawnAt([x, y, z - 400], sim.ship.pos);
            u.vel = [0, 0, 0];
            u.fireTimer = 1e9;
            sim.ufos = sim.ufoSys.ufos;
        } else if (layout === 'boss') {
            sim = createSim({ ...opts, level: 2, ufos: false, powerUps: false });
            sim.rocks = [];
            sim.incoming.left = 0;
            for (const w of sim.boss.state.weakPoints) { w.destroyed = true; w.health = 0; }
            sim.boss.state.core.health = 10;
            sim.boss.state.moveSpeed = 0; // holds still straight ahead, so a test can aim at it
        } else if (layout === 'busy') {
            // A busy scene for the draw-call budget: level 2 (the boss and a boss field), two
            // UFOs, two kinds of power-up in view
            sim = createSim({ ...opts, level: 2, ufos: false, powerUps: false });
            const [x, y, z] = sim.ship.pos;
            for (const dx of [-250, 250]) {
                const u = sim.ufoSys.spawnAt([x + dx, y + 60, z - 450], sim.ship.pos);
                u.vel = [0, 0, 0];
            }
            sim.ufos = sim.ufoSys.ufos;
            sim.power.dropAt([x + 80, y, z - 200], 'shield');
            sim.power.dropAt([x - 80, y, z - 200], 'magnet');
            sim.rocks.push(makeRock({ id: nextId(sim), kind: 'red', size: 'large', pos: [x, y, z - 300], vel: [0, 0, 0], rand: sim.rand }));
            sim.rocks.push(makeRock({ id: nextId(sim), kind: 'green', size: 'large', pos: [x + 40, y + 40, z - 260], vel: [0, 0, 0], rand: sim.rand }));
        } else if (layout === 'blocked') {
            // Level 1 with every rock gone and one UFO far beyond the view distance, holding still
            sim = createSim({ ...opts, powerUps: false });
            sim.rocks = [];
            sim.incoming.left = 0;
            sim.ufoSys.setEnabled(false);
            const [x, y, z] = sim.ship.pos;
            const u = sim.ufoSys.spawnAt([x + 2 * sim.world.fogFar * 0.55, y, z], sim.ship.pos);
            u.vel = [0, 0, 0];
            u.fireTimer = 1e9;
            sim.ufos = sim.ufoSys.ufos;
        } else if (layout === 'doom') {
            sim = createSim({ ...opts, field: false, lives: 1 });
            const [x, y, z] = sim.ship.pos;
            sim.rocks.push(makeRock({ id: nextId(sim), kind: 'green', size: 'small', pos: [x, y, z], vel: [0, 0, 0], rand: sim.rand }));
            sim.rocks.push(makeRock({ id: nextId(sim), kind: 'red', size: 'large', pos: [x, y, z - 300], vel: [0, 0, 150], rand: sim.rand }));
        } else if (layout === 'powerup') {
            sim = createSim({ ...opts, field: false });
            const [x, y, z] = sim.ship.pos;
            sim.power.dropAt([x, y, z - 60], 'triple_shot');
            sim.rocks.push(makeRock({ id: nextId(sim), kind: 'red', size: 'large', pos: [x, y, z - 500], vel: [0, 0, 0], rand: sim.rand }));
        } else {
            sim = createSim(opts);
        }
    }
    newSim();

    // --- game buttons (the menus are ui3d.js)
    function refreshUi() {
        const c = chosenMode();
        const lv = settings.get('levelHorizon3d');
        $('p3-level').textContent = `Level: ${lv ? 'on' : 'off'}`;
        const eff = effectiveMode();
        $('p3-mode').textContent = MODE_LABELS[eff] + (eff !== c ? '*' : '');
        $('p3-recentre').classList.toggle('p3-hidden', eff === 'joystick'); // plan §3: for Direct and Rate
        root.classList.toggle('p3-joystick', eff === 'joystick');
        root.classList.toggle('p3-free', !lv);
        root.classList.toggle('p3-left', !!settings.get('leftHanded3d'));
        root.classList.toggle('p3-tutorial', tutorial.active);
        relayoutRadar();
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

    /** Look settings from the settings and the upgrades (turn rate: Rate and Joystick only). */
    function freshLook(mods) {
        const l = createLook({ mode: look.mode, levelHorizon: settings.get('levelHorizon3d'), sensitivity: settings.get('sensitivity3d') });
        l.invert = !!settings.get('invert3d');
        l.turnRateMult = (mods && mods.turnRateMult) || 1;
        return l;
    }

    /** Start (from the menu or game over) or continue (from pause) the game. */
    function begin() {
        if (screen === 'over' || screen === 'menu') {
            motionSince = performance.now();
            noDataWarned = false;
            look = freshLook(sim.mods);
        }
        screen = 'playing';
        // The pose held at Start is "straight ahead"
        const dq = motionReady() ? source.quat() : null;
        setMode(look, effectiveMode(), dq);
        if (dq) recentre(look, dq);
        lastT = 0;
        acc = 0;
        refreshUi();
    }

    /** Pause button, Esc or P, controller Start, page hidden, context loss: the pause menu. */
    function pause() {
        if (screen !== 'playing') return;
        screen = 'paused';
        releaseAll();
        stopEffects();
        if (progress) guard(() => progress.save());
        try { if (doc.pointerLockElement) doc.exitPointerLock(); } catch { /* ignore */ }
        if (ui) ui.show('pause');
        refreshUi();
    }

    /** Game over: the UI shows it and records the score, credits and achievements (once). */
    function gameOver() {
        screen = 'over';
        releaseAll();
        stopEffects();
        try { if (doc.pointerLockElement) doc.exitPointerLock(); } catch { /* ignore */ }
        if (ui) ui.show('gameOver', { score: sim.score, level: sim.level });
        refreshUi();
    }

    /**
     * A new game from the menus (Play, Play again, Restart). The progress comes from the UI
     * (a name or guest choice replaces it); the upgrades go into the sim and the turn rate.
     */
    function startNewGame({ tutorial: training = false, progress: p = null } = {}) {
        progress = p || (ui ? ui.progress : null);
        if (progress) guard(() => progress.startGame());
        // Unlocks not yet shown on a game-over screen stay listed; only new ones get a toast
        toastSeen = progress && progress.achievements ? (progress.achievements.recentlyUnlocked || []).length : 0;
        toast = null;
        const mods = progress ? progress.ship() : shipMods3d(null);
        tutorial.reset();
        newSim({ mods, tutorial: training });
        screen = 'menu';
        // Motion access must be asked inside the tap, click or key that started the game (iOS);
        // never awaited. Without such a gesture (a controller's Ⓐ) a prompt asks for one.
        const gesture = performance.now() - lastGestureAt < 1000;
        if (gesture || !motionPermissionNeeded(win)) ensureMotion(chosenMode());
        orientLock.lock(); // never awaited; only where allowed (Android full screen, installed app)
        begin();
        if (training) applyTutorialRequests(tutorial.start({ control: chosenMode(), input: inputKind() }));
        refreshUi();
        if (!gesture) maybeAskMotion();
    }

    /** The Help tab and the tutorial wording follow the last input. */
    const inputKind = () => detectInputKind3d({
        lastInputSource, isTouchDevice: !!(win.navigator && win.navigator.maxTouchPoints > 0) || 'ontouchstart' in win,
    });

    /**
     * iPhone: motion access must be asked inside a user gesture. A game started without one
     * (a controller's Ⓐ) asks through a prompt whose Allow button is that gesture.
     */
    function maybeAskMotion() {
        if (!ui || chosenMode() === 'joystick' || permission !== 'unknown' || !motionPermissionNeeded(win) || motionRequest) return;
        pause();
        ui.prompt({
            title: 'Motion', text: 'Direct and Rate steer with the phone. Allow motion access?',
            buttons: [{ id: 'allow', label: 'Allow' }, { id: 'joystick', label: 'Use Joystick' }], cancel: 'joystick',
        }).then((id) => {
            if (id === 'allow') ensureMotion(chosenMode());
            else chooseMode('joystick');
        });
    }

    /** Pause, game over: no thrust or UFO loop left running, no vibration. */
    function stopEffects() {
        if (audio) guard(() => audio.stopAll());
        if (haptics) guard(() => haptics.stop());
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

    /**
     * A new view distance changes the world size: it applies to the next game (the menus say
     * so). In the menu the waiting world is rebuilt at once, so the hook shows it.
     */
    function chooseView(v) {
        if (!VIEW_DISTANCES[v]) return;
        if (screen === 'menu' || screen === 'over') newSim();
        refreshUi();
    }

    function toggleLevel() {
        const on = !settings.get('levelHorizon3d');
        settings.set('levelHorizon3d', on);
        setLevelHorizon(look, on, motionReady() ? source.quat() : null);
        refreshUi();
    }

    // --- in-game buttons
    $('p3-recentre').addEventListener('click', doRecentre);
    $('p3-mode').addEventListener('click', () => {
        const i = CONTROL_MODES.indexOf(chosenMode());
        chooseMode(CONTROL_MODES[(i + 1) % CONTROL_MODES.length]);
        say(`Control: ${MODE_LABELS[chosenMode()]}`, 1500);
    });
    $('p3-level').addEventListener('click', toggleLevel);
    $('p3-pause').addEventListener('click', pause);
    $('p3-skip').addEventListener('click', () => applyTutorialRequests(tutorial.skip()));

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
    // Hyperspace: one jump per press (button, H, controller B)
    let hyperReq = false;
    $('p3-hyper').addEventListener('pointerdown', (e) => { e.preventDefault(); if (screen === 'playing') hyperReq = true; });
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
    doc.addEventListener('pointerlockchange', () => root.classList.toggle('p3-locked', doc.pointerLockElement === root));

    // --- keyboard
    const KEYMAP = {
        KeyW: 'thrust', ArrowUp: 'thrust', Space: 'fire', KeyF: 'fire',
        KeyA: 'rollLeft', KeyQ: 'rollLeft', KeyD: 'rollRight', KeyE: 'rollRight',
        ArrowLeft: 'yawLeft', ArrowRight: 'yawRight', ArrowDown: 'pitchDown',
    };
    win.addEventListener('keydown', (e) => {
        // While the menus show they have the keys (ui3d.js listens on the document); P on the
        // pause menu resumes, as it paused
        if (ui && ui.visible) {
            if (e.code === 'KeyP' && !e.repeat && ui.current === 'pause') ui.back();
            return;
        }
        if (KEYMAP[e.code]) { keys.add(KEYMAP[e.code]); if (screen === 'playing') e.preventDefault(); }
        if (e.repeat || screen !== 'playing') return;
        if (e.code === 'KeyP' || e.code === 'Escape') pause(); // Esc also releases the mouse (browser)
        if (e.code === 'KeyR') doRecentre();
        if (e.code === 'KeyH') hyperReq = true;
        if (e.code === 'KeyL') toggleLevel();
        if (e.code === 'KeyM') $('p3-mode').click();
    });
    win.addEventListener('keyup', (e) => { if (KEYMAP[e.code]) keys.delete(KEYMAP[e.code]); });

    // Browsers only start audio from a user gesture; a touch, click or key also means the
    // controller is no longer the input in use (no rumble then)
    const gesture = (e) => {
        usingPad = false;
        lastGestureAt = performance.now();
        lastInputSource = e && e.type === 'keydown' ? 'keyboard' : (e && e.pointerType === 'mouse' ? 'mouse' : 'touch');
        if (audio) guard(() => audio.unlock());
    };
    root.addEventListener('pointerdown', gesture);
    win.addEventListener('keydown', gesture);

    // --- lifecycle
    doc.addEventListener('visibilitychange', () => { if (doc.hidden) pause(); });
    win.addEventListener('blur', () => releaseAll());

    // --- controller (first standard-mapping pad)
    let padPauseWas = false, padHyperWas = false;
    const menuPad = { dir: null, nextAt: 0, a: false, b: false };
    /** Menus with a controller: D-pad or left stick move (with repeat), Ⓐ selects, Ⓑ or Start goes back. */
    function pollMenuPad(gp, b, now) {
        const ax = gp.axes || [];
        const dir = b(GP.UP) || ax[1] < -MENU_STICK ? 'up' : b(GP.DOWN) || ax[1] > MENU_STICK ? 'down'
            : b(GP.LEFT) || ax[0] < -MENU_STICK ? 'left' : b(GP.RIGHT) || ax[0] > MENU_STICK ? 'right' : null;
        if (dir && (dir !== menuPad.dir || now >= menuPad.nextAt)) {
            menuPad.nextAt = now + (dir !== menuPad.dir ? MENU_REPEAT_DELAY : MENU_REPEAT_INTERVAL);
            ui.navigate(dir);
        }
        menuPad.dir = dir;
        const a = b(GP.A), back = b(GP.B) || b(GP.MENU);
        if (a && !menuPad.a) ui.select();
        if (back && !menuPad.b) ui.back();
        menuPad.a = a;
        menuPad.b = back;
        // The game must not see the presses that closed the menu
        padPauseWas = b(GP.MENU);
        padHyperWas = b(GP.B);
    }
    function pollPad() {
        pad = { x: 0, y: 0, roll: 0, thrust: false, fire: false };
        let pads = [];
        try { pads = win.navigator.getGamepads ? [...win.navigator.getGamepads()] : []; } catch { pads = []; }
        const gp = pads.find((p) => p && p.connected);
        padActive = gp || null;
        if (!gp) return;
        const b = (i) => { const x = gp.buttons[i]; return !!x && (x.pressed || x.value > BUTTON_THRESHOLD); };
        if (ui && ui.visible) {
            if (gp.buttons.some((x) => x && x.pressed)) { usingPad = true; lastInputSource = 'gamepad'; }
            pollMenuPad(gp, b, performance.now());
            return;
        }
        const l = radialDeadzone(gp.axes[0], gp.axes[1]);
        const r = radialDeadzone(gp.axes[2], gp.axes[3]);
        // Plan 07 §3: left stick turns, LT thrust, RT (or Ⓐ) fire, LB / RB roll (the right stick too)
        const trigger = (i) => !!gp.buttons[i] && (gp.buttons[i].value > TRIGGER_THRESHOLD || gp.buttons[i].pressed);
        pad.x = l.x; pad.y = l.y;
        pad.roll = Math.max(-1, Math.min(1, r.x + (b(GP.RB) ? 1 : 0) - (b(GP.LB) ? 1 : 0)));
        pad.thrust = trigger(GP.LT);
        pad.fire = trigger(GP.RT) || b(GP.A);
        const hb = b(GP.B);
        if (hb && !padHyperWas && screen === 'playing') hyperReq = true;
        padHyperWas = hb;
        const p = b(GP.MENU);
        if (pad.x || pad.y || pad.roll || pad.thrust || pad.fire || p) { usingPad = true; lastInputSource = 'gamepad'; }
        if (p && !padPauseWas && screen === 'playing') pause();
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
        const thrust = held.thrust || keys.has('thrust') || pad.thrust;
        const firing = held.fire || keys.has('fire') || pad.fire;
        stepSim(sim, { q: look.q, thrust, fire: firing, hyperspace: hyperReq }, dt);
        hyperReq = false;
        for (const ev of drainEvents(sim)) handleEvent(ev);
        if (tutorial.active) {
            // How far the player looked and thrusted; a new fire press confirms the radar step
            if (lastQ) applyTutorialRequests(tutorial.notify('looked', { delta: qAngle(lastQ, look.q) }));
            if (thrust && sim.ship.alive) applyTutorialRequests(tutorial.notify('thrusted', { dt }));
            if (firing && !tutorialFire) applyTutorialRequests(tutorial.notify('confirm'));
            sim.score = 0; // training scores nothing
        }
        tutorialFire = firing;
        lastQ = look.q.slice();
    }

    /** Scoring, levels and achievements (progress3d.js); during the training, its events instead. */
    function progressEvent(ev) {
        if (tutorial.active) { tutorialEvent(ev); return; }
        if (!progress) return;
        guard(() => {
            if (ev.type === 'collect') { progress.awardPoints(ev.points); progress.trackCrystalCollected(); }
            else if (ev.type === 'split' && ev.by === 'player') progress.trackRockDestroyed();
            else if (ev.type === 'ufoDestroyed' && ev.by === 'player') { progress.awardPoints(ev.points); progress.trackUfoDestroyed(); }
            else if (ev.type === 'weakPointDestroyed' || ev.type === 'bossDefeated') progress.awardPoints(ev.points, ev.credits);
            else if (ev.type === 'level') progress.setLevel(ev.level);
        });
    }

    /** What the training wants to know; a lost life costs nothing there. */
    function tutorialEvent(ev) {
        if (ev.type === 'collect') applyTutorialRequests(tutorial.notify('collectedGreen'));
        else if (ev.type === 'split' && ev.by === 'player') applyTutorialRequests(tutorial.notify('destroyedRed'));
        else if (ev.type === 'wasted' && ev.by !== 'ufo') applyTutorialRequests(tutorial.notify('shotGreen'));
        else if (ev.type === 'hit') {
            sim.lives += 1;
            applyTutorialRequests(tutorial.notify('died', { targetGone: !tutorialRock() }));
        }
    }

    const tutorialRock = () => (tutorialTarget === null ? null : sim.rocks.find((r) => r.id === tutorialTarget) || null);

    /** The training's requests: targets in front of (or behind) the nose, messages, the end. */
    function applyTutorialRequests(reqs) {
        for (const r of reqs || []) {
            if (r.type === 'spawn') {
                const old = tutorialRock();
                if (old) sim.rocks.splice(sim.rocks.indexOf(old), 1);
                const pos = wrapPos(vAdd(sim.ship.pos, vScale(forwardOf(look.q), r.ahead)), sim.size);
                const vel = r.drift ? vScale(randomUnit(sim.rand), r.drift) : [0, 0, 0];
                const rock = makeRock({ id: nextId(sim), kind: r.kind, size: r.size, pos, vel, rand: sim.rand });
                sim.rocks.push(rock);
                tutorialTarget = rock.id;
            } else if (r.type === 'message') say(r.text, 2500);
            else if (r.type === 'hint') say(r.text, 6000);
            else if (r.type === 'finish') {
                guard(() => recordTutorial3dDone({ persistence: pm, user: pm.getCurrentUser() }, !!r.skipped));
                startNewGame({ tutorial: false, progress });
                say('Level 1', 2000);
            }
        }
        highlightTutorial();
    }

    /** Pulse the controls the current training step talks about (DOM buttons; 'radar' on the HUD). */
    function highlightTutorial() {
        for (const id of ['p3-thrust', 'p3-fire', 'p3-stick-zone', 'p3-hyper']) $(id).classList.remove('p3-hl');
        const t = tutorial.active ? tutorial.text : null;
        for (const sel of (t && t.highlight) || []) {
            const el = sel.startsWith('#') ? $(sel.slice(1)) : null;
            if (el) el.classList.add('p3-hl');
        }
        root.classList.toggle('p3-tutorial', tutorial.active);
    }

    /** Ship-frame vector to a world position (sound panning and distance). */
    const localOf = (pos) => qRotate(qConj(look.q), nearestDelta(sim.ship.pos, pos, sim.size));

    /** Sound (audio3d.js and the onSound hook) and vibration / rumble (haptics3d.js) for one event. */
    function effect(name, { sound = null, local = null, size = null, haptic = null } = {}) {
        if (onSound && name) guard(() => onSound(name));
        if (audio && sound) guard(() => (sound === 'explosion' ? audio.explosion(size, local) : audio.play(sound, { local })));
        if (haptics && haptic) guard(() => haptics.event(haptic));
    }

    function handleEvent(ev) {
        progressEvent(ev);
        const pal = findPalette(settings.get('palette'));
        if (ev.type === 'fire') effect(null, { sound: 'shoot' });
        else if (ev.type === 'collect') {
            flashCollect = 1;
            if (renderer) renderer.burst(ev.pos, 'collect');
            effect('collect', { sound: 'collectGreen', local: localOf(ev.pos), haptic: 'collect' });
        } else if (ev.type === 'wasted') {
            hitMarker = 1;
            if (renderer) {
                renderer.burst(ev.pos, 'split');
                if (renderer.debris) renderer.debris(ev.pos, { size: 'crystal', color: pal.collectRadar });
            }
            effect('wasted', { sound: 'explosion', size: 'small', local: localOf(ev.pos) });
        } else if (ev.type === 'split') {
            if (!ev.byShip) hitMarker = 1;
            if (renderer) {
                renderer.burst(ev.pos, ev.byShip ? 'hit' : 'split');
                if (renderer.debris) renderer.debris(ev.pos, { size: ev.size, color: pal.hazardRadar });
            }
            effect('split', { sound: 'explosion', size: ev.size, local: localOf(ev.pos), haptic: ev.byShip ? null : 'rockDestroyed' });
        } else if (ev.type === 'hit' || ev.type === 'shieldHit') {
            if (ev.type === 'hit') flashHit = 1;
            else shieldHitAt = sim.time;
            if (ev.from) damage = { angle: damageAngle(qRotate(qConj(look.q), ev.from)), alpha: 1 };
            effect(ev.type, { sound: ev.type === 'hit' ? 'hit' : null, haptic: ev.type });
        } else if (ev.type === 'level') {
            // Level 1 is the start of the game, not a level-up
            const up = ev.level > 1;
            effect('level', { sound: up ? 'levelUp' : null, haptic: up ? 'levelUp' : null });
        } else if (ev.type === 'ufoShoot' || ev.type === 'bossShoot') {
            effect(ev.type, { sound: 'ufoShoot', local: ev.pos ? localOf(ev.pos) : null });
        } else if (ev.type === 'ufoSpawn' || ev.type === 'escort') effect('ufo');
        else if (ev.type === 'ufoDestroyed') {
            if (ev.by === 'player') hitMarker = 1;
            if (renderer) {
                renderer.burst(ev.pos, 'hit');
                if (renderer.debris) renderer.debris(ev.pos, { size: 'medium', color: UFO_COLOR });
            }
            effect('ufoDestroyed', { sound: 'ufoExplode', local: localOf(ev.pos), haptic: ev.by === 'player' ? 'rockDestroyed' : null });
        } else if (ev.type === 'bossHit') {
            hitMarker = 1;
            effect('bossHit');
        } else if (ev.type === 'weakPointDestroyed') {
            hitMarker = 1;
            if (renderer) {
                renderer.burst(ev.pos, 'hit');
                if (renderer.debris) renderer.debris(ev.pos, { size: 'large', color: BOSS_COLOR });
            }
            effect('weakPoint', { sound: 'explosion', size: 'large', local: localOf(ev.pos), haptic: 'bossWeakPoint' });
        } else if (ev.type === 'bossDefeated') {
            if (renderer) {
                renderer.burst(ev.pos, 'hit');
                if (renderer.debris) for (let i = 0; i < 3; i++) renderer.debris(ev.pos, { size: 'large', color: BOSS_COLOR });
            }
            effect('bossDefeated', { sound: 'bossExplode', local: localOf(ev.pos), haptic: 'bossDefeated' });
        } else if (ev.type === 'powerUp') {
            flashCollect = 1;
            effect('powerUp', { sound: ev.kind === 'extra_life' ? null : 'collectGreen', haptic: 'powerUp' });
        } else if (ev.type === 'hyperspace') {
            flashCollect = 1;
            hyperspaceAt = sim.time;
            effect('hyperspace', { haptic: 'hyperspace' });
        } else if (ev.type === 'extraLife') effect('extraLife', { sound: 'extraLife' });
        else if (ev.type === 'respawn') effect('respawn');
        else if (ev.type === 'gameover') { effect('gameover', { haptic: 'gameOver' }); gameOver(); }
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
        // The frame-rate check (perf3d.js) watches the first seconds of play and supplies the
        // 2 s average the render scale steps on; still too slow at the lowest scale: offer 2D.
        // Never with &lowres3d=1 (software rendering on CI is always slow).
        if (screen === 'playing' && !lowres) {
            const d = perf.frame(dtReal, { renderScale, minScale: MIN_RENDER_SCALE });
            if (d === 'offer-2d' && !perfPrompt && perf.final) {
                perfPrompt = true;
                pause();
                if (ui) {
                    ui.prompt({
                        title: 'Running slowly', text: 'Switch to 2D?',
                        buttons: [{ id: 'yes', label: 'Switch to 2D' }, { id: 'no', label: 'Stay in 3D' }], cancel: 'no',
                    }).then((id) => {
                        perfPrompt = false;
                        if (id === 'yes') switchTo2d();
                        else perf.decline();
                    });
                }
            }
        }
        if (screen === 'playing' && !lowres && now - scaleT >= 1000) {
            scaleT = now;
            const n = nextRenderScale(renderScale, perf.fps || fps, goodSeconds);
            goodSeconds = n.goodSeconds;
            if (n.scale !== renderScale) { renderScale = n.scale; resize(); }
        }
        // Graphics context that never came back (or keeps getting lost): back to 2D
        const fb = ctxLoss.tick(now / 1000);
        if (fb && fb.fallback) {
            say(fb.message, 1e9);
            fallbackAt = now + FALLBACK_MS;
            if (ui) ui.prompt({ title: 'Graphics', text: fb.message, buttons: [{ id: 'ok', label: 'OK' }] });
        }
        if (fallbackAt && now >= fallbackAt) {
            fallbackAt = 0;
            switchTo2d();
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

        if (screen === 'playing' && tutorial.active) {
            const rock = tutorialRock();
            const dist = rock ? vLen(nearestDelta(sim.ship.pos, rock.pos, sim.size)) : undefined;
            applyTutorialRequests(tutorial.update(dtReal, { control: look.mode, input: inputKind(), targetDistance: dist }));
            if (tutorial.active && rock && tutorial.stepId === 'radar') {
                const b = radar.front.find((x) => x.id === rock.id);
                if (b && Math.hypot(b.x, b.y) < 0.12) applyTutorialRequests(tutorial.notify('radarSeen'));
            }
            if (tutorial.active && tutorialTarget !== null && !rock && ['collect', 'shoot', 'radar'].includes(tutorial.stepId)) {
                tutorialTarget = null;
                applyTutorialRequests(tutorial.notify('targetLost'));
            }
        }
        if (screen === 'playing') {
            acc += dtReal;
            let n = 0;
            // A tiny tolerance: a 60 Hz frame (16.67 ms) always runs exactly one step, whatever
            // the rounding of the frame clock
            while (acc >= SIM.dt - 1e-9 && n < MAX_STEPS) { stepOnce(SIM.dt, device); acc -= SIM.dt; n++; }
            if (n === MAX_STEPS) acc = 0;
            steps += n;
        }
        wakeLock.sync(screen === 'playing');
        if (message && now > messageUntil) message = '';
        // Fast artificial turns (stick, mouse, Rate): the vignette, when on
        const turn = look.mode === 'direct' ? 0 : Math.hypot(look.rates.pitch, look.rates.yaw);
        const want = screen === 'playing' && settings.get('vignette3d') ? vignetteAlpha(turn) : 0;
        vignette += (want - vignette) * Math.min(1, dtReal * 6);
        // Achievement toasts during play (the game-over screen lists them again)
        const unlocked = progress && progress.achievements ? progress.achievements.recentlyUnlocked || [] : [];
        if (unlocked.length > toastSeen) {
            const a = unlocked[toastSeen++];
            toast = { text: `Achievement: ${a.name}`, t: 3 };
        }
        if (toast) { toast.t -= dtReal; if (toast.t <= 0) toast = null; }
        flashHit = Math.max(0, flashHit - dtReal * 2);
        flashCollect = Math.max(0, flashCollect - dtReal * 3);
        damage.alpha = Math.max(0, damage.alpha - dtReal * 1.2);
        hitMarker = Math.max(0, hitMarker - dtReal * 4);
        const hs = hyperspaceState(sim);
        const hyperBtn = $('p3-hyper');
        hyperBtn.classList.toggle('p3-cool', !hs.ready);
        const hyperText = hs.ready ? 'HYPER' : String(Math.ceil(hs.cooldown));
        if (hyperBtn.textContent !== hyperText) hyperBtn.textContent = hyperText;
        if (audio) {
            guard(() => audio.thrust(screen === 'playing' && sim.ship.alive && (held.thrust || keys.has('thrust') || pad.thrust)));
            guard(() => audio.update({ screen, lives: sim.lives, bossActive: !!sim.boss, tutorialActive: tutorial.active }));
            const nu = screen === 'playing' ? sim.ufoSys.nearest(sim.ship.pos) : null;
            if (audio.ufoHum) guard(() => audio.ufoHum(nu ? qRotate(qConj(look.q), nu.delta) : null));
        }

        updateRadar(now);
        if (renderer) {
            renderer.render(renderView(dtReal));
            if (screen === 'playing') peakDrawCalls = Math.max(peakDrawCalls, renderer.drawCalls || 0);
        }
        drawOverlay();
    }

    // Reused every frame (review #13: no per-frame allocation in the hot paths)
    const markerColor = { crystal: '', saucer: UFO_COLOR, boss: BOSS_COLOR };
    const radarOpts = {};
    const radarShip = { pos: null, q: null, vel: null };
    const radarColors = { collect: '', hazard: '', ufo: UFO_COLOR, boss: BOSS_COLOR, powerup: POWERUP_COLOR };
    const view = {};
    const hostile = [];
    const radarObjects = [];
    /** UFO and boss shots in one list (the same array every frame). */
    function hostileShots() {
        hostile.length = 0;
        for (const b of sim.ufoSys.bullets) hostile.push(b);
        if (sim.boss) for (const b of sim.boss.state.bullets) hostile.push(b);
        return hostile;
    }

    /** What the renderer draws this frame (render3d.js render(view)); the same object every frame. */
    function renderView(dt) {
        view.shipPos = sim.ship.pos; view.q = look.q; view.rocks = sim.rocks; view.bullets = sim.bullets; view.dt = dt; view.time = sim.time;
        view.ufos = sim.ufos;
        view.hostileBullets = hostileShots();
        view.boss = sim.boss ? sim.boss.state : null;
        view.powerUps = sim.power.pickups;
        // The firing weak point's muzzle flash (boss3d.js sets and fades them)
        view.turretFlash = sim.boss ? sim.boss.state.turretFlash || 0 : 0;
        view.turretDir = sim.boss ? sim.boss.state.turretDir || null : null;
        view.shield = Math.max(sim.power.effects.shield, sim.ship.shield);
        view.shieldHit = Math.max(0, 1 - (sim.time - shieldHitAt) * 2);
        view.magnet = sim.power.effects.magnet;
        view.magnetRange = POWERUP3D.magnetRadius2d * powerUpScale(sim.world.fogFar);
        view.hyperspace = hyperspaceAt === null || reducedMotion ? null : sim.time - hyperspaceAt;
        view.reducedMotion = reducedMotion; // the system setting (orient3d.js): calmer shield and boss
        return view;
    }

    /**
     * Radar circles and edge markers (the nearest crystal; every remaining rock once a level is
     * down to its last few), the crosshair target; a short buzz and the threat sound when a new
     * red rock threatens.
     */
    function updateRadar(now) {
        const fov = settings.get('fov3d');
        const o = radarOpts;
        o.size = sim.size; o.range = sim.world.fogFar; o.aspect = cssW / cssH; o.fov = fov;
        const ship = radarShip;
        ship.pos = sim.ship.pos; ship.q = look.q; ship.vel = sim.ship.vel;
        // No rock left but a UFO or the boss keeps the level going: they show at any distance,
        // with edge arrows, like the last few rocks (review #1)
        // sim3d.showAllTargets: the last few rocks, or none left while UFOs or the boss block the end
        few = showAllTargets(sim);
        const blocked = few && rocksLeft(sim) === 0;
        const boss = bossBody(sim);
        // Rocks, UFOs, the boss and power-ups (those only within the view distance, also while
        // everything else shows at any distance), in one list reused every frame
        radarObjects.length = 0;
        for (const r of sim.rocks) radarObjects.push(r);
        for (const u of sim.ufos) radarObjects.push(u);
        for (const p of sim.power.pickups) if (vLen(nearestDelta(sim.ship.pos, p.pos, sim.size)) <= o.range) radarObjects.push(p);
        if (boss) radarObjects.push(boss);
        o.all = few;
        o.clusters = sim.levels;
        o.shots = hostileShots();
        radar = buildRadar(ship, radarObjects, o);
        // Crystal arrow by the adaptive level (assist3d.js): always / none on screen / last few only
        const arrow = crystalArrowOptions(sim.assist, few);
        edge = arrow ? edgeMarker(ship, sim.rocks, { ...o, always: arrow.always }) : null;
        markers = few ? remainingMarkers(ship, sim.rocks, o) : [];
        // UFOs within the view distance off screen (anywhere once they are all that is left);
        // the boss wherever it is (always findable)
        for (const m of remainingMarkers(ship, sim.ufos, o)) if (blocked || m.dist <= o.range) markers.push(m);
        if (boss) markers.push(...remainingMarkers(ship, [boss], o));
        // Target brackets (always) and the lead marker (Assisting and Balanced)
        target = sim.ship.alive ? crosshairTarget(ship, aimTargets(sim), { size: sim.size, range: sim.world.fogFar }) : null;
        targetScreen = target ? projectLocal(target.local, cssW, cssH, fov) : null;
        const lead = target && sim.assist.lead ? leadPoint(target, SIM.bulletSpeed) : null;
        leadScreen = lead ? projectLocal(lead, cssW, cssH, fov) : null;
        const ids = new Set();
        for (const b of [...radar.front, ...radar.rear]) if (b.threat) ids.add(b.id);
        if (screen === 'playing' && [...ids].some((id) => !threatIds.has(id)) && now - threatBuzzAt > 1000) {
            threatBuzzAt = now;
            // The radar flash is always on; the tone and vibration follow the adaptive level
            effect('threat', { sound: sim.assist.threatTone ? 'threat' : null, haptic: sim.assist.threatVibrate ? 'threat' : null });
        }
        threatIds = ids;
    }

    function drawOverlay() {
        hctx.clearRect(0, 0, cssW, cssH);
        drawVignette(hctx, cssW, cssH, vignette);
        const fk = reducedMotion ? 0.35 : 1; // reduce motion: gentler full-screen flashes
        drawFlash(hctx, cssW, cssH, flashHit * fk, flashCollect * fk);
        if (sim.ship.alive) drawCrosshair(hctx, cssW, cssH, sim.ship.invulnerable > 0 ? 'rgba(255,140,140,0.9)' : undefined);
        drawDamage(hctx, cssW, cssH, damage.angle, damage.alpha);
        if (screen === 'playing') {
            drawTargetBrackets(hctx, targetScreen, target ? target.radius : 0);
            drawLeadMarker(hctx, leadScreen);
            drawHitMarker(hctx, cssW, cssH, hitMarker);
        }
        const adj = adaptiveInfo(sim);
        const below = drawHudText(hctx, cssW, cssH, {
            score: sim.score, lives: sim.lives, mode: look.mode, chosenMode: chosenMode(), levelHorizon: look.level,
            level: sim.levels ? sim.level : 0, rocksLeft: sim.levels ? rocksLeft(sim) : undefined,
            view: VIEW_DISTANCES[viewName()].label, fps, renderScale, speed: vLen(sim.ship.vel), message: screen === 'playing' ? message : '',
            adjustment: adj.text, adjustmentColor: adj.color,
            debug: !!settings.get('debug3d'),
            hint: desktopHint(),
        }, { top: 0, left: 0, right: 0 });
        drawPowerUpChips(hctx, activeEffects(sim), 12, (below || 50) + 6);
        if (sim.boss) drawBossBar(hctx, cssW, cssH, { health: sim.boss.health, maxHealth: sim.boss.maxHealth, phase: sim.boss.phase });
        const pal = findPalette(settings.get('palette'));
        markerColor.crystal = pal.collectRadar;
        if (screen === 'playing') {
            drawEdgeMarker(hctx, cssW, cssH, edge, pal.collectRadar);
            for (const m of markers) drawEdgeMarker(hctx, cssW, cssH, m, markerColor[m.type] || pal.hazardRadar);
            if (!sim.ship.alive && !sim.over) drawBanner(hctx, cssW, cssH, { text: 'SHIP LOST', sub: `${sim.lives} ${sim.lives === 1 ? 'life' : 'lives'} left`, t: 1 });
            else if (sim.banner) drawBanner(hctx, cssW, cssH, sim.banner);
            else if (sim.boss && sim.boss.warning) drawBanner(hctx, cssW, cssH, { text: 'BOSS', sub: 'Shoot the glowing weak points', t: 1 });
        }
        radarColors.collect = pal.collectRadar;
        radarColors.hazard = pal.hazardRadar;
        drawRadar(hctx, layoutR, radar, radarColors, clock / 1000);
        if (screen === 'playing' && tutorial.active) {
            const tt = tutorial.text;
            drawTutorialBox(hctx, cssW, cssH, { title: tt.title, body: tt.body, progress: tutorial.progress });
            if (tt.highlight.includes('radar')) drawRadarPulse(hctx, layoutR, clock / 1000);
        }
        if (toast) drawToast(hctx, cssW, cssH, toast);
        drawJoystick(hctx, stick);
    }

    /** Desktop: how to steer while the mouse is not captured yet. */
    function desktopHint() {
        if (screen !== 'playing' || doc.pointerLockElement === root) return '';
        if (lastInputSource !== 'mouse' && lastInputSource !== 'keyboard') return '';
        return 'Click the view to steer with the mouse (Esc releases it)';
    }

    // --- read-only test hook
    const r4 = (v) => Math.round(v * 1e4) / 1e4;
    const blipOut = (b) => ({
        id: b.id, type: b.type, x: r4(b.x), y: r4(b.y), dist: Math.round(b.dist), near: r4(b.near), threat: b.threat, beyond: b.beyond,
    });
    function snapshot() {
        const a = lookAngles(look);
        return {
            loaded: !!renderer,
            error,
            screen,
            mode: effectiveMode(clock || undefined),
            lookMode: look.mode, // the mode the last frame actually applied
            chosenMode: chosenMode(),
            menuOpen: !!(ui && ui.visible),
            ui: ui ? ui.snapshot() : null,
            updateSafe: !ui || ui.current === 'menu' || ui.current === 'gameOver' || ui.current === 'profile',
            user: guard(() => pm.getCurrentUser()) || null,
            tutorial: { active: tutorial.active, step: tutorial.stepId, finished: tutorial.finished, skipped: tutorial.skipped },
            toast: toast ? toast.text : null,
            vignette: r4(vignette),
            leftHanded: root.classList.contains('p3-left'),
            fov: settings.get('fov3d'),
            invert: !!look.invert,
            turnRateMult: look.turnRateMult || 1,
            credits: progress ? progress.creditsEarned : 0,
            reducedMotion,
            orientationLocked: orientLock.locked,
            palette3d: renderer && renderer.palette ? renderer.palette : null,
            hint: desktopHint(),
            rotateHint: $('p3-portrait-banner').classList.contains('p3-hidden') ? null : $('p3-portrait-banner').textContent,
            frames,
            steps,
            time: r4(sim.time),
            lowres,
            levelHorizon: look.level,
            sensitivity: look.sensitivity,
            viewDistance: viewName(),
            world: { ...sim.world, ...(renderer && renderer.world ? { rendered: renderer.world } : {}) },
            drawnRocks: renderer && renderer.drawnRocks !== undefined ? renderer.drawnRocks : null,
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
            level: sim.level,
            levels: sim.levels,
            rocksLeft: rocksLeft(sim),
            incoming: simCounts(sim).incoming,
            incomingLeft: sim.incoming ? sim.incoming.left : 0,
            banner: sim.banner ? sim.banner.text : null,
            shipAlive: sim.ship.alive,
            invulnerable: r4(sim.ship.invulnerable),
            combo: { count: sim.combo.count, multiplier: sim.combo.multiplier },
            damage: { angle: r4(damage.angle), alpha: r4(damage.alpha) },
            difficulty: sim.difficulty,
            adjustment: (() => { const a = adaptiveInfo(sim); return { ...a, performance: r4(a.performance) }; })(),
            assist: { ...sim.assist },
            target: target ? {
                id: target.id, dist: Math.round(target.dist), angle: r4(target.angle), onScreen: !!targetScreen, lead: !!leadScreen,
            } : null,
            hitMarker: r4(hitMarker),
            ufos: sim.ufos.map((u) => ({
                id: u.id, pos: u.pos.map(r4), dist: Math.round(vLen(nearestDelta(sim.ship.pos, u.pos, sim.size))), escort: !!u.escort,
            })),
            ufoBullets: sim.ufoSys.bullets.length,
            boss: sim.boss ? {
                ...sim.boss.snapshot(), pos: sim.boss.state.pos.map(r4), dist: Math.round(vLen(nearestDelta(sim.ship.pos, sim.boss.state.pos, sim.size))),
                warning: sim.boss.warning,
            } : null,
            powerUps: sim.power.pickups.map((p) => ({
                id: p.id, type: p.type, life: r4(p.life), dist: Math.round(vLen(nearestDelta(sim.ship.pos, p.pos, sim.size))),
            })),
            effects: Object.fromEntries(activeEffects(sim).map((e) => [e.kind, r4(e.left)])),
            hyperspace: { ...hyperspaceState(sim), cooldown: r4(hyperspaceState(sim).cooldown) },
            particles: renderer && renderer.particles !== undefined ? renderer.particles : null,
            perf: { ...perf.snapshot(), prompt: perfPrompt },
            contextLoss: ctxLoss.snapshot(),
            audio: audio && audio.snapshot ? audio.snapshot() : null,
            haptics: haptics && haptics.stats ? { ...haptics.stats } : null,
            lastFew: few,
            markers: markers.map((m) => ({ id: m.id, type: m.type, angle: r4(m.angle), dist: Math.round(m.dist) })),
            counts: simCounts(sim),
            stats: { ...sim.stats },
            fps: Math.round(fps * 10) / 10,
            renderScale,
            pixelRatio,
            drawCalls: renderer ? renderer.drawCalls : 0,
            peakDrawCalls,
            three: renderer ? renderer.three : null,
            seed,
            message,
            radar: {
                front: radar.front.map(blipOut),
                rear: radar.rear.map(blipOut),
                edge: edge ? { id: edge.id, angle: r4(edge.angle), dist: Math.round(edge.dist) } : null,
                layout: layoutR,
            },
            stick: { active: stick.active, x: r4(stick.x), y: r4(stick.y) },
        };
    }
    const hook = win.__spaceAdventure || (win.__spaceAdventure = {});
    Object.defineProperty(hook, 'game3d', { get: snapshot, configurable: true });
    /** Last frame's visibility of each rock (distance, drawn, fog 0..1); no pixel reads. */
    hook.rocks3d = () => sim.rocks.map((r) => {
        const v = renderer && renderer.rockVisibility ? renderer.rockVisibility(r.id) : null;
        return { id: r.id, kind: r.kind, size: r.size, ...(v || {}) };
    });
    hook.probe3d = () => (renderer
        ? renderer.probeLitPixels(renderView(0))
        : null);

    /** Renderer settings: field of view and the (colour-safe) palette. */
    function applyLook() {
        if (renderer && renderer.setFov) renderer.setFov(settings.get('fov3d'));
        if (renderer && renderer.setPalette) renderer.setPalette(settings.get('palette'));
    }

    // --- menus (ui3d.js; docs/plans/07-ui3d-wiring.md)
    function switchTo2d() {
        orientLock.unlock();
        writeLastMode(pageStorage(), null);
        win.location.replace(URL_2D);
    }

    /** A Settings row changed a value (already saved): apply it now. */
    function onSettingChange(key, value) {
        if (key === 'control3d') chooseMode(value);
        else if (key === 'levelHorizon3d') { setLevelHorizon(look, !!value, motionReady() ? source.quat() : null); refreshUi(); }
        else if (key === 'sensitivity3d') look.sensitivity = value;
        else if (key === 'invert3d') look.invert = !!value;
        else if (key === 'fov3d') { if (renderer && renderer.setFov) renderer.setFov(value); }
        else if (key === 'leftHanded3d') refreshUi();
        else if (key === 'palette') { if (renderer && renderer.setPalette) renderer.setPalette(value); }
        else if (key === 'viewDistance3d') chooseView(value); // the next game's world
        // difficulty: the next game; vignette3d, palette: read every frame; sound, music,
        // vibration and rumble: audio3d.js and haptics3d.js follow the settings themselves
    }

    ui = createUi3d({
        doc, root, settings, persistence: pm, version: BUILD_VERSION || '',
        inputKind, isTouch: () => inputKind() === 'touch',
        onPlay: ({ tutorial: training, progress: p }) => startNewGame({ tutorial: training, progress: p }),
        onResume: () => { if (screen === 'paused') begin(); },
        onRestart: () => startNewGame({ tutorial: false, progress }),
        onQuit: () => {
            orientLock.unlock();
            if (progress) guard(() => progress.save());
            tutorial.reset();
            screen = 'menu';
            newSim();
            refreshUi();
        },
        onSwitch2d: switchTo2d,
        onSettingChange,
    });
    applyLook();
    ui.show('menu'); // or the name screen first, without a profile
    if (!renderer) {
        // No WebGL 2 (or it failed): say so, then the 2D game
        ui.prompt({
            title: '3D is not available',
            text: '3D could not start on this device (WebGL 2 is not available). The 2D game opens instead.',
            buttons: [{ id: 'ok', label: 'Open 2D' }],
        }).then(switchTo2d);
    }

    refreshUi();
    win.requestAnimationFrame(frame);
    return { snapshot, ui };
}
