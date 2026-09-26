// Controllers in multiplayer (plan 05 §8, §10.4, §3.2, §13.2, MP-5): per-controller seats,
// disconnect mid-round (reserve, pause, rejoin with Ⓐ, Drop Pn), lobby disconnect = leave,
// keyboard and controllers mixed, and 4-player co-op with the zooming camera. Desktop only;
// controllers are fake navigator.getGamepads() pads (a browser API stub, never game state).
import { test, expect } from '@playwright/test';
import {
  openFresh, hook, waitForState, frames, loginWithKeyboard, openCoopLobby, lobbyPress, lobbyPad,
  padPress, padRelease, padTap, padStick, padDisconnect, drawnTexts, rectsOverlap, PAD,
} from './helpers.js';

const XBOX = 'Xbox Wireless Controller (STANDARD GAMEPAD Vendor: 045e Product: 0b13)';
const DUALSENSE = 'DualSense Wireless Controller (STANDARD GAMEPAD Vendor: 054c Product: 0ce6)';
const TAU = Math.PI * 2;
const norm = (a) => ((a % TAU) + TAU) % TAU;
const angleGap = (a, b) => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));

async function setup(page, pads = [{ id: XBOX }, { id: DUALSENSE }]) {
  const errors = await openFresh(page, { gamepads: pads, recordText: true });
  await loginWithKeyboard(page, 'TESTER');
  await openCoopLobby(page);
  return errors;
}

/** Controllers 0 and 1 join as P1 and P2 and ready up; waits for play. */
async function joinTwoPads(page) {
  await lobbyPad(page, 0, 0, (c) => !!c && c.source === 'pad:0');
  await lobbyPad(page, 1, 1, (c) => !!c && c.source === 'pad:1');
  await lobbyPad(page, 0, 0, (c) => c.ready);
  await lobbyPad(page, 1, 1, (c) => c.ready);
  await waitForState(page, 'playing', 6000);
  await expect.poll(() => hook(page, 'players.1.ship.isAlive')).toBe(true);
}

/** Wait out the multiplayer resume countdown. */
async function waitForPlay(page) {
  await waitForState(page, 'playing');
  await expect.poll(() => hook(page, 'mp.resumeCountdown'), { timeout: 6000 }).toBe(0);
}

/** Pause menu: select an option by label with the keyboard and press Enter. */
async function choosePauseOption(page, label) {
  const options = await hook(page, 'pauseOptions');
  const target = options.indexOf(label);
  expect(target, `${label} in ${JSON.stringify(options)}`).toBeGreaterThanOrEqual(0);
  for (let i = 0; i < 10 && (await hook(page, 'pauseIndex')) !== target; i++) {
    await page.keyboard.press('ArrowDown');
    await frames(page, 2);
  }
  expect(await hook(page, 'pauseIndex')).toBe(target);
  await page.keyboard.press('Enter');
}

test.describe('controllers in multiplayer', () => {
  test.skip(({ hasTouch }) => hasTouch, 'desktop keyboard and controllers');

  test('two controllers join with Ⓐ; each card shows its own glyphs; controller 2 steers only P2', async ({ page }) => {
    const errors = await setup(page);
    await lobbyPad(page, 0, 0, (c) => !!c && c.source === 'pad:0');
    await lobbyPad(page, 1, 1, (c) => !!c && c.source === 'pad:1');
    // Glyph hints per seat: Xbox Ⓐ on P1's card, PlayStation ✕ on P2's
    await expect.poll(async () => {
      const t = await drawnTexts(page);
      return t.includes('Joined – Ⓐ when ready') && t.includes('Joined – ✕ when ready')
        && t.some((s) => s.startsWith('Controller 2 · PlayStation') && s.includes('✕ ready') && s.includes('○ leave'));
    }).toBe(true);
    await lobbyPad(page, 0, 0, (c) => c.ready);
    await lobbyPad(page, 1, 1, (c) => c.ready);
    await waitForState(page, 'playing', 6000);
    await expect.poll(() => hook(page, 'players.1.ship.isAlive')).toBe(true);
    expect((await hook(page, 'players')).map((p) => [p.label, p.seat])).toEqual([['P1', 0], ['P2', 1]]);
    expect((await hook(page, 'seats')).seats.slice(0, 2).map((s) => s.source)).toEqual(['pad:0', 'pad:1']);

    // Controller 2's stick (pointing right) turns P2 only
    const r0 = [await hook(page, 'players.0.ship.rotation'), await hook(page, 'players.1.ship.rotation')];
    await padStick(page, 0.5, 0, { pad: 1 }); // below the thrust threshold: turn only
    await expect.poll(async () => angleGap(await hook(page, 'players.1.ship.rotation'), 0)).toBeLessThan(0.1);
    expect(await page.evaluate(() => [0, 1].map((s) => window.__spaceAdventure.joystickFor(s).active))).toEqual([false, true]);
    expect(norm(await hook(page, 'players.0.ship.rotation'))).toBeCloseTo(norm(r0[0]), 5);
    expect(angleGap(r0[1], 0)).toBeGreaterThan(1);
    await padStick(page, 0, 0, { pad: 1 });

    // Controller 1's Ⓐ fires for P1 only
    await padPress(page, PAD.A, { pad: 0 });
    await expect.poll(async () => (await hook(page, 'bulletsByOwner')).p1 || 0).toBeGreaterThan(0);
    expect((await hook(page, 'bulletsByOwner')).p2 || 0).toBe(0);
    await padRelease(page, PAD.A, { pad: 0 });
    expect(errors).toEqual([]);
  });

  test('a controller disconnecting mid-round pauses with the message; Ⓐ on it again restores P2', async ({ page }) => {
    const errors = await setup(page);
    await joinTwoPads(page);

    await padDisconnect(page, { pad: 1 });
    await waitForState(page, 'paused');
    const mp = await hook(page, 'mp');
    expect(mp.pausedBy).toBe('system');
    expect(mp.reserved).toEqual([1]);
    expect(mp.disconnectNotice).toBe("P2's controller disconnected. Press Ⓐ on a controller to continue as P2, or pause menu › Drop P2");
    expect((await hook(page, 'seats')).seats[1]).toMatchObject({ source: null, reserved: true, reservedFrom: { source: 'pad:1' } });
    expect(await hook(page, 'pauseOptions')).toEqual(['Resume', 'Restart round', 'Change players', 'Main menu', 'Drop P2']);
    const texts = await drawnTexts(page);
    expect(texts).toContain("P2's controller disconnected.");
    expect(texts).toContain('or pause menu › Drop P2');
    // Nobody can resume past a reserved seat (P, Escape or Resume)
    await page.keyboard.press('Escape');
    await frames(page, 4);
    await page.keyboard.press('Enter'); // "Resume" is selected
    await frames(page, 4);
    expect(await hook(page, 'state')).toBe('paused');

    // The controller comes back: Ⓐ takes the seat again, then the 3, 2, 1 countdown
    await padPress(page, PAD.A, { pad: 1 });
    await waitForState(page, 'playing');
    expect(await hook(page, 'mp.reserved')).toEqual([]);
    expect(await hook(page, 'mp.resumeCountdown')).toBeGreaterThan(0);
    expect((await hook(page, 'seats')).seats[1]).toMatchObject({ source: 'pad:1', reserved: false });
    await padRelease(page, PAD.A, { pad: 1 });
    await waitForPlay(page);
    // P2 steers with it again
    await padStick(page, -0.5, 0, { pad: 1 });
    await expect.poll(async () => angleGap(await hook(page, 'players.1.ship.rotation'), Math.PI)).toBeLessThan(0.1);
    await padStick(page, 0, 0, { pad: 1 });
    expect(errors).toEqual([]);
  });

  test('another controller can take the reserved seat; a disconnect while paused also reserves', async ({ page }) => {
    const errors = await setup(page, [{ id: XBOX }, { id: DUALSENSE }, { id: XBOX }]);
    await joinTwoPads(page);
    await page.keyboard.press('p');
    await waitForState(page, 'paused');
    await padDisconnect(page, { pad: 0 });
    await expect.poll(() => hook(page, 'mp.reserved')).toEqual([0]);
    // An unjoined third controller's Ⓐ takes P1's seat
    await padPress(page, PAD.A, { pad: 2 });
    await waitForState(page, 'playing');
    expect((await hook(page, 'seats')).seats[0]).toMatchObject({ source: 'pad:2', reserved: false });
    await padRelease(page, PAD.A, { pad: 2 });
    await waitForPlay(page);
    await padStick(page, 0.5, 0, { pad: 2 });
    await expect.poll(async () => angleGap(await hook(page, 'players.0.ship.rotation'), 0)).toBeLessThan(0.1);
    expect(errors).toEqual([]);
  });

  test('Drop P2: the player leaves the co-op round, the others play on', async ({ page }) => {
    const errors = await setup(page);
    await joinTwoPads(page);
    await padDisconnect(page, { pad: 1 });
    await waitForState(page, 'paused');
    await choosePauseOption(page, 'Drop P2');
    await waitForState(page, 'playing');
    const p2 = await hook(page, 'players.1');
    expect(p2).toMatchObject({ dropped: true, out: true, ship: null, beacon: null });
    expect(await hook(page, 'mp.reserved')).toEqual([]);
    expect(await hook(page, 'mp.dropped')).toEqual(['P2']);
    expect((await hook(page, 'seats')).seats[1]).toBeNull();
    await waitForPlay(page);
    expect(await hook(page, 'players.0.ship.isAlive')).toBe(true);
    await expect(page.locator('.seat-hud').nth(1).locator('[data-hud="status"]')).toHaveText('LEFT THE ROUND');
    expect(errors).toEqual([]);
  });

  test('lobby: a controller that disconnects leaves its seat', async ({ page }) => {
    const errors = await setup(page);
    await lobbyPad(page, 0, 0, (c) => !!c);
    await lobbyPad(page, 1, 1, (c) => !!c);
    await lobbyPad(page, 1, 1, (c) => c.ready);
    await padDisconnect(page, { pad: 1 });
    await expect.poll(async () => (await hook(page, 'lobby.cards'))[1]).toBeNull();
    expect((await hook(page, 'seats')).seats[1]).toBeNull();
    expect(await hook(page, 'lobby.joined')).toBe(1);
    expect(await hook(page, 'state')).toBe('lobby');
    expect(errors).toEqual([]);
  });

  test('keyboard and a controller together: each drives only its own ship', async ({ page }) => {
    const errors = await setup(page, [{ id: XBOX }]);
    await lobbyPress(page, 'Space', 0, (c) => !!c && c.source === 'kbLeft');
    await lobbyPad(page, 0, 1, (c) => !!c && c.source === 'pad:0');
    await lobbyPress(page, 'Space', 0, (c) => c.ready);
    await lobbyPad(page, 0, 1, (c) => c.ready);
    await waitForState(page, 'playing', 6000);
    await expect.poll(() => hook(page, 'players.1.ship.isAlive')).toBe(true);

    // Space fires for P1, the controller's RT for P2
    await page.keyboard.down('Space');
    await expect.poll(async () => (await hook(page, 'bulletsByOwner')).p1 || 0).toBeGreaterThan(0);
    expect((await hook(page, 'bulletsByOwner')).p2 || 0).toBe(0);
    await page.keyboard.up('Space');
    await padPress(page, PAD.RT, { pad: 0 });
    await expect.poll(async () => (await hook(page, 'bulletsByOwner')).p2 || 0).toBeGreaterThan(0);
    await padRelease(page, PAD.RT, { pad: 0 });

    // D turns P1 right, the controller's stick turns P2 left
    const r0 = [await hook(page, 'players.0.ship.rotation'), await hook(page, 'players.1.ship.rotation')];
    await page.keyboard.down('d');
    await padStick(page, -0.5, 0, { pad: 0 });
    await frames(page, 10);
    await page.keyboard.up('d');
    await expect.poll(async () => angleGap(await hook(page, 'players.1.ship.rotation'), Math.PI)).toBeLessThan(0.1);
    await padStick(page, 0, 0, { pad: 0 });
    const r1 = await hook(page, 'players.0.ship.rotation');
    expect(r1).toBeGreaterThan(r0[0] + 0.2);
    expect(await page.evaluate(() => window.__spaceAdventure.isPressedSeat('rotateRight', 1))).toBe(false);
    expect(errors).toEqual([]);
  });

  test('three controllers and a keyboard: 4-player co-op zooms out and keeps every ship on screen', async ({ page }) => {
    test.setTimeout(60000);
    const errors = await setup(page, [{ id: XBOX }, { id: DUALSENSE }, { id: XBOX }]);
    await lobbyPress(page, 'Space', 0, (c) => !!c && c.source === 'kbLeft');
    for (const pad of [0, 1, 2]) await lobbyPad(page, pad, pad + 1, (c) => !!c && c.source === `pad:${pad}`);
    await lobbyPress(page, 'Space', 0, (c) => c.ready);
    for (const pad of [0, 1, 2]) await lobbyPad(page, pad, pad + 1, (c) => c.ready);
    await waitForState(page, 'playing', 6000);
    await expect.poll(() => hook(page, 'players.3.ship.isAlive')).toBe(true);
    const players = await hook(page, 'players');
    expect(players.map((p) => [p.label, p.seat])).toEqual([['P1', 0], ['P2', 1], ['P3', 2], ['P4', 3]]);
    expect(new Set(players.map((p) => p.colour)).size).toBe(4);
    expect(players.map((p) => p.hullMark)).toEqual(['none', 'stripe', 'dot', 'notch']);
    expect(await hook(page, 'mp.playerCount')).toBe(4);
    expect((await hook(page, 'mp.scaling')).asteroidCount).toBe(25); // co-op scaling for 4
    // Compact HUD: two panels per side bar, clear of the play area
    await expect(page.locator('body')).toHaveClass(/mp-many/);
    const panels = page.locator('.seat-hud');
    await expect(panels).toHaveCount(4);
    const canvas = await page.locator('#gameCanvas').boundingBox();
    const view = await hook(page, 'view');
    for (let i = 0; i < 4; i++) {
      const b = await panels.nth(i).boundingBox();
      expect(rectsOverlap(b, canvas), `panel ${i}`).toBe(false);
      expect(b.y + b.height).toBeLessThanOrEqual(800);
    }

    // Fly apart: P2 up, P3 down, P4 right (full stick = turn and thrust)
    await padStick(page, 0, -1, { pad: 0 });
    await padStick(page, 0, 1, { pad: 1 });
    await padStick(page, 1, 0, { pad: 2 });
    // Watch every frame; let go of the sticks (the fake pads) as soon as the camera zooms out
    const zoomed = await page.evaluate(() => new Promise((resolve) => {
      const start = performance.now();
      const tick = () => {
        const z = window.__spaceAdventure.camera.zoom;
        if (z < 0.97 || performance.now() - start > 15000) {
          for (const p of window.__pads) if (p) { p.axes[0] = 0; p.axes[1] = 0; }
          resolve(z);
          return;
        }
        requestAnimationFrame(tick);
      };
      tick();
    }));
    expect(zoomed).toBeLessThan(0.97);
    // Every living ship is inside the view (the camera zooms out instead of losing anyone; it
    // glides, so allow it a moment to catch up with ships still drifting apart)
    const onScreen = () => page.evaluate(() => {
      const g = window.__spaceAdventure;
      const cam = g.camera, W = g.world.width, H = g.world.height, v = g.view;
      const wrap = (d, size) => d - size * Math.round(d / size);
      return g.players.filter((p) => p.ship && p.ship.isAlive && p.respawnTimer <= 0).map((p) => {
        const x = v.width / 2 + wrap(p.ship.x - cam.x, W) * cam.zoom;
        const y = v.height / 2 + wrap(p.ship.y - cam.y, H) * cam.zoom;
        return { label: p.label, ok: x >= 0 && x <= v.width && y >= 0 && y <= v.height, x, y, zoom: cam.zoom };
      });
    });
    await expect.poll(async () => {
      const list = await onScreen();
      return list.length >= 2 && list.every((s) => s.ok) ? 'all on screen' : JSON.stringify(list);
    }, { timeout: 4000 }).toBe('all on screen');
    expect(await hook(page, 'camera.zoom')).toBeLessThan(1);
    expect(await hook(page, 'camera.zoom')).toBeGreaterThanOrEqual(0.75);
    // Radar numbers and edge arrows use each player's number
    const texts = await drawnTexts(page);
    const living = (await hook(page, 'players')).filter((p) => p.ship && p.ship.isAlive && p.respawnTimer <= 0);
    expect(living.length).toBeGreaterThanOrEqual(2);
    for (const p of living) expect(texts).toContain(String(p.number));
    expect(view.width).toBeGreaterThan(0);
    expect(errors).toEqual([]);
  });
});
