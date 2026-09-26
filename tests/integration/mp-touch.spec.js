// Co-op on one tablet, side by side (plan 05 §8 pointer routing, §9 layouts, §10.2 join pads,
// §13.2 MP-3). Runs on iPad landscape (WebKit) and Chromium with touch; the portrait iPad
// project only checks that the lobby switches to the facing layout (mp-facing.spec.js covers it).
import { test, expect } from '@playwright/test';
import {
  MENU, openFresh, hook, waitForState, frames, loginWithTouch, tapAt, menuItemCenter, tapRegionCenter,
  tapRegionPoint, centerOf, rectsOverlap, Fingers,
} from './helpers.js';

const angDist = (a, b) => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));
const ROT_TOL = 0.15;
const isLandscape = (page) => { const v = page.viewportSize(); return v.width > v.height; };

const ZONE_A = ['#touch-fire-btn', '#touch-hyper-btn', '#touch-pause-btn'];
const ZONE_B = ['#touch-fire-btn-b', '#touch-hyper-btn-b', '#touch-pause-btn-b'];

async function openCoopTouchLobby(page, { hard = false } = {}) {
  const errors = await openFresh(page);
  await loginWithTouch(page, 'TOUCHY');
  if (hard) {
    await tapAt(page, await tapRegionPoint(page, MENU.DIFFICULTY, 0.9));
    await expect.poll(() => hook(page, 'difficulty')).toBe('hard');
  }
  await tapAt(page, await menuItemCenter(page, 'Multiplayer'));
  await waitForState(page, 'mp_mode_select');
  expect(await hook(page, 'mp.modeSelect.rows')).toEqual(['turns', 'coop', 'harvest', 'duel', 'timeattack', 'back']);
  await tapAt(page, await tapRegionCenter(page, 1));
  await waitForState(page, 'lobby');
  expect(await hook(page, 'lobby')).toMatchObject({ kind: 'seats', modeId: 'coop' });
  return errors;
}

const card = async (page, seat) => (await hook(page, 'lobby.cards'))[seat];

/** Tap a join pad and wait until the card of `seat` matches `check`. */
async function tapPad(page, zone, seat, check) {
  await tapAt(page, await centerOf(page, `#join-pad-${zone}`));
  await expect.poll(async () => check(await card(page, seat)), { message: `pad ${zone} -> card ${seat}` }).toBe(true);
}

async function startTouchCoop(page, opts = {}) {
  const errors = await openCoopTouchLobby(page, opts);
  await tapPad(page, 'a', 0, (c) => !!c && c.source === 'touch:a');
  await tapPad(page, 'b', 1, (c) => !!c && c.source === 'touch:b');
  await tapPad(page, 'a', 0, (c) => c.ready);
  await tapPad(page, 'b', 1, (c) => c.ready);
  await waitForState(page, 'playing', 6000);
  await expect.poll(() => hook(page, 'players.1.ship.isAlive')).toBe(true);
  await expect(page.locator('#touch-fire-btn-b')).toBeVisible();
  return errors;
}

/** A point in the play area: fx across the canvas, fy down it. */
async function canvasPoint(page, fx, fy) {
  const c = await page.locator('#gameCanvas').boundingBox();
  return { x: Math.round(c.x + c.width * fx), y: Math.round(c.y + c.height * fy) };
}

async function midX(page) {
  return page.evaluate(() => window.innerWidth / 2);
}

test.describe('co-op side by side (touch)', () => {
  test.skip(({ hasTouch }) => !hasTouch, 'touch devices');
  test.beforeEach(({ page }) => {
    test.skip(!isLandscape(page), 'side by side is landscape only');
  });

  test('join pads: tap to join and ready, hold to leave; layout and lobby notes', async ({ page }) => {
    const errors = await openCoopTouchLobby(page);
    const mp = await hook(page, 'mp');
    expect(mp.layout).toBe('sides');
    expect(mp.bar).toBeGreaterThanOrEqual(120);
    expect(mp.touchWarning).toBe(mp.maxTouchPoints < 4);
    await expect(page.locator('#join-pad-a')).toBeVisible();
    await expect(page.locator('#join-pad-b')).toBeVisible();
    await expect(page.locator('#mp-rotate-prompt')).toBeHidden();
    // Pads sit in the side bars, clear of the play area
    const canvas = await page.locator('#gameCanvas').boundingBox();
    for (const id of ['#join-pad-a', '#join-pad-b']) {
      const b = await page.locator(id).boundingBox();
      expect(rectsOverlap(b, canvas), id).toBe(false);
      expect(Math.min(b.width, b.height)).toBeGreaterThanOrEqual(48);
    }

    await tapPad(page, 'b', 0, (c) => !!c && c.source === 'touch:b'); // lowest free seat
    await expect(page.locator('#join-pad-b .join-pad-text')).toHaveText('Tap when ready');
    await tapPad(page, 'a', 1, (c) => !!c && c.source === 'touch:a');
    expect((await card(page, 0)).name).toBe('TOUCHY');
    // Hold to leave (a ready player unreadies first)
    await tapPad(page, 'b', 0, (c) => c.ready);
    await expect(page.locator('#join-pad-b .join-pad-text')).toHaveText('READY');
    const f = new Fingers(page, test.info().project.use.browserName);
    for (const expected of [(c) => !!c && !c.ready, (c) => c === null]) {
      await f.downAt(1, await centerOf(page, '#join-pad-b'));
      await page.waitForTimeout(800);
      await f.up(1);
      await expect.poll(async () => expected(await card(page, 0))).toBe(true);
    }
    expect(await hook(page, 'lobby.joined')).toBe(1);
    await expect(page.locator('#join-pad-b .join-pad-text')).toHaveText('Tap to join');
    // The Back button asks first while someone is joined
    const regions = await hook(page, 'tapRegions');
    const back = regions[regions.length - 1];
    const backPoint = await page.evaluate(([x, y]) => {
      const c = document.getElementById('gameCanvas').getBoundingClientRect();
      const v = window.__spaceAdventure.view;
      return { x: c.left + x * (c.width / v.width), y: c.top + y * (c.height / v.height) };
    }, [back.x + back.w / 2, back.y + back.h / 2]);
    await tapAt(page, backPoint);
    await expect.poll(() => hook(page, 'lobby.exitNotice')).toBeGreaterThan(0);
    await tapAt(page, backPoint);
    await waitForState(page, 'mp_mode_select');
    expect(errors).toEqual([]);
  });

  test('four fingers: P1 drags right, P2 drags up, both hold fire', async ({ page, browserName }) => {
    test.info().annotations.push({ type: 'note', text: 'retried: an asteroid can hit a ship mid-test' });
    const errors = await startTouchCoop(page);
    expect(await hook(page, 'mp')).toMatchObject({ layout: 'sides', zones: ['a', 'b'], simultaneous: true });
    expect(await hook(page, 'controlMode')).toBe('joystick');
    const f = new Fingers(page, browserName);
    await f.downAt(1, await canvasPoint(page, 0.25, 0.6));
    await f.downAt(2, await canvasPoint(page, 0.75, 0.6));
    await f.moveBy(1, 50, 0);
    await f.moveBy(2, 0, -50);
    await f.down(3, '#touch-fire-btn');
    await f.down(4, '#touch-fire-btn-b');
    await expect.poll(() => page.evaluate(() => [0, 1].map((s) => window.__spaceAdventure.joystickFor(s).active)))
      .toEqual([true, true]);
    const [j0, j1] = await page.evaluate(() => [0, 1].map((s) => window.__spaceAdventure.joystickFor(s)));
    expect(angDist(j0.angle, 0)).toBeLessThan(0.05);
    expect(angDist(j1.angle, -Math.PI / 2)).toBeLessThan(0.05);
    await expect.poll(async () => angDist(await hook(page, 'players.0.ship.rotation'), 0), { timeout: 3000 }).toBeLessThan(ROT_TOL);
    await expect.poll(async () => angDist(await hook(page, 'players.1.ship.rotation'), -Math.PI / 2), { timeout: 3000 }).toBeLessThan(ROT_TOL);
    await expect.poll(async () => {
      const b = await hook(page, 'bulletsByOwner');
      return (b.p1 || 0) > 0 && (b.p2 || 0) > 0;
    }).toBe(true);
    expect(await page.evaluate(() => [0, 1].map((s) => window.__spaceAdventure.isPressedSeat('fire', s)))).toEqual([true, true]);
    await expect(page.locator('#touch-fire-btn')).toHaveClass(/active/);
    await expect(page.locator('#touch-fire-btn-b')).toHaveClass(/active/);
    await page.screenshot({ path: `tests/screenshots/${test.info().project.name}-coop-four-fingers.png` });
    await f.releaseAll();
    await expect.poll(() => page.evaluate(() => [0, 1].map((s) => window.__spaceAdventure.isPressedSeat('fire', s))))
      .toEqual([false, false]);
    expect(errors).toEqual([]);
  });

  test('taps 5 px either side of the middle go to the right player; a finger crossing it keeps its seat', async ({ page, browserName }) => {
    await startTouchCoop(page);
    const mid = await midX(page);
    const y = (await canvasPoint(page, 0.5, 0.55)).y;
    const f = new Fingers(page, browserName);
    const active = () => page.evaluate(() => [0, 1].map((s) => window.__spaceAdventure.joystickFor(s).active));
    await f.downAt(1, { x: mid - 5, y });
    await expect.poll(active).toEqual([true, false]);
    await f.up(1);
    await expect.poll(active).toEqual([false, false]);
    await f.downAt(2, { x: mid + 5, y });
    await expect.poll(active).toEqual([false, true]);
    await f.up(2);
    await expect.poll(active).toEqual([false, false]);

    // P1's finger slides right across the middle: still P1's stick, P2's stays free
    await f.downAt(3, { x: mid - 60, y });
    await f.moveBy(3, 120, 0, 6);
    await expect.poll(active).toEqual([true, false]);
    const j = await page.evaluate(() => window.__spaceAdventure.joystickFor(0));
    expect(angDist(j.angle, 0)).toBeLessThan(0.05);
    expect(j.magnitude).toBeCloseTo(1, 1);
    await f.up(3);
    await expect.poll(active).toEqual([false, false]);
  });

  test('palm rule: a finger resting 500 ms in a zone gives the stick to a new finger there', async ({ page, browserName }) => {
    await startTouchCoop(page);
    const f = new Fingers(page, browserName);
    const stick = (s) => page.evaluate((seat) => window.__spaceAdventure.joystickFor(seat), s);
    await f.downAt(1, await canvasPoint(page, 0.2, 0.75)); // a resting palm in P1's half
    await page.waitForTimeout(700);
    await f.downAt(2, await canvasPoint(page, 0.3, 0.4));
    await f.moveBy(2, 0, -45);
    await expect.poll(async () => angDist((await stick(0)).angle, -Math.PI / 2)).toBeLessThan(0.05);
    // The palm's movement no longer steers
    await f.moveBy(1, 40, 0);
    await frames(page, 3);
    expect(angDist((await stick(0)).angle, -Math.PI / 2)).toBeLessThan(0.05);
    expect((await stick(1)).active).toBe(false);
    await f.releaseAll();
  });

  test('zone B buttons: shown, at least 48 px, inside the screen, no overlaps; per-seat pause', async ({ page }) => {
    const errors = await startTouchCoop(page);
    const vp = page.viewportSize();
    const canvas = await page.locator('#gameCanvas').boundingBox();
    const boxes = {};
    for (const sel of [...ZONE_A, ...ZONE_B]) {
      const b = await page.locator(sel).boundingBox();
      expect(b, sel).not.toBeNull();
      boxes[sel] = b;
      expect(b.x, `${sel} left`).toBeGreaterThanOrEqual(0);
      expect(b.y, `${sel} top`).toBeGreaterThanOrEqual(0);
      expect(b.x + b.width, `${sel} right`).toBeLessThanOrEqual(vp.width);
      expect(b.y + b.height, `${sel} bottom`).toBeLessThanOrEqual(vp.height);
      expect(Math.min(b.width, b.height), `${sel} >= 48px`).toBeGreaterThanOrEqual(48);
      expect(rectsOverlap(b, canvas), `${sel} covers the play area`).toBe(false);
      // Away from the system swipe edges
      expect(b.y, `${sel} top edge`).toBeGreaterThanOrEqual(20);
      expect(vp.height - (b.y + b.height), `${sel} bottom edge`).toBeGreaterThanOrEqual(20);
      const hit = await page.evaluate((q) => {
        const r = document.querySelector(q).getBoundingClientRect();
        const el = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
        const btn = el && el.closest('.touch-btn');
        return btn ? btn.id : (el ? `${el.tagName}#${el.id}` : null);
      }, sel);
      expect(hit, sel).toBe(sel.slice(1));
    }
    const names = Object.keys(boxes);
    for (let i = 0; i < names.length; i++) {
      for (let k = i + 1; k < names.length; k++) {
        expect(rectsOverlap(boxes[names[i]], boxes[names[k]]), `${names[i]} overlaps ${names[k]}`).toBe(false);
      }
    }
    // P1's controls in the left bar, P2's (mirrored) in the right bar
    for (const sel of ZONE_A) expect(boxes[sel].x + boxes[sel].width).toBeLessThanOrEqual(canvas.x);
    for (const sel of ZONE_B) expect(boxes[sel].x).toBeGreaterThanOrEqual(canvas.x + canvas.width);
    // HUD panels in the bars; the single-player HUD line is hidden
    await expect(page.locator('.seat-hud')).toHaveCount(2);
    await expect(page.locator('.ui-overlay')).toBeHidden();
    await expect(page.locator('#touch-thrust-btn')).toBeHidden(); // Drag to Steer only

    // P2's pause button: the pause says who
    await tapAt(page, await centerOf(page, '#touch-pause-btn-b'));
    await waitForState(page, 'paused');
    expect(await hook(page, 'mp.pausedBy')).toBe(1);
    await expect(page.locator('.seat-hud').nth(1).locator('[data-hud="status"]')).toHaveText('PAUSED (by you)');
    expect(errors).toEqual([]);
  });

  test('screenshots: lobby, in game with a beacon, results (side by side)', async ({ page, browserName }) => {
    test.setTimeout(90000);
    const name = test.info().project.name;
    await openCoopTouchLobby(page, { hard: true });
    await tapPad(page, 'a', 0, (c) => !!c);
    await tapPad(page, 'b', 1, (c) => !!c);
    await tapPad(page, 'a', 0, (c) => c.ready);
    await page.screenshot({ path: `tests/screenshots/${name}-coop-lobby.png` });
    await tapPad(page, 'b', 1, (c) => c.ready);
    await waitForState(page, 'playing', 6000);
    await page.waitForTimeout(3200); // past the LEVEL banner
    await page.screenshot({ path: `tests/screenshots/${name}-coop-ingame.png` });

    // Hyperspace self-destructs by touch (Math.random stubbed for the jump only)
    const f = new Fingers(page, browserName);
    const selfDestructTap = async (sel) => {
      await page.evaluate(() => {
        const real = window.__realRandom || Math.random;
        window.__realRandom = real;
        Math.random = () => {
          if (!String(new Error().stack).includes('hyperspace')) return real();
          Math.random = real;
          return 0.01;
        };
      });
      await f.down(9, sel);
      await frames(page, 3);
      await f.up(9);
    };
    const loseLifeBy = async (i, sel) => {
      const before = await hook(page, `players.${i}.lives`);
      await expect(async () => {
        const p = (await hook(page, 'players'))[i];
        if (p.lives === before && p.ship && p.ship.isAlive) await selfDestructTap(sel);
        expect(await hook(page, `players.${i}.lives`)).toBe(before - 1);
      }).toPass({ timeout: 15000, intervals: [500] });
    };
    // P1 to 1 life (can't revive), then P2 out
    await loseLifeBy(0, '#touch-hyper-btn');
    for (let k = 0; k < 2; k++) {
      await expect.poll(() => hook(page, 'players.1.ship.isAlive'), { timeout: 8000 }).toBe(true);
      await loseLifeBy(1, '#touch-hyper-btn-b');
    }
    await page.waitForTimeout(400);
    await page.screenshot({ path: `tests/screenshots/${name}-coop-beacon.png` });
    await expect.poll(() => hook(page, 'players.0.ship.isAlive'), { timeout: 8000 }).toBe(true);
    await loseLifeBy(0, '#touch-hyper-btn');
    await waitForState(page, 'results', 8000);
    await expect.poll(() => hook(page, 'results.inputDelay')).toBe(0);
    await page.screenshot({ path: `tests/screenshots/${name}-coop-results.png` });
    expect(await hook(page, 'results.kind')).toBe('coop');
  });
});

test.describe('co-op on a portrait tablet', () => {
  test.skip(({ hasTouch }) => !hasTouch, 'touch devices');
  test.beforeEach(({ page }) => {
    test.skip(isLandscape(page), 'portrait only');
  });

  test('the lobby uses the facing layout (Auto): join pads at the bottom and top, no rotate prompt', async ({ page }) => {
    const errors = await openCoopTouchLobby(page);
    expect(await hook(page, 'mp.layout')).toBe('facing');
    expect(await hook(page, 'mp.layoutSetting')).toBe('auto');
    await expect(page.locator('#mp-rotate-prompt')).toBeHidden();
    await expect(page.locator('#join-pad-a')).toBeVisible();
    await expect(page.locator('#join-pad-b')).toBeVisible();
    await expect(page.locator('#join-pad-a .join-pad-title')).toHaveText('BOTTOM PLAYER');
    await expect(page.locator('#join-pad-b .join-pad-title')).toHaveText('TOP PLAYER');
    const canvas = await page.locator('#gameCanvas').boundingBox();
    const a = await page.locator('#join-pad-a').boundingBox();
    const b = await page.locator('#join-pad-b').boundingBox();
    expect(a.y).toBeGreaterThanOrEqual(canvas.y + canvas.height - 1);
    expect(b.y + b.height).toBeLessThanOrEqual(canvas.y + 1);
    expect(errors).toEqual([]);
  });
});
