// Phone-size screen (390 x 844, like an iPhone 12-15): the canvas is only ~351 px square, so
// every menu screen must fit its rows and keep its exit (Back / Resume / "tap to return")
// tappable inside the canvas. A touch player has no Escape key: an exit drawn below the
// canvas leaves them stuck. Runs in the touch projects (hasTouch) with a phone viewport.
import { test, expect } from '@playwright/test';
import {
  openFresh, hook, waitForState, loginWithTouch, tapMenuItem, tapAt, canvasToPage,
  valueArrowPoint, settingsRowIndex, menuItemCenter, tapRegionCenter, MENU,
} from './helpers.js';

test.use({ viewport: { width: 390, height: 844 } });

const MIN_H = 30;

/** The tap region matching `pick`, checked to lie inside the canvas and be >= 30 px tall. */
async function exitRegion(page, pick, label) {
  await expect.poll(async () => !!(await hook(page, 'tapRegions')).find(pick), { message: `exit region for ${label}` }).toBe(true);
  const r = (await hook(page, 'tapRegions')).find(pick);
  const v = await hook(page, 'view');
  const where = `${label}: ${JSON.stringify(r)} in ${v.width}x${v.height}`;
  expect(r.x, where).toBeGreaterThanOrEqual(-0.5);
  expect(r.y, where).toBeGreaterThanOrEqual(-0.5);
  expect(r.x + r.w, where).toBeLessThanOrEqual(v.width + 0.5);
  expect(r.y + r.h, where).toBeLessThanOrEqual(v.height + 0.5);
  expect(r.h, where).toBeGreaterThanOrEqual(MIN_H);
  return r;
}

/** Check the exit region, tap its centre and wait for `state`. */
async function tapExit(page, pick, label, state) {
  const r = await exitRegion(page, pick, label);
  await tapAt(page, await canvasToPage(page, r.x + r.w / 2, r.y + r.h / 2));
  await waitForState(page, state);
}

const byId = (id) => (r) => r.id === id;
const fullScreen = (r) => r.x === 0 && r.y === 0 && r.w > 300 && r.h > 300;

test.describe('phone-size screen: every menu exit is inside the canvas and tappable', () => {
  test.skip(({ hasTouch }) => !hasTouch, 'touch devices');

  test('the canvas is phone-sized', async ({ page }) => {
    await openFresh(page);
    await loginWithTouch(page, 'PHONE');
    const v = await hook(page, 'view');
    expect(v.height).toBeLessThan(400);
  });

  test('Upgrades, Settings, High Scores, Achievements and Help can be left by tapping', async ({ page }) => {
    const errors = await openFresh(page);
    await loginWithTouch(page, 'PHONE');

    await tapMenuItem(page, 'Upgrades');
    await waitForState(page, 'upgrades');
    await tapExit(page, byId('row:back'), 'Upgrades Back', 'menu');

    await tapMenuItem(page, 'Settings');
    await waitForState(page, 'settings');
    await tapExit(page, byId('row:back'), 'Settings Back', 'menu');

    await tapMenuItem(page, 'High Scores');
    await waitForState(page, 'high_scores');
    await tapExit(page, fullScreen, 'High Scores', 'menu');

    await tapMenuItem(page, 'Achievements');
    await waitForState(page, 'achievements');
    await tapExit(page, fullScreen, 'Achievements', 'menu');

    await tapMenuItem(page, 'Help');
    await waitForState(page, 'help');
    await exitRegion(page, fullScreen, 'Help');
    expect(errors).toEqual([]);
  });

  test('Multiplayer mode select, Time Attack setup and both lobbies have a reachable Back', async ({ page }) => {
    const errors = await openFresh(page);
    await loginWithTouch(page, 'PHONE');
    await tapMenuItem(page, 'Multiplayer');
    await waitForState(page, 'mp_mode_select');
    const rows = await hook(page, 'mp.modeSelect.rows');
    expect(rows[rows.length - 1]).toBe('back');
    // Every mode row stays inside the canvas too
    const v = await hook(page, 'view');
    for (const id of rows) {
      const r = (await hook(page, 'tapRegions')).find(byId(`row:${id}`));
      expect(r, `row ${id}`).toBeTruthy();
      expect(r.y + r.h, `row ${id}`).toBeLessThanOrEqual(v.height + 0.5);
    }

    // Time Attack setup -> Back returns to the mode select
    const ta = (await hook(page, 'tapRegions')).find(byId('row:timeattack'));
    await tapAt(page, await canvasToPage(page, ta.x + ta.w / 2, ta.y + ta.h / 2));
    await waitForState(page, 'ta_setup');
    await tapExit(page, byId('row:back'), 'Time Attack Back', 'mp_mode_select');

    // Take Turns by touch: the pass-one-device lobby
    const turns = (await hook(page, 'tapRegions')).find(byId('row:turns'));
    await tapAt(page, await canvasToPage(page, turns.x + turns.w / 2, turns.y + turns.h / 2));
    await waitForState(page, 'lobby');
    expect(await hook(page, 'lobby.kind')).toBe('count');
    await tapExit(page, byId('row:back'), 'Count lobby Back', 'mp_mode_select');

    // Co-op: the seat lobby's Back button
    const coop = (await hook(page, 'tapRegions')).find(byId('row:coop'));
    await tapAt(page, await canvasToPage(page, coop.x + coop.w / 2, coop.y + coop.h / 2));
    await waitForState(page, 'lobby');
    expect(await hook(page, 'lobby.kind')).toBe('seats');
    await tapExit(page, byId('lobby:back'), 'Seat lobby Back', 'mp_mode_select');

    // And the mode select's own Back
    await tapExit(page, byId('row:back'), 'Mode select Back', 'menu');
    expect(errors).toEqual([]);
  });

  test('pause menu: Resume and Main Menu are inside the canvas', async ({ page }) => {
    const errors = await openFresh(page);
    await loginWithTouch(page, 'PHONE');
    await tapMenuItem(page, 'Start');
    await waitForState(page, 'playing');
    await page.locator('#touch-pause-btn').tap();
    await waitForState(page, 'paused');
    await exitRegion(page, byId('pause:Main Menu'), 'Pause Main Menu');
    await tapExit(page, byId('pause:Resume'), 'Pause Resume', 'playing');
    expect(errors).toEqual([]);
  });

  test('pause menu during the tutorial: Skip Tutorial fits too', async ({ page }) => {
    const errors = await openFresh(page, { tutorial: true });
    await loginWithTouch(page, 'PHONE');
    await tapMenuItem(page, 'Start');
    await waitForState(page, 'tutorial_ask');
    await exitRegion(page, byId('tutorialAsk:skip'), 'Tutorial ask Skip');
    const play = await exitRegion(page, byId('tutorialAsk:play'), 'Play the tutorial');
    await tapAt(page, await canvasToPage(page, play.x + play.w / 2, play.y + play.h / 2));
    await waitForState(page, 'playing');
    await expect.poll(() => hook(page, 'tutorial.active')).toBe(true);
    await page.locator('#touch-pause-btn').tap();
    await waitForState(page, 'paused');
    for (const label of ['Resume', 'Restart', 'Main Menu', 'Skip Tutorial']) {
      await exitRegion(page, byId(`pause:${label}`), `Pause ${label}`);
    }
    expect(errors).toEqual([]);
  });
});

// Bug report (Pixel 7 Pro): "In the settings menu I was not able to press the volume down /
// left buttons." The ◂ was drawn beside the value at the right end of the row, where a tap
// stepped forward. Now ◂ and ▸ are 44+ px targets at the row ends (js/valueRow.js).
test.describe('phone-size screen: ◂ and ▸ on value rows', () => {
  test.skip(({ hasTouch }) => !hasTouch, 'touch devices');

  async function arrowTap(page, region, side) {
    const r = typeof region === 'number' ? (await hook(page, 'tapRegions'))[region] : region;
    const v = await hook(page, 'view');
    expect(r.arrowW, JSON.stringify(r)).toBeGreaterThanOrEqual(44);
    expect(r.x).toBeGreaterThanOrEqual(-0.5);
    expect(r.x + r.w).toBeLessThanOrEqual(v.width + 0.5);
    await tapAt(page, await valueArrowPoint(page, r, side));
  }

  test('Settings: ◂ lowers Music volume, ▸ raises it; the same on Sound effects', async ({ page }) => {
    const errors = await openFresh(page);
    await loginWithTouch(page, 'PHONE');
    await tapMenuItem(page, 'Settings');
    await waitForState(page, 'settings');
    const mv = await settingsRowIndex(page, 'musicVolume');
    await arrowTap(page, mv, 'left');
    await expect.poll(() => hook(page, 'settings.musicVolume')).toBe(4);
    await arrowTap(page, mv, 'left');
    await expect.poll(() => hook(page, 'settings.musicVolume')).toBe(3);
    await arrowTap(page, mv, 'right');
    await expect.poll(() => hook(page, 'settings.musicVolume')).toBe(4);
    const sv = await settingsRowIndex(page, 'sfxVolume');
    await arrowTap(page, sv, 'left');
    await expect.poll(() => hook(page, 'settings.sfxVolume')).toBe(9);
    await arrowTap(page, sv, 'right');
    await expect.poll(() => hook(page, 'settings.sfxVolume')).toBe(10);
    // Colours (two values): ◂ and ▸ both reach the other value and back
    const col = await settingsRowIndex(page, 'colours');
    await arrowTap(page, col, 'left');
    await expect.poll(() => hook(page, 'palette')).toBe('safe');
    await arrowTap(page, col, 'right');
    await expect.poll(() => hook(page, 'palette')).toBe('standard');
    expect(await hook(page, 'state')).toBe('settings');
    expect(errors).toEqual([]);
  });

  test('main-menu Difficulty and a lobby option step both ways', async ({ page }) => {
    const errors = await openFresh(page);
    await loginWithTouch(page, 'PHONE');
    const diff = (await hook(page, 'tapRegions'))[MENU.DIFFICULTY];
    expect(diff.id).toBe('row:difficulty');
    await arrowTap(page, diff, 'left');
    await expect.poll(() => hook(page, 'difficulty')).toBe('easy');
    await arrowTap(page, (await hook(page, 'tapRegions'))[MENU.DIFFICULTY], 'right');
    await expect.poll(() => hook(page, 'difficulty')).toBe('medium');

    await tapAt(page, await menuItemCenter(page, 'Multiplayer'));
    await waitForState(page, 'mp_mode_select');
    const rows = await hook(page, 'mp.modeSelect.rows');
    await tapAt(page, await tapRegionCenter(page, rows.indexOf('coop')));
    await waitForState(page, 'lobby');
    const layout = async () => (await hook(page, 'tapRegions')).find((q) => q.id === 'lobby:layout');
    expect(await layout()).toBeTruthy();
    expect(await hook(page, 'mp.layoutSetting')).toBe('auto');
    await arrowTap(page, await layout(), 'left');
    await expect.poll(() => hook(page, 'mp.layoutSetting')).toBe('facing');
    await arrowTap(page, await layout(), 'right');
    await expect.poll(() => hook(page, 'mp.layoutSetting')).toBe('auto');
    expect(errors).toEqual([]);
  });
});
