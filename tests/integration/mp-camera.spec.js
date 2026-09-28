// Shared camera in simultaneous modes (plan 05 §3, 2026-09-28): continuous tracking (no
// half-world snap), zoom out as the ships spread, and the soft edge that keeps every ship in
// view. Co-op with a shared keyboard, desktop only.
import { test, expect } from '@playwright/test';
import {
  MENU, openFresh, hook, loginWithKeyboard, selectMenuRow, openCoopLobby, joinTwoWithKeyboard,
} from './helpers.js';

async function startCoop(page) {
  const errors = await openFresh(page);
  await loginWithKeyboard(page, 'TESTER');
  // Easy: slower rocks, so P1's long flight is less likely to end in one
  await selectMenuRow(page, MENU.DIFFICULTY);
  await page.keyboard.press('ArrowLeft');
  await expect.poll(() => hook(page, 'difficulty')).toBe('easy');
  await openCoopLobby(page);
  await joinTwoWithKeyboard(page);
  await expect.poll(() => hook(page, 'players.1.ship.isAlive')).toBe(true);
  return errors;
}

/** Sample the hook once per animation frame for `ms` (read-only). */
function sampleFrames(page, ms) {
  return page.evaluate((duration) => new Promise((resolve) => {
    const out = [];
    const start = performance.now();
    const tick = () => {
      const g = window.__spaceAdventure;
      const cam = g.camera;
      out.push({
        t: performance.now() - start,
        cx: cam.x, cy: cam.y, zoom: cam.zoom, continuous: cam.continuous, leash: cam.leash,
        ships: g.players.map((p) => (p.ship && p.ship.isAlive && p.respawnTimer <= 0
          ? { x: p.ship.x, y: p.ship.y, velX: p.ship.velX, velY: p.ship.velY } : null)),
        pressing: g.players.map((p) => p.pressingEdge),
        edges: g.players.map((p) => p.pressingEdges),
        glows: g.mp.edgeGlows,
        state: g.state,
      });
      if (performance.now() - start >= duration) resolve(out);
      else requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }), ms);
}

test.describe('shared camera: continuous tracking and the soft edge', () => {
  test.skip(({ hasTouch }) => hasTouch, 'desktop keyboard');

  test('P1 flies away: the view never snaps, both stay on screen, P1 is held at the edge (glow)', async ({ page }) => {
    test.setTimeout(90000);
    const errors = await startCoop(page);
    const cam0 = await hook(page, 'camera');
    expect(cam0.continuous).toBe(true);
    expect(cam0.leash).not.toBeNull();
    expect(cam0.leash.soft).toBe(false); // co-op: a hard edge
    const view = await hook(page, 'view');
    const world = await hook(page, 'world');
    const W = world.width, H = world.height;
    const wrap = (d, size) => d - size * Math.round(d / size);

    // P1 faces up (ships start facing up): hold W for several seconds while P2 stays. A rock
    // can end the flight (easy, but 15 of them): then wait for the respawn and fly again.
    let samples = [];
    let pressedWhileBoth = false;
    for (let attempt = 0; attempt < 4 && !pressedWhileBoth; attempt++) {
      await expect.poll(async () => {
        const p = await hook(page, 'players');
        return !!(p[0].ship && p[0].ship.isAlive && p[1].ship && p[1].ship.isAlive);
      }, { timeout: 10000, message: 'both ships flying' }).toBe(true);
      await page.keyboard.down('w');
      const s = await sampleFrames(page, 5000);
      samples = samples.concat(s);
      pressedWhileBoth = s.some((f) => f.pressing[0] && f.ships[0] && f.ships[1]);
      if (pressedWhileBoth) {
        // Still pushing against the edge: the picture for the report
        await expect.poll(() => hook(page, 'players.0.pressingEdge')).toBe(true);
        await page.screenshot({ path: 'tests/screenshots/coop-edge.png' });
      }
      await page.keyboard.up('w');
    }
    expect(pressedWhileBoth, 'P1 reached the soft edge with both ships alive').toBe(true);

    // The centre never moves further in one sample than the fastest ship has moved in one sample
    // so far (it follows their midpoint, smoothed). The old camera glided ~0.75 of a view in
    // 0.2 s when the ships drifted half a world apart: 40+ px per frame while a ship moves ~15.
    let maxShipStep = 0, worst = { step: 0, allowed: 0 };
    for (let i = 1; i < samples.length; i++) {
      const a = samples[i - 1], b = samples[i];
      // Only frames where both ships fly in both samples (a death or respawn changes what is
      // framed, and the camera then glides)
      if (!(a.ships[0] && a.ships[1] && b.ships[0] && b.ships[1])) continue;
      if (b.t < a.t) continue; // next attempt
      for (const k of [0, 1]) {
        maxShipStep = Math.max(maxShipStep,
          Math.hypot(wrap(b.ships[k].x - a.ships[k].x, W), wrap(b.ships[k].y - a.ships[k].y, H)));
      }
      const step = Math.hypot(wrap(b.cx - a.cx, W), wrap(b.cy - a.cy, H));
      if (step - (maxShipStep + 3) > worst.step - worst.allowed) worst = { step, allowed: maxShipStep + 3, i };
    }
    expect(worst.step, `camera step ${JSON.stringify(worst)}`).toBeLessThanOrEqual(worst.allowed);

    for (const f of samples) {
      if (f.state !== 'playing') continue;
      for (const [i, s] of f.ships.entries()) {
        if (!s) continue;
        // On screen
        const sx = view.width / 2 + wrap(s.x - f.cx, W) * f.zoom;
        const sy = view.height / 2 + wrap(s.y - f.cy, H) * f.zoom;
        expect(sx, `P${i + 1} x on screen`).toBeGreaterThanOrEqual(0);
        expect(sx, `P${i + 1} x on screen`).toBeLessThanOrEqual(view.width);
        expect(sy, `P${i + 1} y on screen`).toBeGreaterThanOrEqual(0);
        expect(sy, `P${i + 1} y on screen`).toBeLessThanOrEqual(view.height);
        // Inside the soft edge (one frame of movement of slack)
        const L = f.leash;
        expect(Math.abs(wrap(s.x - L.cx, W))).toBeLessThanOrEqual(L.halfW + 20);
        expect(Math.abs(wrap(s.y - L.cy, H))).toBeLessThanOrEqual(L.halfH + 20);
      }
      expect(f.zoom).toBeGreaterThanOrEqual(0.75);
      expect(f.zoom).toBeLessThanOrEqual(1);
      // Separation (unwrapped around the centre) is bounded by the box
      if (f.ships[0] && f.ships[1]) {
        const u = f.ships.map((s) => ({ x: f.cx + wrap(s.x - f.cx, W), y: f.cy + wrap(s.y - f.cy, H) }));
        expect(Math.abs(u[0].x - u[1].x)).toBeLessThanOrEqual(2 * f.leash.halfW + 40);
        expect(Math.abs(u[0].y - u[1].y)).toBeLessThanOrEqual(2 * f.leash.halfH + 40);
      }
    }

    // Pressing: the outward speed is gone (hard edge), and P1's colour glows on that edge
    const pressed = samples.filter((f) => f.pressing[0] && f.ships[0]);
    expect(pressed.length).toBeGreaterThan(0);
    for (const f of pressed) {
      const e = f.edges[0];
      if (e.includes('top')) expect(f.ships[0].velY).toBeGreaterThanOrEqual(-1e-6);
      if (e.includes('bottom')) expect(f.ships[0].velY).toBeLessThanOrEqual(1e-6);
      if (e.includes('left')) expect(f.ships[0].velX).toBeGreaterThanOrEqual(-1e-6);
      if (e.includes('right')) expect(f.ships[0].velX).toBeLessThanOrEqual(1e-6);
    }
    const p1Colour = (await hook(page, 'players'))[0].colour;
    const glows = samples.flatMap((f) => f.glows).filter((g) => g.id === 'p1');
    expect(glows.length).toBeGreaterThan(0);
    expect(glows[0].colour).toBe(p1Colour);
    expect(glows.some((g) => g.alpha > 0.5)).toBe(true);
    // The edge the glow sits on is the one P1 pressed against
    const pressedEdges = new Set(pressed.flatMap((f) => f.edges[0]));
    expect(glows.every((g) => pressedEdges.has(g.edge))).toBe(true);
    // P2 was never pushed (it stayed inside while the view moved toward P1)
    expect(samples.every((f) => !f.pressing[1] || !f.ships[1] || !f.ships[0])).toBe(true);
    expect(errors).toEqual([]);
  });
});
