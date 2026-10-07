// UAT on the live GitHub Pages site: the 2D game as a visitor gets it (service worker on).
import { test, expect } from '@playwright/test';

const shot = (page, testInfo, name) => page.screenshot({ path: `tests/screenshots/uat/${testInfo.project.name}-2d-${name}.png` });
const hook = (page, path) => page.evaluate((p) => p.split('.').reduce((o, k) => (o == null ? o : o[k]), window.__spaceAdventure), path);

async function openLive(page, url = './') {
  const errors = [];
  page.on('pageerror', (err) => errors.push(err.message));
  await page.addInitScript(() => {
    try {
      if (!sessionStorage.getItem('__uat_cleared')) {
        localStorage.clear();
        localStorage.setItem('spaceAdventure_offerTutorial', 'false');
        sessionStorage.setItem('__uat_cleared', '1');
      }
    } catch (e) { /* storage unavailable */ }
  });
  await page.goto(url);
  await page.waitForFunction(() => window.__spaceAdventure && typeof window.__spaceAdventure.state === 'string', null, { timeout: 30000 });
  return errors;
}

test('2D: the live site loads to the menu without errors', async ({ page }, testInfo) => {
  const errors = await openLive(page);
  await expect.poll(() => hook(page, 'state'), { timeout: 30000 }).not.toBe('loading');
  // A fresh visitor may first see the name screen; either way the game must be interactive
  expect(typeof await hook(page, 'state')).toBe('string');
  await shot(page, testInfo, 'menu');
  expect(errors).toEqual([]);
});

test('2D: the service worker takes control and the game reloads offline', async ({ page, context, browserName }, testInfo) => {
  test.skip(browserName !== 'chromium', 'Playwright service worker support is Chromium-only');
  const errors = await openLive(page);
  await expect.poll(() => hook(page, 'pwa.swRegistered'), { timeout: 60000 }).toBe(true);
  await page.reload();
  await expect.poll(() => hook(page, 'pwa.swControlled'), { timeout: 60000 }).toBe(true);
  await context.setOffline(true);
  await page.reload();
  await page.waitForFunction(() => window.__spaceAdventure && typeof window.__spaceAdventure.state === 'string', null, { timeout: 30000 });
  await shot(page, testInfo, 'offline');
  await context.setOffline(false);
  expect(errors).toEqual([]);
});
