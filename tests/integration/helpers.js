// Shared helpers for the Space Adventure browser tests.
// All game state is read through the read-only hook window.__spaceAdventure;
// tests never write game state, they drive the game through real input.
import { expect } from '@playwright/test';

export const MENU = {
  START: 0, UPGRADES: 1, HIGH_SCORES: 2, ACHIEVEMENTS: 3, HELP: 4, CONTROLS: 5,
  RESET: 6, CHANGE_USER: 7, EASY: 8, MEDIUM: 9, HARD: 10,
};

export const MENU_LABELS = [
  'Start', 'Upgrades', 'High Scores', 'Achievements', 'Help', 'Controls', 'Reset Data', 'Change User',
  'Easy', 'Medium', 'Hard',
];

export const CONTROL_MODE_KEY = 'spaceAdventure_controlMode';
export const CONTROL_LABELS = { joystick: 'Controls: Drag to Steer', buttons: 'Controls: Buttons' };

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
 *                player had picked it in the menu earlier); omitted = no saved choice.
 *   recordText:  true -> record the strings drawn with fillText on the canvas (see drawnTexts).
 * Returns the array that page errors are pushed into.
 */
export async function openFresh(page, { controlMode = null, recordText = false } = {}) {
  const errors = [];
  page.on('pageerror', (err) => errors.push(err.message));
  // Clear storage once per test (not on reloads the test itself performs)
  await page.addInitScript(([key, mode]) => {
    try {
      if (!sessionStorage.getItem('__sa_cleared')) {
        localStorage.clear();
        if (mode) localStorage.setItem(key, mode);
        sessionStorage.setItem('__sa_cleared', '1');
      }
    } catch (e) { /* storage unavailable */ }
  }, [CONTROL_MODE_KEY, controlMode]);
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
  await page.goto('/');
  await page.waitForFunction(() => window.__spaceAdventure && typeof window.__spaceAdventure.state === 'string', null, { timeout: 10000 });
  return errors;
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
