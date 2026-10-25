import { defineConfig } from "@playwright/test";
import base from "./playwright.config.js";

export default defineConfig({
  ...base,
  testMatch: "live.spec.ts",
  outputDir: "test-results/live",
  reporter: [["list"], ["html", { outputFolder: "playwright-live-report", open: "never" }]],
  projects: [{ name: "live-chromium", use: { browserName: "chromium", viewport: { width: 1440, height: 1000 } } }],
  webServer: [
    { command: "pnpm exec tsx e2e/server.ts", url: "http://127.0.0.1:4911/__test/health", env: { E2E_LIVE: "1" }, reuseExistingServer: false },
    { command: "pnpm --filter @earthquake/web exec vite --host 127.0.0.1 --port 4910 --strictPort", url: "http://127.0.0.1:4910", env: { API_PROXY_TARGET: "http://127.0.0.1:4911" }, reuseExistingServer: false },
  ],
});
