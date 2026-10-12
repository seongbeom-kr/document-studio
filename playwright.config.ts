import { defineConfig } from "@playwright/test";
const port = Number(process.env.DOCUMENT_STUDIO_TEST_PORT ?? 4173);
const bundled = process.env.DOCUMENT_STUDIO_TEST_SERVER === "bundle";
export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 45000,
  expect: { timeout: 10000 },
  fullyParallel: true,
  workers: 2,
  reporter: [
    ["list"],
    ["json", { outputFile: ".build/e2e-results.json" }],
    ["html", { open: "never" }],
  ],
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    viewport: { width: 1440, height: 1000 },
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: process.env.CI
    ? [{ name: "chromium", use: { browserName: "chromium" } }]
    : [
        { name: "chrome", use: { browserName: "chromium", channel: "chrome" } },
        { name: "edge", use: { browserName: "chromium", channel: "msedge" } },
      ],
  webServer: {
    command: bundled
      ? `node scripts/serve-e2e.mjs --port ${port}`
      : `yarn dev:playground --port ${port}`,
    url: `http://127.0.0.1:${port}`,
    reuseExistingServer: !bundled && !process.env.CI,
    timeout: 30000,
  },
});
