// 3D cockpit prototype (?3d=1, docs/plans/06-3d-mode.md Phase 0).
// Projects: chromium-3d (landscape phone, touch) and chromium-3d-desktop (mouse + keyboard),
// both with WebGL through SwiftShader. Motion is faked with DeviceOrientationEvent dispatches
// and a stubbed DeviceOrientationEvent.requestPermission (browser API stubs, never game
// state); everything is read through the read-only hook window.__spaceAdventure.game3d.
import { test, expect } from '@playwright/test';

test.setTimeout(90000); // SwiftShader renders slowly on CI

const variant = (testInfo) => (testInfo.project.name.endsWith('desktop') ? 'desktop' : 'phone');
const shot = (page, testInfo, name) => page.screenshot({ path: `tests/screenshots/3d-${variant(testInfo)}-${name}.png` });

/**
 * Open the prototype with fresh storage. Options: url, permission ('granted' | 'denied' |
 * null = no prompt API, like Android), storage (more localStorage entries).
 */
async function open3d(page, { url = '/?3d=1&seed3d=1', permission = null, storage = {} } = {}) {
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
    && window.__spaceAdventure.game3d.loaded, null, { timeout: 30000 });
  return errors;
}

const g3 = (page) => page.evaluate(() => window.__spaceAdventure.game3d);
const g3get = (page, key) => page.evaluate((k) => window.__spaceAdventure.game3d[k], key);

async function start(page) {
  await page.click('#p3-start');
  await expect.poll(() => g3get(page, 'screen'), { timeout: 10000 }).toBe('playing');
}

/** Wait until the sim time has advanced (frames really ran), roughly `ms` of game time. */
async function play(page, ms) {
  await page.waitForTimeout(ms);
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
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
  }, rel);
}

async function holdButton(page, selector, ms) {
  const box = await page.locator(selector).boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(ms);
  await page.mouse.up();
}

test('renders the cockpit: draw calls and lit pixels, three.js r185', async ({ page }, testInfo) => {
  const errors = await open3d(page);
  const s = await g3(page);
  expect(s.three).toBe('185');
  expect(s.screen).toBe('menu');
  await shot(page, testInfo, 'menu');
  await start(page);
  await play(page, 800);
  await expect.poll(() => g3get(page, 'drawCalls')).toBeGreaterThan(0);
  const probe = await page.evaluate(() => window.__spaceAdventure.probe3d());
  expect(probe.lit).toBeGreaterThan(0);
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
  expect(await g3get(page, 'permission')).toBe('granted');
  await orientRel(page, {});
  await expect.poll(() => g3get(page, 'mode')).toBe('direct');
  await orientRel(page, { yaw: 40 });
  await expect.poll(() => g3get(page, 'yaw')).toBeCloseTo(40, 1);
  await orientRel(page, { pitch: 20 });
  await expect.poll(() => g3get(page, 'pitch')).toBeCloseTo(20, 1);
  await orientRel(page, { roll: 30 });
  await expect.poll(() => g3get(page, 'roll')).toBeCloseTo(30, 1);
  await orientRel(page, { yaw: 60, pitch: 10, roll: 20 });
  await play(page, 400);
  await shot(page, testInfo, 'turned');
  await page.click('#p3-recentre');
  await expect.poll(async () => {
    const s = await g3(page);
    return Math.abs(s.yaw) + Math.abs(s.pitch) + Math.abs(s.roll);
  }).toBeLessThan(0.01);
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
  await expect.poll(() => g3get(page, 'mode')).toBe('rate');
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

test('Joystick: dragging on the left half rotates the ship', async ({ page }, testInfo) => {
  await open3d(page, { storage: { spaceAdventure_control3d: 'joystick' } });
  await start(page);
  expect(await g3get(page, 'mode')).toBe('joystick');
  const vp = page.viewportSize();
  const x = vp.width * 0.2, y = vp.height * 0.6;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + 60, y - 20, { steps: 4 });
  await page.waitForTimeout(600);
  expect((await g3get(page, 'stick')).active).toBe(true);
  await shot(page, testInfo, 'joystick');
  await page.mouse.up();
  const s = await g3(page);
  expect(s.yaw).toBeLessThan(-2); // dragged right: turned right
  expect(s.pitch).toBeGreaterThan(0.5); // dragged up: nose up
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
      await expect.poll(() => g3get(page, 'mode')).toBe(mode);
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
  await expect.poll(() => g3get(page, 'counts').then((c) => c.bullets), { timeout: 10000 }).toBeGreaterThan(0);
  await expect.poll(() => g3get(page, 'counts').then((c) => c.rocks), { timeout: 20000 }).toBeGreaterThan(2);
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
  await expect.poll(() => g3get(page, 'speed'), { timeout: 10000 }).toBeGreaterThan(5);
  await expect.poll(() => g3get(page, 'stats').then((s) => s.shots), { timeout: 10000 }).toBeGreaterThan(0);
  await page.keyboard.up('KeyW');
  await page.keyboard.up('Space');
  await page.keyboard.press('KeyP');
  await expect.poll(() => g3get(page, 'screen')).toBe('paused');
  await expect(page.locator('#p3-start')).toHaveText('Resume');
});

test('Permission denied falls back to Joystick with a message', async ({ page }) => {
  await open3d(page, { permission: 'denied' });
  await expect(page.locator('#p3-start')).toHaveText('Enable motion & start');
  await page.click('#p3-start');
  await expect.poll(() => g3get(page, 'screen')).toBe('playing');
  await orientRel(page, { yaw: 30 }); // ignored without permission
  await play(page, 200);
  const s = await g3(page);
  expect(s.permission).toBe('denied');
  expect(s.chosenMode).toBe('direct');
  expect(s.mode).toBe('joystick');
  expect(s.message).toMatch(/denied/);
  expect(Math.abs(s.yaw)).toBeLessThan(0.01);
});

test('Portrait shows "landscape recommended"', async ({ page }, testInfo) => {
  await open3d(page);
  await page.setViewportSize({ width: 412, height: 892 });
  await expect(page.locator('#p3-portrait-note')).toBeVisible();
  expect(await g3get(page, 'portrait')).toBe(true);
  await shot(page, testInfo, 'portrait-warning');
});

test('Back to 2D reloads the normal game without the parameter', async ({ page }) => {
  await open3d(page);
  await page.click('#p3-back2d');
  await page.waitForFunction(() => window.__spaceAdventure && typeof window.__spaceAdventure.state === 'string', null, { timeout: 15000 });
  expect(new URL(page.url()).searchParams.get('3d')).toBeNull();
  expect(await page.evaluate(() => 'game3d' in window.__spaceAdventure)).toBe(false);
});
