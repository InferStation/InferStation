import path from "node:path";
import { defineConfig } from "@playwright/test";

const evidenceDir = process.env.E2E_EVIDENCE_DIR || path.resolve(import.meta.dirname, "../../artifacts/e2e");

export default defineConfig({
  testDir: path.join(import.meta.dirname, "specs"),
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 180_000,
  expect: { timeout: 15_000 },
  outputDir: path.join(evidenceDir, "test-results"),
  reporter: [
    ["line"],
    ["html", { outputFolder: path.join(evidenceDir, "html-report"), open: "never" }],
    ["json", { outputFile: path.join(evidenceDir, "playwright-report.json") }],
  ],
  use: {
    baseURL: process.env.E2E_BASE_URL || "http://e2e-web",
    viewport: { width: 1440, height: 1000 },
    locale: "zh-CN",
    timezoneId: "Asia/Shanghai",
    colorScheme: "light",
    reducedMotion: "reduce",
    trace: "on",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
    launchOptions: {
      chromiumSandbox: false,
      args: ["--no-sandbox"],
    },
  },
  projects: [{ name: "chromium", use: { browserName: "chromium" } }],
});
