// The 3D game on WebKit (iPad landscape): too slow without a GPU for gameplay, so only what a
// visitor sees first (docs/plans/07-3d-game.md §6.4): the 3D menus appear, or, without WebGL 2,
// a message and then the 2D game; and the 2D menu's Start 3D row follows its rules.
import { test, expect } from '@playwright/test';
import { openFresh, hook, loginWithKeyboard } from './helpers.js';

const T = 60000;

test('?3d=1 shows the 3D menus, or without WebGL 2 says so and opens the 2D game', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (err) => errors.push(err.message));
  await page.goto('/?3d=1&lowres3d=1');
  await page.waitForFunction(() => window.__spaceAdventure && window.__spaceAdventure.game3d
    && window.__spaceAdventure.game3d.ui, null, { timeout: T });
  const g = await page.evaluate(() => window.__spaceAdventure.game3d);
  if (g.loaded) {
    // A fresh device: the name screen first, then the 3D menu as a guest
    expect(g.ui.screen).toBe('profile');
    await page.locator('[data-u3d="guest"]').click();
    await expect.poll(() => page.evaluate(() => window.__spaceAdventure.game3d.ui.screen), { timeout: T }).toBe('menu');
    await expect(page.locator('[data-u3d="play"]')).toBeVisible();
    await expect(page.locator('[data-u3d="switch2d"]')).toBeVisible();
  } else {
    expect(g.error).toBeTruthy();
    expect(g.ui.screen).toBe('prompt');
    await expect(page.locator('#u3d')).toContainText('WebGL 2');
    await Promise.all([
      page.waitForURL(/[?&]2d=1/, { timeout: T }),
      page.locator('[data-u3d="prompt-ok"]').click(),
    ]);
    await page.waitForFunction(() => window.__spaceAdventure && typeof window.__spaceAdventure.state === 'string', null, { timeout: T });
  }
  expect(errors).toEqual([]);
});

test('2D menu: no Start 3D for an automated browser', async ({ page }) => {
  const errors = await openFresh(page);
  await loginWithKeyboard(page);
  expect(await hook(page, 'menuOptions')).not.toContain('Start 3D');
  expect(errors).toEqual([]);
});

test('2D menu with ?force3d=1: Start 3D is the first row', async ({ page }) => {
  const errors = await openFresh(page, { url: '/?force3d=1' });
  await loginWithKeyboard(page);
  expect((await hook(page, 'menuOptions'))[0]).toBe('Start 3D');
  expect(errors).toEqual([]);
});
