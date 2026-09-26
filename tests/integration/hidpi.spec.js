// HiDPI rendering: the canvas backing store is CSS size x devicePixelRatio (capped at 2),
// while game logic, world size and taps stay in logical (CSS) pixels. Runs on every project.
import { test, expect } from '@playwright/test';
import {
  openFresh, hook, waitForState, loginWithKeyboard, tapRegionCenter, tapAt, frames,
} from './helpers.js';

const MAX_SCALE = 2;

/** DOM truth about the canvas: backing store and displayed (CSS) size. */
function canvasInfo(page) {
  return page.evaluate(() => {
    const c = document.getElementById('gameCanvas');
    const r = c.getBoundingClientRect();
    return { backingWidth: c.width, backingHeight: c.height, cssWidth: r.width, cssHeight: r.height, dpr: window.devicePixelRatio };
  });
}

async function expectSharpCanvas(page, cap = MAX_SCALE) {
  const v = await hook(page, 'view');
  const c = await canvasInfo(page);
  const scale = Math.min(Math.max(c.dpr, 1), cap);
  expect(v.dpr).toBe(c.dpr);
  expect(c.backingWidth).toBe(Math.round(v.width * scale));
  expect(c.backingHeight).toBe(Math.round(v.height * scale));
  expect(v.backingWidth).toBe(c.backingWidth);
  expect(v.backingHeight).toBe(c.backingHeight);
  expect(v.scale).toBeCloseTo(c.backingWidth / v.width, 10);
  // The CSS size did not grow with the backing store
  expect(Math.abs(c.cssWidth - v.width)).toBeLessThanOrEqual(1);
  expect(Math.abs(c.cssHeight - v.height)).toBeLessThanOrEqual(1);
  return { v, c };
}

/** Real tap on touch projects, left mouse click on desktop. */
async function press(page, p, touch) {
  if (touch) await tapAt(page, p);
  else await page.mouse.click(p.x, p.y);
}

async function startGame(page) {
  await loginWithKeyboard(page);
  await page.keyboard.press('Enter'); // Start is the first menu item
  await waitForState(page, 'playing');
  await expect.poll(() => hook(page, 'ship.isAlive')).toBe(true);
}

test.describe('hidpi: canvas sizing', () => {
  test('backing store = round(view width x min(dpr, 2)); CSS size and world use logical pixels', async ({ page }) => {
    const errors = await openFresh(page);
    await waitForState(page, 'prompt_user');
    const { v, c } = await expectSharpCanvas(page);
    const vp = page.viewportSize();
    expect(v.width).toBe(Math.floor(Math.min(vp.width, vp.height) * 0.9));
    expect(v.height).toBe(v.width);
    expect(v.scaleCap).toBe(MAX_SCALE);
    // World size comes from the logical size only
    expect(await hook(page, 'world')).toEqual({ width: v.width * 1.5, height: v.height * 1.5 });
    if (c.dpr >= 2) expect(c.backingWidth).toBe(v.width * 2);
    expect(errors).toEqual([]);
  });

  test('menu taps/clicks near item edges hit the right items', async ({ page }, testInfo) => {
    const touch = !!testInfo.project.use.hasTouch;
    await openFresh(page);
    await loginWithKeyboard(page);
    const regions = await hook(page, 'tapRegions');
    const options = await hook(page, 'menuOptions');
    const diff = options.indexOf('Difficulty');
    // Near the top-right corner of the Difficulty row (next) and its bottom-left (previous)
    const toPage = (x, y) => page.evaluate(([cx, cy]) => {
      const r = document.getElementById('gameCanvas').getBoundingClientRect();
      const view = window.__spaceAdventure.view;
      return { x: r.left + cx * (r.width / view.width), y: r.top + cy * (r.height / view.height) };
    }, [x, y]);
    const e = regions[diff];
    await press(page, await toPage(e.x + e.w * 0.9, e.y + e.h * 0.15), touch);
    await expect.poll(() => hook(page, 'difficulty')).toBe('hard');
    await frames(page, 2);
    const h = (await hook(page, 'tapRegions'))[diff];
    await press(page, await toPage(h.x + h.w * 0.1, h.y + h.h * 0.85), touch);
    await expect.poll(() => hook(page, 'difficulty')).toBe('medium');
    // The row above (Change User) was not triggered by the near-edge taps
    expect(await hook(page, 'user')).not.toBeNull();
    expect(await hook(page, 'state')).toBe('menu');
    // And a centre tap on Help opens it
    await press(page, await tapRegionCenter(page, options.indexOf('Help')), touch);
    await waitForState(page, 'help');
  });

  test('canvas screenshot has device-pixel resolution', async ({ page }) => {
    await openFresh(page);
    await loginWithKeyboard(page);
    const { v, c } = await expectSharpCanvas(page);
    const png = await page.locator('#gameCanvas').screenshot({ scale: 'device' });
    const width = png.readUInt32BE(16); // PNG IHDR width
    expect(Math.abs(width - Math.round(v.width * c.dpr))).toBeLessThanOrEqual(2);
    // iPad gen 7 portrait: 729 CSS px -> 1458 device px (WebKit may round the element's
    // fractional page position out by a pixel on each side)
    if (v.width === 729 && c.dpr === 2) expect(Math.abs(width - 1458)).toBeLessThanOrEqual(2);
  });

  test('rotation / resize mid-game keeps the ship in the world and the canvas sharp', async ({ page }) => {
    await openFresh(page);
    await startGame(page);
    const vp = page.viewportSize();
    const before = await hook(page, 'view');
    await page.setViewportSize({ width: vp.height, height: Math.round(Math.min(vp.width, vp.height) * 0.8) });
    await expect.poll(async () => (await hook(page, 'view')).width).not.toBe(before.width);
    await frames(page, 3);
    await expectSharpCanvas(page);
    const world = await hook(page, 'world');
    const view = await hook(page, 'view');
    expect(world).toEqual({ width: view.width * 1.5, height: view.height * 1.5 });
    const ship = await hook(page, 'ship');
    expect(ship.x).toBeGreaterThanOrEqual(0);
    expect(ship.x).toBeLessThanOrEqual(world.width);
    expect(ship.y).toBeGreaterThanOrEqual(0);
    expect(ship.y).toBeLessThanOrEqual(world.height);
    expect(await hook(page, 'state')).toBe('playing');
    expect(await hook(page, 'loopErrors')).toBe(0);
  });

  test('no frame errors after 5 s of play', async ({ page }) => {
    const errors = await openFresh(page);
    await startGame(page);
    await page.keyboard.down('ArrowLeft');
    await page.keyboard.down(' ');
    await page.waitForTimeout(5000);
    await page.keyboard.up(' ');
    await page.keyboard.up('ArrowLeft');
    expect(await hook(page, 'loopErrors')).toBe(0);
    expect(errors).toEqual([]);
    await expectSharpCanvas(page, (await hook(page, 'view')).scaleCap);
  });
});

test.describe('hidpi: DPR 3 is capped at 2', () => {
  test.use({ deviceScaleFactor: 3 });

  test('backing store is 2x the CSS size, not 3x', async ({ page }) => {
    const errors = await openFresh(page);
    await waitForState(page, 'prompt_user');
    const { v, c } = await expectSharpCanvas(page);
    expect(c.dpr).toBe(3);
    expect(v.scale).toBe(2);
    expect(c.backingWidth).toBe(v.width * 2);
    expect(errors).toEqual([]);
  });
});

test.describe('hidpi: world size does not depend on DPR', () => {
  test('DPR 1 and DPR 2 at the same viewport give the same view and world', async ({ browser }, testInfo) => {
    const base = testInfo.project.use;
    const results = [];
    for (const deviceScaleFactor of [1, 2]) {
      const context = await browser.newContext({ ...base, deviceScaleFactor });
      const page = await context.newPage();
      await openFresh(page);
      await waitForState(page, 'prompt_user');
      const { v } = await expectSharpCanvas(page);
      results.push({ view: { width: v.width, height: v.height }, world: await hook(page, 'world'), backing: v.backingWidth });
      await context.close();
    }
    expect(results[1].view).toEqual(results[0].view);
    expect(results[1].world).toEqual(results[0].world);
    expect(results[1].backing).toBe(results[0].backing * 2);
  });
});

test.describe('hidpi: DPR change without a resize', () => {
  test('changing devicePixelRatio (zoom / other monitor) re-sizes the backing store', async ({ page, browserName }) => {
    test.skip(browserName !== 'chromium', 'DPR can only be changed at runtime through CDP');
    await openFresh(page);
    await waitForState(page, 'prompt_user');
    const vp = page.viewportSize();
    const before = await hook(page, 'view');
    const cdp = await page.context().newCDPSession(page);
    const target = before.dpr === 2 ? 1 : 2;
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width: vp.width, height: vp.height, deviceScaleFactor: target, mobile: false,
    });
    await expect.poll(async () => (await hook(page, 'view')).dpr).toBe(target);
    await expect.poll(async () => (await hook(page, 'view')).backingWidth).toBe(before.width * target);
    const after = await hook(page, 'view');
    expect(after.width).toBe(before.width);
    await expectSharpCanvas(page);
  });
});

test.describe('hidpi: adaptive render-scale fallback', () => {
  test.use({ deviceScaleFactor: 2 });

  test('slow frames while playing lower the render scale cap; taps keep working', async ({ page }, testInfo) => {
    test.setTimeout(45000);
    const touch = !!testInfo.project.use.hasTouch;
    await openFresh(page);
    await startGame(page);
    expect((await hook(page, 'view')).scaleCap).toBe(2);
    // Simulate a slow device: every animation frame busy-waits 30 ms (> 22 ms threshold)
    await page.evaluate(() => {
      const orig = window.requestAnimationFrame.bind(window);
      window.requestAnimationFrame = (cb) => orig((t) => {
        const end = performance.now() + 30;
        while (performance.now() < end) { /* busy */ }
        cb(t);
      });
    });
    await expect.poll(async () => (await hook(page, 'view')).scaleCap, { timeout: 15000 }).toBeLessThan(2);
    const v = await hook(page, 'view');
    expect(v.downgrades).toBeGreaterThanOrEqual(1);
    expect(v.avgFrameMs).toBeGreaterThan(22);
    await expectSharpCanvas(page, v.scaleCap);
    // Logical sizes are unchanged: the world is the same and taps still land
    expect(await hook(page, 'world')).toEqual({ width: v.width * 1.5, height: v.height * 1.5 });
    await page.keyboard.press('Escape');
    await waitForState(page, 'paused');
    const resumeAt = await tapRegionCenter(page, 0);
    await press(page, resumeAt, touch);
    await waitForState(page, 'playing');
    expect(await hook(page, 'loopErrors')).toBe(0);
  });
});
