// 3D cockpit prototype (?3d=1, docs/plans/06-3d-mode.md Phase 0).
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

/** Start: the menu closes at once and the game runs, whatever the motion permission does. */
async function start(page) {
  await page.click('#p3-start');
  await expect.poll(() => g3get(page, 'screen'), { timeout: T }).toBe('playing');
  await expect(page.locator('#p3-menu')).toBeHidden();
  await waitSteps(page, 1);
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
  expect(s1.score).toBeGreaterThan(0);
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
  await expect(page.locator('#p3-start')).toHaveText('Resume');
});

test('Permission denied falls back to Joystick with a message', async ({ page }) => {
  await open3d(page, { permission: 'denied' });
  await expect(page.locator('#p3-start')).toHaveText('Enable motion & start');
  await start(page);
  await poll(page, 'permission').toBe('denied');
  await orientRel(page, { yaw: 30 }); // ignored without permission
  await play(page, 200);
  const s = await g3(page);
  expect(s.permission).toBe('denied');
  expect(s.chosenMode).toBe('direct');
  expect(s.mode).toBe('joystick');
  expect(s.message).toMatch(/denied/);
  // Shown once, on the HUD: the menu (and its status line) is hidden while playing
  await expect(page.locator('#p3-msg')).toBeHidden();
  expect(Math.abs(s.yaw)).toBeLessThan(0.01);
});

test('Portrait shows "landscape recommended"', async ({ page }, testInfo) => {
  await open3d(page);
  await page.setViewportSize({ width: 412, height: 892 });
  await expect(page.locator('#p3-portrait-note')).toBeVisible();
  expect(await g3get(page, 'portrait')).toBe(true);
  await shot(page, testInfo, 'portrait-warning');
});

test('View distance: Far by default, the choice persists and changes the world size', async ({ page }, testInfo) => {
  const errors = await open3d(page);
  let s = await g3(page);
  expect(s.viewDistance).toBe('far');
  expect(s.world.size).toBe(3200);
  expect(s.world.rendered.fogFar).toBe(1440);
  await expect(page.locator('#p3-view-far')).toHaveAttribute('aria-pressed', 'true');
  await page.click('#p3-view-veryfar');
  await poll(page, 'viewDistance').toBe('veryfar');
  s = await g3(page);
  expect(s.world.size).toBe(4200);
  expect(s.world.rendered).toMatchObject({ size: 4200, fogFar: 1870 });
  expect(s.world.rendered.cameraFar).toBeGreaterThan(s.world.cullDistance);
  expect(s.counts.rocks).toBe(s.world.greens + s.world.reds);
  expect(await page.evaluate(() => localStorage.getItem('spaceAdventure_viewDistance3d'))).toBe('veryfar');
  // Persists across a reload
  await page.reload();
  await page.waitForFunction(() => window.__spaceAdventure && window.__spaceAdventure.game3d
    && window.__spaceAdventure.game3d.loaded, null, { timeout: T });
  expect(await g3get(page, 'viewDistance')).toBe('veryfar');
  await expect(page.locator('#p3-view-veryfar')).toHaveAttribute('aria-pressed', 'true');
  await start(page);
  await play(page, 500);
  // Hundreds of rocks, still a handful of draw calls (instancing)
  await poll(page, 'drawCalls').toBeGreaterThan(0);
  expect(await g3get(page, 'drawCalls')).toBeLessThan(30);
  expect(await g3get(page, 'drawnRocks')).toBeGreaterThan(50);
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
  await page.keyboard.press('KeyP');
  await poll(page, 'screen').toBe('paused');
  await page.click('#p3-view-normal');
  await poll(page, 'viewDistance').toBe('normal');
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

test('Back to 2D reloads the normal game without the parameter', async ({ page }) => {
  await open3d(page);
  await page.click('#p3-back2d');
  await page.waitForFunction(() => window.__spaceAdventure && typeof window.__spaceAdventure.state === 'string', null, { timeout: T });
  expect(new URL(page.url()).searchParams.get('3d')).toBeNull();
  expect(await page.evaluate(() => 'game3d' in window.__spaceAdventure)).toBe(false);
});
