// Installable-app DOM (Item 3) on the regular projects (service workers blocked):
// iOS "Add to Home Screen" hint, Full screen buttons (app bar, in-game, Settings row),
// what is hidden during play and when the Fullscreen API is missing (iPhone).
import { test, expect } from '@playwright/test';
import {
  openFresh, hook, waitForState, loginWithKeyboard, loginWithTouch, tapMenuItem, tapAt, frames,
  centerOf, rectsOverlap, canvasToPage, settingsRowIndex,
} from './helpers.js';

const IOS_HINT_KEY = 'spaceAdventure_a2hsHintDismissed';

/** Log in with the device's own input. */
async function login(page, testInfo, name) {
  if (testInfo.project.use.hasTouch) await loginWithTouch(page, name);
  else await loginWithKeyboard(page, name);
}

/** Start a game from the menu with the device's own input. */
async function startGame(page, testInfo) {
  if (testInfo.project.use.hasTouch) await tapMenuItem(page, 'Start');
  else await page.keyboard.press('Enter');
  await waitForState(page, 'playing');
}

/** Make the Fullscreen API unavailable before load, as on iPhone Safari (a browser API stub). */
async function withoutFullscreenApi(page) {
  await page.addInitScript(() => {
    for (const name of ['fullscreenEnabled', 'webkitFullscreenEnabled']) {
      Object.defineProperty(Document.prototype, name, { configurable: true, get: () => false });
    }
  });
}

test.describe('iOS "Add to Home Screen" hint', () => {
  test.beforeEach(async ({}, testInfo) => {
    test.skip(!testInfo.project.name.startsWith('ipad-webkit'), 'iPad Safari user agent only');
  });

  test('shown in the menu with the storage note; never during play', async ({ page }, testInfo) => {
    const errors = await openFresh(page);
    await waitForState(page, 'prompt_user');
    expect(await hook(page, 'pwa.isIos')).toBe(true);
    await expect(page.locator('#ios-hint')).toBeHidden(); // only in the menu

    await login(page, testInfo, 'IPADDY');
    const hint = page.locator('#ios-hint');
    await expect(hint).toBeVisible();
    await expect(hint).toContainText('tap Share, then');
    await expect(hint).toContainText('Add to Home Screen');
    await expect(hint).toContainText('Scores and credits don’t carry over from Safari to the installed app');
    await expect(page.locator('#app-a2hs-btn')).toBeVisible();
    expect(await hook(page, 'pwa.iosHintVisible')).toBe(true);

    await startGame(page, testInfo);
    await expect(hint).toBeHidden();
    await expect(page.locator('#app-bar')).toBeHidden();
    expect(await hook(page, 'pwa.iosHintVisible')).toBe(false);
    expect(errors).toEqual([]);
  });

  test('dismissal is remembered across reloads; the app bar button shows it again', async ({ page }, testInfo) => {
    await openFresh(page);
    await login(page, testInfo, 'DISMISS');
    const hint = page.locator('#ios-hint');
    await expect(hint).toBeVisible();
    await page.locator('#ios-hint-dismiss').tap();
    await expect(hint).toBeHidden();
    expect(await hook(page, 'state')).toBe('menu'); // the tap did not reach the menu
    expect(await page.evaluate((k) => localStorage.getItem(k), IOS_HINT_KEY)).toBe('1');

    await page.reload();
    await waitForState(page, 'menu');
    await frames(page, 3);
    await expect(hint).toBeHidden();
    expect(await hook(page, 'pwa.iosHintVisible')).toBe(false);

    // Still reachable on demand
    await page.locator('#app-a2hs-btn').tap();
    await expect(hint).toBeVisible();
    await page.locator('#ios-hint-dismiss').tap();
    await expect(hint).toBeHidden();
  });
});

test('not iOS: no Add to Home Screen hint or button', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name.startsWith('ipad-webkit'), 'non-iOS projects');
  await openFresh(page);
  await login(page, testInfo, 'NOTIOS');
  await frames(page, 3);
  expect(await hook(page, 'pwa.isIos')).toBe(false);
  await expect(page.locator('#ios-hint')).toBeHidden();
  await expect(page.locator('#app-a2hs-btn')).toBeHidden();
});

test('Full screen is hidden everywhere when the Fullscreen API is missing (iPhone)', async ({ page }, testInfo) => {
  await withoutFullscreenApi(page);
  const errors = await openFresh(page);
  await login(page, testInfo, 'NOFULL');
  expect(await hook(page, 'pwa')).toMatchObject({ fullscreenSupported: false, fullscreenButtonVisible: false });
  await expect(page.locator('#app-fullscreen-btn')).toBeHidden();
  await startGame(page, testInfo);
  await expect(page.locator('#game-fullscreen-btn')).toBeHidden();
  expect(errors).toEqual([]);
});

test('no Full screen Settings row without the Fullscreen API', async ({ page }, testInfo) => {
  await withoutFullscreenApi(page);
  await openFresh(page);
  await login(page, testInfo, 'NOROW');
  if (testInfo.project.use.hasTouch) await tapMenuItem(page, 'Settings');
  else {
    const target = (await hook(page, 'menuOptions')).indexOf('Settings');
    for (let i = 1; i <= target; i++) {
      await page.keyboard.press('ArrowDown');
      await expect.poll(() => hook(page, 'menuIndex')).toBe(i);
    }
    await page.keyboard.press('Enter');
  }
  await waitForState(page, 'settings');
  expect((await hook(page, 'settingsRows')).map((r) => r.id)).not.toContain('fullscreen');
  await expect(page.locator('#settings-fullscreen-btn')).toBeHidden();
});

test('app bar, iOS hint and toast never cover a menu row; hidden during play', async ({ page }, testInfo) => {
  await openFresh(page);
  await login(page, testInfo, 'NOCOVER');
  await frames(page, 3);
  const ui = await hook(page, 'pwa.ui');
  expect(ui.appBar).toBe(true);
  // Menu rows stay tappable: no app button or hint covers a tap region's centre
  const regions = await hook(page, 'tapRegions');
  for (let i = 0; i < regions.length; i++) {
    const r = regions[i];
    const p = await canvasToPage(page, r.x + r.w / 2, r.y + r.h / 2);
    const covered = await page.evaluate(([x, y]) => !!document.elementFromPoint(x, y)?.closest('.app-bar, .app-notices'), [p.x, p.y]);
    expect(covered, `menu row ${i} covered`).toBe(false);
  }
  await startGame(page, testInfo);
  await expect(page.locator('#app-bar')).toBeHidden();
  await expect(page.locator('#app-notices')).toBeHidden();
});

test.describe('Full screen buttons (touch)', () => {
  test.beforeEach(async ({ page }, testInfo) => {
    test.skip(!testInfo.project.use.hasTouch, 'touch projects');
    await openFresh(page);
    test.skip(!(await hook(page, 'pwa.fullscreenSupported')), 'this browser has no Fullscreen API');
    await loginWithTouch(page, 'FSTOUCH');
  });

  test('in-game toggle sits in the top-right cluster, hit-tests to itself and is not a data-action button', async ({ page }, testInfo) => {
    await startGame(page, testInfo);
    const btn = page.locator('#game-fullscreen-btn');
    await expect(btn).toBeVisible();
    expect(await btn.evaluate((el) => el.parentElement.classList.contains('touch-top'))).toBe(true);
    expect(await btn.getAttribute('data-action')).toBeNull();
    expect(await btn.evaluate((el) => el.classList.contains('app-btn'))).toBe(true);
    const box = await btn.boundingBox();
    for (const sel of ['#touch-mute-btn', '#touch-pause-btn']) {
      expect(rectsOverlap(box, await page.locator(sel).boundingBox()), `overlaps ${sel}`).toBe(false);
    }
    const c = await centerOf(page, '#game-fullscreen-btn');
    expect(await page.evaluate(([x, y]) => document.elementFromPoint(x, y)?.closest('#game-fullscreen-btn') !== null, [c.x, c.y])).toBe(true);

    // Tapping it neither pauses nor fires; it toggles full screen where the browser allows it
    await btn.tap();
    await frames(page, 5);
    expect(await hook(page, 'state')).toBe('playing');
    const entered = await page.evaluate(() => !!(document.fullscreenElement || document.webkitFullscreenElement));
    if (entered) {
      expect(await hook(page, 'pwa.fullscreen')).toBe(true);
      await expect(btn).toHaveAttribute('aria-label', 'Exit full screen');
      await btn.tap();
      await expect.poll(() => page.evaluate(() => !!(document.fullscreenElement || document.webkitFullscreenElement))).toBe(false);
    }
  });

  test('the Settings row overlay covers exactly the "Full screen" row', async ({ page }) => {
    await tapMenuItem(page, 'Settings');
    await waitForState(page, 'settings');
    const index = await settingsRowIndex(page, 'fullscreen');
    const r = (await hook(page, 'tapRegions'))[index];
    const topLeft = await canvasToPage(page, r.x, r.y);
    const bottomRight = await canvasToPage(page, r.x + r.w, r.y + r.h);
    const box = await page.locator('#settings-fullscreen-btn').boundingBox();
    expect(Math.abs(box.x - topLeft.x)).toBeLessThan(2);
    expect(Math.abs(box.y - topLeft.y)).toBeLessThan(2);
    expect(Math.abs(box.x + box.width - bottomRight.x)).toBeLessThan(2);
    expect(Math.abs(box.y + box.height - bottomRight.y)).toBeLessThan(2);
    // Other rows are not covered
    const back = (await hook(page, 'tapRegions'))[await settingsRowIndex(page, 'back')];
    const p = await canvasToPage(page, back.x + back.w / 2, back.y + back.h / 2);
    expect(await page.evaluate(([x, y]) => document.elementFromPoint(x, y)?.id, [p.x, p.y])).toBe('gameCanvas');
    // Leaving Settings hides it
    await tapAt(page, p);
    await waitForState(page, 'menu');
    await expect(page.locator('#settings-fullscreen-btn')).toBeHidden();
  });
});
