import { chromium } from "@playwright/test";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import http from "node:http";
import assert from "node:assert/strict";
const template = await readFile(
  new URL("../packages/template/dist/index.js", import.meta.url),
);
const entry =
  'import {validateContractV3} from "/template.js"; window.templateV3Ready=typeof validateContractV3==="function";';
const server = http.createServer((request, response) => {
  response.setHeader(
    "Content-Security-Policy",
    "default-src 'none'; script-src 'self'; connect-src 'self'; style-src 'self'",
  );
  response.setHeader(
    "Content-Type",
    request.url.endsWith(".js") ? "text/javascript" : "text/html",
  );
  response.end(
    request.url === "/template.js"
      ? template
      : request.url === "/entry.js"
        ? entry
        : '<!doctype html><html><body><script type="module" src="/entry.js"></script></body></html>',
  );
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
let browser;
try {
  const executablePath = [
    chromium.executablePath(),
    "C:/Program Files/Google/Chrome/Application/chrome.exe",
    "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  ].find(existsSync);
  assert(
    executablePath,
    "Install a Playwright browser or provide Chrome/Edge for the CSP test",
  );
  browser = await chromium.launch({ headless: true, executablePath });
  const page = await browser.newPage(),
    errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  await page.waitForLoadState("networkidle");
  const ready = await page.evaluate(() => window.templateV3Ready === true);
  process.stdout.write(
    JSON.stringify({ check: "template-browser-csp", ready, errors }) + "\n",
  );
  assert(ready, "The official v3 browser entry must load without unsafe-eval");
} finally {
  await browser?.close();
  await new Promise((resolve) => server.close(resolve));
}
