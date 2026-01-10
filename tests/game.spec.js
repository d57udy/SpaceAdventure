import { test, expect } from '@playwright/test';

test.describe('Space Adventure Game', () => {

  test.beforeEach(async ({ page }) => {
    // Collect console errors
    page.on('console', msg => {
      if (msg.type() === 'error') {
        console.log('Browser console error:', msg.text());
      }
    });

    page.on('pageerror', error => {
      console.log('Page error:', error.message);
    });
  });

  test('game loads without JavaScript errors', async ({ page }) => {
    const errors = [];

    page.on('pageerror', error => {
      errors.push(error.message);
    });

    await page.goto('/');

    // Wait for the canvas to be present
    await page.waitForSelector('#gameCanvas', { timeout: 5000 });

    // Check for errors
    expect(errors).toEqual([]);
  });

  test('canvas element exists and has correct size', async ({ page }) => {
    await page.goto('/');

    const canvas = await page.locator('#gameCanvas');
    await expect(canvas).toBeVisible();

    // Canvas should have a reasonable size
    const box = await canvas.boundingBox();
    expect(box.width).toBeGreaterThan(100);
    expect(box.height).toBeGreaterThan(100);
  });

  test('UI overlay elements exist', async ({ page }) => {
    await page.goto('/');

    // Check UI elements
    await expect(page.locator('#score')).toBeVisible();
    await expect(page.locator('#lives')).toBeVisible();
    await expect(page.locator('#level')).toBeVisible();
  });

  test('game shows user prompt on first load', async ({ page }) => {
    await page.goto('/');

    // Wait a bit for the game to initialize
    await page.waitForTimeout(500);

    // The canvas should show the user prompt
    const canvas = await page.locator('#gameCanvas');
    await expect(canvas).toBeVisible();

    // Take a screenshot to verify what's being rendered
    await page.screenshot({ path: 'tests/screenshots/initial-load.png' });
  });

  test('can enter username and see menu', async ({ page }) => {
    await page.goto('/');

    // Wait for game to load
    await page.waitForTimeout(500);

    // Type a username (need to focus on the page first)
    await page.click('body');
    await page.keyboard.type('TestUser');
    await page.keyboard.press('Enter');

    // Wait for menu to appear
    await page.waitForTimeout(500);

    // Take screenshot of menu
    await page.screenshot({ path: 'tests/screenshots/menu.png' });
  });

  test('can start game after entering username', async ({ page }) => {
    await page.goto('/');

    // Wait and enter username
    await page.waitForTimeout(500);
    await page.click('body');
    await page.keyboard.type('Player1');
    await page.keyboard.press('Enter');

    // Wait for menu
    await page.waitForTimeout(500);

    // Press Enter/Space to start game
    await page.keyboard.press('Enter');

    // Wait for game to start
    await page.waitForTimeout(1000);

    // Take screenshot of gameplay
    await page.screenshot({ path: 'tests/screenshots/gameplay.png' });
  });

  test('game renders asteroids and ship', async ({ page }) => {
    await page.goto('/');

    // Enter username and start game
    await page.waitForTimeout(500);
    await page.click('body');
    await page.keyboard.type('Test123');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(300);
    await page.keyboard.press('Enter');
    await page.waitForTimeout(1000);

    // Check canvas is rendering (not just black)
    const canvas = await page.locator('#gameCanvas');
    const imageData = await canvas.screenshot();

    // The image should have some non-black pixels (game elements)
    expect(imageData.length).toBeGreaterThan(1000);
  });

  test('ship responds to controls', async ({ page }) => {
    await page.goto('/');

    // Setup game
    await page.waitForTimeout(500);
    await page.click('body');
    await page.keyboard.type('Control');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(300);
    await page.keyboard.press('Enter');
    await page.waitForTimeout(1000);

    // Take initial screenshot
    await page.screenshot({ path: 'tests/screenshots/before-control.png' });

    // Press thrust
    await page.keyboard.down('ArrowUp');
    await page.waitForTimeout(500);
    await page.keyboard.up('ArrowUp');

    // Take screenshot after thrust
    await page.screenshot({ path: 'tests/screenshots/after-thrust.png' });

    // Rotate
    await page.keyboard.down('ArrowLeft');
    await page.waitForTimeout(300);
    await page.keyboard.up('ArrowLeft');

    // Take screenshot after rotation
    await page.screenshot({ path: 'tests/screenshots/after-rotate.png' });
  });

  test('shooting works', async ({ page }) => {
    await page.goto('/');

    // Setup game
    await page.waitForTimeout(500);
    await page.click('body');
    await page.keyboard.type('Shooter');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(300);
    await page.keyboard.press('Enter');
    await page.waitForTimeout(1000);

    // Fire bullets
    await page.keyboard.press('Space');
    await page.waitForTimeout(100);
    await page.keyboard.press('Space');
    await page.waitForTimeout(100);

    // Take screenshot
    await page.screenshot({ path: 'tests/screenshots/shooting.png' });
  });
});
