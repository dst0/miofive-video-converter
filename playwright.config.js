// @ts-check
const { defineConfig, devices } = require('@playwright/test');

/**
 * @see https://playwright.dev/docs/test-configuration
 */
module.exports = defineConfig({
  testDir: './tests',
  testIgnore: ['unit/**'],
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: 1,
  reporter: [['list'], ['html', { open: 'never' }]],
  timeout: 30000, // 30 seconds per test (default is 30s, making it explicit)
  use: {
    baseURL: 'http://127.0.0.1:3000',
    trace: 'retain-on-failure',
    actionTimeout: 10000, // 10 seconds for actions like click, fill
    serviceWorkers: 'block',
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],

  webServer: {
    command: 'npm start',
    url: 'http://127.0.0.1:3000',
    reuseExistingServer: false,
    timeout: 120 * 1000,
  },
});
