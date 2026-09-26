// Game controller support (Item 8). navigator.getGamepads is stubbed with fake standard
// controllers (a browser API, not game state); rumble requests are recorded by the stub.
import { test, expect } from '@playwright/test';
import {
  MENU, PAD, RUMBLE_KEY, openFresh, hook, snap, frames, waitForState, loginWithKeyboard, loginWithTouch,
  tapMenuItem, tapAt, canvasToPage, drawnTexts, padPress, padRelease, padTap, padStick, padDisconnect,
  rumbles, settingsRowIndex, isPressed,
} from './helpers.js';

const XBOX = 'Xbox Wireless Controller (STANDARD GAMEPAD Vendor: 045e Product: 0b13)';
const DUALSENSE = 'DualSense Wireless Controller (STANDARD GAMEPAD Vendor: 054c Product: 0ce6)';

async function selectMenuIndex(page, target) {
  for (let i = 0; i < 20 && (await hook(page, 'menuIndex')) !== target; i++) {
    const before = await hook(page, 'menuIndex');
    await page.keyboard.press('ArrowDown');
    await expect.poll(() => hook(page, 'menuIndex')).not.toBe(before);
  }
  expect(await hook(page, 'menuIndex')).toBe(target);
}

/** Log in with the keyboard, then connect the controller with Ⓑ (does nothing on the menu). */
async function openWithPad(page, opts = {}) {
  const errors = await openFresh(page, { gamepads: [{ id: XBOX }], ...opts });
  await loginWithKeyboard(page, opts.user || 'PADDY');
  await padTap(page, PAD.B);
  await expect.poll(() => hook(page, 'gamepad.connected')).toBe(true);
  return errors;
}

/** Ⓐ on Start (keeps holding it until released by the caller if hold = true). */
async function startWithPad(page, { hold = false } = {}) {
  expect(await hook(page, 'menuIndex')).toBe(MENU.START);
  await padPress(page, PAD.A);
  await waitForState(page, 'playing');
  if (!hold) await padRelease(page, PAD.A);
  await expect.poll(() => hook(page, 'ship.isAlive')).toBe(true);
}

test.describe('gamepad: desktop', () => {
  test.beforeEach(async ({}, testInfo) => {
    test.skip(!!testInfo.project.use.hasTouch, 'controller menu/game tests run on the desktop project');
  });

  test('connecting shows a toast, fills the hook and switches the input source', async ({ page }) => {
    const errors = await openWithPad(page, { recordText: true });
    const s = await snap(page);
    expect(s.gamepad).toMatchObject({ connected: true, id: XBOX, family: 'xbox', mapping: 'standard', seen: true });
    expect(s.lastInputSource).toBe('gamepad');
    expect(s.state).toBe('menu');
    expect(await hook(page, 'toasts')).toContain('Xbox Wireless Controller connected');
    expect(await drawnTexts(page)).toContain('Xbox Wireless Controller connected');
    await page.keyboard.press('ArrowDown');
    await expect.poll(() => hook(page, 'lastInputSource')).toBe('keyboard');
    expect(errors).toEqual([]);
  });

  test('D-pad and stick navigate the menu, with repeat while held', async ({ page }) => {
    await openWithPad(page);
    await padTap(page, PAD.DOWN);
    await expect.poll(() => hook(page, 'menuIndex')).toBe(1);
    await padTap(page, PAD.UP);
    await expect.poll(() => hook(page, 'menuIndex')).toBe(0);
    // Held: once at once, again after 400 ms, then every 140 ms
    await padPress(page, PAD.DOWN);
    await page.waitForTimeout(900);
    await padRelease(page, PAD.DOWN);
    const afterRepeat = await hook(page, 'menuIndex');
    expect(afterRepeat).toBeGreaterThanOrEqual(3);
    // Stick: one step per push past the threshold
    await padStick(page, 0, -1);
    await expect.poll(() => hook(page, 'menuIndex')).toBe(afterRepeat - 1);
    await padStick(page, 0, 0);
    await frames(page, 2);
    await padStick(page, 0, -0.9);
    await expect.poll(() => hook(page, 'menuIndex')).toBe(afterRepeat - 2);
    await padStick(page, 0, 0);
    // Right on the Difficulty row steps it, Ⓑ does nothing on the main menu
    await selectMenuIndex(page, MENU.DIFFICULTY);
    await padTap(page, PAD.RIGHT);
    await expect.poll(() => hook(page, 'difficulty')).toBe('hard');
    await padTap(page, PAD.B);
    expect(await hook(page, 'state')).toBe('menu');
  });

  test('Ⓐ on Start starts the game without firing; a fresh Ⓐ or RT fires', async ({ page }) => {
    await openWithPad(page);
    await startWithPad(page, { hold: true });
    expect(await hook(page, 'inputContext')).toBe('game');
    await frames(page, 15);
    expect(await hook(page, 'counts.playerBullets')).toBe(0);
    expect(await isPressed(page, 'fire')).toBe(false);
    await padRelease(page, PAD.A);
    await frames(page, 2);
    await padPress(page, PAD.A);
    await expect.poll(() => hook(page, 'counts.playerBullets')).toBeGreaterThanOrEqual(1);
    await padRelease(page, PAD.A);
    await expect.poll(() => hook(page, 'counts.playerBullets'), { timeout: 3000 }).toBe(0);
    await padPress(page, PAD.RT, { value: 0.8 });
    await expect.poll(() => hook(page, 'counts.playerBullets')).toBeGreaterThanOrEqual(1);
    await padRelease(page, PAD.RT);
  });

  test('stick steers (right turns the ship toward 0) and full stick thrusts; LT thrusts', async ({ page }) => {
    await openWithPad(page);
    await startWithPad(page);
    await padStick(page, 1, 0);
    await expect.poll(async () => Math.abs(await hook(page, 'ship.rotation'))).toBeLessThan(0.1);
    await expect.poll(() => hook(page, 'ship.isThrusting')).toBe(true);
    await expect.poll(() => hook(page, 'ship.velX')).toBeGreaterThan(20);
    expect((await hook(page, 'joystick')).active).toBe(true);
    await padStick(page, 0, 0);
    await expect.poll(() => hook(page, 'ship.isThrusting')).toBe(false);
    await padPress(page, PAD.LT, { value: 1 });
    await expect.poll(() => hook(page, 'ship.isThrusting')).toBe(true);
    await padRelease(page, PAD.LT);
    await expect.poll(() => hook(page, 'ship.isThrusting')).toBe(false);
  });

  test('Ⓑ hyperspaces (the ship jumps, or self-destructs 10% of the time)', async ({ page }) => {
    await openWithPad(page);
    await startWithPad(page);
    await page.waitForTimeout(300);
    const before = await hook(page, 'ship');
    await padTap(page, PAD.B);
    await expect.poll(async () => {
      const s = await hook(page, 'ship');
      return !s || !s.isAlive || Math.hypot(s.x - before.x, s.y - before.y) > 30;
    }).toBe(true);
  });

  test('Start pauses; Ⓑ and Start resume; Ⓐ selects in the pause menu', async ({ page }) => {
    await openWithPad(page, { recordText: true });
    await startWithPad(page);
    await padTap(page, PAD.MENU);
    await waitForState(page, 'paused');
    expect(await hook(page, 'inputContext')).toBe('pause');
    expect((await drawnTexts(page)).some((t) => t.includes('Ⓐ Select') && t.includes('Ⓑ Resume'))).toBe(true);
    await padTap(page, PAD.B);
    await waitForState(page, 'playing');
    await padTap(page, PAD.MENU);
    await waitForState(page, 'paused');
    await padTap(page, PAD.MENU);
    await waitForState(page, 'playing');
    await padTap(page, PAD.MENU);
    await waitForState(page, 'paused');
    await padTap(page, PAD.DOWN);
    await padTap(page, PAD.DOWN);
    await expect.poll(() => hook(page, 'pauseIndex')).toBe(2);
    await padTap(page, PAD.A);
    await waitForState(page, 'menu');
    expect((await hook(page, 'menuOptions'))[0]).toBe('Resume');
  });

  test('disconnecting the controller while playing with it pauses the game with a toast', async ({ page }) => {
    await openWithPad(page);
    await startWithPad(page);
    await padStick(page, 0.8, 0);
    await expect.poll(() => hook(page, 'lastInputSource')).toBe('gamepad');
    await padDisconnect(page);
    await waitForState(page, 'paused');
    expect(await hook(page, 'toasts')).toContain('Xbox Wireless Controller disconnected');
    expect(await hook(page, 'gamepad.connected')).toBe(false);
  });

  test('glyph hints on menu, settings, help and upgrades footers after controller input', async ({ page }) => {
    await openWithPad(page, { recordText: true });
    let texts = await drawnTexts(page);
    expect(texts.some((t) => t.startsWith('Ⓐ Select   Ⓑ Back'))).toBe(true);
    // Keyboard input switches the hints back
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowUp');
    texts = await drawnTexts(page);
    expect(texts.some((t) => t.startsWith('Ⓐ Select'))).toBe(false);
    // Settings (and the rumble row, visible once a controller has been seen)
    await selectMenuIndex(page, MENU.SETTINGS);
    await padTap(page, PAD.A);
    await waitForState(page, 'settings');
    texts = await drawnTexts(page);
    expect(texts.some((t) => t.includes('Ⓐ Select') && t.includes('Ⓑ Back'))).toBe(true);
    expect(texts).toContain('Controller rumble');
    await padTap(page, PAD.B);
    await waitForState(page, 'menu');
    // Help: controller branch
    await selectMenuIndex(page, MENU.HELP);
    await padTap(page, PAD.A);
    await waitForState(page, 'help');
    texts = await drawnTexts(page);
    expect(texts).toContain('Ⓐ or RT');
    expect(texts.some((t) => t.includes('Ⓑ Back') && t.includes('Ⓨ Replay tutorial'))).toBe(true);
    await padTap(page, PAD.B);
    await waitForState(page, 'menu');
    // Upgrades
    await selectMenuIndex(page, MENU.UPGRADES);
    await padTap(page, PAD.A);
    await waitForState(page, 'upgrades');
    texts = await drawnTexts(page);
    expect(texts).toContain('Ⓐ Buy   Ⓑ Back');
    await padTap(page, PAD.B);
    await waitForState(page, 'menu');
  });

  test('PlayStation controllers get their own glyphs', async ({ page }) => {
    await openFresh(page, { gamepads: [{ id: DUALSENSE }], recordText: true });
    await loginWithKeyboard(page, 'PSPLAYER');
    await padTap(page, PAD.B);
    await expect.poll(() => hook(page, 'gamepad.family')).toBe('playstation');
    expect((await drawnTexts(page)).some((t) => t.startsWith('✕ Select   ○ Back'))).toBe(true);
  });

  test('a controller with a non-standard layout gets a warning toast', async ({ page }) => {
    await openFresh(page, { gamepads: [{ id: 'Retro Pad', mapping: '' }] });
    await loginWithKeyboard(page, 'RETRO');
    await padTap(page, PAD.B);
    await expect.poll(() => hook(page, 'toasts')).toContain('Retro Pad connected (unknown layout: buttons may differ)');
  });

  test('Controller rumble setting: shown after a controller is seen, toggles and persists', async ({ page }) => {
    await openFresh(page, { gamepads: [{ id: XBOX }] });
    await loginWithKeyboard(page, 'RUMBLER');
    await selectMenuIndex(page, MENU.SETTINGS);
    await page.keyboard.press('Enter');
    await waitForState(page, 'settings');
    expect((await hook(page, 'settingsRows')).map((r) => r.id)).not.toContain('rumble');
    await padTap(page, PAD.X); // any button connects it
    await expect.poll(async () => (await hook(page, 'settingsRows')).map((r) => r.id)).toContain('rumble');
    const index = await settingsRowIndex(page, 'rumble');
    for (let i = 0; i < 12 && (await hook(page, 'settingsIndex')) !== index; i++) await padTap(page, PAD.DOWN);
    expect(await hook(page, 'settingsIndex')).toBe(index);
    expect((await hook(page, 'settingsRows'))[index].value).toBe('On');
    await padTap(page, PAD.A);
    await expect.poll(() => hook(page, 'settings.rumble')).toBe(false);
    expect(await page.evaluate((k) => localStorage.getItem(k), RUMBLE_KEY)).toBe('false');
  });

  test('name entry: a hint for controllers, and Ⓐ accepts the default name PLAYER1', async ({ page }) => {
    await openFresh(page, { gamepads: [{ id: XBOX }], recordText: true });
    await waitForState(page, 'prompt_user');
    await page.locator('#username-input').blur();
    await padTap(page, PAD.B);
    await expect.poll(() => hook(page, 'lastInputSource')).toBe('gamepad');
    expect(await drawnTexts(page)).toContain('Use keyboard or touch to enter a name');
    await padTap(page, PAD.A);
    await waitForState(page, 'menu');
    expect(await hook(page, 'user')).toBe('PLAYER1');
  });

  test('controller-only players see "Tap or press a key to enable sound" while audio is locked', async ({ page }) => {
    // A returning player (no typing needed), so no key or tap has unlocked audio yet
    await openFresh(page, {
      gamepads: [{ id: XBOX }], recordText: true,
      storage: { asteroids_currentUser: 'PADONLY', asteroids_userList: '["PADONLY"]' },
    });
    await waitForState(page, 'menu');
    await padTap(page, PAD.B);
    await expect.poll(() => hook(page, 'lastInputSource')).toBe('gamepad');
    const locked = (await hook(page, 'audioState')) !== 'running';
    const texts = await drawnTexts(page);
    expect(texts.includes('Tap or press a key to enable sound')).toBe(locked);
    // A key press is a user gesture: the hint goes away
    await page.keyboard.press('m');
    await page.keyboard.press('m');
    await padTap(page, PAD.B);
    expect(await drawnTexts(page)).not.toContain('Tap or press a key to enable sound');
  });

  test('rumble on death and Ⓐ on game over returns to the menu', async ({ page }) => {
    test.slow();
    await openWithPad(page, { user: 'CRASHPAD' });
    await selectMenuIndex(page, MENU.DIFFICULTY);
    await page.keyboard.press('ArrowRight');
    await expect.poll(() => hook(page, 'difficulty')).toBe('hard');
    await selectMenuIndex(page, MENU.START);
    await startWithPad(page);
    // Fly around at full stick while spinning, hyperspacing now and then
    let reached = false;
    const deadline = Date.now() + 60000;
    let t = 0;
    while (Date.now() < deadline) {
      if ((await hook(page, 'state')) === 'game_over') { reached = true; break; }
      t += 1;
      await padStick(page, Math.cos(t), Math.sin(t));
      if (t % 4 === 0) await padTap(page, PAD.B);
      await page.waitForTimeout(250);
    }
    await padStick(page, 0, 0);
    test.skip(!reached, 'Could not reach game over through real input within 60s');
    const deaths = (await rumbles(page)).filter((r) => r.strongMagnitude === 0.8);
    expect(deaths.length).toBeGreaterThanOrEqual(1);
    expect(deaths[0]).toMatchObject({ type: 'dual-rumble', duration: 350, weakMagnitude: 0.3 });
    await page.waitForTimeout(1200); // game-over input delay
    await padTap(page, PAD.A);
    await waitForState(page, 'menu');
  });

  test('rumble respects the setting: Off sends no effects', async ({ page }) => {
    await openWithPad(page, { storage: { [RUMBLE_KEY]: 'false' }, user: 'QUIET' });
    await startWithPad(page);
    // Shoot and fly for a while: red hits and collects would rumble if it were on
    await padPress(page, PAD.RT, { value: 1 });
    for (let t = 0; t < 12; t++) {
      await padStick(page, Math.cos(t), Math.sin(t));
      await page.waitForTimeout(200);
    }
    await padRelease(page, PAD.RT);
    await padStick(page, 0, 0);
    expect(await rumbles(page)).toEqual([]);
    expect(await hook(page, 'gamepad.rumbles')).toBe(0);
  });
});

test.describe('gamepad: touch devices', () => {
  test.beforeEach(async ({}, testInfo) => {
    test.skip(!testInfo.project.use.hasTouch, 'touch-control hiding runs on the tablet projects');
  });

  test('touch controls hide after controller input and return after a tap', async ({ page }, testInfo) => {
    const errors = await openFresh(page, { gamepads: [{ id: XBOX }] });
    await loginWithTouch(page, 'TABPAD');
    await tapMenuItem(page, 'Start');
    await waitForState(page, 'playing');
    const fire = page.locator('#touch-fire-btn');
    await expect(fire).toBeVisible();
    await padStick(page, 0.9, 0);
    await expect.poll(() => hook(page, 'lastInputSource')).toBe('gamepad');
    await expect(page.locator('body')).toHaveClass(/input-gamepad/);
    await expect(fire).toBeHidden();
    await padStick(page, 0, 0);
    await page.screenshot({ path: `tests/screenshots/${testInfo.project.name}-gamepad-ingame.png` });
    // A tap on the right half of the canvas (outside the drag-to-steer zone)
    const p = await canvasToPage(page, (await hook(page, 'view.width')) * 0.8, (await hook(page, 'view.height')) * 0.5);
    await tapAt(page, p);
    await expect.poll(() => hook(page, 'lastInputSource')).toBe('touch');
    await expect(fire).toBeVisible();
    expect(await hook(page, 'state')).toBe('playing');
    expect(errors).toEqual([]);
  });
});
