import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 30000,
  retries: 0,
  use: {
    baseURL: "http://localhost:8123",
  },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        launchOptions: {
          args: [
            `--disable-extensions-except=${process.env.EXTENSION_PATH || "."}`,
            `--load-extension=${process.env.EXTENSION_PATH || "."}`,
          ],
        },
      },
    },
  ],
  webServer: {
    command: "python3 -m http.server 8123",
    port: 8123,
    cwd: "./tests/fixtures",
    reuseExistingServer: true,
  },
});
