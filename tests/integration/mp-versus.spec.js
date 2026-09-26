// Versus modes on a shared keyboard (plan 05 §2, §4.3 Harvest Race, §4.4 Duel, MP-4): lobby
// options, the field refill, scoring and DENIED, the round clock and overtime, friendly fire,
// kill credit, respawn placement and ship bump. Desktop only; everything is driven by real
// keys. `?roundSeconds=N` (localhost only) shortens a round for the overtime test.
import { test, expect } from '@playwright/test';
import {
  openFresh, hook, waitForState, frames, loginWithKeyboard, openModeLobby, lobbyPress, joinTwoWithKeyboard,
  jumpTo, collectGreenByJump, drawnTexts,
} from './helpers.js';

const wrapDist = (a, b, W, H) => {
  const d = (v, s) => { let x = v % s; if (x > s / 2) x -= s; if (x < -s / 2) x += s; return x; };
  return Math.hypot(d(a.x - b.x, W), d(a.y - b.y, H));
};
const angDist = (a, b) => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));

/**
 * The next hyperspace jump by `key` self-destructs: a browser API stub (Math.random) answers
 * 0.01 to one pending hyperspace roll per call, so two players can queue a jump each.
 */
async function selfDestructKey(page, key) {
  await page.evaluate(() => {
    const real = window.__realRandom || Math.random;
    window.__realRandom = real;
    window.__sdPending = (window.__sdPending || 0) + 1;
    if (!Math.random.__sd) {
      const stub = () => {
        if (window.__sdPending > 0 && String(new Error().stack).includes('hyperspace')) {
          window.__sdPending--;
          return 0.01;
        }
        return real();
      };
      stub.__sd = true;
      Math.random = stub;
    }
  });
  await page.keyboard.press(key);
}

async function vulnerable(page, i) {
  await expect.poll(async () => {
    const s = await hook(page, `players.${i}.ship`);
    return !!s && s.isAlive && !s.isInvulnerable;
  }, { timeout: 8000, message: `P${i + 1} vulnerable` }).toBe(true);
}

async function startVersus(page, modeId, { url = '/', options = [] } = {}) {
  const errors = await openFresh(page, { url, recordText: true });
  await loginWithKeyboard(page, 'TESTER');
  await openModeLobby(page, modeId);
  for (const key of options) await page.keyboard.press(key);
  await joinTwoWithKeyboard(page);
  expect(await hook(page, 'mode.id')).toBe(modeId);
  return errors;
}

test.describe('versus (shared keyboard)', () => {
  test.skip(({ hasTouch }) => hasTouch, 'desktop keyboard');

  test('Harvest: round option, field refill with fade-in, scoring, DENIED in the shooter colour', async ({ page }) => {
    test.setTimeout(60000);
    const errors = await openFresh(page, { recordText: true });
    await loginWithKeyboard(page, 'TESTER');
    await openModeLobby(page, 'harvest');
    expect(await hook(page, 'lobby.options')).toMatchObject({ roundSeconds: 180, rows: ['option'] });
    expect(await hook(page, 'lobby.max')).toBe(2);
    await page.keyboard.press('o');
    await expect.poll(() => hook(page, 'lobby.options.roundSeconds')).toBe(300);
    await page.keyboard.press('o');
    await expect.poll(() => hook(page, 'lobby.options.roundSeconds')).toBe(120);
    await joinTwoWithKeyboard(page);

    const mode = await hook(page, 'mode');
    expect(mode).toMatchObject({ id: 'harvest', kind: 'versus', phase: 'normal', friendlyFire: false, shipBump: true });
    expect(mode.timeLeft).toBeGreaterThan(115);
    expect(mode.timeLeft).toBeLessThanOrEqual(120);
    await expect.poll(() => hook(page, 'mode.timeLeft')).toBeLessThan(mode.timeLeft);
    expect(await hook(page, 'mp.versus.field')).toEqual({ greens: 12, reds: 6 });
    const players = await hook(page, 'players');
    expect(players.map((p) => p.credits)).toEqual([0, 0]); // standard ships, no credits
    expect((await hook(page, 'mp.scaling')).powerUpInterval).toBe(12);
    // Every asteroid starts at least 250 px from both ships (less the drift since: < 80 px/s)
    const world = await hook(page, 'world');
    const [field, elapsed] = [await hook(page, 'asteroids'), await hook(page, 'mode.elapsed')];
    for (const a of field) {
      for (const p of players) {
        expect(wrapDist(a, p.ship, world.width, world.height)).toBeGreaterThanOrEqual(250 - 80 * (elapsed + 0.2));
      }
    }
    // The clock and the rules banner are drawn
    const texts = await drawnTexts(page, 3);
    expect(texts.some((t) => /^\d:\d\d$/.test(t))).toBe(true);
    expect(texts).toContain('HARVEST RACE');

    // P1 collects a crystal (hyperspace S lands in its path): points for P1 only
    await vulnerable(page, 0);
    const spawnedBefore = await hook(page, 'mp.versus.spawned');
    await expect(async () => {
      if ((await hook(page, 'players.0.score')) === 0) {
        const s = await hook(page, 'players.0.ship');
        if (s && s.isAlive) await collectGreenByJump(page, 's');
        await page.waitForTimeout(600);
      }
      expect(await hook(page, 'players.0.score')).toBeGreaterThan(0);
    }).toPass({ timeout: 25000, intervals: [300] });
    await page.evaluate(() => { if (window.__realRandom) Math.random = window.__realRandom; });
    expect(await hook(page, 'players.1.score')).toBe(0);
    // The field is topped up within about a second, the new crystal fading in
    await expect.poll(() => hook(page, 'mp.versus.spawned'), { timeout: 4000 }).toBeGreaterThan(spawnedBefore);
    await expect.poll(() => hook(page, 'mp.versus.field.greens'), { timeout: 4000 }).toBeGreaterThanOrEqual(12);

    // P2 shoots a crystal: DENIED in P2's colour, no points
    const p2Colour = (await hook(page, 'players'))[1].colour;
    await vulnerable(page, 1);
    await expect(async () => {
      if ((await hook(page, 'players.1.stats.greensDenied')) === 0) {
        const g = await page.evaluate(() => {
          const s = window.__spaceAdventure;
          const W = s.world.width;
          const H = s.world.height;
          const all = s.asteroids;
          for (const a of all.filter((q) => q.type === 'green' && !q.materialising)) {
            const x = a.x;
            const y = a.y + a.radius + 55;
            if (x < 40 || x > W - 40 || y < 40 || y > H - 40) continue;
            const clear = all.every((q) => q === a || Math.hypot(q.x - x, q.y - y) > q.radius + 45
              && !(Math.abs(q.x - x) < q.radius + 4 && q.y > a.y && q.y < y));
            if (clear) return { x, y };
          }
          return null;
        });
        const ship = await hook(page, 'players.1.ship');
        if (g && ship && ship.isAlive) {
          await jumpTo(page, 'ArrowDown', g.x, g.y);
          await frames(page, 2);
          // Turn to face straight up (-π/2), then fire
          for (let k = 0; k < 40; k++) {
            const r = await hook(page, 'players.1.ship.rotation');
            if (r === undefined || angDist(r, -Math.PI / 2) < 0.12) break;
            const key = Math.sin(r + Math.PI / 2) > 0 ? 'ArrowLeft' : 'ArrowRight';
            await page.keyboard.down(key);
            await frames(page, 1);
            await page.keyboard.up(key);
          }
          await page.keyboard.down('Enter');
          await page.waitForTimeout(350);
          await page.keyboard.up('Enter');
        }
        await page.waitForTimeout(300);
      }
      expect(await hook(page, 'players.1.stats.greensDenied')).toBeGreaterThan(0);
    }).toPass({ timeout: 30000, intervals: [500] });
    await page.evaluate(() => { if (window.__realRandom) Math.random = window.__realRandom; });
    const denied = (await hook(page, 'floatingTexts')).filter((t) => t.text === 'DENIED');
    expect(denied.length).toBeGreaterThan(0);
    expect(denied[0].colour).toBe(p2Colour);
    expect(await hook(page, 'players.1.score')).toBe(0);
    await page.screenshot({ path: 'tests/screenshots/desktop-chromium-harvest-ingame.png' });
    expect(errors).toEqual([]);
  });

  test('Harvest: tie at time up goes to overtime; nobody scores, so it is a draw', async ({ page }) => {
    test.setTimeout(90000);
    const errors = await startVersus(page, 'harvest', { url: '/?roundSeconds=4' });
    expect(await hook(page, 'mode.timeLeft')).toBeLessThanOrEqual(4);
    // Keep both ships from collecting anything: a ship self-destructs by hyperspace as soon as
    // it appears, while still protected (protected and dead ships collect nothing): 0 - 0.
    const keys = ['s', 'ArrowDown'];
    let sawOvertime = false;
    const deadline = Date.now() + 60000;
    while (Date.now() < deadline) {
      const state = await hook(page, 'state');
      if (state !== 'playing') break;
      const m = await hook(page, 'mode');
      if (m.phase === 'overtime') {
        if (!sawOvertime) {
          sawOvertime = true;
          expect(m.timeLeft).toBe(0);
          expect(m.overtimeLeft).toBeGreaterThan(15);
          expect(await drawnTexts(page, 2)).toContain('OVERTIME');
          await page.screenshot({ path: 'tests/screenshots/desktop-chromium-harvest-overtime.png' });
        }
      }
      const players = await hook(page, 'players');
      for (let i = 0; i < 2; i++) {
        const s = players[i].ship;
        if (s && s.isAlive) await selfDestructKey(page, keys[i]);
      }
      await page.waitForTimeout(100);
    }
    expect((await hook(page, 'players')).map((p) => p.score)).toEqual([0, 0]);
    expect(sawOvertime).toBe(true);
    await waitForState(page, 'results', 8000);
    const results = await hook(page, 'results');
    expect(results).toMatchObject({ mode: 'harvest', outcome: 'draw', winners: [] });
    expect(await hook(page, 'mode.result.outcome')).toBe('draw');
    await expect.poll(() => hook(page, 'results.inputDelay')).toBe(0);
    await page.screenshot({ path: 'tests/screenshots/desktop-chromium-harvest-results.png' });
    expect(errors).toEqual([]);
  });

  test('Duel: friendly fire scores the kill, a self-kill scores nothing, far respawn, firing ends protection, bump', async ({ page }) => {
    test.setTimeout(90000);
    const errors = await openFresh(page, { recordText: true });
    await loginWithKeyboard(page, 'TESTER');
    await openModeLobby(page, 'duel');
    expect(await hook(page, 'lobby.options.target')).toBe(5);
    await page.keyboard.press('o');
    await expect.poll(() => hook(page, 'lobby.options.target')).toBe(7);
    for (const next of [10, 3, 5]) {
      await page.keyboard.press('o');
      await expect.poll(() => hook(page, 'lobby.options.target')).toBe(next);
    }
    await joinTwoWithKeyboard(page);
    expect(await hook(page, 'mode')).toMatchObject({ id: 'duel', target: 5, friendlyFire: true, shipBump: true });
    expect(await hook(page, 'mp.versus.field')).toEqual({ greens: 4, reds: 5 });
    expect(await hook(page, 'counts.ufos')).toBe(0);
    const world = await hook(page, 'world');
    const W = world.width;
    const H = world.height;

    // Self-kill: P1's hyperspace self-destructs. A death, but nobody scores.
    await vulnerable(page, 0);
    await selfDestructKey(page, 's');
    await expect.poll(() => hook(page, 'players.0.stats.deaths')).toBe(1);
    expect((await hook(page, 'players')).map((p) => p.stats.kills)).toEqual([0, 0]);

    // Respawn after 2 s at the point furthest from P2, protected until P1 fires
    await expect.poll(() => hook(page, 'players.0.ship.isAlive'), { timeout: 5000 }).toBe(true);
    const [q1, q2] = (await hook(page, 'players')).map((p) => p.ship);
    expect(wrapDist(q1, q2, W, H)).toBeGreaterThan(0.4 * Math.hypot(W / 2, H / 2));
    expect(q1.isInvulnerable).toBe(true);
    await page.keyboard.down('Space');
    await expect.poll(() => hook(page, 'players.0.ship.isInvulnerable')).toBe(false);
    await page.keyboard.up('Space');

    // Friendly fire: P1 jumps below P2 and shoots up; the kill is P1's
    await vulnerable(page, 1);
    await expect(async () => {
      if ((await hook(page, 'players.0.stats.kills')) === 0) {
        const [a, b] = (await hook(page, 'players')).map((p) => p.ship);
        if (a && a.isAlive && b && b.isAlive && !b.isInvulnerable) {
          await jumpTo(page, 's', b.x, Math.min(H - 30, b.y + 80));
          await frames(page, 2);
          for (let k = 0; k < 40; k++) {
            const r = await hook(page, 'players.0.ship.rotation');
            if (r === undefined || angDist(r, -Math.PI / 2) < 0.12) break;
            const key = Math.sin(r + Math.PI / 2) > 0 ? 'a' : 'd';
            await page.keyboard.down(key);
            await frames(page, 1);
            await page.keyboard.up(key);
          }
          await page.keyboard.down('Space');
          await page.waitForTimeout(600);
          await page.keyboard.up('Space');
        }
        await page.waitForTimeout(300);
      }
      expect(await hook(page, 'players.0.stats.kills')).toBe(1);
    }).toPass({ timeout: 40000, intervals: [500] });
    await page.evaluate(() => { if (window.__realRandom) Math.random = window.__realRandom; });
    const after = await hook(page, 'players');
    expect(after[1].stats.deaths).toBeGreaterThanOrEqual(1);
    expect(after[1].stats.kills).toBe(0);
    expect(after[0].stats.hits).toBeGreaterThan(0);
    const texts = await drawnTexts(page, 3);
    expect(texts.some((t) => /KILL/.test(t))).toBe(true);
    // Duel HUD panels show kills; unlimited lives
    await expect(page.locator('.seat-hud').first().locator('[data-hud="score"]')).toHaveText('1 KILL');
    await expect(page.locator('.seat-hud').first().locator('[data-hud="lives"]')).toHaveText('▲ ∞');

    // P2 respawns far from P1
    await expect.poll(() => hook(page, 'players.1.ship.isAlive'), { timeout: 5000 }).toBe(true);
    const [r1, r2] = (await hook(page, 'players')).map((p) => p.ship);
    expect(wrapDist(r1, r2, W, H)).toBeGreaterThan(0.4 * Math.hypot(W / 2, H / 2));
    await page.screenshot({ path: 'tests/screenshots/desktop-chromium-duel-ingame.png' });

    // Bump: P2 jumps right next to P1; they bounce apart, nobody is hurt
    const bumps = await hook(page, 'mp.versus.bumps');
    const deaths = (await hook(page, 'players')).map((p) => p.stats.deaths);
    const p1 = await hook(page, 'players.0.ship');
    await jumpTo(page, 'ArrowDown', p1.x + 12, p1.y);
    await expect.poll(() => hook(page, 'mp.versus.bumps')).toBeGreaterThan(bumps);
    await page.evaluate(() => { if (window.__realRandom) Math.random = window.__realRandom; });
    await frames(page, 10);
    const [b1, b2] = (await hook(page, 'players')).map((p) => p.ship);
    expect(wrapDist(b1, b2, W, H)).toBeGreaterThanOrEqual(30);
    expect(Math.hypot(b1.velX, b1.velY)).toBeGreaterThan(20);
    expect(Math.hypot(b2.velX, b2.velY)).toBeGreaterThan(20);
    expect((await hook(page, 'players')).map((p) => p.stats.deaths)).toEqual(deaths);
    expect(errors).toEqual([]);
  });
});
