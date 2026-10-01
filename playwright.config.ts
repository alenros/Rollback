import { defineConfig, devices } from '@playwright/test';
import dotenv from 'dotenv';

// Load Firebase credentials from .env — these tests talk to the real database.
dotenv.config();

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false, // Run serially to avoid Firebase conflicts
  timeout: 60000,
  retries: 1,

  use: {
    baseURL: 'http://localhost:4321',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },

  webServer: {
    command: 'pnpm dev', // localhost only: --host would trigger a Windows Firewall prompt
    url: 'http://localhost:4321',
    reuseExistingServer: !process.env.CI,
    timeout: 120000,
  },

  projects: [
    {
      name: 'chromium',
      // PW_CHANNEL=msedge or chrome runs on an installed browser instead of Playwright's own build.
      use: { ...devices['Desktop Chrome'], channel: process.env.PW_CHANNEL },
    },
  ],
});
