import { defineConfig, devices } from '@playwright/test';

// Browser integration / UAT tests for Space Adventure.
//
// Projects:
//   desktop-chromium       keyboard + mouse, 1280x800, DPR 1  -> smoke + hidpi + keyboard specs
//   ipad-webkit            iPad (gen 7) portrait, WebKit, DPR 2  -> smoke + hidpi + touch specs
//   ipad-webkit-landscape  iPad (gen 7) landscape, WebKit, DPR 2 -> smoke + hidpi + touch specs
//   ipad-chromium-touch    Chromium, hasTouch, 1024x768, DPR 1 -> smoke + hidpi + touch specs
//
// Only tests/integration is scanned; tests/unit is owned by a separate runner.
const PORT = 8082;

const KEYBOARD_SPECS = ['smoke.spec.js', 'hidpi.spec.js', 'keyboard.spec.js', 'settings.spec.js', 'colours.spec.js'];
const TOUCH_SPECS = ['smoke.spec.js', 'hidpi.spec.js', 'touch.spec.js', 'settings.spec.js', 'colours.spec.js'];

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
  webServer: {
    command: `python3 -m http.server ${PORT}`,
    port: PORT,
    reuseExistingServer: true,
    stdout: 'ignore',
    stderr: 'ignore',
  },
  projects: [
    {
      name: 'desktop-chromium',
      testMatch: KEYBOARD_SPECS,
      use: {
        browserName: 'chromium',
        viewport: { width: 1280, height: 800 },
        hasTouch: false,
        isMobile: false,
      },
    },
    {
      name: 'ipad-webkit',
      testMatch: TOUCH_SPECS,
      use: { ...devices['iPad (gen 7)'], browserName: 'webkit' },
    },
    {
      name: 'ipad-webkit-landscape',
      testMatch: TOUCH_SPECS,
      use: { ...devices['iPad (gen 7) landscape'], browserName: 'webkit' },
    },
    {
      name: 'ipad-chromium-touch',
      testMatch: TOUCH_SPECS,
      use: {
        browserName: 'chromium',
        viewport: { width: 1024, height: 768 },
        hasTouch: true,
        isMobile: false,
      },
    },
  ],
});
