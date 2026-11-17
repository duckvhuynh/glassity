import { defineConfig, devices } from '@playwright/test';

const port = 4174;

// Browser tests run against the built package: `npm run build` first.
export default defineConfig({
  testDir: 'e2e',
  timeout: 30_000,
  fullyParallel: true,
  // Software WebGL in three browsers at once starves the frame loop; two workers keep timings honest.
  workers: 2,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['list']] : 'list',
  use: {
    baseURL: `http://localhost:${port}`,
    viewport: { width: 800, height: 700 },
    deviceScaleFactor: 1,
  },
  webServer: {
    command: `node demo/serve.mjs ${port}`,
    url: `http://localhost:${port}/e2e/fixtures/basic.html`,
    reuseExistingServer: !process.env.CI,
  },
  projects: [
    {
      name: 'chromium',
      // Headless Chromium on machines without a GPU needs the software renderer allowed explicitly.
      use: { ...devices['Desktop Chrome'], viewport: { width: 800, height: 700 }, launchOptions: { args: ['--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] } },
    },
    {
      name: 'firefox',
      use: { ...devices['Desktop Firefox'], viewport: { width: 800, height: 700 }, launchOptions: { firefoxUserPrefs: { 'webgl.force-enabled': true } } },
    },
    {
      name: 'webkit',
      use: { ...devices['Desktop Safari'], viewport: { width: 800, height: 700 }, deviceScaleFactor: 1 },
    },
  ],
});
