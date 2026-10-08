// Switching between 2D and 3D from the menus (docs/plans/07-3d-game.md §4): the "Start 3D"
// row (first and default where 3D runs), the remembered mode, ?2d=1, and the High Scores
// 2D / 3D boards. Automated browsers only see 3D with ?force3d=1 (js/mode3d.js can3d), so
// the rest of the 2D suite keeps the classic menu.
import { test, expect } from '@playwright/test';
import { openFresh, hook, loginWithKeyboard, waitForState, selectMenuRow, drawnTexts, tapRegionCenter, MENU } from './helpers.js';

const LAST_MODE = 'spaceAdventure_lastMode';
const lastMode = (page) => page.evaluate((k) => localStorage.getItem(k), LAST_MODE);

test('without ?force3d an automated browser keeps the classic menu (Start first)', async ({ page }) => {
  const errors = await openFresh(page);
  await loginWithKeyboard(page);
  expect(await hook(page, 'threeDAvailable')).toBe(false);
  const options = await hook(page, 'menuOptions');
  expect(options[0]).toBe('Start');
  expect(options).not.toContain('Start 3D');
  expect(errors).toEqual([]);
});

test('Start 3D is the first row and the default; Enter opens the 3D page and remembers it', async ({ page }) => {
  const errors = await openFresh(page, { url: '/?force3d=1' });
  await loginWithKeyboard(page);
  expect(await hook(page, 'threeDAvailable')).toBe(true);
  const options = await hook(page, 'menuOptions');
  expect(options[0]).toBe('Start 3D');
  expect(options[1]).toBe('Start');
  expect(options.length).toBe(11);
  expect(await hook(page, 'menuIndex')).toBe(0);
  expect(errors).toEqual([]);
  await Promise.all([
    page.waitForURL(/[?&]3d=1/, { timeout: 10000 }),
    page.keyboard.press('Enter'),
  ]);
  expect(await lastMode(page)).toBe('3d');
});

test('Start (2D) remembers 2D; ?2d=1 forgets the last mode; a browser tab never auto-opens 3D', async ({ page }) => {
  const errors = await openFresh(page, { url: '/?force3d=1', storage: { [LAST_MODE]: '3d' } });
  // Not an installed app: the 2D page stays even though the last mode was 3D
  await loginWithKeyboard(page);
  expect(new URL(page.url()).searchParams.get('3d')).toBeNull();
  await selectMenuRow(page, 1); // Start (2D) below Start 3D
  await page.keyboard.press('Enter');
  await waitForState(page, 'playing');
  expect(await lastMode(page)).toBe('2d');
  await page.evaluate((k) => localStorage.setItem(k, '3d'), LAST_MODE);
  await page.goto('/?2d=1');
  await page.waitForFunction(() => window.__spaceAdventure && typeof window.__spaceAdventure.state === 'string');
  expect(await lastMode(page)).toBeNull();
  expect(errors).toEqual([]);
});

test('High Scores: LEFT/RIGHT and the top button switch between the 2D and 3D boards', async ({ page }) => {
  const errors = await openFresh(page, {
    recordText: true,
    storage: {
      asteroids_highScores_TESTER: JSON.stringify([{ name: 'TES', score: 1234 }]),
      asteroids_highScores3d_TESTER: JSON.stringify([{ name: 'TES', score: 777, level: 2 }]),
    },
  });
  await loginWithKeyboard(page);
  // No 3D on this browser, but a 3D score exists: the switch shows
  await selectMenuRow(page, MENU.HIGH_SCORES);
  await page.keyboard.press('Enter');
  await waitForState(page, 'high_scores');
  expect(await hook(page, 'highScoresBoard')).toBe('2d');
  let texts = await drawnTexts(page);
  expect(texts).toContain('HIGH SCORES (ALL USERS)');
  expect(texts).toContain('1234');
  expect(texts).not.toContain('777');
  await page.keyboard.press('ArrowRight');
  await expect.poll(() => hook(page, 'highScoresBoard')).toBe('3d');
  texts = await drawnTexts(page);
  expect(texts).toContain('3D HIGH SCORES (ALL USERS)');
  expect(texts).toContain('777');
  expect(texts).not.toContain('1234');
  // The top button switches back
  const regions = await hook(page, 'tapRegions');
  const i = regions.findIndex((r) => r.id === 'highScores:board');
  expect(i).toBeGreaterThanOrEqual(0);
  const pt = await tapRegionCenter(page, i);
  await page.mouse.click(pt.x, pt.y);
  await expect.poll(() => hook(page, 'highScoresBoard')).toBe('2d');
  expect(await hook(page, 'state')).toBe('high_scores');
  await page.keyboard.press('Escape');
  await waitForState(page, 'menu');
  expect(await hook(page, 'highScoresBoard')).toBe('2d');
  expect(errors).toEqual([]);
});

test('High Scores without 3D and without 3D scores: no switch, LEFT/RIGHT do nothing', async ({ page }) => {
  await openFresh(page);
  await loginWithKeyboard(page);
  await selectMenuRow(page, MENU.HIGH_SCORES);
  await page.keyboard.press('Enter');
  await waitForState(page, 'high_scores');
  await page.keyboard.press('ArrowRight');
  await page.waitForTimeout(150);
  expect(await hook(page, 'highScoresBoard')).toBe('2d');
  const regions = await hook(page, 'tapRegions');
  expect(regions.some((r) => r.id === 'highScores:board')).toBe(false);
});

test('the hook lists the main menu rows as soon as the state is menu (no wait for the first menu frame)', async ({ page }) => {
  const errors = await openFresh(page, { url: '/?force3d=1', storage: { asteroids_currentUser: 'TESTER', asteroids_userList: JSON.stringify(['TESTER']) } });
  // Read in the same task that first sees 'menu': before any menu frame could have drawn
  const options = await page.evaluate(() => new Promise((resolve) => {
    const check = () => {
      const h = window.__spaceAdventure;
      if (h && h.state === 'menu') resolve(h.menuOptions);
      else setTimeout(check, 0);
    };
    check();
  }));
  expect(options[0]).toBe('Start 3D');
  expect(options).toContain('Start');
  // The same rows the menu draws and selects (currentMenuOptions once it has drawn)
  await waitForState(page, 'menu');
  expect(await hook(page, 'menuOptions')).toEqual(options);
  expect(errors).toEqual([]);
});
