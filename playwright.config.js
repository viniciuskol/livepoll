import { defineConfig, devices } from '@playwright/test';
import { existsSync } from 'node:fs';

// Browsers are pre-installed in the CI image; never download them there. Off
// that image (a dev machine, Windows) the path does not exist, and forcing it
// hides the browsers Playwright installed in its own cache - every e2e test
// then fails at browser launch, before it ever reaches the app.
const IMAGE_BROWSERS = '/opt/pw-browsers';
if (!process.env.PLAYWRIGHT_BROWSERS_PATH && existsSync(IMAGE_BROWSERS)) {
  process.env.PLAYWRIGHT_BROWSERS_PATH = IMAGE_BROWSERS;
}
const PINNED_CHROMIUM = `${IMAGE_BROWSERS}/chromium-1194/chrome-linux/chrome`;

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 90_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: 'http://127.0.0.1:8787',
    ...devices['Desktop Chrome'],
    launchOptions: existsSync(PINNED_CHROMIUM) ? { executablePath: PINNED_CHROMIUM } : {},
  },
  webServer: {
    command: 'npm run dev',
    url: 'http://127.0.0.1:8787/api/health',
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
