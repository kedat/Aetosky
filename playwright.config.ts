import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { defineConfig } from "@playwright/test";

const localBrowsers = resolve(".tools/playwright-browsers");
if (!process.env.PLAYWRIGHT_BROWSERS_PATH && existsSync(localBrowsers)) process.env.PLAYWRIGHT_BROWSERS_PATH = localBrowsers;

export default defineConfig({
  testDir: "./e2e",
  testMatch: "dashboard.spec.ts",
  workers: 1,
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  timeout: 30_000,
  expect: { timeout: 8_000 },
  reporter: [["list"], ["html", { open: "never" }]],
  use: { baseURL: "http://127.0.0.1:4910", timezoneId: "Asia/Ho_Chi_Minh", locale: "en-GB", reducedMotion: "reduce", trace: "retain-on-failure", screenshot: "only-on-failure" },
  projects: [
    { name: "chromium", use: { browserName: "chromium", viewport: { width: 1440, height: 1000 } } },
    { name: "mobile-chromium", use: { browserName: "chromium", viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true } },
    { name: "firefox", use: { browserName: "firefox", viewport: { width: 1440, height: 900 } } },
    { name: "webkit", use: { browserName: "webkit", viewport: { width: 1440, height: 900 } } },
  ],
  webServer: [
    { command: "pnpm exec tsx e2e/server.ts", url: "http://127.0.0.1:4911/__test/health", reuseExistingServer: false, timeout: 30_000 },
    { command: "pnpm --filter @earthquake/web exec vite --host 127.0.0.1 --port 4910 --strictPort", url: "http://127.0.0.1:4910", env: { API_PROXY_TARGET: "http://127.0.0.1:4911" }, reuseExistingServer: false },
  ],
});
