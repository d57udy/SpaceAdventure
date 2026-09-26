// Smoke tests: run on every project (desktop and touch).
import { test, expect } from '@playwright/test';
import { openFresh, snap, hook, waitForState } from './helpers.js';

test.describe('smoke', () => {
  test('loads without page errors and exposes the test hook', async ({ page }) => {
    const errors = await openFresh(page);
    await waitForState(page, 'prompt_user');
    // Let a few frames run so errors in the game loop surface
    await page.waitForFunction(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(true)))));
    const s = await snap(page);
    expect(s.user).toBeNull();
    expect(s.lives).toBeGreaterThan(0);
    expect(s.world.width).toBeGreaterThan(0);
    expect(errors).toEqual([]);
  });

  test('canvas is square, visible and fits the viewport', async ({ page }) => {
    await openFresh(page);
    const canvas = page.locator('#gameCanvas');
    await expect(canvas).toBeVisible();
    const box = await canvas.boundingBox();
    const vp = page.viewportSize();
    expect(box.width).toBeGreaterThan(300);
    expect(Math.abs(box.width - box.height)).toBeLessThanOrEqual(1);
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.y).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(vp.width);
    expect(box.y + box.height).toBeLessThanOrEqual(vp.height);
  });

  test('HUD overlay and username prompt are shown on first load', async ({ page }) => {
    await openFresh(page);
    await expect(page.locator('#score')).toHaveText('Score: 0');
    await expect(page.locator('#lives')).toBeVisible();
    await expect(page.locator('#level')).toHaveText('Level: 1');
    await expect(page.locator('#user-prompt')).toBeVisible();
    await expect(page.locator('#username-input')).toBeVisible();
    await expect(page.locator('#username-submit')).toBeVisible();
  });

  test('touch detection matches the device type', async ({ page }, testInfo) => {
    await openFresh(page);
    const touch = !!testInfo.project.use.hasTouch;
    expect(await hook(page, 'isTouchDevice')).toBe(touch);
    if (touch) await expect(page.locator('body')).toHaveClass(/touch-enabled/);
    else await expect(page.locator('body')).not.toHaveClass(/touch-enabled/);
    // Touch controls are never visible before playing
    await expect(page.locator('.touch-controls')).toBeHidden();
  });

  test('rejects too-short usernames and stays on the prompt', async ({ page }) => {
    await openFresh(page);
    await waitForState(page, 'prompt_user');
    await page.locator('#username-input').fill('AB');
    await page.locator('#username-submit').click();
    await expect(page.locator('#username-error')).toContainText('at least 3');
    expect(await hook(page, 'state')).toBe('prompt_user');
  });

  test('sanitizes username input to A-Z0-9 uppercase, max 10 chars', async ({ page }) => {
    await openFresh(page);
    await waitForState(page, 'prompt_user');
    const input = page.locator('#username-input');
    await input.focus();
    await page.keyboard.type('ab-c d_1!23456789');
    await expect(input).toHaveValue('ABCD123456');
    await page.locator('#username-submit').click();
    await waitForState(page, 'menu');
    expect(await hook(page, 'user')).toBe('ABCD123456');
  });

  test('remembers the user across reloads', async ({ page }) => {
    await openFresh(page);
    await waitForState(page, 'prompt_user');
    await page.locator('#username-input').fill('REMEMBER');
    await page.locator('#username-submit').click();
    await waitForState(page, 'menu');
    await page.reload();
    await page.waitForFunction(() => window.__spaceAdventure && window.__spaceAdventure.state === 'menu');
    expect(await hook(page, 'user')).toBe('REMEMBER');
    await expect(page.locator('#user-prompt')).toBeHidden();
  });
});
