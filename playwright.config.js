import { defineConfig, devices } from '@playwright/test';

// Browser integration / UAT tests for Space Adventure.
//
// Projects:
//   desktop-chromium       keyboard + mouse, 1280x800, DPR 1  -> smoke + hidpi + keyboard specs
//   ipad-webkit            iPad (gen 7) portrait, WebKit, DPR 2  -> smoke + hidpi + touch specs
//   ipad-webkit-landscape  iPad (gen 7) landscape, WebKit, DPR 2 -> smoke + hidpi + touch specs
//   ipad-chromium-touch    Chromium, hasTouch, 1024x768, DPR 1 -> smoke + hidpi + touch specs
//   pixel-chromium         Pixel 7 Pro portrait, Chromium, 412x892, DPR 3.5, mobile + touch
//                          -> smoke + hidpi + touch + phone + settings + tutorial + layout specs
//   (phone.spec.js in the touch list overrides the viewport to a 390x844 phone)
//   layout.spec.js (every non-PWA project): the canvas fills the viewport at any aspect ratio,
//   menus fit, screenshots per project in tests/screenshots/
//   pwa-chromium           service worker, offline, install, full screen at /       -> pwa spec
//   pwa-subpath            the same served under /SpaceAdventure/ like GitHub Pages -> pwa spec
//   chromium-3d            3D prototype (?3d=1): landscape phone 892x412, touch, WebGL through
//                          SwiftShader (no GPU on CI)                                -> proto3d spec
//   chromium-3d-desktop    the same at 1280x800 with mouse and keyboard             -> proto3d spec
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

const KEYBOARD_SPECS = ['smoke.spec.js', 'hidpi.spec.js', 'keyboard.spec.js', 'settings.spec.js', 'colours.spec.js', 'music-render.spec.js', 'gamepad.spec.js', 'tutorial.spec.js', 'players.spec.js', 'mp-modes.spec.js', 'mp-lobby.spec.js', 'mp-keyboard.spec.js', 'app-ui.spec.js', 'timeattack.spec.js', 'mp-versus.spec.js', 'mp-gamepad.spec.js', 'mp-saucer.spec.js', 'mp-access.spec.js', 'mp-camera.spec.js', 'layout.spec.js', 'platform.spec.js', 'no3d.spec.js', 'mode-switch.spec.js'];
const PWA_SPECS = ['pwa.spec.js'];
const TOUCH_SPECS = ['smoke.spec.js', 'hidpi.spec.js', 'touch.spec.js', 'settings.spec.js', 'colours.spec.js', 'music-render.spec.js', 'gamepad.spec.js', 'tutorial.spec.js', 'mp-modes.spec.js', 'mp-touch.spec.js', 'mp-facing.spec.js', 'app-ui.spec.js', 'mp-access.spec.js', 'phone.spec.js', 'layout.spec.js', 'platform.spec.js'];
// 3D prototype: WebGL needs SwiftShader in headless CI (docs/plans/06-3d-mode.md §5)
const SPECS_3D = ['proto3d.spec.js'];
const ARGS_3D = ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--mute-audio'];
// A tall phone (the adaptive, non-square canvas on a small screen)
const PIXEL_SPECS = ['smoke.spec.js', 'hidpi.spec.js', 'touch.spec.js', 'phone.spec.js', 'settings.spec.js', 'tutorial.spec.js', 'layout.spec.js'];

export default defineConfig({
  testDir: './tests/integration',
  timeout: 30000,
  expect: { timeout: 5000 },
  retries: process.env.CI ? 1 : 0,
  fullyParallel: true,
  // Keep the machine usable: at most 2 browsers at a time unless PW_WORKERS says otherwise.
  // (Several full parallel runs at once overloaded the developer's Mac.)
  workers: Number(process.env.PW_WORKERS) || 2,
  reporter: [['list']],
  use: {
    headless: true,
    // Never play game sounds through the speakers during tests: Chromium-only flag
    // (WebKit rejects unknown args); tests/integration/helpers.js silences WebKit's audio.
    launchOptions: { args: [] },
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
        browserName: 'chromium', launchOptions: { args: ['--mute-audio'] },
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
        browserName: 'chromium', launchOptions: { args: ['--mute-audio'] },
        viewport: { width: 1024, height: 768 },
        hasTouch: true,
        isMobile: false,
        serviceWorkers: 'block',
      },
    },
    {
      name: 'pixel-chromium',
      testMatch: PIXEL_SPECS,
      use: {
        browserName: 'chromium', launchOptions: { args: ['--mute-audio'] },
        viewport: { width: 412, height: 892 },
        deviceScaleFactor: 3.5,
        isMobile: true,
        hasTouch: true,
        serviceWorkers: 'block',
      },
    },
    {
      name: 'pwa-chromium',
      testMatch: PWA_SPECS,
      use: {
        browserName: 'chromium', launchOptions: { args: ['--mute-audio'] },
        viewport: { width: 1280, height: 800 },
        serviceWorkers: 'allow',
      },
    },
    {
      name: 'pwa-subpath',
      testMatch: PWA_SPECS,
      use: {
        browserName: 'chromium', launchOptions: { args: ['--mute-audio'] },
        viewport: { width: 1280, height: 800 },
        serviceWorkers: 'allow',
        baseURL: `http://localhost:${SUBPATH_PORT}/SpaceAdventure/`,
      },
    },
    {
      name: 'chromium-3d',
      testMatch: SPECS_3D,
      use: {
        browserName: 'chromium', launchOptions: { args: ARGS_3D },
        viewport: { width: 892, height: 412 },
        deviceScaleFactor: 3.5,
        isMobile: true,
        hasTouch: true,
        serviceWorkers: 'block',
      },
    },
    {
      name: 'chromium-3d-desktop',
      testMatch: SPECS_3D,
      use: {
        browserName: 'chromium', launchOptions: { args: ARGS_3D },
        viewport: { width: 1280, height: 800 },
        hasTouch: false,
        isMobile: false,
        serviceWorkers: 'block',
      },
    },
  ],
});
