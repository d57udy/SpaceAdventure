import { defineConfig, devices } from '@playwright/test';

// User acceptance tests against the LIVE GitHub Pages site (never a local server).
// Run by .github/workflows/uat-pages.yml after each Pages build, or by hand on GitHub
// (Actions > UAT on GitHub Pages > Run workflow). Not meant for the developer's Mac.
//
// UAT_BASE_URL overrides the site (default: the production Pages URL). The service worker
// runs as for a real visitor, so these tests also cover offline play and updates.
const BASE = process.env.UAT_BASE_URL || 'https://d57udy.github.io/SpaceAdventure/';
const ARGS_3D = ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--mute-audio'];

export default defineConfig({
  testDir: './tests/uat',
  timeout: 240000,
  expect: { timeout: 10000 },
  retries: 1,
  fullyParallel: true,
  workers: Number(process.env.PW_WORKERS) || 2,
  reporter: [['list']],
  use: { headless: true, baseURL: BASE, trace: 'retain-on-failure', serviceWorkers: 'allow' },
  projects: [
    {
      name: 'uat-desktop',
      use: {
        browserName: 'chromium', launchOptions: { args: ARGS_3D },
        viewport: { width: 1280, height: 800 }, hasTouch: false, isMobile: false,
      },
    },
    {
      name: 'uat-phone',
      // Pixel 7 Pro in landscape, the owner's test device
      use: {
        browserName: 'chromium', launchOptions: { args: ARGS_3D },
        viewport: { width: 892, height: 412 }, deviceScaleFactor: 3.5, isMobile: true, hasTouch: true,
      },
    },
    {
      name: 'uat-ipad-webkit',
      // Menus and 2D only: CI WebKit has no GPU (3D gameplay is too slow to test there)
      testMatch: ['live-2d.spec.js'],
      use: { ...devices['iPad (gen 7) landscape'], browserName: 'webkit' },
    },
  ],
});
