import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  timeout: 60000,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  use: {
    baseURL: "http://localhost:4100",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    viewport: { width: 390, height: 844 },
  },
  webServer: {
    command: "node dist-server/server/index.js",
    url: "http://localhost:4100",
    reuseExistingServer: false,
    timeout: 30000,
    env: {
      PORT: "4100",
      NODE_ENV: "test",
      SESSION_SECRET: "e2e-test-secret-key-not-for-prod",
      PLANBUDDY_DATA_DIR: ":memory:",
    },
  },
  projects: [
    {
      name: "mobile-chrome",
      use: { ...devices["Pixel 7"] },
    },
  ],
});
