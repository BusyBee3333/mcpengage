import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/ui",
  timeout: 30_000,
  fullyParallel: true,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : "list",
  use: { baseURL: "http://127.0.0.1:4173", trace: "retain-on-failure", screenshot: "only-on-failure" },
  webServer: { command: "npm run preview:ui", url: "http://127.0.0.1:4173/revenue-copilot.html", reuseExistingServer: !process.env.CI, timeout: 30_000 },
  projects: [{ name: "chromium", use: { browserName: "chromium" } }]
});
