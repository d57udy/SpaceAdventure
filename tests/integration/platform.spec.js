// Platform integration: the Back button (history), window blur, the context menu, the screen
// wake lock, hybrid touch + keyboard devices and Unicode player names.
// Desktop project (keyboard) and the touch projects (hybrid tests).
import { test, expect } from '@playwright/test';
import {
  MENU, openFresh, hook, waitForState, loginWithKeyboard, loginWithTouch, tapMenuItem, selectMenuRow, frames,
  drawnTexts,
} from './helpers.js';

const isGuard = (page) => page.evaluate(() => !!(history.state && history.state.spaceAdventureBack));

/** Stub the Screen Wake Lock API (a browser API stub, never game state). */
async function stubWakeLock(page) {
  await page.addInitScript(() => {
    window.__wake = { requests: 0, releases: 0, held: 0 };
    const wakeLock = {
      request(type) {
        window.__wake.requests++;
        window.__wake.held++;
        const listeners = [];
        return Promise.resolve({
          type, released: false,
          addEventListener(t, fn) { if (t === 'release') listeners.push(fn); },
          release() {
            this.released = true;
            window.__wake.releases++;
            window.__wake.held--;
            listeners.forEach((fn) => fn());
            return Promise.resolve();
          },
        });
      },
    };
    Object.defineProperty(navigator, 'wakeLock', { configurable: true, value: wakeLock });
  });
}
const wake = (page) => page.evaluate(() => ({ ...window.__wake }));

async function startWithKeyboard(page) {
  expect(await hook(page, 'menuIndex')).toBe(MENU.START);
  await page.keyboard.press('Enter');
  await waitForState(page, 'playing');
}

test.describe('platform: desktop keyboard', () => {
  test.beforeEach(async ({}, testInfo) => {
    test.skip(!!testInfo.project.use.hasTouch, 'desktop project');
  });

  test('Back from Settings returns to the menu; the URL never changes', async ({ page }) => {
    const errors = await openFresh(page);
    await loginWithKeyboard(page, 'BACKNAV');
    const url = page.url();
    expect(await isGuard(page)).toBe(false); // the main menu has no guard entry
    await selectMenuRow(page, MENU.SETTINGS);
    await page.keyboard.press('Enter');
    await waitForState(page, 'settings');
    await expect.poll(() => isGuard(page)).toBe(true);
    expect(page.url()).toBe(url);
    await page.goBack({ waitUntil: 'commit' });
    await waitForState(page, 'menu');
    expect(page.url()).toBe(url);
    expect(await hook(page, 'backNav.guarded')).toBe(false);
    // Help the same way, then its own Escape: the guard is removed again
    await selectMenuRow(page, MENU.HELP);
    await page.keyboard.press('Enter');
    await waitForState(page, 'help');
    await expect.poll(() => isGuard(page)).toBe(true);
    await page.keyboard.press('Escape');
    await waitForState(page, 'menu');
    await expect.poll(() => isGuard(page)).toBe(false);
    expect(page.url()).toBe(url);
    expect(errors).toEqual([]);
  });

  test('Back in play pauses, and a second Back stays paused in the game', async ({ page }) => {
    const errors = await openFresh(page);
    await loginWithKeyboard(page, 'BACKPLAY');
    const url = page.url();
    await startWithKeyboard(page);
    await expect.poll(() => isGuard(page)).toBe(true);
    await page.goBack({ waitUntil: 'commit' });
    await waitForState(page, 'paused');
    await expect.poll(() => isGuard(page)).toBe(true); // pushed again
    // A key press first: Chromium skips history entries added without a user activation
    // since the last navigation (the re-pushed guard), as a real user's tap would give one
    await page.keyboard.press('ArrowDown');
    await frames(page, 3);
    await page.goBack({ waitUntil: 'commit' });
    await frames(page, 3);
    expect(await hook(page, 'state')).toBe('paused');
    expect(page.url()).toBe(url);
    expect(await hook(page, 'pausedGameExists')).toBe(false);
    expect(errors).toEqual([]);
  });

  test('window blur pauses a running game', async ({ page }) => {
    await openFresh(page);
    await loginWithKeyboard(page, 'BLURRY');
    await startWithKeyboard(page);
    await page.evaluate(() => window.dispatchEvent(new Event('blur')));
    await waitForState(page, 'paused');
    await page.keyboard.press('Escape'); // resume
    await waitForState(page, 'playing');
  });

  test('the context menu is suppressed on the canvas and the touch controls', async ({ page }) => {
    await openFresh(page);
    await loginWithKeyboard(page, 'RIGHTCLK');
    const prevented = await page.evaluate(() => ['#gameCanvas', '.touch-controls'].map((sel) => {
      const e = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
      document.querySelector(sel).dispatchEvent(e);
      return e.defaultPrevented;
    }));
    expect(prevented).toEqual([true, true]);
  });

  test('the screen wake lock is held while playing and released on pause', async ({ page }) => {
    await stubWakeLock(page);
    await openFresh(page);
    await loginWithKeyboard(page, 'AWAKE');
    expect((await wake(page)).requests).toBe(0);
    await startWithKeyboard(page);
    await expect.poll(async () => (await wake(page)).held).toBe(1);
    await page.keyboard.press('Escape');
    await waitForState(page, 'paused');
    await expect.poll(async () => (await wake(page)).held).toBe(0);
    await page.keyboard.press('Escape');
    await waitForState(page, 'playing');
    await expect.poll(async () => (await wake(page)).held).toBe(1);
    expect((await wake(page)).requests).toBe(2);
  });

  test('Unicode names are accepted, upper-cased and remembered', async ({ page }) => {
    const errors = await openFresh(page);
    await waitForState(page, 'prompt_user');
    const input = page.locator('#username-input');
    await input.fill('Jürgen');
    await expect(input).toHaveValue('JÜRGEN');
    await page.locator('#username-submit').click();
    await waitForState(page, 'menu');
    expect(await hook(page, 'user')).toBe('JÜRGEN');
    await page.reload();
    await page.waitForFunction(() => window.__spaceAdventure && window.__spaceAdventure.state === 'menu');
    expect(await hook(page, 'user')).toBe('JÜRGEN');
    expect(errors).toEqual([]);
  });

  test('Help lists every fire key', async ({ page }) => {
    await openFresh(page, { recordText: true });
    await loginWithKeyboard(page, 'HELPER');
    await selectMenuRow(page, MENU.HELP);
    await page.keyboard.press('Enter');
    await waitForState(page, 'help');
    expect(await drawnTexts(page)).toContain('Space, F or Enter');
  });
});

test.describe('platform: hybrid touch + keyboard', () => {
  test.beforeEach(async ({}, testInfo) => {
    test.skip(!testInfo.project.use.hasTouch, 'touch-capable projects');
  });

  test('a key press hides the touch controls until the next touch', async ({ page }) => {
    const errors = await openFresh(page);
    await loginWithTouch(page, 'HYBRID');
    await tapMenuItem(page, 'Start');
    await waitForState(page, 'playing');
    const fire = page.locator('#touch-fire-btn');
    await expect(fire).toBeVisible();
    expect(await hook(page, 'touchUi')).toBe(true);
    await page.keyboard.press('ArrowLeft');
    await expect.poll(() => hook(page, 'lastInputSource')).toBe('keyboard');
    await expect(page.locator('body')).toHaveClass(/input-keyboard/);
    await expect(page.locator('body')).toHaveClass(/touch-enabled/); // still a touch device
    await expect(fire).toBeHidden();
    expect(await hook(page, 'touchUi')).toBe(false);
    // A touch on the canvas brings them back
    const c = await page.locator('#gameCanvas').boundingBox();
    await page.touchscreen.tap(c.x + c.width * 0.75, c.y + c.height / 2);
    await expect.poll(() => hook(page, 'lastInputSource')).toBe('touch');
    await expect(page.locator('body')).not.toHaveClass(/input-keyboard/);
    await expect(fire).toBeVisible();
    expect(errors).toEqual([]);
  });

  test('typing on a keyboard at the name prompt focuses the field', async ({ page }) => {
    await openFresh(page);
    await waitForState(page, 'prompt_user');
    const input = page.locator('#username-input');
    await expect(input).not.toBeFocused(); // touch devices: no autofocus
    await page.keyboard.press('k');
    await expect(input).toBeFocused();
    await page.keyboard.type('eys', { delay: 20 });
    await expect(input).toHaveValue('KEYS');
    await page.keyboard.press('Enter');
    await waitForState(page, 'menu');
    expect(await hook(page, 'user')).toBe('KEYS');
  });
});
