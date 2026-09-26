// Settings screen: keyboard (desktop) and touch (tablet projects).
import { test, expect } from '@playwright/test';
import {
  MENU, SETTINGS_ROWS_DESKTOP, CONTROL_MODE_KEY, PALETTE_KEY, MUTED_KEY,
  HAPTICS_KEY, MUSIC_TUNE_KEY, MUSIC_VOLUME_KEY, SFX_VOLUME_KEY, TUNE_LABELS,
  touchSettingsRows, hasVibrate, vibrations,
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
    // Chromium has navigator.vibrate (so the Vibration row shows); WebKit does not
    expect(s.settingsRows.map((r) => r.id)).toEqual(touchSettingsRows(await hasVibrate(page)));
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

// --- Vibration (Item 4). navigator.vibrate is stubbed (a browser API, not game state). ---

async function openTouchSettings(page, opts = {}) {
  const errors = await openFresh(page, opts);
  await loginWithTouch(page, 'BUZZ');
  await tapMenuItem(page, 'Settings');
  await waitForState(page, 'settings');
  return errors;
}

async function startByTapFromSettings(page) {
  await tapAt(page, await tapRegionCenter(page, await settingsRowIndex(page, 'back')));
  await waitForState(page, 'menu');
  await tapMenuItem(page, 'Start');
  await waitForState(page, 'playing');
  await expect.poll(() => hook(page, 'ship.isAlive')).toBe(true);
}

const HYPERSPACE_PATTERN = [15, 30, 40];
const LIFE_LOST_PATTERN = [120, 60, 200];
const CONFIRM_PATTERN = 30;

test.describe('settings: vibration (touch)', () => {
  test.beforeEach(async ({}, testInfo) => {
    test.skip(!testInfo.project.use.hasTouch, 'vibration is only offered on touch devices');
  });

  test('row shows "On" with navigator.vibrate; toggling persists and plays the confirmation tick', async ({ page }) => {
    const errors = await openTouchSettings(page, { vibrate: true });
    expect((await hook(page, 'settingsRows')).map((r) => r.id)).toEqual(touchSettingsRows(true));
    expect(await rowValue(page, 'vibration')).toBe('On');
    expect(await hook(page, 'haptics')).toMatchObject({ supported: true, enabled: true });

    const row = await settingsRowIndex(page, 'vibration');
    await tapAt(page, await tapRegionCenter(page, row));
    await expect.poll(() => rowValue(page, 'vibration')).toBe('Off');
    expect(await stored(page, HAPTICS_KEY)).toBe('false');
    expect(await hook(page, 'haptics.enabled')).toBe(false);
    expect((await vibrations(page)).at(-1)).toBe(0); // switching off stops any buzz

    await tapAt(page, await tapRegionCenter(page, row));
    await expect.poll(() => rowValue(page, 'vibration')).toBe('On');
    expect(await stored(page, HAPTICS_KEY)).toBe('true');
    await expect.poll(async () => (await vibrations(page)).at(-1)).toBe(CONFIRM_PATTERN);

    await tapAt(page, await tapRegionCenter(page, row)); // Off again, then reload
    await expect.poll(() => rowValue(page, 'vibration')).toBe('Off');
    await reloadToMenu(page);
    expect(await hook(page, 'settings.haptics')).toBe(false);
    expect(errors).toEqual([]);
  });

  test('hyperspace button records the hyperspace pattern (or the life-lost one on a 10% self-destruct)', async ({ page }) => {
    await openTouchSettings(page, { vibrate: true });
    await startByTapFromSettings(page);
    await page.locator('#touch-hyper-btn').tap();
    await expect.poll(async () => {
      const v = await vibrations(page);
      return v.some((p) => JSON.stringify(p) === JSON.stringify(HYPERSPACE_PATTERN)
        || JSON.stringify(p) === JSON.stringify(LIFE_LOST_PATTERN));
    }).toBe(true);
    expect(await hook(page, 'haptics.calls')).toBeGreaterThan(0);
  });

  test('pausing records a stop (0)', async ({ page }) => {
    await openTouchSettings(page, { vibrate: true });
    await startByTapFromSettings(page);
    const before = (await vibrations(page)).length;
    await page.locator('#touch-pause-btn').tap();
    await waitForState(page, 'paused');
    const after = (await vibrations(page)).slice(before);
    expect(after).toContain(0);
  });

  test('with Vibration off, hyperspace records nothing', async ({ page }) => {
    await openTouchSettings(page, { vibrate: true, storage: { [HAPTICS_KEY]: 'false' } });
    expect(await rowValue(page, 'vibration')).toBe('Off');
    await startByTapFromSettings(page);
    await page.locator('#touch-hyper-btn').tap();
    await page.waitForTimeout(300);
    expect((await vibrations(page)).filter((p) => p !== 0)).toEqual([]);
  });

  test('WebKit without the stub: no Vibration row and no errors', async ({ page, browserName }) => {
    test.skip(browserName !== 'webkit', 'WebKit lacks navigator.vibrate');
    const errors = await openTouchSettings(page);
    expect(await hasVibrate(page)).toBe(false);
    expect((await hook(page, 'settingsRows')).map((r) => r.id)).toEqual(touchSettingsRows(false));
    expect(await hook(page, 'haptics.supported')).toBe(false);
    expect(errors).toEqual([]);
  });
});

test('settings: desktop has no Vibration row, even with navigator.vibrate', async ({ page }, testInfo) => {
  test.skip(!!testInfo.project.use.hasTouch, 'desktop only');
  await openFresh(page, { vibrate: true });
  await loginWithKeyboard(page, 'NOBUZZ');
  await selectMenuIndex(page, MENU.SETTINGS);
  await page.keyboard.press('Enter');
  await waitForState(page, 'settings');
  expect(await hasVibrate(page)).toBe(true);
  expect((await hook(page, 'settingsRows')).map((r) => r.id)).toEqual(SETTINGS_ROWS_DESKTOP);
  expect(await hook(page, 'haptics.supported')).toBe(true);
});

// --- Music (Item 7) ---

test.describe('settings: music (keyboard)', () => {
  test.beforeEach(async ({ page }, testInfo) => {
    test.skip(!!testInfo.project.use.hasTouch, 'keyboard music tests run on the desktop project');
    await openFresh(page, { recordText: true });
    await loginWithKeyboard(page, 'TUNES');
  });

  test('mood: menu in the menu, calm after Start, paused when paused, back to calm on resume', async ({ page }) => {
    await expect.poll(() => hook(page, 'musicMood')).toBe('menu');
    await page.keyboard.press('Enter'); // Start
    await waitForState(page, 'playing');
    await expect.poll(() => hook(page, 'musicMood')).toBe('calm');
    await expect.poll(() => hook(page, 'music.mood')).toBe('calm');
    await page.keyboard.press('p');
    await waitForState(page, 'paused');
    await expect.poll(() => hook(page, 'musicMood')).toBe('paused');
    await expect.poll(() => hook(page, 'music.mood')).toBe('paused');
    await page.keyboard.press('p');
    await waitForState(page, 'playing');
    await expect.poll(() => hook(page, 'musicMood')).toBe('calm');
  });

  test('Music row cycles Off / Synthwave / Ambient / Chiptune and persists across reload', async ({ page }) => {
    await selectMenuIndex(page, MENU.SETTINGS);
    await page.keyboard.press('Enter');
    await waitForState(page, 'settings');
    expect(await rowValue(page, 'music')).toBe(TUNE_LABELS.synthwave);
    expect(await hook(page, 'musicTune')).toBe('synthwave');
    await selectSettingsRow(page, 'music');
    await page.keyboard.press('ArrowRight');
    await expect.poll(() => hook(page, 'musicTune')).toBe('ambient');
    expect(await rowValue(page, 'music')).toBe(TUNE_LABELS.ambient);
    expect(await hook(page, 'music.tune')).toBe('ambient');
    expect(await stored(page, MUSIC_TUNE_KEY)).toBe('ambient');
    await page.keyboard.press('Enter');
    await expect.poll(() => hook(page, 'musicTune')).toBe('chiptune');
    await page.keyboard.press('ArrowRight');
    await expect.poll(() => hook(page, 'musicTune')).toBe('off'); // wraps
    expect(await hook(page, 'music.tune')).toBe('off');
    await page.keyboard.press('ArrowLeft');
    await expect.poll(() => hook(page, 'musicTune')).toBe('chiptune');
    const texts = await drawnTexts(page);
    expect(texts).toContain('Music');
    expect(texts.some((t) => t.includes(TUNE_LABELS.chiptune))).toBe(true);
    await reloadToMenu(page);
    expect(await hook(page, 'musicTune')).toBe('chiptune');
    expect(await hook(page, 'music.tune')).toBe('chiptune');
  });

  test('Music volume and Sound effects rows step with Left/Right, clamp at 0..10 and persist', async ({ page }) => {
    await selectMenuIndex(page, MENU.SETTINGS);
    await page.keyboard.press('Enter');
    await waitForState(page, 'settings');
    expect(await rowValue(page, 'musicVolume')).toBe('5');
    expect(await rowValue(page, 'sfxVolume')).toBe('10');
    await selectSettingsRow(page, 'musicVolume');
    await page.keyboard.press('ArrowRight');
    await expect.poll(() => rowValue(page, 'musicVolume')).toBe('6');
    expect(await hook(page, 'music.volume')).toBe(6);
    expect(await stored(page, MUSIC_VOLUME_KEY)).toBe('6');
    await selectSettingsRow(page, 'sfxVolume');
    await page.keyboard.press('ArrowRight'); // already at 10: clamps
    await frames(page, 3);
    expect(await rowValue(page, 'sfxVolume')).toBe('10');
    await page.keyboard.press('ArrowLeft');
    await expect.poll(() => rowValue(page, 'sfxVolume')).toBe('9');
    await page.keyboard.press('ArrowLeft');
    await expect.poll(() => rowValue(page, 'sfxVolume')).toBe('8');
    expect(await stored(page, SFX_VOLUME_KEY)).toBe('8');
    await reloadToMenu(page);
    expect(await hook(page, 'settings')).toMatchObject({ musicVolume: 6, sfxVolume: 8 });
    expect(await hook(page, 'music.volume')).toBe(6);
  });
});

test.describe('settings: music (touch)', () => {
  test.beforeEach(async ({}, testInfo) => {
    test.skip(!testInfo.project.use.hasTouch, 'touch music tests run on the touch projects');
  });

  test('tap left/right halves of the music rows; values persist; no page errors', async ({ page }) => {
    const errors = await openTouchSettings(page);
    const tune = await settingsRowIndex(page, 'music');
    await tapAt(page, await tapRegionPoint(page, tune, 0.9));
    await expect.poll(() => hook(page, 'musicTune')).toBe('ambient');
    await tapAt(page, await tapRegionPoint(page, tune, 0.1));
    await tapAt(page, await tapRegionPoint(page, tune, 0.1));
    await expect.poll(() => hook(page, 'musicTune')).toBe('off');

    const mv = await settingsRowIndex(page, 'musicVolume');
    await tapAt(page, await tapRegionPoint(page, mv, 0.1));
    await expect.poll(() => rowValue(page, 'musicVolume')).toBe('4');
    const sv = await settingsRowIndex(page, 'sfxVolume');
    await tapAt(page, await tapRegionPoint(page, sv, 0.1));
    await expect.poll(() => rowValue(page, 'sfxVolume')).toBe('9');
    await tapAt(page, await tapRegionPoint(page, sv, 0.9));
    await expect.poll(() => rowValue(page, 'sfxVolume')).toBe('10');

    await reloadToMenu(page);
    expect(await hook(page, 'settings')).toMatchObject({ musicTune: 'off', musicVolume: 4, sfxVolume: 10 });
    expect(errors).toEqual([]);
  });

  test('every tune previews, plays through Start and Pause without page errors', async ({ page }) => {
    const errors = await openTouchSettings(page);
    const tune = await settingsRowIndex(page, 'music');
    for (const id of ['ambient', 'chiptune', 'off', 'synthwave']) {
      await tapAt(page, await tapRegionPoint(page, tune, 0.9));
      await expect.poll(() => hook(page, 'musicTune')).toBe(id);
      await frames(page, 5);
    }
    await startByTapFromSettings(page);
    await expect.poll(() => hook(page, 'musicMood')).toBe('calm');
    await page.locator('#touch-pause-btn').tap();
    await waitForState(page, 'paused');
    await expect.poll(() => hook(page, 'musicMood')).toBe('paused');
    await frames(page, 10);
    const m = await hook(page, 'music');
    // Where headless audio runs, the sequencer really scheduled notes
    if (m.running) expect(m.events).toBeGreaterThan(0);
    expect(await hook(page, 'loopErrors')).toBe(0);
    expect(errors).toEqual([]);
  });
});
