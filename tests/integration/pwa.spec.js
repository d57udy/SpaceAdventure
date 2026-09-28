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
  expect(data).toMatchObject({ name: 'Space Adventure', short_name: 'Space Adventure', start_url: './', scope: './', display: 'fullscreen' });
  // Screenshots and icons are reachable from the manifest's folder (also under /SpaceAdventure/)
  for (const src of [...data.icons.map((i) => i.src), ...data.screenshots.map((s) => s.src)]) {
    const res = await page.request.get(new URL(src, manifest.url).href);
    expect(res.status(), src).toBe(200);
    expect(res.headers()['content-type'], src).toContain('image/png');
  }
  const { installabilityErrors } = await cdp.send('Page.getInstallabilityErrors');
  expect(installabilityErrors).toEqual([]);
});

test.describe('update flow', () => {
  test.beforeEach(async ({}, testInfo) => {
    test.skip(testInfo.project.name !== 'pwa-subpath', 'needs the admin server (tests/support/serve.mjs --admin)');
  });

  test('new version: toast in the menu, never in play or with a paused run; tapping it reloads onto the new cache', async ({ page, request }, testInfo) => {
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

      // Not while paused either: the reload would lose the paused run
      await page.keyboard.press('KeyP');
      await waitForState(page, 'paused');
      await frames(page, 5);
      expect(await hook(page, 'pwa.updateToastVisible')).toBe(false);
      await expect(page.locator('#update-toast')).toBeHidden();
      // Nor in the menu while that paused game can still be resumed
      await page.keyboard.press('ArrowDown');
      await expect.poll(() => hook(page, 'pauseIndex')).toBe(1);
      await page.keyboard.press('ArrowDown');
      await expect.poll(() => hook(page, 'pauseIndex')).toBe(2);
      await page.keyboard.press('Enter'); // Main Menu
      await waitForState(page, 'menu');
      expect(await hook(page, 'pausedGameExists')).toBe(true);
      await frames(page, 5);
      await expect(page.locator('#update-toast')).toBeHidden();

      // A fresh page (no run in memory): offered in the menu again
      await page.reload();
      await page.waitForFunction(() => window.__spaceAdventure && typeof window.__spaceAdventure.state === 'string');
      await waitForState(page, 'menu');
      await expect.poll(() => hook(page, 'pwa.updateReady'), { timeout: 15000 }).toBe(true);
      await expect(page.locator('#update-toast')).toBeVisible();
      // Wording follows the input device (desktop Chromium: "click")
      await expect(page.locator('#update-toast')).toHaveText(/^New version available: (click|tap|click or tap) to update$/);

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
    // The resize handling makes the canvas fill the new viewport (any aspect ratio; no
    // safe-area insets in the test browsers)
    await expect.poll(async () => {
      const v = await hook(page, 'view');
      const inner = await page.evaluate(() => [window.innerWidth, window.innerHeight]);
      return v.width === Math.floor(inner[0]) && v.height === Math.floor(inner[1]);
    }).toBe(true);

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

// --- Install feedback -------------------------------------------------------------------
// Chrome's real install prompt cannot be driven from a test, so a fake beforeinstallprompt
// event is dispatched. `outcome` is what the fake prompt's userChoice resolves with.
async function fakeInstallPrompt(page, outcome = 'accepted') {
  await page.evaluate((result) => {
    const ev = new Event('beforeinstallprompt', { cancelable: true });
    ev.prompt = () => { window.__promptCalls = (window.__promptCalls || 0) + 1; return Promise.resolve(); };
    ev.userChoice = Promise.resolve({ outcome: result, platform: 'web' });
    window.dispatchEvent(ev);
  }, outcome);
}

test.describe('Install feedback', () => {
  test('Install: accepted shows "Installing…", appinstalled shows where to find the app', async ({ page }) => {
    const errors = await openFresh(page, { url: './' });
    await loginWithKeyboard(page, 'INSTALLER');
    const btn = page.locator('#app-install-btn');
    const notice = page.locator('#install-notice');
    await expect(btn).toBeHidden(); // no prompt from the browser yet
    await expect(notice).toBeHidden();

    await fakeInstallPrompt(page, 'accepted');
    await expect(btn).toBeVisible();
    await btn.click();
    expect(await page.evaluate(() => window.__promptCalls)).toBe(1);
    await expect(btn).toBeHidden();
    await expect(notice).toBeVisible();
    await expect(notice).toContainText('Installing… Space Adventure will appear on your home screen or in your app list');
    expect(await hook(page, 'pwa.installNotice')).toBe('installing');

    await page.evaluate(() => window.dispatchEvent(new Event('appinstalled')));
    await expect(notice).toContainText('Installed. Open Space Adventure from your home screen or app drawer');
    expect(await page.evaluate(() => localStorage.getItem('spaceAdventure_appInstalled'))).toBe('1');

    // Closing it leaves an "Open the app" button with the same guidance
    await page.locator('#install-notice-dismiss').click();
    await expect(notice).toBeHidden();
    const open = page.locator('#app-open-btn');
    await expect(open).toBeVisible();
    await open.click();
    await expect(notice).toContainText('Space Adventure is installed on this device');

    // Never during play
    await page.keyboard.press('Enter');
    await waitForState(page, 'playing');
    await expect(notice).toBeHidden();
    expect(errors).toEqual([]);
  });

  test('Install: dismissed explains how to install later', async ({ page }) => {
    await openFresh(page, { url: './' });
    await loginWithKeyboard(page, 'NOTNOW');
    await fakeInstallPrompt(page, 'dismissed');
    await page.locator('#app-install-btn').click();
    await expect(page.locator('#app-install-btn')).toBeHidden();
    await expect(page.locator('#install-notice')).toContainText('Not installed. To install later, use the browser menu');
  });

  test('installed earlier, opened in a browser tab: "Open the app" instead of Install', async ({ page }) => {
    await openFresh(page, { url: './', storage: { spaceAdventure_appInstalled: '1' } });
    await loginWithKeyboard(page, 'TABBER');
    await expect(page.locator('#app-install-btn')).toBeHidden();
    await expect(page.locator('#app-open-btn')).toBeVisible();
    expect(await hook(page, 'pwa.installButton')).toBe('open-app');
    // Chrome offering install again means the app was removed: Install comes back
    await fakeInstallPrompt(page, 'accepted');
    await expect(page.locator('#app-install-btn')).toBeVisible();
    await expect(page.locator('#app-open-btn')).toBeHidden();
  });

  test('inside the installed app (display-mode standalone): no install UI at all', async ({ page }) => {
    await page.addInitScript(() => {
      const real = window.matchMedia.bind(window);
      window.matchMedia = (q) => (q === '(display-mode: standalone)'
        ? { matches: true, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} }
        : real(q));
    });
    await openFresh(page, { url: './' });
    await loginWithKeyboard(page, 'INAPP');
    await fakeInstallPrompt(page, 'accepted');
    await page.evaluate(() => window.dispatchEvent(new Event('appinstalled')));
    await frames(page, 3);
    await expect(page.locator('#app-install-btn')).toBeHidden();
    await expect(page.locator('#app-open-btn')).toBeHidden();
    await expect(page.locator('#install-notice')).toBeHidden();
    expect(await hook(page, 'pwa.standalone')).toBe(true);
  });

  test('keyboard: Tab to the Install button and press Enter opens the prompt', async ({ page }) => {
    await openFresh(page, { url: './' });
    await loginWithKeyboard(page, 'TABKEY');
    await fakeInstallPrompt(page, 'accepted');
    const btn = page.locator('#app-install-btn');
    await expect(btn).toBeVisible();
    await btn.focus();
    await page.keyboard.press('Enter');
    await expect.poll(() => page.evaluate(() => window.__promptCalls || 0)).toBe(1);
    expect(await hook(page, 'state')).toBe('menu'); // Enter did not also start a game
  });
});
