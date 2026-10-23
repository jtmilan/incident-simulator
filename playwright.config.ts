import { defineConfig, devices } from '@playwright/test';

// BASE_URL points the same smoke test at the live site after a deploy.
// Without it, Playwright builds and serves the production bundle locally.
const liveUrl = process.env.BASE_URL;
const localUrl = 'http://localhost:4173/chaos-control-room/';

export default defineConfig({
  testDir: 'tests/e2e',
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: liveUrl ?? localUrl,
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: liveUrl
    ? undefined
    : {
        command: 'npm run build && npm run preview',
        url: localUrl,
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
      },
});
