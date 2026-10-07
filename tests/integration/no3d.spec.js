// 2D isolation: without ?3d=1 the game never loads any 3D file (docs/plans/06-3d-mode.md §3).
// desktop-chromium project (service workers blocked, so the precache does not fetch them either).
import { test, expect } from '@playwright/test';
import { openFresh, frames, loginWithKeyboard, waitForState } from './helpers.js';

test('the 2D game never requests a js/3d/ file', async ({ page }) => {
  const urls = [];
  page.on('request', (r) => urls.push(r.url()));
  const errors = await openFresh(page);
  await loginWithKeyboard(page);
  await waitForState(page, 'menu');
  await page.keyboard.press('Enter'); // Start
  await waitForState(page, 'playing');
  await frames(page, 10);
  expect(urls.some((u) => u.includes('/js/main.js'))).toBe(true);
  expect(urls.filter((u) => u.includes('/js/3d/'))).toEqual([]);
  expect(await page.evaluate(() => 'game3d' in window.__spaceAdventure)).toBe(false);
  expect(errors).toEqual([]);
});
