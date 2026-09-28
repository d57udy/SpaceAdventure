// MP-7 (plan 05 §12, §14): round intro controls card, the Multiplayer help page and the
// accessibility options (auto-fire, fire button side, HUD text size, mute in the pause menu).
// Keyboard tests run on the desktop project, touch tests on the tablet projects.
import { test, expect } from '@playwright/test';
import {
  MENU, openFresh, hook, waitForState, frames, loginWithKeyboard, loginWithTouch, selectMenuRow, openCoopLobby,
  joinTwoWithKeyboard, skipRoundIntro, drawnTexts, tapAt, tapRegionCenter, tapRegionPoint, menuItemCenter,
  tapMenuItem, centerOf, settingsRowIndex, canvasToPage,
} from './helpers.js';

const introPanels = (page) => page.locator('#mp-hud .seat-hud .seat-hud-intro');

/** Every text in the per-player HUD panels is at least 18 px (plan §12). */
async function expectHudText18(page) {
  const sizes = await page.evaluate(() => {
    const out = [];
    for (const el of document.querySelectorAll('#mp-hud .seat-hud, #mp-hud .seat-hud *')) {
      const own = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
      const style = getComputedStyle(el);
      if (own && style.display !== 'none') out.push({ text: el.textContent.trim(), px: parseFloat(style.fontSize) });
    }
    return out;
  });
  expect(sizes.length).toBeGreaterThan(0);
  for (const s of sizes) expect(s.px, `"${s.text}"`).toBeGreaterThanOrEqual(18);
}

async function startCoopKeyboard(page, { storage = {}, skipIntro = false } = {}) {
  const errors = await openFresh(page, { storage, recordText: true });
  await loginWithKeyboard(page, 'TESTER');
  await openCoopLobby(page);
  await joinTwoWithKeyboard(page, 'playing', { skipIntro });
  return errors;
}

/** Settings > Multiplayer with the keyboard; returns once the sub-page is open. */
async function openMpSettingsWithKeys(page) {
  await selectMenuRow(page, MENU.SETTINGS);
  await page.keyboard.press('Enter');
  await waitForState(page, 'settings');
  const target = await settingsRowIndex(page, 'multiplayer');
  for (let i = 0; i < 20 && (await hook(page, 'settingsIndex')) !== target; i++) {
    await page.keyboard.press('ArrowDown');
    await frames(page, 2);
  }
  await page.keyboard.press('Enter');
  await expect.poll(() => hook(page, 'settingsPage')).toBe('mp');
}

test.describe('MP-7 keyboard', () => {
  test.skip(({ hasTouch }) => hasTouch, 'desktop keyboard');

  test('intro card: per-seat controls in the HUD panels, world frozen, starts when both fire', async ({ page }) => {
    const errors = await startCoopKeyboard(page);
    const intro = await hook(page, 'mp.intro');
    expect(intro).toMatchObject({ full: true, duration: 8, ready: [false, false], viewers: 1 });
    expect(intro.rules).toMatch(/revive/);
    expect(intro.cards.map((c) => c.source)).toEqual(['kbLeft', 'kbRight']);
    await expect(page.locator('body')).toHaveClass(/mp-intro/);
    await expect(introPanels(page)).toHaveCount(2);
    await expect(introPanels(page).nth(0)).toContainText('W thrust · A D turn');
    await expect(introPanels(page).nth(0)).toContainText('SPACE or F fire');
    await expect(introPanels(page).nth(0)).toContainText('Press FIRE (SPACE) when ready');
    await expect(introPanels(page).nth(1)).toContainText('Press FIRE (ENTER) when ready');
    // Each player's key caps on their own side of the canvas (P1 left, P2 right)
    await expect.poll(async () => ((await hook(page, 'mp.intro')) || {}).blocks?.length).toBe(2);
    const blocks = (await hook(page, 'mp.intro')).blocks;
    expect(blocks.map((b) => [b.label, b.side, b.status])).toEqual([
      ['P1', 'left', 'Press FIRE (SPACE) when ready'], ['P2', 'right', 'Press FIRE (ENTER) when ready'],
    ]);
    expect(blocks[0].keys).toEqual(['W', 'A', 'S', 'D', 'SPACE', 'F']);
    expect(blocks[1].keys).toEqual(['↑', '←', '↓', '→', 'ENTER']);
    await expect(introPanels(page).nth(1)).toContainText('↑ thrust · ← → turn');
    await expect(introPanels(page).nth(1)).toContainText('ENTER or RIGHT SHIFT fire');
    // Score and lives make room for the card
    await expect(page.locator('.seat-hud').nth(0).locator('[data-hud="score"]')).toBeHidden();
    const texts = await drawnTexts(page);
    expect(texts.some((t) => /revive/.test(t))).toBe(true);
    expect(texts.some((t) => /^Everyone press FIRE to start · \d$/.test(t))).toBe(true);

    // Frozen: thrust does nothing, the round clock stands still
    const ship = await hook(page, 'players.0.ship');
    await page.keyboard.down('w');
    await frames(page, 20);
    await page.keyboard.up('w');
    const still = await hook(page, 'players.0.ship');
    expect(Math.hypot(still.x - ship.x, still.y - ship.y)).toBeLessThan(0.5);
    expect(await hook(page, 'mode.elapsed')).toBe(0);
    expect(await hook(page, 'counts.playerBullets')).toBe(0);

    // P1 fires: ready, still waiting for P2
    await page.keyboard.press('Space');
    await expect.poll(() => hook(page, 'mp.intro.ready')).toEqual([true, false]);
    await expect(introPanels(page).nth(0)).toContainText('READY');
    await frames(page, 5);
    expect(await hook(page, 'mp.intro')).not.toBeNull();
    // P2 fires: the round starts
    await page.keyboard.press('Enter');
    await expect.poll(() => hook(page, 'mp.intro')).toBeNull();
    await expect(page.locator('body')).not.toHaveClass(/mp-intro/);
    await expect.poll(() => hook(page, 'mode.elapsed')).toBeGreaterThan(0);
    await expect(page.locator('.seat-hud').nth(0).locator('[data-hud="score"]')).toBeVisible();
    await expectHudText18(page);

    // Restart round: same line-up, the short 2 s card
    await page.keyboard.press('p');
    await waitForState(page, 'paused');
    await page.keyboard.press('ArrowDown');
    await expect.poll(() => hook(page, 'pauseIndex')).toBe(1);
    await page.keyboard.press('Enter');
    await expect.poll(() => hook(page, 'mp.intro.full')).toBe(false);
    expect(await hook(page, 'mp.intro.duration')).toBe(2);
    await expect.poll(() => hook(page, 'mp.intro'), { timeout: 5000 }).toBeNull();
    expect(errors).toEqual([]);
  });

  test('intro card starts by itself after 8 s', async ({ page }) => {
    test.setTimeout(60000);
    const errors = await startCoopKeyboard(page);
    expect(await hook(page, 'mp.intro.full')).toBe(true);
    const t0 = Date.now();
    await page.waitForTimeout(3000);
    const mid = await hook(page, 'mp.intro');
    expect(mid).not.toBeNull();
    expect(mid.timeLeft).toBeLessThan(6);
    expect(await hook(page, 'mode.elapsed')).toBe(0);
    await expect.poll(() => hook(page, 'mp.intro'), { timeout: 12000 }).toBeNull();
    expect(Date.now() - t0).toBeGreaterThan(4000);
    await expect.poll(() => hook(page, 'mode.elapsed')).toBeGreaterThan(0);
    expect(errors).toEqual([]);
  });

  test('Help: the Multiplayer page by keys and by tap', async ({ page }) => {
    const errors = await openFresh(page, { recordText: true });
    await loginWithKeyboard(page, 'TESTER');
    await selectMenuRow(page, MENU.HELP);
    await page.keyboard.press('Enter');
    await waitForState(page, 'help');
    expect(await hook(page, 'mp.help.page')).toBe(0);
    expect(await drawnTexts(page)).toContain('SPACE ADVENTURE - HELP');
    // Keys: right arrow to the Multiplayer page, left back
    await page.keyboard.press('ArrowRight');
    await expect.poll(() => hook(page, 'mp.help.page')).toBe(1);
    const texts = await drawnTexts(page);
    for (const t of ['MULTIPLAYER HELP', 'KEYBOARD (two players)', 'CONTROLLERS', 'TABLET', 'MODES',
      'Co-op "Wingmen": 2 to 4 players fly together, each with their own ship.']) {
      expect(texts, t).toContain(t);
    }
    // Keyboard: key cap diagrams per seat (a text table on a small screen)
    if (texts.includes('P1 · left side · SPACE joins')) {
      for (const t of ['P2 · right side · ENTER joins', 'W', 'A', 'S', 'D', 'SPACE', 'F', '↑', '←', '↓', '→', 'ENTER']) {
        expect(texts, t).toContain(t);
      }
    } else {
      for (const t of ['SPACE or F', 'ENTER or RIGHT SHIFT']) expect(texts, t).toContain(t);
    }
    expect(texts.some((t) => /Multitasking & Gestures/.test(t))).toBe(true);
    await page.keyboard.press('ArrowLeft');
    await expect.poll(() => hook(page, 'mp.help.page')).toBe(0);
    // Tap: the page button at the top
    const button = async () => {
      const r = (await hook(page, 'tapRegions')).find((q) => q.id === 'help:page');
      expect(r).toBeTruthy();
      return canvasToPage(page, r.x + r.w / 2, r.y + r.h / 2);
    };
    let p = await button();
    await page.mouse.click(p.x, p.y);
    await expect.poll(() => hook(page, 'mp.help.page')).toBe(1);
    expect(await hook(page, 'state')).toBe('help');
    p = await button();
    await page.mouse.click(p.x, p.y);
    await expect.poll(() => hook(page, 'mp.help.page')).toBe(0);
    // Escape returns; the next visit starts on the game page
    await page.keyboard.press('ArrowRight');
    await expect.poll(() => hook(page, 'mp.help.page')).toBe(1);
    await page.keyboard.press('Escape');
    await waitForState(page, 'menu');
    await selectMenuRow(page, MENU.HELP);
    await page.keyboard.press('Enter');
    await waitForState(page, 'help');
    expect(await hook(page, 'mp.help.page')).toBe(0);
    expect(errors).toEqual([]);
  });

  test('auto-fire: fires without holding fire in multiplayer, not in single-player', async ({ page }) => {
    const errors = await openFresh(page);
    await loginWithKeyboard(page, 'TESTER');
    await openMpSettingsWithKeys(page);
    const rows = (await hook(page, 'settingsRows')).map((r) => r.id);
    expect(rows).toEqual(['mpAutoFire', 'mpStereo', 'mpBack'].filter((id) => id !== 'mpStereo' || rows.includes('mpStereo')));
    expect(await hook(page, 'settingsIndex')).toBe(0);
    await page.keyboard.press('Enter');
    await expect.poll(async () => (await hook(page, 'settingsRows'))[0]).toMatchObject({ label: 'Auto-fire (multiplayer)', value: 'On' });
    expect(await hook(page, 'settings.mpAutoFire')).toBe(true);
    await page.keyboard.press('Escape'); // back to the main Settings page, on the Multiplayer row
    await expect.poll(() => hook(page, 'settingsPage')).toBe('main');
    expect((await hook(page, 'settingsRows'))[await hook(page, 'settingsIndex')].id).toBe('multiplayer');
    await page.keyboard.press('Escape');
    await waitForState(page, 'menu');

    // Single-player: nothing fires by itself
    await selectMenuRow(page, MENU.START);
    await page.keyboard.press('Enter');
    await waitForState(page, 'playing');
    await page.waitForTimeout(1000);
    expect(await hook(page, 'counts.playerBullets')).toBe(0);
    expect(await hook(page, 'players.0.stats.shots')).toBe(0);
    await page.keyboard.press('Escape');
    await waitForState(page, 'paused');
    await page.keyboard.press('ArrowUp');
    await expect.poll(() => hook(page, 'pauseIndex')).toBe(2);
    await page.keyboard.press('Enter'); // Main Menu
    await waitForState(page, 'menu');

    // Co-op: both ships fire with no key held
    await openCoopLobby(page);
    await joinTwoWithKeyboard(page);
    const shots = async () => (await hook(page, 'players')).map((pl) => pl.stats.shots);
    const before = await shots();
    await page.waitForTimeout(1200);
    const after = await shots();
    expect(after[0] - before[0]).toBeGreaterThanOrEqual(3);
    expect(after[1] - before[1]).toBeGreaterThanOrEqual(3);
    expect(await page.evaluate(() => [0, 1].map((s) => window.__spaceAdventure.isPressedSeat('fire', s)))).toEqual([false, false]);
    expect(errors).toEqual([]);
  });

  test('Mute in the multiplayer pause menu', async ({ page }) => {
    const errors = await startCoopKeyboard(page, { skipIntro: true });
    await page.keyboard.press('p');
    await waitForState(page, 'paused');
    expect(await hook(page, 'pauseOptions')).toEqual(['Resume', 'Restart round', 'Change players', 'Main menu', 'Mute']);
    expect(await hook(page, 'isMuted')).toBe(false);
    await page.keyboard.press('ArrowUp'); // wraps to Mute
    await expect.poll(() => hook(page, 'pauseIndex')).toBe(4);
    await page.keyboard.press('Enter');
    await expect.poll(() => hook(page, 'isMuted')).toBe(true);
    expect(await hook(page, 'state')).toBe('paused');
    expect(await hook(page, 'settings.muted')).toBe(true);
    expect((await hook(page, 'pauseOptions'))[4]).toBe('Unmute');
    await page.keyboard.press('Enter');
    await expect.poll(() => hook(page, 'isMuted')).toBe(false);
    expect(await hook(page, 'settings.muted')).toBe(false);
    expect(errors).toEqual([]);
  });
});

// --- Touch: one tablet, two players ---
async function openCoopTouchLobby(page) {
  await tapAt(page, await menuItemCenter(page, 'Multiplayer'));
  await waitForState(page, 'mp_mode_select');
  const rows = await hook(page, 'mp.modeSelect.rows');
  await tapAt(page, await tapRegionCenter(page, rows.indexOf('coop')));
  await waitForState(page, 'lobby');
}
async function tapPad(page, zone, seat, check) {
  await tapAt(page, await centerOf(page, `#join-pad-${zone}`));
  await expect.poll(async () => check((await hook(page, 'lobby.cards'))[seat]), { message: `pad ${zone}` }).toBe(true);
}
async function joinBothTouch(page) {
  await tapPad(page, 'a', 0, (c) => !!c && c.source === 'touch:a');
  await tapPad(page, 'b', 1, (c) => !!c && c.source === 'touch:b');
  await tapPad(page, 'a', 0, (c) => c.ready);
  await tapPad(page, 'b', 1, (c) => c.ready);
  await waitForState(page, 'playing', 10000); // 3 s countdown; slow CI WebKit draws ~3 fps
}

test.describe('MP-7 touch', () => {
  test.skip(({ hasTouch }) => !hasTouch, 'touch');

  test('intro card: each zone and fire button pulses until that player fires; drawn per viewer', async ({ page }) => {
    const errors = await openFresh(page, { recordText: true });
    await loginWithTouch(page, 'TOUCHY');
    await openCoopTouchLobby(page);
    await joinBothTouch(page);
    const layout = await hook(page, 'mp.layout');
    expect(['sides', 'facing']).toContain(layout);
    const intro = await hook(page, 'mp.intro');
    expect(intro).toMatchObject({ full: true, ready: [false, false] });
    expect(intro.cards.map((c) => c.source)).toEqual(['touch:a', 'touch:b']);
    expect(intro.cards[0].lines[0]).toBe('Drag here to steer');
    await expect.poll(() => hook(page, 'mp.intro.viewers')).toBe(layout === 'facing' ? 2 : 1);
    const body = page.locator('body');
    await expect(body).toHaveClass(/intro-zone-a/);
    await expect(body).toHaveClass(/intro-zone-b/);
    if ((await hook(page, 'mp.hud')) === 'dom') {
      await expect(introPanels(page).nth(0)).toContainText('Drag here to steer');
      await expect(introPanels(page).nth(1)).toContainText('FIRE: red button');
    }
    await page.screenshot({ path: `tests/screenshots/${test.info().project.name}-mp-intro-touch.png` });

    await tapAt(page, await centerOf(page, '#touch-fire-btn'));
    await expect.poll(() => hook(page, 'mp.intro.ready')).toEqual([true, false]);
    await expect(body).not.toHaveClass(/intro-zone-a/);
    await expect(body).toHaveClass(/intro-zone-b/);
    await tapAt(page, await centerOf(page, '#touch-fire-btn-b'));
    await expect.poll(() => hook(page, 'mp.intro')).toBeNull();
    await expect(body).not.toHaveClass(/intro-zone-b/);
    if ((await hook(page, 'mp.hud')) === 'dom') await expectHudText18(page);
    expect(errors).toEqual([]);
  });

  test('Help: tap the page button for the Multiplayer page, tap elsewhere to return', async ({ page }) => {
    const errors = await openFresh(page, { recordText: true });
    await loginWithTouch(page, 'TOUCHY');
    await tapMenuItem(page, 'Help');
    await waitForState(page, 'help');
    const button = async () => {
      const r = (await hook(page, 'tapRegions')).find((q) => q.id === 'help:page');
      expect(r, 'page button').toBeTruthy();
      expect(r.h).toBeGreaterThanOrEqual(30);
      return canvasToPage(page, r.x + r.w / 2, r.y + r.h / 2);
    };
    await tapAt(page, await button());
    await expect.poll(() => hook(page, 'mp.help.page')).toBe(1);
    const texts = await drawnTexts(page);
    expect(texts).toContain('MULTIPLAYER HELP');
    expect(texts.some((t) => /Side by side \(landscape\)/.test(t))).toBe(true);
    await tapAt(page, await button());
    await expect.poll(() => hook(page, 'mp.help.page')).toBe(0);
    await tapAt(page, await button());
    await expect.poll(() => hook(page, 'mp.help.page')).toBe(1);
    // Anywhere else returns to the menu
    await tapAt(page, await canvasToPage(page, (await hook(page, 'view.width')) / 2, (await hook(page, 'view.height')) / 2));
    await waitForState(page, 'menu');
    expect(errors).toEqual([]);
  });

  test('fire button side: Settings > Multiplayer moves the left/bottom player\'s fire button inward', async ({ page }) => {
    const errors = await openFresh(page);
    await loginWithTouch(page, 'TOUCHY');
    await tapMenuItem(page, 'Settings');
    await waitForState(page, 'settings');
    await tapAt(page, await tapRegionCenter(page, await settingsRowIndex(page, 'multiplayer')));
    await expect.poll(() => hook(page, 'settingsPage')).toBe('mp');
    const ids = (await hook(page, 'settingsRows')).map((r) => r.id);
    expect(ids.slice(0, 3)).toEqual(['mpAutoFire', 'mpFireSideA', 'mpFireSideB']);
    const row = await settingsRowIndex(page, 'mpFireSideA');
    expect((await hook(page, 'settingsRows'))[row].value).toBe('Outer');
    await tapAt(page, await tapRegionPoint(page, row, 0.9));
    await expect.poll(async () => (await hook(page, 'settingsRows'))[row].value).toBe('Inner');
    expect(await hook(page, 'settings.mpFireSideA')).toBe('inner');
    await tapAt(page, await tapRegionCenter(page, await settingsRowIndex(page, 'mpBack')));
    await expect.poll(() => hook(page, 'settingsPage')).toBe('main');
    await tapAt(page, await tapRegionCenter(page, await settingsRowIndex(page, 'back')));
    await waitForState(page, 'menu');

    await openCoopTouchLobby(page);
    await joinBothTouch(page);
    await skipRoundIntro(page);
    const layout = await hook(page, 'mp.layout');
    const vw = await page.evaluate(() => window.innerWidth);
    const canvas = await page.locator('#gameCanvas').boundingBox();
    const a = await page.locator('#touch-fire-btn').boundingBox();
    const b = await page.locator('#touch-fire-btn-b').boundingBox();
    if (layout === 'sides') {
      // P1 (inner): the canvas side of the left bar; P2 (outer): the screen edge
      expect(a.x + a.width).toBeLessThanOrEqual(canvas.x + 1);
      expect(a.x + a.width).toBeGreaterThan(canvas.x - 20);
      expect(b.x + b.width).toBeGreaterThan(vw - 20);
    } else {
      // Facing: P1's fire moves from their right-hand corner to their left
      expect(a.x + a.width / 2).toBeLessThan(vw / 2);
      expect(b.x + b.width / 2).toBeLessThan(vw / 2); // P2 (outer) sits on their right: the screen's left
    }
    // Still inside the screen and clear of the play area
    expect(a.x).toBeGreaterThanOrEqual(0);
    const overlap = !(a.x + a.width <= canvas.x || canvas.x + canvas.width <= a.x || a.y + a.height <= canvas.y || canvas.y + canvas.height <= a.y);
    expect(overlap).toBe(false);
    // The inner fire button works
    const shots = await hook(page, 'players.0.stats.shots');
    await tapAt(page, await centerOf(page, '#touch-fire-btn'));
    await expect.poll(() => hook(page, 'players.0.stats.shots')).toBeGreaterThan(shots);
    await page.screenshot({ path: `tests/screenshots/${test.info().project.name}-mp-fire-inner.png` });
    expect(errors).toEqual([]);
  });
});
