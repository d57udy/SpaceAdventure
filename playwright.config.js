import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  timeout: 30000,
  retries: 0,
  use: {
    headless: true,
    viewport: { width: 800, height: 600 },
    baseURL: 'http://localhost:8082',
  },
  webServer: {
    command: 'python3 -m http.server 8082',
    port: 8082,
    reuseExistingServer: true,
  },
  projects: [
    {
      name: 'chromium',
      use: { browserName: 'chromium' },
    },
  ],
});
