// UAT on the live GitHub Pages site: the 3D game (?3d=1) as a visitor gets it.
// WebGL runs through SwiftShader on CI (slow), so waits use game state, never wall time.
import { test, expect } from '@playwright/test';

const T = 90000;
const shot = (page, testInfo, name) => page.screenshot({ path: `tests/screenshots/uat/${testInfo.project.name}-3d-${name}.png` });
const g3 = (page) => page.evaluate(() => window.__spaceAdventure.game3d);

async function open3dLive(page, query = '') {
  const errors = [];
  page.on('pageerror', (err) => errors.push(err.message));
  await page.addInitScript(() => {
    try {
      if (!sessionStorage.getItem('__uat3d_cleared')) {
        localStorage.clear();
        localStorage.setItem('spaceAdventure_sensor3d', 'event');
        localStorage.setItem('spaceAdventure_control3d', 'joystick');
        localStorage.setItem('spaceAdventure_offerTutorial', 'false');
        sessionStorage.setItem('__uat3d_cleared', '1');
      }
    } catch (e) { /* storage unavailable */ }
  });
  await page.goto(`./?3d=1&lowres3d=1${query}`);
  await page.waitForFunction(() => window.__spaceAdventure && window.__spaceAdventure.game3d
    && window.__spaceAdventure.game3d.loaded, null, { timeout: T });
  return errors;
}

test('3D: loads, starts and the game advances', async ({ page }, testInfo) => {
  const errors = await open3dLive(page, '&seed3d=1');
  await shot(page, testInfo, 'menu');
  await page.click('#p3-start');
  await expect.poll(async () => (await g3(page)).screen, { timeout: T }).toBe('playing');
  const s0 = (await g3(page)).steps;
  await page.waitForFunction((t) => window.__spaceAdventure.game3d.steps >= t, s0 + 30, { timeout: T });
  await shot(page, testInfo, 'playing');
  expect(errors).toEqual([]);
});

test('3D: the radar sits on the right edge, front above rear', async ({ page }) => {
  await open3dLive(page, '&seed3d=1');
  await page.click('#p3-start');
  await expect.poll(async () => (await g3(page)).screen, { timeout: T }).toBe('playing');
  const { layout } = (await g3(page)).radar;
  const w = page.viewportSize().width;
  expect(layout.front.cx).toBeGreaterThan(w * 0.75);
  expect(layout.front.cy).toBeLessThan(layout.rear.cy);
});

test('3D: reloads offline from the service worker cache', async ({ page, context }, testInfo) => {
  const errors = await open3dLive(page);
  // First visit installs the worker and fills the cache; the next load is controlled by it
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => true));
  await page.reload();
  await expect.poll(() => page.evaluate(() => !!(navigator.serviceWorker && navigator.serviceWorker.controller)), { timeout: T }).toBe(true);
  await context.setOffline(true);
  await page.reload();
  await page.waitForFunction(() => window.__spaceAdventure && window.__spaceAdventure.game3d
    && window.__spaceAdventure.game3d.loaded, null, { timeout: T });
  await shot(page, testInfo, 'offline');
  await context.setOffline(false);
  expect(errors).toEqual([]);
});
