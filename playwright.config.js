import { defineConfig, devices } from '@playwright/test';

// Browser integration / UAT tests for Space Adventure.
//
// Projects:
//   desktop-chromium       keyboard + mouse, 1280x800, DPR 1  -> smoke + hidpi + keyboard specs
//   ipad-webkit            iPad (gen 7) portrait, WebKit, DPR 2  -> smoke + hidpi + touch specs
//   ipad-webkit-landscape  iPad (gen 7) landscape, WebKit, DPR 2 -> smoke + hidpi + touch specs
//   ipad-chromium-touch    Chromium, hasTouch, 1024x768, DPR 1 -> smoke + hidpi + touch specs
//   pwa-chromium           service worker, offline, install, full screen at /       -> pwa spec
//   pwa-subpath            the same served under /SpaceAdventure/ like GitHub Pages -> pwa spec
//
// The existing projects block service workers (serviceWorkers: 'block') so they stay
// deterministic; only the pwa-* projects let the worker run (the page opts in with ?sw=1
// on localhost). Playwright's service worker support is Chromium-only.
//
// Only tests/integration is scanned; tests/unit is owned by a separate runner.
const PORT = Number(process.env.PW_PORT) || 8082; // PW_PORT lets parallel worktrees use separate servers
// Sub-path server (tests/support/serve.mjs --admin): the repo under /SpaceAdventure/, with the
// test-only /__admin/override endpoint used by the update-flow test.
const SUBPATH_PORT = Number(process.env.PW_SUBPATH_PORT) || 8083;

const KEYBOARD_SPECS = ['smoke.spec.js', 'hidpi.spec.js', 'keyboard.spec.js', 'settings.spec.js', 'colours.spec.js', 'music-render.spec.js', 'gamepad.spec.js', 'tutorial.spec.js', 'players.spec.js', 'mp-modes.spec.js', 'mp-lobby.spec.js', 'app-ui.spec.js'];
const PWA_SPECS = ['pwa.spec.js'];
const TOUCH_SPECS = ['smoke.spec.js', 'hidpi.spec.js', 'touch.spec.js', 'settings.spec.js', 'colours.spec.js', 'music-render.spec.js', 'gamepad.spec.js', 'tutorial.spec.js', 'mp-modes.spec.js', 'app-ui.spec.js'];

export default defineConfig({
  testDir: './tests/integration',
  timeout: 30000,
  expect: { timeout: 5000 },
  retries: process.env.CI ? 1 : 0,
  fullyParallel: true,
  reporter: [['list']],
  use: {
    headless: true,
    baseURL: `http://localhost:${PORT}`,
    trace: 'retain-on-failure',
  },
  webServer: [
    {
      command: `python3 -m http.server ${PORT}`,
      port: PORT,
      reuseExistingServer: true,
      stdout: 'ignore',
      stderr: 'ignore',
    },
    {
      command: `node tests/support/serve.mjs --port ${SUBPATH_PORT} --prefix /SpaceAdventure/ --admin`,
      url: `http://localhost:${SUBPATH_PORT}/SpaceAdventure/`,
      // Never reuse: another checkout's server would serve other files and admin overrides
      reuseExistingServer: false,
      stdout: 'ignore',
      stderr: 'pipe',
    },
  ],
  projects: [
    {
      name: 'desktop-chromium',
      testMatch: KEYBOARD_SPECS,
      use: {
        browserName: 'chromium',
        viewport: { width: 1280, height: 800 },
        hasTouch: false,
        isMobile: false,
        serviceWorkers: 'block',
      },
    },
    {
      name: 'ipad-webkit',
      testMatch: TOUCH_SPECS,
      use: { ...devices['iPad (gen 7)'], browserName: 'webkit', serviceWorkers: 'block' },
    },
    {
      name: 'ipad-webkit-landscape',
      testMatch: TOUCH_SPECS,
      use: { ...devices['iPad (gen 7) landscape'], browserName: 'webkit', serviceWorkers: 'block' },
    },
    {
      name: 'ipad-chromium-touch',
      testMatch: TOUCH_SPECS,
      use: {
        browserName: 'chromium',
        viewport: { width: 1024, height: 768 },
        hasTouch: true,
        isMobile: false,
        serviceWorkers: 'block',
      },
    },
    {
      name: 'pwa-chromium',
      testMatch: PWA_SPECS,
      use: {
        browserName: 'chromium',
        viewport: { width: 1280, height: 800 },
        serviceWorkers: 'allow',
      },
    },
    {
      name: 'pwa-subpath',
      testMatch: PWA_SPECS,
      use: {
        browserName: 'chromium',
        viewport: { width: 1280, height: 800 },
        serviceWorkers: 'allow',
        baseURL: `http://localhost:${SUBPATH_PORT}/SpaceAdventure/`,
      },
    },
  ],
});
