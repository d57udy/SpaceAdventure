// Installable, offline app (Item 3): service worker, offline play, updates, manifest,
// installability and the Full screen button.
//
// Runs in the pwa-chromium (served at /) and pwa-subpath (served under /SpaceAdventure/
// like GitHub Pages) projects. Playwright's service worker support is Chromium-only.
// On localhost the game only registers its worker with ?sw=1.
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { openFresh, hook, waitForState, loginWithKeyboard, frames } from './helpers.js';

// sw.js as committed (Playwright runs from the repo root, where playwright.config.js is).
// Parsed like scripts/update-sw-version.mjs parseSw (that .mjs cannot be imported here).
const SW_SOURCE = readFileSync(join(process.cwd(), 'sw.js'), 'utf8');
const VERSION = SW_SOURCE.match(/const CACHE_VERSION = '([^']*)';/)[1];
const PRECACHE = [...SW_SOURCE.match(/const PRECACHE = \[([\s\S]*?)\];/)[1].matchAll(/'([^']*)'/g)].map((m) => m[1]);
const CACHE_PREFIX = 'space-adventure-';
const APP_URL = './?sw=1';

// The update-flow test changes what the server sends for sw.js; run this file's tests
// one after another so no other test sees the override.
test.describe.configure({ mode: 'default' });

/** Open with ?sw=1 and wait until the worker controls the page and has precached. */
async function openControlled(page, opts = {}) {
  const errors = await openFresh(page, { url: APP_URL, ...opts });
  await page.evaluate(() => navigator.serviceWorker.ready);
  await expect.poll(() => hook(page, 'pwa.swControlled'), { timeout: 15000 }).toBe(true);
  return errors;
}

/** Names of this app's caches and, for each, the URLs it holds. */
function cacheContents(page) {
  return page.evaluate(async (prefix) => {
    const out = {};
    for (const name of (await caches.keys()).filter((k) => k.startsWith(prefix))) {
      const cache = await caches.open(name);
      out[name] = (await cache.keys()).map((r) => r.url).sort();
    }
    return out;
  }, CACHE_PREFIX);
}

const expectedUrls = (scope) => PRECACHE.map((u) => new URL(u, scope).href).sort();

test('the worker registers, controls the page and is scoped to the app folder', async ({ page }, testInfo) => {
  const errors = await openControlled(page);
  const pwa = await hook(page, 'pwa');
  const appFolder = new URL('./', page.url()).href;
  expect(pwa).toMatchObject({ swSupported: true, swStatus: 'registered', swControlled: true, displayMode: 'browser' });
  expect(pwa.swScope).toBe(appFolder);
  if (testInfo.project.name === 'pwa-subpath') expect(new URL(pwa.swScope).pathname).toBe('/SpaceAdventure/');
  const scriptURL = await page.evaluate(() => navigator.serviceWorker.controller.scriptURL);
  expect(scriptURL).toBe(new URL('sw.js', appFolder).href);
  expect(errors).toEqual([]);
});

test('without ?sw=1 localhost skips registration (developers never get stale files)', async ({ page }) => {
  await openFresh(page, { url: './' });
  expect(await hook(page, 'pwa')).toMatchObject({ swStatus: 'skipped-localhost', swControlled: false });
  expect(await page.evaluate(() => navigator.serviceWorker.getRegistrations().then((r) => r.length))).toBe(0);
});

test('the precache holds every file in sw.js PRECACHE, in one versioned cache', async ({ page }) => {
  await openControlled(page);
  const scope = await hook(page, 'pwa.swScope');
  await expect.poll(async () => Object.keys(await cacheContents(page))).toEqual([CACHE_PREFIX + VERSION]);
  const contents = await cacheContents(page);
  expect(contents[CACHE_PREFIX + VERSION]).toEqual(expectedUrls(scope));
  // Sanity: the list covers the page, the game code, the sounds and the icons
  expect(PRECACHE).toEqual(expect.arrayContaining(['./', 'index.html', 'js/main.js', 'js/pwa.js', 'js/pwaUi.js',
    'manifest.webmanifest', 'assets/audio/player_shoot.mp3', 'icons/icon-192.png']));
});

test('offline: reload, log in and play; sounds come from the service worker', async ({ page, context }) => {
  const errors = await openControlled(page);
  await expect.poll(async () => Object.keys(await cacheContents(page))).toEqual([CACHE_PREFIX + VERSION]);

  const responses = [];
  page.on('response', (r) => responses.push({ url: r.url(), sw: r.fromServiceWorker(), status: r.status() }));
  await context.setOffline(true);
  try {
    await page.reload();
    await page.waitForFunction(() => window.__spaceAdventure && typeof window.__spaceAdventure.state === 'string');
    expect(await page.evaluate(() => navigator.onLine)).toBe(false);
    expect(await hook(page, 'pwa.swControlled')).toBe(true);

    await loginWithKeyboard(page, 'OFFLINE');
    await page.keyboard.press('Enter'); // Start
    await waitForState(page, 'playing');
    await page.keyboard.down('Space');
    await frames(page, 20);
    await page.keyboard.up('Space');
    expect(await hook(page, 'state')).toBe('playing');
    expect(await hook(page, 'loopErrors')).toBe(0);

    // The page itself and every sound came from the worker
    const doc = responses.find((r) => r.url === page.url());
    expect(doc && doc.sw, 'navigation served by the worker').toBe(true);
    await expect.poll(() => responses.filter((r) => r.url.endsWith('.mp3')).length).toBe(9);
    const mp3 = responses.filter((r) => r.url.endsWith('.mp3'));
    for (const r of mp3) expect(r, r.url).toMatchObject({ sw: true, status: 200 });
    expect(errors).toEqual([]);
  } finally {
    await context.setOffline(false);
  }
});

test('manifest and installability (Chrome DevTools Protocol)', async ({ page }) => {
  await openControlled(page);
  const cdp = await page.context().newCDPSession(page);
  const manifest = await cdp.send('Page.getAppManifest');
  expect(manifest.url).toBe(new URL('manifest.webmanifest', page.url()).href);
  expect(manifest.errors).toEqual([]);
  const data = JSON.parse(manifest.data);
  expect(data).toMatchObject({ name: 'Space Adventure', start_url: './', scope: './', display: 'fullscreen' });
  const { installabilityErrors } = await cdp.send('Page.getInstallabilityErrors');
  expect(installabilityErrors).toEqual([]);
});

test.describe('update flow', () => {
  test.beforeEach(async ({}, testInfo) => {
    test.skip(testInfo.project.name !== 'pwa-subpath', 'needs the admin server (tests/support/serve.mjs --admin)');
  });

  test('new version: toast in menu and pause, never in play; tapping it reloads onto the new cache', async ({ page, request }, testInfo) => {
    const origin = new URL(testInfo.project.use.baseURL).origin;
    await request.post(`${origin}/__admin/reset`);
    try {
      const errors = await openControlled(page);
      await loginWithKeyboard(page, 'UPDATER');
      await expect.poll(async () => Object.keys(await cacheContents(page))).toEqual([CACHE_PREFIX + VERSION]);
      expect(await page.locator('#update-toast').isVisible()).toBe(false);

      // Deploy a "new version": same files, new CACHE_VERSION
      const NEW_VERSION = 'sa-updatetest1';
      const changed = SW_SOURCE.replace(`const CACHE_VERSION = '${VERSION}';`, `const CACHE_VERSION = '${NEW_VERSION}';`);
      expect(changed).not.toBe(SW_SOURCE);
      const res = await request.post(`${origin}/__admin/override?path=sw.js`, { data: changed, headers: { 'Content-Type': 'text/javascript' } });
      expect(res.status()).toBe(204);

      // Let the browser find the update (as on tab focus or the hourly check): offered in the menu
      await page.evaluate(() => navigator.serviceWorker.getRegistration().then((r) => r.update()));
      await expect.poll(() => hook(page, 'pwa.updateReady'), { timeout: 15000 }).toBe(true);
      await expect(page.locator('#update-toast')).toBeVisible();
      expect(await hook(page, 'pwa.updateToastVisible')).toBe(true);

      // Never during play
      await page.keyboard.press('Enter');
      await waitForState(page, 'playing');
      await frames(page, 5);
      expect(await hook(page, 'state')).toBe('playing');
      expect(await hook(page, 'pwa.updateToastVisible')).toBe(false);
      await expect(page.locator('#update-toast')).toBeHidden();

      // Pause: now it is offered
      await page.keyboard.press('KeyP');
      await waitForState(page, 'paused');
      await expect(page.locator('#update-toast')).toBeVisible();
      await expect(page.locator('#update-toast')).toHaveText('New version available: tap to update');
      // Resume hides it again
      await page.keyboard.press('KeyP');
      await waitForState(page, 'playing');
      await expect(page.locator('#update-toast')).toBeHidden();
      await page.keyboard.press('KeyP');
      await waitForState(page, 'paused');

      // Tap: save, activate the new worker, reload once
      const reloaded = page.waitForEvent('load');
      await page.locator('#update-toast').click();
      await reloaded;
      await page.waitForFunction(() => window.__spaceAdventure && typeof window.__spaceAdventure.state === 'string');
      await waitForState(page, 'menu'); // the user is remembered
      expect(await hook(page, 'user')).toBe('UPDATER');
      await expect.poll(() => hook(page, 'pwa.swControlled')).toBe(true);
      expect(await page.evaluate(() => new Promise((resolve) => {
        const ch = new MessageChannel();
        ch.port1.onmessage = (e) => resolve(e.data.version);
        navigator.serviceWorker.controller.postMessage({ type: 'GET_VERSION' }, [ch.port2]);
      }))).toBe(NEW_VERSION);
      // New cache complete, old one deleted
      const scope = await hook(page, 'pwa.swScope');
      await expect.poll(async () => Object.keys(await cacheContents(page))).toEqual([CACHE_PREFIX + NEW_VERSION]);
      expect((await cacheContents(page))[CACHE_PREFIX + NEW_VERSION]).toEqual(expectedUrls(scope));
      expect(await hook(page, 'pwa.updateReady')).toBe(false);
      await expect(page.locator('#update-toast')).toBeHidden();
      expect(errors).toEqual([]);
    } finally {
      await request.post(`${origin}/__admin/reset`);
    }
  });
});

test.describe('Full screen', () => {
  /** Headless browsers may refuse fullscreen; skip rather than fail then. */
  async function enteredOrSkip(page) {
    try {
      await expect.poll(() => page.evaluate(() => !!document.fullscreenElement), { timeout: 3000 }).toBe(true);
    } catch {
      test.skip(true, 'this (headless) browser refused fullscreen');
    }
  }

  test('the app bar button enters and leaves full screen; hidden during play', async ({ page }) => {
    const errors = await openFresh(page, { url: './' });
    await loginWithKeyboard(page, 'FULLER');
    const btn = page.locator('#app-fullscreen-btn');
    await expect(btn).toBeVisible();
    await expect(btn).toHaveText('Full screen');
    await btn.click();
    await enteredOrSkip(page);
    expect(await page.evaluate(() => document.fullscreenElement === document.documentElement)).toBe(true);
    await expect.poll(() => hook(page, 'pwa.fullscreen')).toBe(true);
    await expect(btn).toHaveText('Exit full screen');
    // The resize handling keeps the canvas square inside the new viewport
    await frames(page, 3);
    const view = await hook(page, 'view');
    const inner = await page.evaluate(() => Math.min(window.innerWidth, window.innerHeight));
    expect(view.width).toBe(Math.floor(inner * 0.9));

    await page.keyboard.press('Enter');
    await waitForState(page, 'playing');
    await expect(page.locator('#app-bar')).toBeHidden();
    await page.keyboard.press('KeyP');
    await waitForState(page, 'paused');
    await expect(btn).toBeVisible();
    await btn.click();
    await expect.poll(() => page.evaluate(() => !!document.fullscreenElement)).toBe(false);
    await expect(btn).toHaveText('Full screen');
    expect(errors).toEqual([]);
  });

  test('F toggles full screen in menus (not while typing a name)', async ({ page }) => {
    await openFresh(page, { url: './' });
    await waitForState(page, 'prompt_user');
    await page.locator('#username-input').focus();
    await page.keyboard.type('FFF');
    await frames(page, 2);
    expect(await page.evaluate(() => !!document.fullscreenElement)).toBe(false);
    await page.keyboard.press('Enter');
    await waitForState(page, 'menu');
    await page.keyboard.press('KeyF');
    await enteredOrSkip(page);
    await page.keyboard.press('KeyF');
    await expect.poll(() => page.evaluate(() => !!document.fullscreenElement)).toBe(false);
  });

  test('the Settings "Full screen" row is a real button over the row', async ({ page }) => {
    await openFresh(page, { url: './' });
    await loginWithKeyboard(page, 'SETFULL');
    const options = await hook(page, 'menuOptions');
    const target = options.indexOf('Settings');
    for (let i = 1; i <= target; i++) {
      await page.keyboard.press('ArrowDown');
      await expect.poll(() => hook(page, 'menuIndex')).toBe(i);
    }
    await page.keyboard.press('Enter');
    await waitForState(page, 'settings');
    const rows = await hook(page, 'settingsRows');
    const index = rows.findIndex((r) => r.id === 'fullscreen');
    expect(index).toBe(rows.length - 2); // just above Back
    const overlay = page.locator('#settings-fullscreen-btn');
    await expect(overlay).toBeVisible();
    await overlay.click();
    await enteredOrSkip(page);
    await expect.poll(async () => (await hook(page, 'settingsRows'))[index].label).toBe('Exit full screen');
    await overlay.click();
    await expect.poll(() => page.evaluate(() => !!document.fullscreenElement)).toBe(false);
  });
});
