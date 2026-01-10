import { test, expect } from '@playwright/test';

test.describe('Level System', () => {

  test('shows level notification on game start', async ({ page }) => {
    // Navigate to game - Playwright uses fresh context per test (no localStorage)
    await page.goto('/');

    // Wait for game to fully initialize
    await page.waitForTimeout(1000);

    // Focus on page for keyboard input (like working tests do)
    await page.click('body');

    // Type username - slower typing with delays between chars
    await page.keyboard.type('LevelTst', { delay: 100 });

    await page.keyboard.press('Enter');

    // Wait for menu to appear
    await page.waitForTimeout(500);

    // Start the game (menu index 0 = Start should be selected)
    await page.keyboard.press('Enter');

    // Wait for level notification to appear
    await page.waitForTimeout(400);

    // Take screenshot showing level notification
    await page.screenshot({ path: 'tests/screenshots/level-notification.png' });
  });

  test('shows asteroid count during gameplay', async ({ page }) => {
    // Navigate to game
    await page.goto('/');

    // Wait for game to fully initialize
    await page.waitForTimeout(1000);

    // Focus on page
    await page.click('body');

    // Type username with delay
    await page.keyboard.type('AstCount', { delay: 100 });

    await page.keyboard.press('Enter');

    // Wait for menu
    await page.waitForTimeout(500);

    // Start the game
    await page.keyboard.press('Enter');

    // Wait for level notification to fade (3+ seconds)
    await page.waitForTimeout(4000);

    // Take screenshot showing asteroid count
    await page.screenshot({ path: 'tests/screenshots/asteroid-count.png' });
  });

});
