// Touch UAT tests (iPad WebKit, iPad landscape WebKit, Chromium with touch).
import { test, expect } from '@playwright/test';
import {
  openFresh, snap, hook, isPressed, waitForState, loginWithTouch, tapMenuItem,
  tapRegionCenter, tapAt, Fingers, rectsOverlap,
} from './helpers.js';

const BUTTONS = {
  rotateLeft: '#touch-left-btn',
  rotateRight: '#touch-right-btn',
  thrust: '#touch-thrust-btn',
  fire: '#touch-fire-btn',
  hyperspace: '#touch-hyper-btn',
  toggleMute: '#touch-mute-btn',
  pause: '#touch-pause-btn',
};

async function startByTap(page) {
  await tapMenuItem(page, 'Start');
  await waitForState(page, 'playing');
  await expect.poll(() => hook(page, 'ship.isAlive')).toBe(true);
  await expect(page.locator(BUTTONS.fire)).toBeVisible();
}

test.describe('touch: prompt and menu', () => {
  test('page is touch-enabled and the username can be entered with taps', async ({ page }) => {
    const errors = await openFresh(page);
    await expect(page.locator('body')).toHaveClass(/touch-enabled/);
    await waitForState(page, 'prompt_user');
    // Touch devices must not autofocus (the on-screen keyboard only opens on tap)
    await expect(page.locator('#username-input')).not.toBeFocused();
    await loginWithTouch(page, 'ipad1');
    expect(await hook(page, 'user')).toBe('IPAD1');
    await expect(page.locator('#user-prompt')).toBeHidden();
    await expect(page.locator('#username-input')).not.toBeFocused(); // keyboard dismissed
    expect(errors).toEqual([]);
  });

  test('menu items have tap regions inside the canvas', async ({ page }) => {
    await openFresh(page);
    await loginWithTouch(page);
    const s = await snap(page);
    const size = await page.evaluate(() => ({ w: gameCanvas.width, h: gameCanvas.height }));
    expect(s.tapRegions.length).toBe(s.menuOptions.length);
    for (const r of s.tapRegions) {
      expect(r.x).toBeGreaterThanOrEqual(0);
      expect(r.y).toBeGreaterThanOrEqual(0);
      expect(r.x + r.w).toBeLessThanOrEqual(size.w);
      expect(r.y + r.h).toBeLessThanOrEqual(size.h);
      expect(r.h).toBeGreaterThanOrEqual(30); // finger-sized rows
    }
  });

  test('touch controls are hidden in the menu and shown only while playing', async ({ page }) => {
    await openFresh(page);
    await loginWithTouch(page);
    for (const sel of Object.values(BUTTONS)) await expect(page.locator(sel)).toBeHidden();
    await startByTap(page);
    for (const sel of Object.values(BUTTONS)) await expect(page.locator(sel)).toBeVisible();
    await page.locator(BUTTONS.pause).tap();
    await waitForState(page, 'paused');
    for (const sel of Object.values(BUTTONS)) await expect(page.locator(sel)).toBeHidden();
  });

  test('tapping Start starts the game with sensible state', async ({ page }) => {
    await openFresh(page);
    await loginWithTouch(page);
    await startByTap(page);
    const s = await snap(page);
    expect(s.score).toBe(0);
    expect(s.level).toBe(1);
    expect(s.lives).toBeGreaterThan(0);
    expect(s.counts.asteroids).toBeGreaterThan(0);
  });

  test('tapping a difficulty selects it', async ({ page }) => {
    await openFresh(page);
    await loginWithTouch(page);
    await tapMenuItem(page, 'Easy');
    await expect.poll(() => hook(page, 'difficulty')).toBe('easy');
    await tapMenuItem(page, 'Hard');
    await expect.poll(() => hook(page, 'difficulty')).toBe('hard');
    expect(await hook(page, 'state')).toBe('menu');
  });

  for (const [label, state] of [['Help', 'help'], ['High Scores', 'high_scores'], ['Achievements', 'achievements']]) {
    test(`tapping ${label} opens it and a tap anywhere returns to the menu`, async ({ page }) => {
      await openFresh(page);
      await loginWithTouch(page);
      await tapMenuItem(page, label);
      await waitForState(page, state);
      const canvasBox = await page.locator('#gameCanvas').boundingBox();
      await tapAt(page, { x: canvasBox.x + canvasBox.width / 2, y: canvasBox.y + canvasBox.height * 0.2 });
      await waitForState(page, 'menu');
    });
  }

  test('upgrades screen: tap an upgrade (stays) and tap Back (returns)', async ({ page }) => {
    await openFresh(page);
    await loginWithTouch(page);
    await tapMenuItem(page, 'Upgrades');
    await waitForState(page, 'upgrades');
    const regions = await hook(page, 'tapRegions');
    expect(regions.length).toBeGreaterThan(1);
    await tapAt(page, await tapRegionCenter(page, 1));
    await expect.poll(() => hook(page, 'upgradeIndex')).toBe(1);
    expect(await hook(page, 'state')).toBe('upgrades'); // no credits: purchase fails, stays
    await tapAt(page, await tapRegionCenter(page, regions.length - 1));
    await waitForState(page, 'menu');
  });
});

test.describe('touch: gameplay controls', () => {
  test.beforeEach(async ({ page }) => {
    await openFresh(page);
    await loginWithTouch(page);
    await startByTap(page);
  });

  test('holding rotate left / right changes the ship rotation', async ({ page, browserName }) => {
    const f = new Fingers(page, browserName);
    const r0 = await hook(page, 'ship.rotation');
    await f.down(1, BUTTONS.rotateLeft);
    await expect.poll(() => isPressed(page, 'rotateLeft')).toBe(true);
    await expect(page.locator(BUTTONS.rotateLeft)).toHaveClass(/active/);
    await expect.poll(() => hook(page, 'ship.rotation')).toBeLessThan(r0 - 0.2);
    await f.up(1);
    await expect.poll(() => isPressed(page, 'rotateLeft')).toBe(false);
    await expect(page.locator(BUTTONS.rotateLeft)).not.toHaveClass(/active/);

    const r1 = await hook(page, 'ship.rotation');
    await f.down(2, BUTTONS.rotateRight);
    await expect.poll(() => hook(page, 'ship.rotation')).toBeGreaterThan(r1 + 0.2);
    await f.up(2);
    await expect.poll(() => isPressed(page, 'rotateRight')).toBe(false);
  });

  test('multi-touch: thrust + fire + rotate held together all register', async ({ page, browserName }) => {
    const f = new Fingers(page, browserName);
    await f.down(1, BUTTONS.thrust);
    await f.down(2, BUTTONS.fire);
    await f.down(3, BUTTONS.rotateLeft);
    await expect.poll(async () => ({
      thrust: await isPressed(page, 'thrust'),
      fire: await isPressed(page, 'fire'),
      rotateLeft: await isPressed(page, 'rotateLeft'),
    })).toEqual({ thrust: true, fire: true, rotateLeft: true });
    await expect.poll(() => hook(page, 'ship.isThrusting')).toBe(true);
    // Lift one finger: others stay held
    await f.up(2);
    await expect.poll(() => isPressed(page, 'fire')).toBe(false);
    expect(await isPressed(page, 'thrust')).toBe(true);
    expect(await isPressed(page, 'rotateLeft')).toBe(true);
    await f.releaseAll();
    await expect.poll(async () => (await isPressed(page, 'thrust')) || (await isPressed(page, 'rotateLeft'))).toBe(false);
  });

  test('sliding a finger from rotate left to rotate right switches the action', async ({ page, browserName }) => {
    const f = new Fingers(page, browserName);
    await f.down(1, BUTTONS.rotateLeft);
    await expect.poll(() => isPressed(page, 'rotateLeft')).toBe(true);
    await f.moveTo(1, BUTTONS.rotateRight);
    await expect.poll(() => isPressed(page, 'rotateRight')).toBe(true);
    expect(await isPressed(page, 'rotateLeft')).toBe(false);
    await expect(page.locator(BUTTONS.rotateRight)).toHaveClass(/active/);
    await expect(page.locator(BUTTONS.rotateLeft)).not.toHaveClass(/active/);
    const r = await hook(page, 'ship.rotation');
    await expect.poll(() => hook(page, 'ship.rotation')).toBeGreaterThan(r + 0.1);
    await f.up(1);
    await expect.poll(() => isPressed(page, 'rotateRight')).toBe(false);
  });

  test('thrust button accelerates the ship', async ({ page, browserName }) => {
    const f = new Fingers(page, browserName);
    await f.down(1, BUTTONS.thrust);
    await expect.poll(() => hook(page, 'ship.velY')).toBeLessThan(-0.5);
    await f.up(1);
    await expect.poll(() => hook(page, 'ship.isThrusting')).toBe(false);
  });

  test('holding fire creates player bullets', async ({ page, browserName }) => {
    const f = new Fingers(page, browserName);
    expect(await hook(page, 'counts.playerBullets')).toBe(0);
    await f.down(1, BUTTONS.fire);
    await expect.poll(() => hook(page, 'counts.playerBullets')).toBeGreaterThanOrEqual(2);
    await f.up(1);
  });

  test('a short (~100ms) tap on fire shoots', async ({ page, browserName }) => {
    const f = new Fingers(page, browserName);
    await f.down(1, BUTTONS.fire);
    await page.waitForTimeout(100);
    await f.up(1);
    await expect.poll(() => hook(page, 'counts.playerBullets'), { timeout: 2000 }).toBeGreaterThanOrEqual(1);
  });

  test('pause button pauses; tapping Resume resumes', async ({ page }) => {
    await page.locator(BUTTONS.pause).tap();
    await waitForState(page, 'paused');
    const options = await hook(page, 'tapRegions');
    expect(options.length).toBe(3);
    await tapAt(page, await tapRegionCenter(page, 0)); // Resume
    await waitForState(page, 'playing');
    await expect(page.locator(BUTTONS.fire)).toBeVisible();
  });

  test('pause -> Main Menu -> Resume via taps', async ({ page }) => {
    await page.locator(BUTTONS.pause).tap();
    await waitForState(page, 'paused');
    await tapAt(page, await tapRegionCenter(page, 2)); // Main Menu
    await waitForState(page, 'menu');
    await expect.poll(() => hook(page, 'menuOptions.0')).toBe('Resume');
    await tapMenuItem(page, 'Resume');
    await waitForState(page, 'playing');
  });

  test('pause -> Restart via taps', async ({ page }) => {
    await page.locator(BUTTONS.pause).tap();
    await waitForState(page, 'paused');
    await tapAt(page, await tapRegionCenter(page, 1)); // Restart
    await waitForState(page, 'playing');
    expect(await hook(page, 'score')).toBe(0);
  });

  test('mute button toggles mute', async ({ page }) => {
    expect(await hook(page, 'isMuted')).toBe(false);
    await page.locator(BUTTONS.toggleMute).tap();
    await expect.poll(() => hook(page, 'isMuted')).toBe(true);
    await page.locator(BUTTONS.toggleMute).tap();
    await expect.poll(() => hook(page, 'isMuted')).toBe(false);
    expect(await hook(page, 'state')).toBe('playing');
  });

  test('hyperspace button moves the ship (or self-destructs, 10%)', async ({ page }) => {
    const s0 = await hook(page, 'ship');
    await page.locator(BUTTONS.hyperspace).tap();
    await expect.poll(async () => {
      const s = await snap(page);
      if (!s.ship || !s.ship.isAlive) return 'died';
      return Math.hypot(s.ship.x - s0.x, s.ship.y - s0.y) > 20 ? 'moved' : 'still';
    }).not.toBe('still');
  });

  test('tapping the canvas during play does not fire or pause', async ({ page }) => {
    const box = await page.locator('#gameCanvas').boundingBox();
    await tapAt(page, { x: box.x + box.width / 2, y: box.y + box.height / 3 });
    await page.waitForTimeout(200);
    const s = await snap(page);
    expect(s.state).toBe('playing');
    expect(s.counts.playerBullets).toBe(0);
  });
});

test.describe('touch: layout', () => {
  test('buttons do not overlap each other or the canvas and are inside the viewport', async ({ page }) => {
    await openFresh(page);
    await loginWithTouch(page);
    await startByTap(page);
    const vp = page.viewportSize();
    const canvas = await page.locator('#gameCanvas').boundingBox();
    const boxes = {};
    for (const [action, sel] of Object.entries(BUTTONS)) {
      const b = await page.locator(sel).boundingBox();
      expect(b, sel).not.toBeNull();
      boxes[action] = b;
      expect(b.x, `${sel} left`).toBeGreaterThanOrEqual(0);
      expect(b.y, `${sel} top`).toBeGreaterThanOrEqual(0);
      expect(b.x + b.width, `${sel} right`).toBeLessThanOrEqual(vp.width);
      expect(b.y + b.height, `${sel} bottom`).toBeLessThanOrEqual(vp.height);
      expect(Math.min(b.width, b.height), `${sel} >= 44px touch target`).toBeGreaterThanOrEqual(44);
    }
    const names = Object.keys(boxes);
    for (let i = 0; i < names.length; i++) {
      for (let j = i + 1; j < names.length; j++) {
        expect(rectsOverlap(boxes[names[i]], boxes[names[j]]), `${names[i]} overlaps ${names[j]}`).toBe(false);
      }
    }
    // Allow a few px of bounding-box overlap (buttons are circles, so the box corner is empty)
    const TOL = 6;
    const inset = { x: canvas.x + TOL, y: canvas.y + TOL, width: canvas.width - 2 * TOL, height: canvas.height - 2 * TOL };
    const covering = names.filter((n) => rectsOverlap(boxes[n], inset))
      .map((n) => `${n}: button ${JSON.stringify(boxes[n])} canvas ${JSON.stringify(canvas)}`);
    expect(covering, 'touch buttons covering the play area').toEqual([]);
  });

  test('buttons hit-test to themselves (nothing on top of them)', async ({ page }) => {
    await openFresh(page);
    await loginWithTouch(page);
    await startByTap(page);
    for (const [action, sel] of Object.entries(BUTTONS)) {
      const hit = await page.evaluate((s) => {
        const r = document.querySelector(s).getBoundingClientRect();
        const el = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
        const btn = el && el.closest('.touch-btn');
        return btn ? btn.dataset.action : (el ? el.tagName : null);
      }, sel);
      expect(hit, sel).toBe(action);
    }
  });

  test('canvas and controls fit the viewport without page scroll', async ({ page }) => {
    await openFresh(page);
    await loginWithTouch(page);
    await startByTap(page);
    const m = await page.evaluate(() => ({
      sw: document.documentElement.scrollWidth, sh: document.documentElement.scrollHeight,
      iw: window.innerWidth, ih: window.innerHeight, sx: window.scrollX, sy: window.scrollY,
      bodyOverflow: getComputedStyle(document.body).overflow,
    }));
    expect(m.sw).toBeLessThanOrEqual(m.iw);
    expect(m.sh).toBeLessThanOrEqual(m.ih);
    expect(m.sx).toBe(0);
    expect(m.sy).toBe(0);
    const c = await page.locator('#gameCanvas').boundingBox();
    expect(c.y + c.height).toBeLessThanOrEqual(m.ih);
    expect(c.x + c.width).toBeLessThanOrEqual(m.iw);
  });
});

test.describe('touch: screenshots for review', () => {
  test('menu and in-game screenshots', async ({ page }, testInfo) => {
    const name = testInfo.project.name;
    await openFresh(page);
    await waitForState(page, 'prompt_user');
    await page.screenshot({ path: `tests/screenshots/${name}-prompt.png` });
    await loginWithTouch(page);
    await page.screenshot({ path: `tests/screenshots/${name}-menu.png` });
    await startByTap(page);
    await page.waitForTimeout(300);
    await page.screenshot({ path: `tests/screenshots/${name}-ingame.png` });
    await page.locator(BUTTONS.pause).tap();
    await waitForState(page, 'paused');
    await page.screenshot({ path: `tests/screenshots/${name}-paused.png` });
  });
});
