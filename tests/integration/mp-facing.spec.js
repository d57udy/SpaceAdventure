// Facing layout: two players across a flat tablet (plan 05 §9, §11, finding 6, MP-4). P1 sits
// at the bottom edge, P2 at the top with their controls and HUD turned 180°. Touch steering is
// never rotated: a finger dragged toward the bottom of the glass points the ship there.
// Runs on the iPad WebKit projects (portrait: Auto gives facing; landscape: Facing chosen).
import { test, expect } from '@playwright/test';
import {
  openFresh, hook, waitForState, frames, loginWithTouch, tapAt, menuItemCenter, tapRegionCenter, canvasToPage,
  centerOf, rectsOverlap, Fingers, padTap, padStick, PAD,
} from './helpers.js';

const angDist = (a, b) => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));
const isLandscape = (page) => { const v = page.viewportSize(); return v.width > v.height; };
const LAYOUT_KEY = 'spaceAdventure_mpLayout';

async function openTouchLobby(page, modeId, { storage = {}, url = '/' } = {}) {
  const errors = await openFresh(page, { storage, url });
  await loginWithTouch(page, 'TOUCHY');
  await tapAt(page, await menuItemCenter(page, 'Multiplayer'));
  await waitForState(page, 'mp_mode_select');
  const rows = await hook(page, 'mp.modeSelect.rows');
  expect(rows).toEqual(['turns', 'coop', 'harvest', 'duel', 'saucer', 'timeattack', 'back']);
  await tapAt(page, await tapRegionCenter(page, rows.indexOf(modeId)));
  await waitForState(page, 'lobby');
  expect(await hook(page, 'lobby.modeId')).toBe(modeId);
  return errors;
}

const card = async (page, seat) => (await hook(page, 'lobby.cards'))[seat];
async function tapPad(page, zone, seat, check) {
  await tapAt(page, await centerOf(page, `#join-pad-${zone}`));
  await expect.poll(async () => check(await card(page, seat)), { message: `pad ${zone} -> card ${seat}` }).toBe(true);
}
async function joinBoth(page) {
  await tapPad(page, 'a', 0, (c) => !!c && c.source === 'touch:a');
  await tapPad(page, 'b', 1, (c) => !!c && c.source === 'touch:b');
  await tapPad(page, 'a', 0, (c) => c.ready);
  await tapPad(page, 'b', 1, (c) => c.ready);
  await waitForState(page, 'playing', 6000);
  await expect.poll(() => hook(page, 'players.1.ship.isAlive')).toBe(true);
}

/** Page point of the tap region with this id (rotated copy or upright). */
async function regionPoint(page, id, rotated) {
  await expect.poll(async () => (await hook(page, 'tapRegions')).some((r) => r.id === id && r.rotated === rotated),
    { message: `tap region ${id} rotated=${rotated}` }).toBe(true);
  const r = (await hook(page, 'tapRegions')).find((q) => q.id === id && q.rotated === rotated);
  return canvasToPage(page, r.x + r.w / 2, r.y + r.h / 2);
}

async function canvasPoint(page, fx, fy) {
  const c = await page.locator('#gameCanvas').boundingBox();
  return { x: Math.round(c.x + c.width * fx), y: Math.round(c.y + c.height * fy) };
}

/** 2x2 matrix part of an element's computed transform (a, b, c, d). */
function transformOf(page, selector) {
  return page.evaluate((sel) => {
    const t = getComputedStyle(document.querySelector(sel)).transform;
    if (!t || t === 'none') return [1, 0, 0, 1];
    const m = t.match(/matrix\(([^)]+)\)/);
    return m ? m[1].split(',').slice(0, 4).map((v) => Math.round(Number(v) * 1000) / 1000) : null;
  }, selector);
}

async function expectP2Rotated(page) {
  // P2's HUD panel sits in the rotated column; P1's is upright
  await expect(page.locator('#mp-hud-right .seat-hud[data-seat="1"]')).toHaveCount(1);
  await expect(page.locator('#mp-hud-left .seat-hud[data-seat="0"]')).toHaveCount(1);
  expect(await transformOf(page, '#mp-hud-right')).toEqual([-1, 0, 0, -1]);
  expect(await transformOf(page, '.touch-zone-b')).toEqual([-1, 0, 0, -1]);
  const left = await transformOf(page, '#mp-hud-left');
  expect([left[0], left[3]]).toEqual([1, 1]);
}

async function expectP2DragDown(page, browserName) {
  // P2 drags toward the bottom of the screen: the ship turns to face the bottom (+π/2)
  const f = new Fingers(page, browserName);
  await f.downAt(1, await canvasPoint(page, 0.5, 0.2));
  await f.moveBy(1, 0, 50);
  await expect.poll(() => page.evaluate(() => window.__spaceAdventure.joystickFor(1).active)).toBe(true);
  const j = await page.evaluate(() => window.__spaceAdventure.joystickFor(1));
  expect(angDist(j.angle, Math.PI / 2)).toBeLessThan(0.05);
  expect(await page.evaluate(() => window.__spaceAdventure.joystickFor(0).active)).toBe(false);
  await expect.poll(async () => angDist(await hook(page, 'players.1.ship.rotation'), Math.PI / 2), { timeout: 3000 })
    .toBeLessThan(0.15);
  // And P2 fires with their own (rotated) fire button
  await f.down(2, '#touch-fire-btn-b');
  await expect.poll(async () => ((await hook(page, 'bulletsByOwner')).p2 || 0) > 0).toBe(true);
  await f.releaseAll();
}

test.describe('facing layout (iPad)', () => {
  test.skip(({ browserName, hasTouch }) => browserName !== 'webkit' || !hasTouch, 'iPad WebKit');

  test('portrait (Auto): Harvest facing; P2 steering not rotated, P2 HUD and controls turned 180°; rotated pause menu; rotation pauses', async ({ page, browserName }) => {
    test.skip(isLandscape(page), 'portrait');
    test.setTimeout(60000);
    const errors = await openTouchLobby(page, 'harvest');
    expect(await hook(page, 'mp.layout')).toBe('facing');
    expect(await hook(page, 'lobby.options.rows')).toEqual(['option', 'layout']);
    // Join pads: P1's below the canvas, P2's above it, both fully on screen
    const vp = page.viewportSize();
    const lc = await page.locator('#gameCanvas').boundingBox();
    for (const [id, below] of [['#join-pad-a', true], ['#join-pad-b', false]]) {
      const b = await page.locator(id).boundingBox();
      expect(b.x, id).toBeGreaterThanOrEqual(0);
      expect(b.x + b.width, id).toBeLessThanOrEqual(vp.width);
      if (below) expect(b.y, id).toBeGreaterThanOrEqual(lc.y + lc.height - 1);
      else expect(b.y + b.height, id).toBeLessThanOrEqual(lc.y + 1);
    }
    await page.screenshot({ path: `tests/screenshots/${test.info().project.name}-facing-lobby.png` });
    await joinBoth(page);
    expect(await hook(page, 'mp')).toMatchObject({ layout: 'facing', zones: ['a', 'b'], hud: 'dom', landscape: false });

    // Controls: P1's below the canvas, P2's above it; nothing overlaps the play area
    const canvas = await page.locator('#gameCanvas').boundingBox();
    for (const sel of ['#touch-fire-btn', '#touch-hyper-btn', '#touch-pause-btn']) {
      const b = await page.locator(sel).boundingBox();
      expect(b.y, sel).toBeGreaterThanOrEqual(canvas.y + canvas.height - 1);
    }
    for (const sel of ['#touch-fire-btn-b', '#touch-hyper-btn-b', '#touch-pause-btn-b']) {
      const b = await page.locator(sel).boundingBox();
      expect(b.y + b.height, sel).toBeLessThanOrEqual(canvas.y + 1);
      expect(b.y, `${sel} clear of the top edge`).toBeGreaterThanOrEqual(20);
      expect(rectsOverlap(b, canvas), sel).toBe(false);
    }
    // P2's fire sits on their right hand: the screen's left
    expect((await page.locator('#touch-fire-btn-b').boundingBox()).x).toBeLessThan(canvas.x + canvas.width / 2);
    await expectP2Rotated(page);
    await page.waitForTimeout(3200); // past the intro banner
    await expectP2DragDown(page, browserName);
    await page.screenshot({ path: `tests/screenshots/${test.info().project.name}-facing-harvest.png` });

    // P2 pauses; the menu is drawn for both players and the rotated copy works
    await tapAt(page, await centerOf(page, '#touch-pause-btn-b'));
    await waitForState(page, 'paused');
    expect(await hook(page, 'mp.pausedBy')).toBe(1);
    const upright = await regionPoint(page, 'pause:Resume', false);
    const rotated = await regionPoint(page, 'pause:Resume', true);
    expect(upright.y).toBeGreaterThan(canvas.y + canvas.height / 2);
    expect(rotated.y).toBeLessThan(canvas.y + canvas.height / 2);
    await page.screenshot({ path: `tests/screenshots/${test.info().project.name}-facing-paused.png` });
    await tapAt(page, rotated);
    await waitForState(page, 'playing');
    expect(await hook(page, 'mp.resumeCountdown')).toBeGreaterThan(0);
    await expect.poll(() => hook(page, 'mp.resumeCountdown'), { timeout: 5000 }).toBe(0);

    // Turning the tablet mid-round pauses (system) and lays out side by side; resume counts down
    await page.setViewportSize({ width: 1080, height: 810 });
    await waitForState(page, 'paused');
    expect(await hook(page, 'mp.pausedBy')).toBe('system');
    await expect.poll(() => hook(page, 'mp.layout')).toBe('sides');
    await tapAt(page, await tapRegionCenter(page, 0)); // Resume (one upright menu now)
    await waitForState(page, 'playing');
    expect(await hook(page, 'mp.resumeCountdown')).toBeGreaterThan(0);
    expect(errors).toEqual([]);
  });

  test('portrait: results in both halves; the rotated Main menu button works', async ({ page }) => {
    test.skip(isLandscape(page), 'portrait');
    test.setTimeout(90000);
    await openTouchLobby(page, 'harvest', { url: '/?roundSeconds=3' });
    await joinBoth(page);
    await waitForState(page, 'results', 40000); // 3 s, plus 20 s of overtime on a tie
    await expect.poll(() => hook(page, 'results.inputDelay')).toBe(0);
    const canvas = await page.locator('#gameCanvas').boundingBox();
    const up = await regionPoint(page, 'results:Main menu', false);
    const rot = await regionPoint(page, 'results:Main menu', true);
    expect(up.y).toBeGreaterThan(canvas.y + canvas.height / 2);
    expect(rot.y).toBeLessThan(canvas.y + canvas.height / 2);
    await expect(page.locator('.ui-overlay')).toBeHidden(); // the canvas draws both copies
    await page.screenshot({ path: `tests/screenshots/${test.info().project.name}-facing-results.png` });
    await tapAt(page, rot);
    await waitForState(page, 'menu');
  });

  test('portrait with Side by side chosen: rotate prompt; the lobby layout row switches to Facing', async ({ page }) => {
    test.skip(isLandscape(page), 'portrait');
    const errors = await openTouchLobby(page, 'coop', { storage: { [LAYOUT_KEY]: 'sides' } });
    expect(await hook(page, 'mp.layout')).toBe('rotate');
    await expect(page.locator('#mp-rotate-prompt')).toBeVisible();
    await expect(page.locator('#mp-rotate-prompt')).toContainText('Rotate to landscape');
    await expect(page.locator('#join-pad-a')).toBeHidden();
    await page.screenshot({ path: `tests/screenshots/${test.info().project.name}-coop-rotate.png` });
    // Layout row: tap its right part to step Side by side -> Facing
    const r = (await hook(page, 'tapRegions')).find((q) => q.id === 'lobby:layout');
    expect(r).toBeTruthy();
    await tapAt(page, await canvasToPage(page, r.x + r.w * 0.8, r.y + r.h / 2));
    await expect.poll(() => hook(page, 'mp.layoutSetting')).toBe('facing');
    await expect.poll(() => hook(page, 'mp.layout')).toBe('facing');
    await expect(page.locator('#mp-rotate-prompt')).toBeHidden();
    await expect(page.locator('#join-pad-b')).toBeVisible();
    expect(errors).toEqual([]);
  });

  test('landscape with Facing chosen: Duel; P1 in the lower bar halves, P2 upper and turned 180°', async ({ page, browserName }) => {
    test.skip(!isLandscape(page), 'landscape');
    test.setTimeout(60000);
    const errors = await openTouchLobby(page, 'duel', { storage: { [LAYOUT_KEY]: 'facing' } });
    expect(await hook(page, 'mp.layout')).toBe('facing');
    await joinBoth(page);
    expect(await hook(page, 'mp')).toMatchObject({ layout: 'facing', landscape: true, zones: ['a', 'b'] });
    const vp = page.viewportSize();
    const canvas = await page.locator('#gameCanvas').boundingBox();
    const a = await page.locator('#touch-fire-btn').boundingBox();
    const b = await page.locator('#touch-fire-btn-b').boundingBox();
    expect(a.y).toBeGreaterThan(vp.height / 2);
    expect(a.x).toBeGreaterThanOrEqual(canvas.x + canvas.width - 1); // right bar
    expect(b.y + b.height).toBeLessThan(vp.height / 2);
    expect(b.x + b.width).toBeLessThanOrEqual(canvas.x + 1); // left bar
    await expectP2Rotated(page);
    await page.waitForTimeout(3200);
    await expectP2DragDown(page, browserName);
    await frames(page, 5);
    await page.screenshot({ path: `tests/screenshots/${test.info().project.name}-facing-duel.png` });
    expect(errors).toEqual([]);
  });

  test('portrait: a controller player at the top edge gets their stick turned 180° (MP-5)', async ({ page }) => {
    test.skip(isLandscape(page), 'portrait');
    const errors = await openFresh(page, { gamepads: [{}] });
    await loginWithTouch(page, 'TOUCHY');
    await tapAt(page, await menuItemCenter(page, 'Multiplayer'));
    await waitForState(page, 'mp_mode_select');
    const rows = await hook(page, 'mp.modeSelect.rows');
    await tapAt(page, await tapRegionCenter(page, rows.indexOf('coop')));
    await waitForState(page, 'lobby');
    // P1 touches the bottom pad, P2 joins with a controller (seat 2: the top side)
    await tapPad(page, 'a', 0, (c) => !!c && c.source === 'touch:a');
    await padTap(page, PAD.A);
    await expect.poll(async () => (await card(page, 1))?.source).toBe('pad:0');
    await tapPad(page, 'a', 0, (c) => c.ready);
    await padTap(page, PAD.A);
    await waitForState(page, 'playing', 6000);
    await expect.poll(() => hook(page, 'players.1.ship.isAlive')).toBe(true);
    expect(await hook(page, 'mp.layout')).toBe('facing');
    await expect.poll(() => hook(page, 'mp.orientations')).toEqual([0, 180, 0, 0]);
    await expect(page.locator('#mp-hud-right .seat-hud[data-seat="1"]')).toHaveCount(1);
    // Stick pushed to the controller's right = the screen's left for the top player
    await padStick(page, 0.5, 0);
    await expect.poll(async () => angDist(await hook(page, 'players.1.ship.rotation'), Math.PI)).toBeLessThan(0.1);
    await padStick(page, 0, 0);
    expect(errors).toEqual([]);
  });
});
