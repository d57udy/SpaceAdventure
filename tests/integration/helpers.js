// Shared helpers for the Space Adventure browser tests.
// All game state is read through the read-only hook window.__spaceAdventure;
// tests never write game state, they drive the game through real input.
import { expect } from '@playwright/test';

// Main menu rows
export const MENU = {
  START: 0, MULTIPLAYER: 1, UPGRADES: 2, HIGH_SCORES: 3, ACHIEVEMENTS: 4, HELP: 5, SETTINGS: 6,
  RESET: 7, CHANGE_USER: 8, DIFFICULTY: 9,
};

export const MENU_LABELS = [
  'Start', 'Multiplayer', 'Upgrades', 'High Scores', 'Achievements', 'Help', 'Settings', 'Reset Data',
  'Change User', 'Difficulty',
];

/** Drawn text of the single difficulty row, e.g. 'Difficulty: Medium'. */
export const difficultyText = (name) => `Difficulty: ${name}`;

// Settings screen rows (Controls only on touch devices; Vibration only on touch devices
// whose browser has navigator.vibrate, see touchSettingsRows; Controller rumble only once a
// controller has been seen)
const TUTORIAL_ROWS = ['offerTutorial', 'replayTutorial'];
export const SETTINGS_ROWS_TOUCH = ['controls', 'colours', 'sound', 'music', 'musicVolume', 'sfxVolume', ...TUTORIAL_ROWS, 'back'];
export const SETTINGS_ROWS_DESKTOP = ['colours', 'sound', 'music', 'musicVolume', 'sfxVolume', ...TUTORIAL_ROWS, 'back'];
export const touchSettingsRows = (withVibration) => (withVibration
  ? ['controls', 'colours', 'sound', 'music', 'musicVolume', 'sfxVolume', 'vibration', ...TUTORIAL_ROWS, 'back']
  : SETTINGS_ROWS_TOUCH);

/**
 * Expected Settings rows plus 'Full screen' (before Back) when this browser has the
 * Fullscreen API (Item 3: the row is hidden on iPhone and in an installed app).
 */
export async function withFullscreenRow(page, rows) {
  const supported = await page.evaluate(() => !!(document.fullscreenEnabled || document.webkitFullscreenEnabled));
  const i = rows.indexOf('back');
  return supported ? [...rows.slice(0, i), 'fullscreen', ...rows.slice(i)] : rows;
}

export const CONTROL_MODE_KEY = 'spaceAdventure_controlMode';
export const PALETTE_KEY = 'spaceAdventure_palette';
export const MUTED_KEY = 'spaceAdventure_muted';
export const HAPTICS_KEY = 'spaceAdventure_haptics';
export const MUSIC_TUNE_KEY = 'spaceAdventure_musicTune';
export const MUSIC_VOLUME_KEY = 'spaceAdventure_musicVolume';
export const SFX_VOLUME_KEY = 'spaceAdventure_sfxVolume';
export const OFFER_TUTORIAL_KEY = 'spaceAdventure_offerTutorial';
export const RUMBLE_KEY = 'spaceAdventure_rumble';
export const TUNE_LABELS = { off: 'Off', synthwave: 'Synthwave', ambient: 'Ambient', chiptune: 'Chiptune' };
export const CONTROL_LABELS = { joystick: 'Drag to Steer', buttons: 'Buttons' };
export const PALETTE_LABELS = { standard: 'Standard', safe: 'Colour-safe' };

/** Snapshot of the whole hook (plain object). */
export function snap(page) {
  return page.evaluate(() => {
    const g = window.__spaceAdventure;
    return {
      state: g.state, user: g.user, score: g.score, lives: g.lives, level: g.level,
      menuIndex: g.menuIndex, menuOptions: g.menuOptions, difficulty: g.difficulty,
      pauseIndex: g.pauseIndex, upgradeIndex: g.upgradeIndex, isMuted: g.isMuted,
      isTouchDevice: g.isTouchDevice, world: g.world, view: g.view, ship: g.ship, counts: g.counts,
      tapRegions: g.tapRegions, controlMode: g.controlMode, joystick: g.joystick,
      settings: g.settings, settingsIndex: g.settingsIndex, settingsRows: g.settingsRows, palette: g.palette,
      tutorial: g.tutorial, gamepad: g.gamepad, lastInputSource: g.lastInputSource,
    };
  });
}

/** Read one hook property (supports dotted paths like 'ship.rotation'). */
export function hook(page, path) {
  return page.evaluate((p) => p.split('.').reduce((o, k) => (o == null ? o : o[k]), window.__spaceAdventure), path);
}

export function isPressed(page, action) {
  return page.evaluate((a) => window.__spaceAdventure.isPressed(a), action);
}

/** Wait for n animation frames of the game loop. */
export function frames(page, n = 2) {
  return page.evaluate((count) => new Promise((resolve) => {
    let left = count;
    const tick = () => (--left <= 0 ? resolve(true) : requestAnimationFrame(tick));
    requestAnimationFrame(tick);
  }), n);
}

/**
 * Wait for a game state, then let two more frames run. The game clears queued one-shot
 * input on the first frame *after* a state change (handleInput: lastInputState), so input
 * sent in that window is dropped; settling avoids racing it.
 */
export async function waitForState(page, state, timeout = 5000) {
  await expect.poll(() => hook(page, 'state'), { timeout, message: `waiting for state '${state}'` }).toBe(state);
  await frames(page, 2);
}

/**
 * Open the game with empty localStorage and collect page errors.
 * Options:
 *   controlMode: 'joystick' | 'buttons' -> pre-seed the saved touch control scheme (as if the
 *                player had picked it in Settings earlier); omitted = no saved choice.
 *   storage:     { key: value } more localStorage entries to seed (e.g. PALETTE_KEY: 'safe').
 *   recordText:  true -> record the strings drawn with fillText on the canvas (see drawnTexts).
 *   vibrate:     true -> install a recording navigator.vibrate stub before load (also on
 *                WebKit, which lacks the API); calls land in window.__vibrations (see vibrations).
 *   tutorial:    false (default) -> seed the real device setting "Offer tutorial: Off", so
 *                pressing Start goes straight to Level 1 as before the tutorial existed;
 *                true -> leave it at its default (On): a new player's first Start asks.
 *   gamepads:    [{ id, mapping }] -> install fake controllers (see installGamepads).
 *   url:         page to open, relative to the project's baseURL (default '/'; the PWA
 *                tests use './?sw=1', which also works under the /SpaceAdventure/ sub-path).
 * Returns the array that page errors are pushed into.
 */
export async function openFresh(page, {
  controlMode = null, storage = {}, recordText = false, vibrate = false, tutorial = false, gamepads = null,
  url = '/',
} = {}) {
  const errors = [];
  page.on('pageerror', (err) => errors.push(err.message));
  const seed = { ...(tutorial ? {} : { [OFFER_TUTORIAL_KEY]: 'false' }), ...storage };
  if (controlMode) seed[CONTROL_MODE_KEY] = controlMode;
  // Clear storage once per test (not on reloads the test itself performs)
  await page.addInitScript((entries) => {
    try {
      if (!sessionStorage.getItem('__sa_cleared')) {
        localStorage.clear();
        for (const [k, v] of Object.entries(entries)) localStorage.setItem(k, v);
        sessionStorage.setItem('__sa_cleared', '1');
      }
    } catch (e) { /* storage unavailable */ }
  }, seed);
  if (recordText) {
    // Observe (not alter) canvas text drawing so labels like "Controls: Buttons" can be checked
    await page.addInitScript(() => {
      window.__drawnTexts = new Set();
      const orig = CanvasRenderingContext2D.prototype.fillText;
      CanvasRenderingContext2D.prototype.fillText = function (text, ...rest) {
        window.__drawnTexts.add(String(text));
        return orig.call(this, text, ...rest);
      };
    });
  }
  if (vibrate) {
    // Stub a browser API (never game state): record every pattern the game asks for
    await page.addInitScript(() => {
      window.__vibrations = [];
      Object.defineProperty(navigator, 'vibrate', {
        configurable: true,
        value: (pattern) => { window.__vibrations.push(pattern); return true; },
      });
    });
  }
  if (gamepads) await installGamepads(page, gamepads);
  await page.goto(url);
  await page.waitForFunction(() => window.__spaceAdventure && typeof window.__spaceAdventure.state === 'string', null, { timeout: 10000 });
  return errors;
}

/**
 * Fake game controllers (a browser API stub, never game state): navigator.getGamepads()
 * returns window.__pads, standard-mapping pads whose buttons/axes the test changes with
 * padPress/padRelease/padStick/padDisconnect. Rumble requests land in window.__rumbles.
 * Like real browsers, a pad is only listed after its first button press (padPress).
 */
export async function installGamepads(page, pads = [{}]) {
  await page.addInitScript((defs) => {
    window.__rumbles = [];
    window.__padDefs = defs.map((d, i) => ({
      id: d.id || 'Xbox Wireless Controller (STANDARD GAMEPAD Vendor: 045e Product: 0b13)',
      mapping: d.mapping === undefined ? 'standard' : d.mapping,
      index: i,
    }));
    window.__pads = defs.map(() => null);
    window.__makePad = (i) => {
      const def = window.__padDefs[i];
      return {
        id: def.id, index: i, mapping: def.mapping, connected: true, timestamp: performance.now(),
        buttons: Array.from({ length: 17 }, () => ({ pressed: false, touched: false, value: 0 })),
        axes: [0, 0, 0, 0],
        vibrationActuator: {
          type: 'dual-rumble',
          playEffect(type, params) { window.__rumbles.push({ pad: i, type, ...params }); return Promise.resolve('complete'); },
        },
      };
    };
    Object.defineProperty(navigator, 'getGamepads', {
      configurable: true,
      value: () => window.__pads.slice(),
    });
  }, pads);
}

/** Press (and hold) a controller button (standard index; value for triggers). */
export function padPress(page, button, { pad = 0, value = 1 } = {}) {
  return page.evaluate(([b, i, v]) => {
    if (!window.__pads[i]) window.__pads[i] = window.__makePad(i);
    window.__pads[i].buttons[b] = { pressed: v > 0.5, touched: true, value: v };
    window.__pads[i].timestamp = performance.now();
  }, [button, pad, value]);
}

export function padRelease(page, button, { pad = 0 } = {}) {
  return page.evaluate(([b, i]) => {
    if (!window.__pads[i]) return;
    window.__pads[i].buttons[b] = { pressed: false, touched: false, value: 0 };
    window.__pads[i].timestamp = performance.now();
  }, [button, pad]);
}

/** Press a button for a few game frames, then release it. */
export async function padTap(page, button, opts = {}) {
  await padPress(page, button, opts);
  await frames(page, 3);
  await padRelease(page, button, opts);
  await frames(page, 2);
}

export function padStick(page, x, y, { pad = 0 } = {}) {
  return page.evaluate(([ax, ay, i]) => {
    if (!window.__pads[i]) window.__pads[i] = window.__makePad(i);
    window.__pads[i].axes[0] = ax;
    window.__pads[i].axes[1] = ay;
  }, [x, y, pad]);
}

export function padDisconnect(page, { pad = 0 } = {}) {
  return page.evaluate((i) => { window.__pads[i] = null; }, pad);
}

export function rumbles(page) {
  return page.evaluate(() => window.__rumbles.slice());
}

/** Standard-mapping button indices (by position). */
export const PAD = {
  A: 0, B: 1, X: 2, Y: 3, LB: 4, RB: 5, LT: 6, RT: 7, VIEW: 8, MENU: 9,
  UP: 12, DOWN: 13, LEFT: 14, RIGHT: 15,
};

/** Patterns recorded by the openFresh({ vibrate: true }) stub. */
export function vibrations(page) {
  return page.evaluate(() => window.__vibrations.slice());
}

/** Does this browser (or the stub) provide navigator.vibrate? */
export function hasVibrate(page) {
  return page.evaluate(() => typeof navigator.vibrate === 'function');
}

/** Strings drawn on the canvas during the next few frames (needs openFresh recordText). */
export function drawnTexts(page, n = 3) {
  return page.evaluate((count) => new Promise((resolve) => {
    window.__drawnTexts.clear();
    let left = count;
    const tick = () => (--left <= 0 ? resolve([...window.__drawnTexts]) : requestAnimationFrame(tick));
    requestAnimationFrame(tick);
  }), n);
}

/** Username flow via the (autofocused) DOM input and Enter. */
export async function loginWithKeyboard(page, name = 'TESTER') {
  await waitForState(page, 'prompt_user');
  const input = page.locator('#username-input');
  await expect(input).toBeVisible();
  await input.focus();
  await page.keyboard.type(name, { delay: 20 });
  await page.keyboard.press('Enter');
  await waitForState(page, 'menu');
  await expect.poll(() => hook(page, 'tapRegions.length')).toBeGreaterThan(0);
}

/**
 * Logical canvas coordinates (game pixels, as in tapRegions) -> page (CSS) coordinates.
 * Uses the hook's logical view size, not canvas.width: the backing store is larger than
 * the logical size on HiDPI screens (e.g. 2x on an iPad).
 */
export async function canvasToPage(page, x, y) {
  return page.evaluate(([cx, cy]) => {
    const c = document.getElementById('gameCanvas');
    const r = c.getBoundingClientRect();
    const v = window.__spaceAdventure.view;
    return { x: r.left + cx * (r.width / v.width), y: r.top + cy * (r.height / v.height) };
  }, [x, y]);
}

/** Page coordinates of the centre of tapRegions[index] (current screen). */
export async function tapRegionCenter(page, index) {
  await expect.poll(() => hook(page, 'tapRegions.length')).toBeGreaterThan(index);
  const r = (await hook(page, 'tapRegions'))[index];
  return canvasToPage(page, r.x + r.w / 2, r.y + r.h / 2);
}

/** Page coordinates of the menu item with the given label (menu screen only). */
export async function menuItemCenter(page, label) {
  const options = await hook(page, 'menuOptions');
  const index = options.indexOf(label);
  expect(index, `menu option '${label}' in ${JSON.stringify(options)}`).toBeGreaterThanOrEqual(0);
  return tapRegionCenter(page, index);
}

/** Element centre in client coordinates. */
export async function centerOf(page, selector) {
  const box = await page.locator(selector).boundingBox();
  expect(box, `bounding box for ${selector}`).not.toBeNull();
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

export function rectsOverlap(a, b) {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
}

/**
 * Press-and-hold fingers on the on-screen buttons.
 * Chromium: real touches via CDP Input.dispatchTouchEvent (the browser generates the
 * pointer events, including implicit pointer capture).
 * WebKit: Playwright cannot hold a touch, so synthetic PointerEvents with
 * pointerType 'touch' are dispatched at the element under the finger.
 */
export class Fingers {
  constructor(page, browserName) {
    this.page = page;
    this.useCdp = browserName === 'chromium';
    this.points = new Map(); // id -> {x, y}
    this.cdp = null;
  }

  // One event per changed finger, identified by id (same approach as Puppeteer's TouchHandle)
  async _cdpSend(type, id, p) {
    if (!this.cdp) this.cdp = await this.page.context().newCDPSession(this.page);
    await this.cdp.send('Input.dispatchTouchEvent', {
      type, touchPoints: [{ x: p.x, y: p.y, id, radiusX: 5, radiusY: 5, force: type === 'touchEnd' ? 0 : 1 }],
    });
  }

  async _synthetic(type, id, x, y) {
    await this.page.evaluate(([t, pid, cx, cy]) => {
      const target = document.elementFromPoint(cx, cy) || document.body;
      target.dispatchEvent(new PointerEvent(t, {
        pointerId: pid, pointerType: 'touch', isPrimary: pid === 1,
        bubbles: true, cancelable: true, composed: true,
        clientX: cx, clientY: cy, button: t === 'pointermove' ? -1 : 0,
        buttons: t === 'pointerup' ? 0 : 1, width: 10, height: 10, pressure: t === 'pointerup' ? 0 : 0.5,
      }));
    }, [type, id, x, y]);
  }

  async down(id, selector) {
    await this.downAt(id, await centerOf(this.page, selector));
  }

  /** Put a finger down at a page point {x, y}. */
  async downAt(id, p) {
    this.points.set(id, { x: p.x, y: p.y });
    if (this.useCdp) await this._cdpSend('touchStart', id, p);
    else await this._synthetic('pointerdown', id, p.x, p.y);
  }

  async moveTo(id, selector) {
    await this.moveToPoint(id, await centerOf(this.page, selector));
  }

  /** Slide a held finger to a page point in a few steps. */
  async moveToPoint(id, p, steps = 4) {
    const start = this.points.get(id);
    // A few intermediate steps, like a real finger slide
    for (let i = 1; i <= steps; i++) {
      const q = { x: start.x + ((p.x - start.x) * i) / steps, y: start.y + ((p.y - start.y) * i) / steps };
      this.points.set(id, q);
      if (this.useCdp) await this._cdpSend('touchMove', id, q);
      else await this._synthetic('pointermove', id, q.x, q.y);
    }
  }

  /** Slide a held finger by (dx, dy) pixels from where it is now. */
  async moveBy(id, dx, dy, steps = 4) {
    const start = this.points.get(id);
    await this.moveToPoint(id, { x: start.x + dx, y: start.y + dy }, steps);
  }

  async up(id) {
    const p = this.points.get(id);
    if (!p) return;
    this.points.delete(id);
    if (this.useCdp) await this._cdpSend('touchEnd', id, p);
    else await this._synthetic('pointerup', id, p.x, p.y);
  }

  async releaseAll() {
    for (const id of [...this.points.keys()]) await this.up(id);
  }
}

/** Tap a point in page coordinates with a real touch. */
export async function tapAt(page, p) {
  await page.touchscreen.tap(p.x, p.y);
}

/** Login on a touch device: tap the field, type with the (emulated) on-screen keyboard, tap OK. */
export async function loginWithTouch(page, name = 'TOUCHY') {
  await waitForState(page, 'prompt_user');
  const input = page.locator('#username-input');
  await expect(input).toBeVisible();
  await input.tap();
  await expect(input).toBeFocused();
  await page.keyboard.type(name, { delay: 20 });
  await page.locator('#username-submit').tap();
  await waitForState(page, 'menu');
  await expect.poll(() => hook(page, 'tapRegions.length')).toBeGreaterThan(0);
}

/** Tap the 'Start' (or 'Resume') menu item and wait for play. */
export async function tapMenuItem(page, label) {
  const p = await menuItemCenter(page, label);
  await tapAt(page, p);
}

/** Settings row index by id (current Settings screen). */
export async function settingsRowIndex(page, id) {
  const rows = await hook(page, 'settingsRows');
  const index = rows.findIndex((r) => r.id === id);
  expect(index, `settings row '${id}' in ${JSON.stringify(rows)}`).toBeGreaterThanOrEqual(0);
  return index;
}

/** Page point at a fraction (0..1) across tapRegions[index], vertically centred. */
export async function tapRegionPoint(page, index, fx = 0.5) {
  await expect.poll(() => hook(page, 'tapRegions.length')).toBeGreaterThan(index);
  const r = (await hook(page, 'tapRegions'))[index];
  return canvasToPage(page, r.x + r.w * fx, r.y + r.h / 2);
}

// --- Local multiplayer ---

/** Move the main-menu selection with ArrowDown until it reaches `target`. */
export async function selectMenuRow(page, target) {
  for (let i = 0; i < 20 && (await hook(page, 'menuIndex')) !== target; i++) {
    const before = await hook(page, 'menuIndex');
    await page.keyboard.press('ArrowDown');
    await expect.poll(() => hook(page, 'menuIndex')).not.toBe(before);
  }
  expect(await hook(page, 'menuIndex')).toBe(target);
}

/** Main menu -> Multiplayer (keyboard) -> mode select screen. */
export async function openMultiplayer(page) {
  await selectMenuRow(page, MENU.MULTIPLAYER);
  await page.keyboard.press('Enter');
  await waitForState(page, 'mp_mode_select');
}

/** Mode select -> Take Turns with Enter -> the seat lobby (keyboard). */
export async function openTakeTurnsLobby(page) {
  await openMultiplayer(page);
  expect(await hook(page, 'mp.modeSelect.rows')).toEqual(['turns', 'coop', 'back']);
  await page.keyboard.press('Enter');
  await waitForState(page, 'lobby');
  expect(await hook(page, 'lobby.kind')).toBe('seats');
}

/** Press a key and wait until the lobby card of `seat` matches `check(card)`. */
export async function lobbyPress(page, key, seat, check) {
  await page.keyboard.press(key);
  await expect.poll(async () => check((await hook(page, 'lobby.cards'))[seat]), { message: `lobby card ${seat} after ${key}` }).toBe(true);
}

/**
 * Hyperspace with the 10% self-destruct roll forced (a browser API stub, not game state):
 * the next Math.random() call made by the hyperspace jump returns 0.01. Works in single-player
 * (H) and in merged multiplayer input.
 */
export async function selfDestruct(page, key = 'h') {
  await page.evaluate(() => {
    const real = window.__realRandom || Math.random;
    window.__realRandom = real;
    Math.random = () => {
      if (!String(new Error().stack).includes('hyperspace')) return real();
      Math.random = real;
      return 0.01;
    };
  });
  await page.keyboard.press(key);
}

/**
 * Jump into the path of a drifting green crystal so it runs into the ship (stubs Math.random
 * only for the jump's own rolls). The ship lands just ahead of the crystal along its drift.
 */
export async function collectGreenByJump(page) {
  await page.evaluate(() => {
    const real = window.__realRandom || Math.random;
    window.__realRandom = real;
    let calls = 0;
    let target = null;
    Math.random = () => {
      if (!String(new Error().stack).includes('hyperspace')) return real();
      const g = window.__spaceAdventure;
      const W = g.world.width;
      const H = g.world.height;
      const r = 15;
      calls++;
      if (calls === 1) {
        const all = g.asteroids;
        const clear = (x, y) => all.every((a) => Math.hypot(a.x - x, a.y - y) > a.radius + r + 2);
        const greens = all.filter((q) => q.type === 'green')
          .sort((p, q) => Math.hypot(q.velX, q.velY) - Math.hypot(p.velX, p.velY));
        for (const a of greens) {
          const speed = Math.hypot(a.velX, a.velY) || 1;
          const d = a.radius + r + 4;
          const x = a.x + (a.velX / speed) * d;
          const y = a.y + (a.velY / speed) * d;
          if (x > 40 && x < W - 40 && y > 40 && y < H - 40 && clear(x, y)) { target = { x, y }; break; }
        }
        if (!target) { Math.random = real; return 0.01; } // no spot: self-destruct instead
        return 0.5; // no self-destruct
      }
      if (calls === 2) return (target.x - r) / (W - 2 * r);
      Math.random = real;
      return (target.y - r) / (H - 2 * r);
    };
  });
  await page.keyboard.press('h');
}

/** Mode select -> Co-op (second row) with the keyboard -> the seat lobby. */
export async function openCoopLobby(page) {
  await openMultiplayer(page);
  await page.keyboard.press('ArrowDown');
  await expect.poll(() => hook(page, 'mp.modeSelect.index')).toBe(1);
  await page.keyboard.press('Enter');
  await waitForState(page, 'lobby');
  expect(await hook(page, 'lobby')).toMatchObject({ kind: 'seats', modeId: 'coop' });
}

/** P1 (Space) and P2 (Enter) join and ready up in a keyboard lobby; waits for play. */
export async function joinTwoWithKeyboard(page, startState = 'playing') {
  await lobbyPress(page, 'Space', 0, (c) => !!c);
  await lobbyPress(page, 'Enter', 1, (c) => !!c);
  await lobbyPress(page, 'Space', 0, (c) => c.ready);
  await lobbyPress(page, 'Enter', 1, (c) => c.ready);
  await waitForState(page, startState, 6000);
}

/**
 * Hyperspace to a chosen world point (stubs Math.random for the jump's own rolls only, a browser
 * API stub, not game state): no self-destruct, then x and y. `key` is the seat's hyperspace key.
 */
export async function jumpTo(page, key, x, y) {
  await page.evaluate(([tx, ty]) => {
    const real = window.__realRandom || Math.random;
    window.__realRandom = real;
    let calls = 0;
    Math.random = () => {
      if (!String(new Error().stack).includes('hyperspace')) return real();
      const g = window.__spaceAdventure;
      const r = 15;
      calls++;
      if (calls === 1) return 0.5; // no self-destruct
      if (calls === 2) return Math.min(1, Math.max(0, (tx - r) / (g.world.width - 2 * r)));
      Math.random = real;
      return Math.min(1, Math.max(0, (ty - r) / (g.world.height - 2 * r)));
    };
  }, [x, y]);
  await page.keyboard.press(key);
}
