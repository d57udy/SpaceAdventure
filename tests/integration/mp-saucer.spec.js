// Saucer (plan 05 §4.5, MP-5): P1 flies the ship, P2 steers the UFO with a controller or keys.
// Desktop only. Controllers are fake navigator.getGamepads() pads; a shortened round (time or
// target) is seeded before load through the spaceAdventure_testSaucerRound key, like any other
// stored setting. The game state itself is only read.
import { test, expect } from '@playwright/test';
import {
  openFresh, hook, waitForState, frames, loginWithKeyboard, openModeLobby, lobbyPress, lobbyPad,
  padPress, padRelease, padTap, padStick, padDisconnect, drawnTexts, PAD,
} from './helpers.js';

const SAUCER_TEST_KEY = 'spaceAdventure_testSaucerRound';

/** P1 joins with Space, P2 with the controller (or Enter); both ready; waits for play. */
async function startSaucer(page, { storage = {}, p2 = 'pad', recordText = false } = {}) {
  const errors = await openFresh(page, { gamepads: p2 === 'pad' ? [{}] : null, storage, recordText });
  await loginWithKeyboard(page, 'TESTER');
  await openModeLobby(page, 'saucer');
  await lobbyPress(page, 'Space', 0, (c) => !!c && c.source === 'kbLeft');
  if (p2 === 'pad') await lobbyPad(page, 0, 1, (c) => !!c && c.source === 'pad:0');
  else await lobbyPress(page, 'Enter', 1, (c) => !!c && c.source === 'kbRight');
  return {
    errors,
    async ready() {
      await lobbyPress(page, 'Space', 0, (c) => c.ready);
      if (p2 === 'pad') await lobbyPad(page, 0, 1, (c) => c.ready);
      else await lobbyPress(page, 'Enter', 1, (c) => c.ready);
      await waitForState(page, 'playing', 6000);
      await expect.poll(() => hook(page, 'saucer.ufo.alive')).toBe(true);
    },
  };
}

/** Wrap-aware offset from the saucer to a world point, and the view scale. */
function saucerOffset(page, tx, ty) {
  return page.evaluate(([x, y]) => {
    const g = window.__spaceAdventure;
    const u = g.saucer.ufo;
    if (!u) return null;
    const wrap = (d, size) => d - size * Math.round(d / size);
    const dx = wrap(x - u.x, g.world.width);
    const dy = wrap(y - u.y, g.world.height);
    return { dx, dy, dist: Math.hypot(dx, dy) };
  }, [tx, ty]);
}

/** Steer the saucer (controller stick) to within `within` px of a world point, then stop. */
async function steerSaucerTo(page, target, within = 12) {
  await expect(async () => {
    const t = typeof target === 'function' ? await target() : target;
    const o = await saucerOffset(page, t.x, t.y);
    expect(o).not.toBeNull();
    if (o.dist > within) {
      const m = o.dist > 60 ? 1 : 0.45; // slow down near the spot
      await padStick(page, (o.dx / o.dist) * m, (o.dy / o.dist) * m);
      await frames(page, 2);
    } else {
      await padStick(page, 0, 0);
    }
    expect(o.dist).toBeLessThanOrEqual(within);
  }).toPass({ timeout: 15000, intervals: [0] });
  await padStick(page, 0, 0);
  await frames(page, 2);
}

/** Park the saucer above P1's (upward-facing) ship and let P1 shoot it down. */
async function shootSaucerDown(page) {
  await expect.poll(() => hook(page, 'saucer.ufo.isInvulnerable'), { timeout: 5000 }).toBe(false);
  const ship = await hook(page, 'players.0.ship');
  expect(Math.abs(Math.sin(ship.rotation) + 1)).toBeLessThan(1e-6); // facing up
  await steerSaucerTo(page, async () => {
    const s = await hook(page, 'players.0.ship');
    return { x: s.x, y: s.y - 150 };
  }, 8);
  await page.keyboard.down('Space');
  await expect.poll(() => hook(page, 'players.0.stats.ufos'), { timeout: 5000 }).toBe(1);
  await page.keyboard.up('Space');
}

test.describe('Saucer', () => {
  test.skip(({ hasTouch }) => hasTouch, 'desktop keyboard and controllers');

  test('lobby roles and strength; P2 steers the saucer with the stick and fires with a 1 s cooldown', async ({ page }) => {
    const s = await startSaucer(page, { recordText: true });
    expect(await hook(page, 'lobby')).toMatchObject({ min: 2, max: 2 });
    await expect.poll(async () => {
      const t = await drawnTexts(page);
      return t.includes('SHIP') && t.includes('SAUCER') && t.includes('Saucer strength  (O)') && t.includes('◂  Normal  ▸');
    }).toBe(true);
    expect(await hook(page, 'lobby.options.rows')).toEqual(['option']);
    // O (anyone) steps the strength too
    await page.keyboard.press('o');
    await expect.poll(() => hook(page, 'saucer.strength')).toBe('strong');
    await page.keyboard.press('o');
    await expect.poll(() => hook(page, 'saucer.strength')).toBe('weak');
    await page.keyboard.press('o');
    await expect.poll(() => hook(page, 'saucer.strength')).toBe('normal');
    // P2's ◂ ▸ change the saucer's strength (not its colour)
    const colour = (await hook(page, 'lobby.cards'))[1].colour;
    await padTap(page, PAD.RIGHT);
    await expect.poll(() => hook(page, 'saucer.strength')).toBe('strong');
    await padTap(page, PAD.LEFT);
    await padTap(page, PAD.LEFT);
    await expect.poll(() => hook(page, 'saucer.strength')).toBe('weak');
    await padTap(page, PAD.RIGHT);
    await expect.poll(() => hook(page, 'saucer.strength')).toBe('normal');
    expect((await hook(page, 'lobby.cards'))[1].colour).toBe(colour);
    await s.ready();

    // One ship (P1), the saucer (P2), no AI UFOs, P1's target by difficulty (Medium)
    expect(await hook(page, 'mode.id')).toBe('saucer');
    const players = await hook(page, 'players');
    expect(players[0].ship).not.toBeNull();
    expect(players[1]).toMatchObject({ ship: null, lives: 0, label: 'P2' });
    const sc = await hook(page, 'saucer');
    expect(sc).toMatchObject({ active: true, target: 2500, speed: 150, fireCooldown: 1, playerId: 'p2', pilotId: 'p1', spawns: 1 });
    expect(sc.ufo.isInvulnerable).toBe(true); // translucent for 2 s after appearing
    expect(await hook(page, 'counts.ufos')).toBe(1);
    expect(await hook(page, 'mode.timeLeft')).toBeGreaterThan(145);
    expect(await hook(page, 'mp.boss')).toBeNull();

    // Absolute steering: stick up -> up at full speed; right -> right; let go -> stops
    await padStick(page, 0, -1);
    await expect.poll(() => hook(page, 'saucer.ufo.velY')).toBeLessThan(-140);
    expect(Math.abs(await hook(page, 'saucer.ufo.velX'))).toBeLessThan(1);
    expect(await hook(page, 'saucer.ufo.heading')).toBeCloseTo(-Math.PI / 2, 3);
    await padStick(page, 1, 0);
    await expect.poll(() => hook(page, 'saucer.ufo.velX')).toBeGreaterThan(140);
    await padStick(page, 0, 0);
    await expect.poll(() => hook(page, 'saucer.ufo.velX')).toBe(0);
    expect(await hook(page, 'saucer.ufo.heading')).toBeCloseTo(0, 3); // the turret keeps pointing
    const ship = await hook(page, 'players.0.ship');
    expect(ship.velX).toBe(0); // P1 untouched
    expect(ship.velY).toBe(0);

    // Fire held: one shot at once, the next only after 1 s
    // (game time from the round clock, watched every frame, so a slow machine can't skew it)
    await padPress(page, PAD.A);
    const shotTimes = await page.evaluate(() => new Promise((resolve) => {
      const g = window.__spaceAdventure;
      const times = [];
      let last = g.saucer.ufo.shots;
      const start = g.mode.elapsed;
      const tick = () => {
        const u = g.saucer.ufo;
        if (u && u.shots !== last) {
          last = u.shots;
          times.push(g.mode.elapsed);
        }
        if (times.length >= 3 || g.mode.elapsed - start > 4) resolve(times);
        else requestAnimationFrame(tick);
      };
      tick();
    }));
    await padRelease(page, PAD.A);
    expect(shotTimes.length).toBe(3);
    expect(shotTimes[1] - shotTimes[0]).toBeGreaterThan(0.95);
    expect(shotTimes[1] - shotTimes[0]).toBeLessThan(1.1);
    expect(shotTimes[2] - shotTimes[1]).toBeGreaterThan(0.95);
    expect(await hook(page, 'bulletsByOwner')).toEqual({}); // saucer shots are enemy bullets
    expect(s.errors).toEqual([]);
  });

  test('a saucer shot destroys a green crystal: P2 +1', async ({ page }) => {
    test.setTimeout(60000);
    const s = await startSaucer(page);
    await s.ready();
    // Chase the nearest green with the stick, fire held; aim assist snaps onto it
    await padPress(page, PAD.A);
    await expect(async () => {
      const aim = await page.evaluate(() => {
        const g = window.__spaceAdventure;
        const u = g.saucer.ufo;
        if (!u) return null;
        const wrap = (d, size) => d - size * Math.round(d / size);
        let best = null;
        for (const a of g.asteroids) {
          if (a.type !== 'green') continue;
          const dx = wrap(a.x - u.x, g.world.width);
          const dy = wrap(a.y - u.y, g.world.height);
          const d = Math.hypot(dx, dy);
          if (!best || d < best.d) best = { dx, dy, d };
        }
        return best;
      });
      if (aim) {
        const m = aim.d > 160 ? 1 : 0.4;
        await padStick(page, (aim.dx / aim.d) * m, (aim.dy / aim.d) * m);
      }
      await frames(page, 3);
      expect(await hook(page, 'players.1.stats.greensDenied')).toBeGreaterThanOrEqual(1);
    }).toPass({ timeout: 40000, intervals: [0] });
    await padRelease(page, PAD.A);
    await padStick(page, 0, 0);
    const p2 = await hook(page, 'players.1');
    expect(p2.score).toBeGreaterThanOrEqual(1);
    expect(p2.score).toBe(p2.stats.greensDenied + 3 * p2.stats.kills);
    expect(s.errors).toEqual([]);
  });

  test('P1 shoots the saucer down (+200); it returns after 4 s at the far edge; P2 scores 3 for taking a life', async ({ page }) => {
    test.setTimeout(60000);
    const s = await startSaucer(page, { recordText: true });
    await s.ready();
    const before = await hook(page, 'players.0.score');
    await shootSaucerDown(page);
    expect(await hook(page, 'players.0.score')).toBeGreaterThanOrEqual(before + 200);
    expect(await hook(page, 'saucer.ufo')).toBeNull();
    expect(await hook(page, 'players.1.stats.deaths')).toBe(1);
    const wait = await hook(page, 'saucer.respawnTimer');
    expect(wait).toBeGreaterThan(3);
    expect(wait).toBeLessThanOrEqual(4);
    await expect.poll(async () => (await drawnTexts(page)).some((t) => t.startsWith('SAUCER BACK IN'))).toBe(true);

    // Back after 4 s: protected, at the view's edge on the far side from P1
    await expect.poll(() => hook(page, 'saucer.spawns'), { timeout: 6000 }).toBe(2);
    const back = await page.evaluate(() => {
      const g = window.__spaceAdventure;
      const s = g.saucer.lastSpawn, v = g.view, W = g.world.width, H = g.world.height;
      const wrap = (d, size) => d - size * Math.round(d / size);
      // Screen offset from the view centre at the moment it appeared
      const sx = wrap(s.x - s.cx, W) * s.zoom, sy = wrap(s.y - s.cy, H) * s.zoom;
      const px = s.pilot ? wrap(s.pilot.x - s.cx, W) : 0, py = s.pilot ? wrap(s.pilot.y - s.cy, H) : 0;
      return { edge: Math.max(Math.abs(sx) - (v.width / 2 - 40 * s.zoom), Math.abs(sy) - (v.height / 2 - 40 * s.zoom)),
        side: sx * px + sy * py, pilotOff: Math.hypot(px, py), invulnerable: g.saucer.ufo.isInvulnerable };
    });
    expect(back.invulnerable).toBe(true);
    expect(Math.abs(back.edge)).toBeLessThan(1);
    if (back.pilotOff > 1) expect(back.side).toBeLessThan(0);
    await expect.poll(() => hook(page, 'saucer.ufo.isInvulnerable'), { timeout: 4000 }).toBe(false);

    // P2 hunts P1: steer close, turret toward P1, fire (aim assist)
    const lives = await hook(page, 'players.0.lives');
    await padPress(page, PAD.A);
    await expect(async () => {
      const ship = await hook(page, 'players.0.ship');
      if (ship && !ship.isInvulnerable) {
        const o = await saucerOffset(page, ship.x, ship.y);
        if (o) {
          const m = o.dist > 180 ? 1 : 0.4;
          await padStick(page, (o.dx / o.dist) * m, (o.dy / o.dist) * m);
        }
      }
      await frames(page, 3);
      expect(await hook(page, 'players.1.stats.kills')).toBeGreaterThanOrEqual(1);
    }).toPass({ timeout: 25000, intervals: [0] });
    await padRelease(page, PAD.A);
    await padStick(page, 0, 0);
    expect(await hook(page, 'players.0.lives')).toBe(lives - 1);
    const p2 = await hook(page, 'players.1');
    expect(p2.score).toBe(3 + p2.stats.greensDenied);
    expect(s.errors).toEqual([]);
  });

  test('keys steer the saucer in absolute directions: ↑ up, ↓ down (no hyperspace), Enter fires', async ({ page }) => {
    const s = await startSaucer(page, { p2: 'keys' });
    await s.ready();
    const ship = await hook(page, 'players.0.ship');
    await page.keyboard.down('ArrowUp');
    await expect.poll(() => hook(page, 'saucer.ufo.velY')).toBeLessThan(-140);
    await page.keyboard.up('ArrowUp');
    await page.keyboard.down('ArrowDown');
    await page.keyboard.down('ArrowLeft');
    await expect.poll(() => hook(page, 'saucer.ufo.velY')).toBeGreaterThan(100);
    expect(await hook(page, 'saucer.ufo.velX')).toBeLessThan(-100); // diagonal down-left
    await page.keyboard.up('ArrowDown');
    await page.keyboard.up('ArrowLeft');
    await expect.poll(() => hook(page, 'saucer.ufo.velX')).toBe(0);
    await page.keyboard.press('Enter');
    await expect.poll(() => hook(page, 'saucer.ufo.shots')).toBe(1);
    // P1 never moved or jumped
    const after = await hook(page, 'players.0.ship');
    expect(Math.hypot(after.x - ship.x, after.y - ship.y)).toBeLessThan(1);
    expect(await page.evaluate(() => window.__spaceAdventure.isPressedSeat('thrust', 0))).toBe(false);
    expect(s.errors).toEqual([]);
  });

  test('P1 reaching the target wins the round', async ({ page }) => {
    test.setTimeout(60000);
    const s = await startSaucer(page, { storage: { [SAUCER_TEST_KEY]: JSON.stringify({ target: 200 }) } });
    await s.ready();
    expect(await hook(page, 'saucer.target')).toBe(200);
    await shootSaucerDown(page);
    await waitForState(page, 'round_end');
    const r = await hook(page, 'results');
    expect(r.outcome).toBe('win');
    expect(r.winners).toEqual(['p1']);
    expect(r.saucer).toMatchObject({ target: 200, reason: 'TESTER reached 200' });
    expect(r.highlights[0]).toBe('TESTER reached 200 · target 200');
    await waitForState(page, 'results', 4000);
    expect(s.errors).toEqual([]);
  });

  test('time up: the saucer wins', async ({ page }) => {
    const s = await startSaucer(page, { storage: { [SAUCER_TEST_KEY]: JSON.stringify({ time: 3 }) } });
    await s.ready();
    expect(await hook(page, 'mode.timeLeft')).toBeLessThanOrEqual(3);
    await waitForState(page, 'round_end', 8000);
    const r = await hook(page, 'results');
    expect(r).toMatchObject({ outcome: 'win', winners: ['p2'], winnerNames: ['Guest 2'] });
    expect(r.saucer.reason).toBe('Time up');
    expect(s.errors).toEqual([]);
  });

  test('Drop P2 after a disconnect ends a Saucer round: P1 wins', async ({ page }) => {
    const s = await startSaucer(page);
    await s.ready();
    await padDisconnect(page);
    await waitForState(page, 'paused');
    expect(await hook(page, 'mp.reserved')).toEqual([1]);
    const options = await hook(page, 'pauseOptions');
    const target = options.indexOf('Drop P2');
    expect(target).toBeGreaterThan(0);
    for (let i = 0; i < target; i++) {
      await page.keyboard.press('ArrowDown');
      await frames(page, 2);
    }
    await page.keyboard.press('Enter');
    await waitForState(page, 'round_end');
    const r = await hook(page, 'results');
    expect(r).toMatchObject({ outcome: 'win', winners: ['p1'] });
    expect(r.saucer.reason).toBe('P2 left the round');
    expect(await hook(page, 'counts.ufos')).toBe(0);
    expect(s.errors).toEqual([]);
  });
});
