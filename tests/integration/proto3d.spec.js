// The 3D game's flight, world and HUD (?3d=1; docs/plans/06-3d-mode.md, 07-3d-game.md). The
// menus (ui3d.js) are covered in game3d.spec.js; here a game starts as a guest (Play).
// Projects: chromium-3d (landscape phone, touch) and chromium-3d-desktop (mouse + keyboard),
// both with WebGL through SwiftShader. Motion is faked with DeviceOrientationEvent dispatches
// and a stubbed DeviceOrientationEvent.requestPermission (browser API stubs, never game
// state); everything is read through the read-only hook window.__spaceAdventure.game3d.
//
// SwiftShader on CI can run at 1-5 fps, and the game then runs slower than wall time (at
// most 6 fixed steps per frame). So the tests never wait on wall time: they wait on hook
// state, on fixed sim steps having run (`steps`) and on game time (`time`), with generous
// timeouts. Every URL carries &lowres3d=1 (half-resolution buffer, no antialiasing).
import { test, expect } from '@playwright/test';

test.setTimeout(180000); // SwiftShader renders slowly on CI
const T = 60000; // generous per-wait timeout

const variant = (testInfo) => (testInfo.project.name.endsWith('desktop') ? 'desktop' : 'phone');
const shot = (page, testInfo, name) => page.screenshot({ path: `tests/screenshots/3d-${variant(testInfo)}-${name}.png` });

/**
 * Open the prototype with fresh storage. Options: url, permission ('granted' | 'denied' |
 * null = no prompt API, like Android), storage (more localStorage entries).
 */
async function open3d(page, { url = '/?3d=1&seed3d=1', permission = null, storage = {} } = {}) {
  url += '&lowres3d=1';
  const errors = [];
  page.on('pageerror', (err) => errors.push(err.message));
  await page.addInitScript(({ permission, storage }) => {
    try {
      if (!sessionStorage.getItem('__sa3d_cleared')) {
        localStorage.clear();
        localStorage.setItem('spaceAdventure_sensor3d', 'event'); // deviceorientation only (deterministic)
        for (const [k, v] of Object.entries(storage)) localStorage.setItem(k, v);
        sessionStorage.setItem('__sa3d_cleared', '1');
      }
    } catch (e) { /* storage unavailable */ }
    if (permission) {
      window.__permAsked = 0;
      DeviceOrientationEvent.requestPermission = () => { window.__permAsked++; return Promise.resolve(permission); };
    }
  }, { permission, storage });
  await page.goto(url);
  await page.waitForFunction(() => window.__spaceAdventure && window.__spaceAdventure.game3d
    && window.__spaceAdventure.game3d.loaded, null, { timeout: T });
  return errors;
}

const g3 = (page) => page.evaluate(() => window.__spaceAdventure.game3d);
const g3get = (page, key) => page.evaluate((k) => window.__spaceAdventure.game3d[k], key);

/** Wait until at least `n` more fixed sim steps have run (the game really advanced). */
async function waitSteps(page, n = 2) {
  const s0 = await g3get(page, 'steps');
  await page.waitForFunction((t) => window.__spaceAdventure.game3d.steps >= t, s0 + n, { timeout: T });
}

const ui = (page) => page.evaluate(() => window.__spaceAdventure.game3d.ui);
const item = (page, id) => page.locator(`[data-u3d="${id}"]`);

/** Start as a guest: the menu closes at once and the game runs, whatever the motion permission does. */
async function start(page) {
  await expect.poll(async () => (await ui(page)).screen, { timeout: T }).toMatch(/^(profile|menu)$/);
  if ((await ui(page)).screen === 'profile') await item(page, 'guest').click();
  await item(page, 'play').click();
  await expect.poll(() => g3get(page, 'screen'), { timeout: T }).toBe('playing');
  await expect(page.locator('#u3d')).toBeHidden();
  await waitSteps(page, 1);
}

/** Step a Settings row (from the menu or the pause menu) until it shows `value`, then Back. */
async function setRow(page, key, value) {
  await item(page, 'settings').click();
  await expect.poll(async () => (await ui(page)).screen, { timeout: T }).toBe('settings');
  for (let i = 0; i < 12; i++) {
    const it = (await ui(page)).items.find((x) => x.id === `set-${key}`);
    if (it.value === value) break;
    await page.locator(`#u3d-set-${key} button`).nth(2).click();
  }
  expect((await ui(page)).items.find((x) => x.id === `set-${key}`).value).toBe(value);
  await item(page, 'back').click();
}

/** Wait for `ms` of GAME time (sim.time), not wall time: a slow renderer slows the game. */
async function play(page, ms) {
  const t0 = await g3get(page, 'time');
  await page.waitForFunction((t) => window.__spaceAdventure.game3d.time >= t, t0 + ms / 1000, { timeout: T });
}

/**
 * Dispatch a deviceorientation event for: an upright pose for the current screen angle,
 * then rotated by rel = { pitch, yaw, roll } degrees in the phone's own frame. The device
 * angles are computed in the page with the game's math module (inverse of deviceQuat).
 */
function orientRel(page, rel = {}) {
  return page.evaluate(async ({ pitch = 0, yaw = 0, roll = 0 }) => {
    const M = await import('/js/3d/math3d.js');
    const L = await import('/js/3d/look.js');
    const a = (screen.orientation && screen.orientation.angle) || 0;
    const upright = { 0: [0, 90, 0], 90: [0, 0, -90], 270: [0, 0, 90], [-90]: [0, 0, 90], 180: [0, -90, 0] }[a] || [0, 90, 0];
    const N = L.deviceQuat(upright[0], upright[1], upright[2], a);
    const D = M.qMul(N, M.qFromEulerYXZ(pitch * M.DEG, yaw * M.DEG, roll * M.DEG));
    const E = M.qMul(M.qMul(D, M.qFromAxisAngle([0, 0, 1], a * M.DEG)), [Math.SQRT1_2, 0, 0, Math.SQRT1_2]);
    const e = M.qToYawPitchRoll(E);
    const ev = new DeviceOrientationEvent('deviceorientation', {
      alpha: e.yaw / M.DEG, beta: e.pitch / M.DEG, gamma: -e.roll / M.DEG, absolute: false,
    });
    window.dispatchEvent(ev);
  }, rel).then(() => waitSteps(page, 2)); // a frame read it and the sim stepped with it
}

/** Hold a button for `ms` of game time. */
async function holdButton(page, selector, ms) {
  const box = await page.locator(selector).boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await play(page, ms);
  await page.mouse.up();
}

const poll = (page, key, opts = {}) => expect.poll(() => g3get(page, key), { timeout: T, ...opts });

test('renders the 3D view: draw calls and lit pixels, three.js r185', async ({ page }, testInfo) => {
  const errors = await open3d(page);
  const s = await g3(page);
  expect(s.three).toBe('185');
  expect(s.screen).toBe('menu');
  await shot(page, testInfo, 'menu');
  await start(page);
  await play(page, 800);
  await poll(page, 'drawCalls').toBeGreaterThan(0);
  expect(await g3get(page, 'menuOpen')).toBe(false);
  // The scene is really drawn (stars, planet, rocks): not just the clear colour
  const probe = await page.evaluate(() => window.__spaceAdventure.probe3d());
  expect(probe.lit).toBeGreaterThan(10);
  const after = await g3(page);
  expect(after.counts.green).toBeGreaterThan(0);
  expect(after.counts.red).toBeGreaterThan(0);
  expect(after.fps).toBeGreaterThan(0);
  expect(after.renderScale).toBeGreaterThan(0);
  await shot(page, testInfo, 'cockpit-forward');
  expect(errors).toEqual([]);
});

test('Direct: the ship follows the phone (yaw, pitch, roll); Recentre zeroes', async ({ page }, testInfo) => {
  const errors = await open3d(page, { permission: 'granted' });
  await start(page);
  expect(await page.evaluate(() => window.__permAsked)).toBe(1);
  await poll(page, 'permission').toBe('granted');
  await orientRel(page, {});
  await poll(page, 'lookMode').toBe('direct');
  await orientRel(page, { yaw: 40 });
  await poll(page, 'yaw').toBeCloseTo(40, 1);
  await orientRel(page, { pitch: 20 });
  await poll(page, 'pitch').toBeCloseTo(20, 1);
  await orientRel(page, { roll: 30 });
  await poll(page, 'roll').toBeCloseTo(30, 1);
  await orientRel(page, { yaw: 60, pitch: 10, roll: 20 });
  await play(page, 400);
  await shot(page, testInfo, 'turned');
  await page.click('#p3-recentre');
  await expect.poll(async () => {
    const s = await g3(page);
    return Math.abs(s.yaw) + Math.abs(s.pitch) + Math.abs(s.roll);
  }, { timeout: T }).toBeLessThan(0.01);
  // After recentring, the same pose is "straight ahead" and changes are relative to it
  await orientRel(page, { yaw: 60 + 0, pitch: 10, roll: 20 });
  await play(page, 200);
  expect(Math.abs(await g3get(page, 'yaw'))).toBeLessThan(0.5);
  expect(errors).toEqual([]);
});

test('Rate: tilt keeps turning, back to neutral stops', async ({ page }) => {
  await open3d(page, { permission: 'granted', storage: { spaceAdventure_control3d: 'rate' } });
  await start(page);
  await orientRel(page, {});
  await poll(page, 'lookMode').toBe('rate');
  await orientRel(page, { yaw: 30 });
  await play(page, 500);
  const y1 = await g3get(page, 'yaw');
  await play(page, 500);
  const y2 = await g3get(page, 'yaw');
  expect(y2).toBeGreaterThan(y1 + 1);
  await orientRel(page, {});
  await play(page, 300);
  const y3 = await g3get(page, 'yaw');
  await play(page, 500);
  expect(Math.abs((await g3get(page, 'yaw')) - y3)).toBeLessThan(0.01);
});

test('the HUD layer is see-through so the 3D scene is visible', async ({ page }) => {
  await open3d(page);
  await start(page);
  const bg = await page.evaluate(() => getComputedStyle(document.getElementById('p3-hud')).backgroundColor);
  expect(['rgba(0, 0, 0, 0)', 'transparent']).toContain(bg);
});

test('Joystick: dragging on the left half rotates the ship', async ({ page }, testInfo) => {
  await open3d(page, { storage: { spaceAdventure_control3d: 'joystick' } });
  await start(page);
  expect(await g3get(page, 'mode')).toBe('joystick');
  await expect(page.locator('#p3-stick-zone')).toBeVisible();
  const vp = page.viewportSize();
  const x = vp.width * 0.2, y = vp.height * 0.6;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + 60, y - 20, { steps: 4 });
  await poll(page, 'stick').toMatchObject({ active: true });
  // Read the direction after a short turn: held much longer (slow CI frames, screenshots) the
  // nose passes straight up and the yaw/pitch angles flip by 180°.
  await play(page, 150);
  const s = await g3(page);
  await shot(page, testInfo, 'joystick');
  await page.mouse.up();
  expect(s.yaw).toBeLessThan(-0.5); // dragged right: turned right
  expect(s.pitch).toBeGreaterThan(0.1); // dragged up: nose up
});

for (const mode of ['direct', 'rate', 'joystick']) {
  test(`Level horizon keeps roll at 0 (${mode})`, async ({ page }) => {
    await open3d(page, {
      permission: 'granted',
      storage: { spaceAdventure_control3d: mode, spaceAdventure_levelHorizon3d: 'true' },
    });
    await start(page);
    expect(await g3get(page, 'levelHorizon')).toBe(true);
    if (mode !== 'joystick') {
      await orientRel(page, {});
      await poll(page, 'lookMode').toBe(mode);
      await orientRel(page, { roll: 35, yaw: 20, pitch: 10 });
    } else {
      await expect(page.locator('#p3-roll-right')).toBeHidden(); // no roll buttons with a level horizon
      await page.keyboard.down('KeyE');
    }
    await play(page, 600);
    if (mode === 'joystick') await page.keyboard.up('KeyE');
    const s = await g3(page);
    expect(Math.abs(s.roll)).toBeLessThan(0.01);
    if (mode !== 'joystick') expect(Math.abs(s.yaw)).toBeGreaterThan(1);
  });
}

test('Thrust moves the ship; Fire shoots and splits the red rock ahead', async ({ page }) => {
  await open3d(page, { url: '/?3d=1&seed3d=1&layout3d=range', storage: { spaceAdventure_control3d: 'joystick' } });
  await start(page);
  const s0 = await g3(page);
  expect(s0.counts).toMatchObject({ red: 1, green: 1, rocks: 2 });
  // Fire (hold = auto-fire) at the red rock 300 units straight ahead
  const box = await page.locator('#p3-fire').boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await expect.poll(() => g3get(page, 'counts').then((c) => c.bullets), { timeout: T }).toBeGreaterThan(0);
  await expect.poll(() => g3get(page, 'counts').then((c) => c.rocks), { timeout: T }).toBeGreaterThan(2);
  await page.mouse.up();
  const s1 = await g3(page);
  expect(s1.stats.splits).toBeGreaterThan(0);
  expect(s1.stats.redsShot).toBeGreaterThan(0); // no points for red rocks, as in 2D
  // Thrust
  await holdButton(page, '#p3-thrust', 1000);
  const s2 = await g3(page);
  expect(s2.speed).toBeGreaterThan(5);
  expect(s2.shipPos[2]).toBeLessThan(s1.shipPos[2] - 1);
});

test('Keyboard: W thrusts, Space fires, P pauses', async ({ page }) => {
  await open3d(page, { url: '/?3d=1&seed3d=1&layout3d=range' });
  await start(page);
  await page.keyboard.down('KeyW');
  await page.keyboard.down('Space');
  await poll(page, 'speed').toBeGreaterThan(5);
  await expect.poll(() => g3get(page, 'stats').then((s) => s.shots), { timeout: T }).toBeGreaterThan(0);
  await page.keyboard.up('KeyW');
  await page.keyboard.up('Space');
  await page.keyboard.press('KeyP');
  await poll(page, 'screen').toBe('paused');
  await expect(item(page, 'resume')).toBeVisible();
});

test('Permission denied falls back to Joystick with a message', async ({ page }) => {
  await open3d(page, { permission: 'denied' });
  await start(page);
  await poll(page, 'permission').toBe('denied');
  await orientRel(page, { yaw: 30 }); // ignored without permission
  await play(page, 200);
  const s = await g3(page);
  expect(s.permission).toBe('denied');
  expect(s.chosenMode).toBe('direct');
  expect(s.mode).toBe('joystick');
  expect(s.message).toMatch(/denied/);
  // Shown once, on the HUD: the menus are hidden while playing
  await expect(page.locator('#u3d')).toBeHidden();
  expect(Math.abs(s.yaw)).toBeLessThan(0.01);
});

test('Portrait shows "landscape recommended"', async ({ page }, testInfo) => {
  await open3d(page);
  await page.setViewportSize({ width: 412, height: 892 });
  await start(page);
  await expect(page.locator('#p3-portrait-banner')).toBeVisible();
  expect(await g3get(page, 'portrait')).toBe(true);
  await shot(page, testInfo, 'portrait-warning');
});

test('View distance: Far by default, the choice persists and changes the world size', async ({ page }, testInfo) => {
  const errors = await open3d(page);
  let s = await g3(page);
  expect(s.viewDistance).toBe('far');
  expect(s.world.size).toBe(3200);
  expect(s.world.rendered.fogFar).toBe(1440);
  await expect.poll(async () => (await ui(page)).screen, { timeout: T }).toBe('profile');
  await item(page, 'guest').click();
  await setRow(page, 'viewDistance3d', 'veryfar');
  await poll(page, 'viewDistance').toBe('veryfar');
  s = await g3(page);
  expect(s.world.size).toBe(4200);
  expect(s.world.rendered).toMatchObject({ size: 4200, fogFar: 1870 });
  expect(s.world.rendered.cameraFar).toBeGreaterThan(s.world.cullDistance);
  // A new level 1 field: every rock counted, incoming ones still to come
  expect(s.level).toBe(1);
  expect(s.rocksLeft).toBe(s.counts.rocks + s.incomingLeft);
  expect(s.incomingLeft).toBeGreaterThan(0);
  expect(await page.evaluate(() => localStorage.getItem('spaceAdventure_viewDistance3d'))).toBe('veryfar');
  // Persists across a reload
  await page.reload();
  await page.waitForFunction(() => window.__spaceAdventure && window.__spaceAdventure.game3d
    && window.__spaceAdventure.game3d.loaded, null, { timeout: T });
  expect(await g3get(page, 'viewDistance')).toBe('veryfar');
  await start(page);
  await play(page, 500);
  // Level 1's fixed rock set (plan 07 §2.5) spread over the cube: some of it within the cull
  // distance, a handful of draw calls (instancing). drawnRocks is the renderer's count of the
  // same frame's rocks3d() entries inside the cull distance (one read: rocks keep moving).
  await poll(page, 'drawCalls').toBeGreaterThan(0);
  expect(await g3get(page, 'drawCalls')).toBeLessThan(25);
  await expect.poll(() => g3get(page, 'drawnRocks'), { timeout: T }).toBeGreaterThan(0);
  const seen = await page.evaluate(() => ({
    drawn: window.__spaceAdventure.game3d.drawnRocks,
    inCull: window.__spaceAdventure.rocks3d().filter((r) => r.drawn).length,
  }));
  expect(seen.drawn).toBe(seen.inCull);
  await shot(page, testInfo, 'far');
  expect(errors).toEqual([]);
});

test('A red rock beyond the old fog end (720) is visible at Far, fogged out at Normal', async ({ page }) => {
  const errors = await open3d(page, { url: '/?3d=1&seed3d=1&layout3d=far', storage: { spaceAdventure_control3d: 'joystick' } });
  await start(page);
  const red = async () => (await page.evaluate(() => window.__spaceAdventure.rocks3d())).find((r) => r.kind === 'red');
  await expect.poll(async () => (await red()).drawn, { timeout: T }).toBe(true);
  let r = await red();
  expect(r.distance).toBeGreaterThan(720);
  expect(r.distance).toBeLessThan(1440);
  expect(r.fog).toBeLessThan(0.9); // clearly visible, not just a fogged ghost
  // Normal view distance: the same layout, the rock is (almost) fully fogged
  // (a view distance applies to the next game: pause, Settings, Quit, Play again)
  await page.keyboard.press('KeyP');
  await poll(page, 'screen').toBe('paused');
  await setRow(page, 'viewDistance3d', 'normal');
  await poll(page, 'viewDistance').toBe('normal');
  await item(page, 'quit').click();
  await start(page);
  await expect.poll(async () => (await red()).fog, { timeout: T }).toBeGreaterThan(0.9);
  r = await red();
  expect(r.distance).toBeGreaterThan(900);
  expect(errors).toEqual([]);
});

test('Radar: the red rock ahead is at the front centre, the crystal behind at the rear centre; 90° moves it to the rim', async ({ page }, testInfo) => {
  const errors = await open3d(page, { url: '/?3d=1&seed3d=1&layout3d=range', permission: 'granted' });
  await start(page);
  await orientRel(page, {});
  await poll(page, 'lookMode').toBe('direct');
  const radar = () => g3get(page, 'radar');
  const rockOf = (r) => [...r.front, ...r.rear].find((b) => b.type === 'rock');
  let r = await radar();
  expect(r.front.map((b) => b.type)).toContain('rock');
  expect(Math.hypot(rockOf(r).x, rockOf(r).y)).toBeLessThan(0.02);
  const crystal = r.rear.find((b) => b.type === 'crystal');
  expect(crystal).toBeTruthy();
  expect(Math.hypot(crystal.x, crystal.y)).toBeLessThan(0.02);
  await shot(page, testInfo, 'radar');
  // Turn 90° left: the rock (still dead ahead in the world) is now on the right rim
  await orientRel(page, { yaw: 90 });
  await poll(page, 'yaw').toBeCloseTo(90, 0);
  await expect.poll(async () => rockOf(await radar()).x, { timeout: T }).toBeGreaterThan(0.95);
  r = await radar();
  expect(Math.abs(rockOf(r).y)).toBeLessThan(0.05);
  expect(errors).toEqual([]);
});

test('Switch to 2D opens the normal game without the parameter', async ({ page }) => {
  await open3d(page);
  await expect.poll(async () => (await ui(page)).screen, { timeout: T }).toBe('profile');
  await item(page, 'guest').click();
  await item(page, 'switch2d').click();
  await page.waitForFunction(() => window.__spaceAdventure && typeof window.__spaceAdventure.state === 'string', null, { timeout: T });
  expect(new URL(page.url()).searchParams.get('3d')).toBeNull();
  expect(await page.evaluate(() => 'game3d' in window.__spaceAdventure)).toBe(false);
});

test('A level ends as in 2D: collect the last crystal, shoot the last red rock, level 2 begins', async ({ page }, testInfo) => {
  const errors = await open3d(page, { url: '/?3d=1&seed3d=1&layout3d=last', storage: { spaceAdventure_control3d: 'joystick' } });
  let s = await g3(page);
  expect(s.levels).toBe(true);
  expect(s.level).toBe(1);
  expect(s.rocksLeft).toBe(2);
  expect(s.lastFew).toBe(true);
  await start(page);
  // Both are on screen straight ahead: on the radar, no arrows needed
  s = await g3(page);
  expect(s.radar.front.length).toBe(2);
  expect(s.markers).toEqual([]);
  // Fly into the crystal 100 ahead
  await holdButton(page, '#p3-thrust', 1200);
  await poll(page, 'counts').toMatchObject({ green: 0, red: 1 });
  expect((await g3(page)).score).toBeGreaterThan(0);
  // Shoot the small red rock: nothing left, the next level's field appears
  await holdButton(page, '#p3-fire', 600);
  await poll(page, 'level').toBe(2);
  s = await g3(page);
  expect(s.banner).toBe('LEVEL 2');
  expect(s.rocksLeft).toBeGreaterThan(2);
  expect(s.invulnerable).toBeGreaterThan(0);
  await shot(page, testInfo, 'level2');
  expect(errors).toEqual([]);
});

test('A real level 1: HUD hook has level, rocks left and incoming rocks arrive during play', async ({ page }) => {
  const errors = await open3d(page, { url: '/?3d=1&seed3d=3', storage: { spaceAdventure_control3d: 'joystick' } });
  const s0 = await g3(page);
  expect(s0.level).toBe(1);
  expect(s0.rocksLeft).toBe(s0.counts.rocks + s0.incomingLeft);
  await start(page);
  // The first incoming rock is sent after the difficulty interval (Medium 5.5 s of game time)
  await play(page, 6500);
  await poll(page, 'incomingLeft').toBeLessThan(s0.incomingLeft);
  expect(errors).toEqual([]);
});

test('Phase 2 hook: adaptive difficulty Balanced, its aids, the rock ahead bracketed, debris when it splits', async ({ page }) => {
  const errors = await open3d(page, { url: '/?3d=1&seed3d=1&layout3d=range', storage: { spaceAdventure_control3d: 'joystick' } });
  const s0 = await g3(page);
  expect(s0.difficulty).toBe('medium');
  expect(s0.adjustment).toMatchObject({ level: 'balanced', text: 'Balanced' });
  expect(s0.assist).toMatchObject({ aimDeg: 2, lead: true, crystalArrow: 'offscreen', pickupBonus: 0 });
  await start(page);
  await poll(page, 'target').toMatchObject({ dist: 300, onScreen: true, lead: false });
  // &lowres3d=1: the frame-rate check never runs (a software renderer is always slow)
  expect((await g3get(page, 'perf')).decision).toBe('measuring');
  expect((await g3get(page, 'contextLoss')).lost).toBe(false);
  await page.keyboard.down('Space');
  await expect.poll(() => g3get(page, 'stats').then((s) => s.splits), { timeout: T }).toBeGreaterThan(0);
  await page.keyboard.up('Space');
  await poll(page, 'particles').toBeGreaterThan(0);
  expect(errors).toEqual([]);
});

test('Difficulty: Medium by default; Hard persists and the next game starts with 2 lives', async ({ page }) => {
  const errors = await open3d(page);
  expect(await g3get(page, 'difficulty')).toBe('medium');
  await expect.poll(async () => (await ui(page)).screen, { timeout: T }).toBe('profile');
  await item(page, 'guest').click();
  await setRow(page, 'difficulty', 'hard');
  expect(await page.evaluate(() => localStorage.getItem('spaceAdventure_difficulty'))).toBe('hard');
  await page.reload();
  await page.waitForFunction(() => window.__spaceAdventure && window.__spaceAdventure.game3d
    && window.__spaceAdventure.game3d.loaded, null, { timeout: T });
  await start(page);
  expect(await g3get(page, 'difficulty')).toBe('hard');
  expect(await g3get(page, 'lives')).toBe(2);
  expect(errors).toEqual([]);
});

test('Graphics context loss pauses the game; a restored context is rebuilt and play resumes', async ({ page }) => {
  const errors = await open3d(page, { storage: { spaceAdventure_control3d: 'joystick' } });
  await start(page);
  // The page must stay: a slow restore is waited for (10 s of visible time), then asked about
  const url = page.url();
  let navigations = 0;
  page.on('framenavigated', (f) => { if (f === page.mainFrame()) navigations++; });
  const lose = () => page.evaluate(() => {
    const gl = document.getElementById('p3-canvas').getContext('webgl2');
    window.__loseExt = gl && gl.getExtension('WEBGL_lose_context');
    if (window.__loseExt) window.__loseExt.loseContext();
    return !!window.__loseExt;
  });
  test.skip(!(await lose()), 'WEBGL_lose_context not available');
  await poll(page, 'screen').toBe('paused');
  await expect.poll(() => g3get(page, 'contextLoss').then((c) => c.lost), { timeout: T }).toBe(true);
  await page.evaluate(() => window.__loseExt.restoreContext());
  await expect.poll(() => g3get(page, 'contextLoss').then((c) => c.lost), { timeout: T }).toBe(false);
  // The message came as a prompt over the pause menu: OK, then Resume
  await item(page, 'prompt-ok').click();
  await item(page, 'resume').click();
  await poll(page, 'screen').toBe('playing');
  await waitSteps(page, 2);
  await poll(page, 'drawCalls').toBeGreaterThan(0);
  expect(navigations).toBe(0);
  expect(page.url()).toBe(url);
  expect((await g3get(page, 'contextLoss')).gaveUp).toBe(false);
  expect(errors).toEqual([]);
});

test('layout3d=ufo: the UFO ahead shows on the radar; Space shoots it for 200 points', async ({ page }, testInfo) => {
  const errors = await open3d(page, { url: '/?3d=1&seed3d=1&layout3d=ufo', storage: { spaceAdventure_control3d: 'joystick' } });
  await start(page);
  await poll(page, 'ufos').toHaveLength(1);
  const s = await g3(page);
  expect(s.ufos[0].dist).toBe(400);
  expect(s.radar.front.some((b) => b.type === 'saucer')).toBe(true);
  await shot(page, testInfo, 'ufo');
  await page.keyboard.down('Space');
  await expect.poll(() => g3get(page, 'stats').then((st) => st.ufosShot), { timeout: T }).toBe(1);
  await page.keyboard.up('Space');
  expect(await g3get(page, 'score')).toBe(200);
  expect(await g3get(page, 'ufos')).toHaveLength(0);
  expect(errors).toEqual([]);
});

test('layout3d=boss: the boss enters, one shot at its exposed core defeats it, its drops appear, level 3 follows', async ({ page }, testInfo) => {
  const errors = await open3d(page, { url: '/?3d=1&seed3d=1&layout3d=boss', storage: { spaceAdventure_control3d: 'joystick' } });
  const s0 = await g3(page);
  expect(s0.level).toBe(2);
  expect(s0.boss.phase).toBe('entering');
  await start(page);
  await expect.poll(() => g3get(page, 'boss').then((b) => b && b.phase), { timeout: T }).toBe('fighting');
  await shot(page, testInfo, 'boss');
  await page.keyboard.down('Space');
  await expect.poll(() => g3get(page, 'stats').then((st) => st.bosses), { timeout: T }).toBe(1);
  await page.keyboard.up('Space');
  await poll(page, 'level').toBe(3);
  expect(await g3get(page, 'boss')).toBe(null);
  expect(errors).toEqual([]);
});

test('layout3d=powerup: thrust into the triple shot, then each shot fires 3 bullets; H jumps through hyperspace', async ({ page }) => {
  const errors = await open3d(page, { url: '/?3d=1&seed3d=1&layout3d=powerup', storage: { spaceAdventure_control3d: 'joystick' } });
  await start(page);
  expect((await g3get(page, 'powerUps'))[0].type).toBe('triple_shot');
  await page.keyboard.down('KeyW');
  await expect.poll(() => g3get(page, 'effects').then((e) => e.triple_shot || 0), { timeout: T }).toBeGreaterThan(0);
  await page.keyboard.up('KeyW');
  await page.keyboard.down('Space');
  await expect.poll(() => g3get(page, 'counts').then((c) => c.bullets), { timeout: T }).toBeGreaterThanOrEqual(3);
  await page.keyboard.up('Space');
  await page.keyboard.press('KeyH');
  await expect.poll(() => g3get(page, 'hyperspace').then((h) => h.jumps), { timeout: T }).toBe(1);
  expect(errors).toEqual([]);
});

test('layout3d=blocked: only a far UFO keeps the level going; it is on the radar and has an edge arrow', async ({ page }) => {
  const errors = await open3d(page, { url: '/?3d=1&seed3d=1&layout3d=blocked', storage: { spaceAdventure_control3d: 'joystick' } });
  await start(page);
  const s = await g3(page);
  expect(s.rocksLeft).toBe(0);
  expect(s.ufos[0].dist).toBeGreaterThan(s.world.fogFar);
  expect(s.lastFew).toBe(true);
  expect([...s.radar.front, ...s.radar.rear].some((b) => b.type === 'saucer')).toBe(true);
  expect(s.markers.some((m) => m.type === 'saucer')).toBe(true);
  expect(errors).toEqual([]);
});

test('Draw calls stay under 25 in a busy scene: boss, UFOs, power-ups, rocks, shots and debris (plan 07 §5)', async ({ page }, testInfo) => {
  const errors = await open3d(page, { url: '/?3d=1&seed3d=1&layout3d=busy', storage: { spaceAdventure_control3d: 'joystick' } });
  await start(page);
  await expect.poll(() => g3get(page, 'boss').then((b) => b && b.phase), { timeout: T }).toBe('fighting');
  // Shots and explosions too: fire at the rock ahead until it splits
  await page.keyboard.down('Space');
  await expect.poll(() => g3get(page, 'stats').then((s) => s.splits), { timeout: T }).toBeGreaterThan(0);
  await poll(page, 'particles').toBeGreaterThan(0);
  await play(page, 1000);
  await page.keyboard.up('Space');
  const s = await g3(page);
  expect(s.ufos.length).toBeGreaterThan(0);
  expect(s.powerUps.length).toBeGreaterThan(0);
  expect(s.peakDrawCalls).toBeGreaterThan(10);
  expect(s.peakDrawCalls).toBeLessThan(25);
  await shot(page, testInfo, 'busy');
  expect(errors).toEqual([]);
});
