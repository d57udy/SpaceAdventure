// Adaptive screens: the canvas fills the safe viewport at any aspect ratio (desktop 16:10,
// iPad portrait and landscape, a Pixel 7 Pro phone), the menus fit inside it (every tap region
// inside the canvas and at least 44 px tall for rows), and screenshots of the menu, Settings,
// the game and the pause menu are saved per project to tests/screenshots/ for review.
import { test, expect } from '@playwright/test';
import {
  openFresh, hook, waitForState, loginWithKeyboard, loginWithTouch, selectMenuRow, frames, MENU,
} from './helpers.js';

/** The viewport inside the safe-area insets (CSS px). */
function safeViewport(page) {
  return page.evaluate(() => {
    const cs = getComputedStyle(document.documentElement);
    const read = (n) => Math.max(0, parseFloat(cs.getPropertyValue(n)) || 0);
    const s = { top: read('--safe-top'), right: read('--safe-right'), bottom: read('--safe-bottom'), left: read('--safe-left') };
    return { width: window.innerWidth - s.left - s.right, height: window.innerHeight - s.top - s.bottom };
  });
}

async function login(page, testInfo, name) {
  if (testInfo.project.use.hasTouch) await loginWithTouch(page, name);
  else await loginWithKeyboard(page, name);
}

/** Every tap region of the current screen lies inside the canvas (logical px). */
async function expectRegionsInside(page, label, { minRowH = 44 } = {}) {
  await expect.poll(() => hook(page, 'tapRegions.length'), { message: `${label}: tap regions` }).toBeGreaterThan(0);
  const v = await hook(page, 'view');
  const regions = await hook(page, 'tapRegions');
  const bad = [];
  for (const r of regions) {
    const where = `${label} ${r.id ?? '?'} ${JSON.stringify(r)} in ${v.width}x${v.height}`;
    if (r.x < -0.5 || r.y < -0.5 || r.x + r.w > v.width + 0.5 || r.y + r.h > v.height + 0.5) bad.push(`outside: ${where}`);
    if (r.id && r.id.startsWith('row:') && r.h < minRowH - 0.5) bad.push(`short: ${where}`);
  }
  expect(bad).toEqual([]);
}

async function shot(page, testInfo, name) {
  await frames(page, 3);
  await page.screenshot({ path: `tests/screenshots/${testInfo.project.name}-layout-${name}.png` });
}

test.describe('layout: adaptive canvas', () => {
  test('the canvas fills >= 95% of the safe viewport in both dimensions', async ({ page }) => {
    const errors = await openFresh(page);
    await waitForState(page, 'prompt_user');
    const safe = await safeViewport(page);
    const box = await page.locator('#gameCanvas').boundingBox();
    expect(box.width).toBeGreaterThanOrEqual(safe.width * 0.95);
    expect(box.height).toBeGreaterThanOrEqual(safe.height * 0.95);
    const v = await hook(page, 'view');
    expect(v.width).toBeGreaterThanOrEqual(safe.width * 0.95);
    expect(v.height).toBeGreaterThanOrEqual(safe.height * 0.95);
    expect(v.reserve).toEqual({ left: 0, right: 0, top: 0, bottom: 0 });
    // The world is at least 1.5 views on each axis and never more than 16:9
    const w = await hook(page, 'world');
    expect(w.width).toBeGreaterThanOrEqual(v.width * 1.5 - 1e-6);
    expect(w.height).toBeGreaterThanOrEqual(v.height * 1.5 - 1e-6);
    expect(Math.max(w.width, w.height) / Math.min(w.width, w.height)).toBeLessThanOrEqual(16 / 9 + 1e-6);
    expect(errors).toEqual([]);
  });

  test('menus fit: every tap region inside the canvas, rows >= 44 px', async ({ page }, testInfo) => {
    const errors = await openFresh(page);
    await login(page, testInfo, 'LAYOUT');
    await expectRegionsInside(page, 'Main menu');
    // The menu column is centred and inside the view
    const col = await hook(page, 'view.menuColumn');
    const v = await hook(page, 'view');
    expect(col.x).toBeGreaterThanOrEqual(0);
    expect(col.x + col.w).toBeLessThanOrEqual(v.width + 0.5);
    expect(Math.abs(col.x + col.w / 2 - v.width / 2)).toBeLessThanOrEqual(0.5);

    for (const [row, state, label] of [
      [MENU.SETTINGS, 'settings', 'Settings'],
      [MENU.UPGRADES, 'upgrades', 'Upgrades'],
      [MENU.HELP, 'help', 'Help'],
      [MENU.HIGH_SCORES, 'high_scores', 'High Scores'],
      [MENU.MULTIPLAYER, 'mp_mode_select', 'Multiplayer'],
    ]) {
      await selectMenuRow(page, row);
      await page.keyboard.press('Enter');
      await waitForState(page, state);
      await expectRegionsInside(page, label);
      await page.keyboard.press('Escape');
      await waitForState(page, 'menu');
    }
    expect(errors).toEqual([]);
  });

  test('screenshots: menu, settings, in-game and pause', async ({ page }, testInfo) => {
    const errors = await openFresh(page);
    await login(page, testInfo, 'SHOTS');
    await shot(page, testInfo, 'menu');
    await selectMenuRow(page, MENU.SETTINGS);
    await page.keyboard.press('Enter');
    await waitForState(page, 'settings');
    await shot(page, testInfo, 'settings');
    await page.keyboard.press('Escape');
    await waitForState(page, 'menu');
    await selectMenuRow(page, MENU.START);
    await page.keyboard.press('Enter');
    await waitForState(page, 'playing');
    await expect.poll(() => hook(page, 'ship.isAlive')).toBe(true);
    await page.waitForTimeout(500);
    // In play: the radar is inside the canvas (bottom centre under touch controls)
    const v = await hook(page, 'view');
    const r = v.hudLayout.radar;
    expect(r.x).toBeGreaterThanOrEqual(0);
    expect(r.y).toBeGreaterThanOrEqual(0);
    expect(r.x + r.size).toBeLessThanOrEqual(v.width);
    expect(r.y + r.size).toBeLessThanOrEqual(v.height);
    await shot(page, testInfo, 'ingame');
    await page.keyboard.press('Escape');
    await waitForState(page, 'paused');
    await expectRegionsInside(page, 'Pause');
    const pause = (await hook(page, 'tapRegions')).filter((q) => q.id && q.id.startsWith('pause:'));
    expect(pause.length).toBeGreaterThanOrEqual(3);
    for (const q of pause) expect(q.h, q.id).toBeGreaterThanOrEqual(44);
    await shot(page, testInfo, 'pause');
    expect(await hook(page, 'loopErrors')).toBe(0);
    expect(errors).toEqual([]);
  });
});
