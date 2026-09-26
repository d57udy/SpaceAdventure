// Settings screen: keyboard (desktop) and touch (tablet projects).
import { test, expect } from '@playwright/test';
import {
  MENU, SETTINGS_ROWS_DESKTOP, SETTINGS_ROWS_TOUCH, CONTROL_MODE_KEY, PALETTE_KEY, MUTED_KEY,
  CONTROL_LABELS, PALETTE_LABELS, openFresh, hook, snap, waitForState, loginWithKeyboard, loginWithTouch,
  tapMenuItem, tapAt, tapRegionCenter, tapRegionPoint, settingsRowIndex, drawnTexts, frames,
} from './helpers.js';

const stored = (page, key) => page.evaluate((k) => localStorage.getItem(k), key);

async function reloadToMenu(page) {
  await page.reload();
  await page.waitForFunction(() => window.__spaceAdventure && window.__spaceAdventure.state === 'menu');
  await frames(page, 2);
}

async function selectMenuIndex(page, target) {
  for (let i = 0; i < 20 && (await hook(page, 'menuIndex')) !== target; i++) {
    const before = await hook(page, 'menuIndex');
    await page.keyboard.press('ArrowDown');
    await expect.poll(() => hook(page, 'menuIndex')).not.toBe(before);
  }
  expect(await hook(page, 'menuIndex')).toBe(target);
}

async function selectSettingsRow(page, id) {
  const target = await settingsRowIndex(page, id);
  for (let i = 0; i < 10 && (await hook(page, 'settingsIndex')) !== target; i++) {
    const before = await hook(page, 'settingsIndex');
    await page.keyboard.press('ArrowDown');
    await expect.poll(() => hook(page, 'settingsIndex')).not.toBe(before);
  }
  expect(await hook(page, 'settingsIndex')).toBe(target);
}

const rowValue = async (page, id) => (await hook(page, 'settingsRows')).find((r) => r.id === id).value;

test.describe('settings: keyboard', () => {
  test.beforeEach(async ({ page }, testInfo) => {
    test.skip(!!testInfo.project.use.hasTouch, 'keyboard settings tests run on the desktop project');
    await openFresh(page, { recordText: true });
    await loginWithKeyboard(page, 'SETKEYS');
    await selectMenuIndex(page, MENU.SETTINGS);
    await page.keyboard.press('Enter');
    await waitForState(page, 'settings');
  });

  test('opens with the desktop rows, defaults and one tap region per row', async ({ page }) => {
    const s = await snap(page);
    expect(s.settingsRows.map((r) => r.id)).toEqual(SETTINGS_ROWS_DESKTOP);
    expect(s.settingsIndex).toBe(0);
    expect(s.settings.palette).toBe('standard');
    expect(s.settings.muted).toBe(false);
    expect(s.palette).toBe('standard');
    expect(s.tapRegions.length).toBe(s.settingsRows.length);
    for (const r of s.tapRegions) expect(r.h).toBeGreaterThanOrEqual(30);
    const texts = await drawnTexts(page);
    expect(texts).toContain('SETTINGS');
    expect(texts).toContain('Colours');
    expect(texts.some((t) => t.includes(PALETTE_LABELS.standard))).toBe(true);
    expect(texts).toContain('Sound');
  });

  test('Up/Down move with wrap-around', async ({ page }) => {
    const n = (await hook(page, 'settingsRows')).length;
    await page.keyboard.press('ArrowDown');
    await expect.poll(() => hook(page, 'settingsIndex')).toBe(1);
    await page.keyboard.press('ArrowUp');
    await expect.poll(() => hook(page, 'settingsIndex')).toBe(0);
    await page.keyboard.press('ArrowUp');
    await expect.poll(() => hook(page, 'settingsIndex')).toBe(n - 1);
    await page.keyboard.press('s');
    await expect.poll(() => hook(page, 'settingsIndex')).toBe(0);
  });

  test('Colours: Right, Left and Enter change the palette; it persists across reload', async ({ page }) => {
    await selectSettingsRow(page, 'colours');
    await page.keyboard.press('ArrowRight');
    await expect.poll(() => hook(page, 'palette')).toBe('safe');
    expect(await rowValue(page, 'colours')).toBe(PALETTE_LABELS.safe);
    expect(await stored(page, PALETTE_KEY)).toBe('safe');
    await page.keyboard.press('ArrowLeft');
    await expect.poll(() => hook(page, 'palette')).toBe('standard');
    await page.keyboard.press('Enter');
    await expect.poll(() => hook(page, 'palette')).toBe('safe');
    expect(await hook(page, 'state')).toBe('settings');
    await reloadToMenu(page);
    expect(await hook(page, 'palette')).toBe('safe');
    expect(await hook(page, 'settings.palette')).toBe('safe');
  });

  test('Sound: Enter mutes (persisted, restored after reload) and unmutes', async ({ page }) => {
    await selectSettingsRow(page, 'sound');
    expect(await rowValue(page, 'sound')).toBe('On');
    await page.keyboard.press('Enter');
    await expect.poll(() => hook(page, 'isMuted')).toBe(true);
    expect(await rowValue(page, 'sound')).toBe('Off');
    expect(await stored(page, MUTED_KEY)).toBe('true');
    await reloadToMenu(page);
    expect(await hook(page, 'isMuted')).toBe(true);
    // M in the menu toggles the same setting
    await page.keyboard.press('m');
    await expect.poll(() => hook(page, 'isMuted')).toBe(false);
    expect(await stored(page, MUTED_KEY)).toBe('false');
    await reloadToMenu(page);
    expect(await hook(page, 'isMuted')).toBe(false);
  });

  test('Escape returns to the menu', async ({ page }) => {
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Escape');
    await waitForState(page, 'menu');
    expect(await hook(page, 'menuIndex')).toBe(0);
  });

  test('Back row: Enter and mouse click return to the menu; Left/Right on Back do nothing', async ({ page }) => {
    await selectSettingsRow(page, 'back');
    await page.keyboard.press('ArrowLeft');
    await page.keyboard.press('ArrowRight');
    await page.waitForTimeout(150);
    expect(await hook(page, 'state')).toBe('settings');
    await page.keyboard.press('Enter');
    await waitForState(page, 'menu');
    // Mouse: open again and click Back
    const p = await tapRegionCenter(page, MENU.SETTINGS);
    await page.mouse.click(p.x, p.y);
    await waitForState(page, 'settings');
    const back = await tapRegionCenter(page, await settingsRowIndex(page, 'back'));
    await page.mouse.click(back.x, back.y);
    await waitForState(page, 'menu');
  });

  test('mouse clicks on the left/right part of the Colours row step it', async ({ page }) => {
    const i = await settingsRowIndex(page, 'colours');
    let p = await tapRegionPoint(page, i, 0.9);
    await page.mouse.click(p.x, p.y);
    await expect.poll(() => hook(page, 'palette')).toBe('safe');
    p = await tapRegionPoint(page, i, 0.1);
    await page.mouse.click(p.x, p.y);
    await expect.poll(() => hook(page, 'palette')).toBe('standard');
  });
});

test.describe('settings: touch', () => {
  test.beforeEach(async ({ page }, testInfo) => {
    test.skip(!testInfo.project.use.hasTouch, 'touch settings tests run on the touch projects');
    await openFresh(page, { recordText: true });
    await loginWithTouch(page, 'SETTOUCH');
    await tapMenuItem(page, 'Settings');
    await waitForState(page, 'settings');
  });

  test('opens with the touch rows (Controls first) and finger-sized tap regions inside the canvas', async ({ page }) => {
    const s = await snap(page);
    expect(s.settingsRows.map((r) => r.id)).toEqual(SETTINGS_ROWS_TOUCH);
    expect(s.settingsRows[0].value).toBe(CONTROL_LABELS.joystick);
    expect(s.tapRegions.length).toBe(s.settingsRows.length);
    for (const r of s.tapRegions) {
      expect(r.h).toBeGreaterThanOrEqual(30);
      expect(r.x).toBeGreaterThanOrEqual(0);
      expect(r.y + r.h).toBeLessThanOrEqual(s.view.height);
    }
  });

  test('tap the left/right half of Controls, Colours and Sound to change them', async ({ page }) => {
    const ctl = await settingsRowIndex(page, 'controls');
    await tapAt(page, await tapRegionPoint(page, ctl, 0.9));
    await expect.poll(() => hook(page, 'controlMode')).toBe('buttons');
    expect(await stored(page, CONTROL_MODE_KEY)).toBe('buttons');
    await tapAt(page, await tapRegionPoint(page, ctl, 0.1));
    await expect.poll(() => hook(page, 'controlMode')).toBe('joystick');

    const col = await settingsRowIndex(page, 'colours');
    await tapAt(page, await tapRegionPoint(page, col, 0.1));
    await expect.poll(() => hook(page, 'palette')).toBe('safe'); // two values: left wraps
    expect(await hook(page, 'settingsIndex')).toBe(col);
    await tapAt(page, await tapRegionPoint(page, col, 0.5)); // centre steps forward
    await expect.poll(() => hook(page, 'palette')).toBe('standard');

    const snd = await settingsRowIndex(page, 'sound');
    await tapAt(page, await tapRegionPoint(page, snd, 0.9));
    await expect.poll(() => hook(page, 'isMuted')).toBe(true);
    await expect(page.locator('#touch-mute-btn')).toHaveClass(/muted/);
    expect(await hook(page, 'state')).toBe('settings');
  });

  test('changes persist across reload and Back returns to the menu', async ({ page }) => {
    await tapAt(page, await tapRegionCenter(page, await settingsRowIndex(page, 'controls')));
    await tapAt(page, await tapRegionCenter(page, await settingsRowIndex(page, 'colours')));
    await tapAt(page, await tapRegionCenter(page, await settingsRowIndex(page, 'sound')));
    await expect.poll(() => hook(page, 'settings')).toMatchObject({ controlMode: 'buttons', palette: 'safe', muted: true });
    await tapAt(page, await tapRegionCenter(page, await settingsRowIndex(page, 'back')));
    await waitForState(page, 'menu');
    await reloadToMenu(page);
    const s = await snap(page);
    expect(s.controlMode).toBe('buttons');
    expect(s.palette).toBe('safe');
    expect(s.isMuted).toBe(true);
    await expect(page.locator('body')).toHaveClass(/controls-buttons/);
  });
});
