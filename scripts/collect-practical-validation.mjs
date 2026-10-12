import { readFile, writeFile, readdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import path from "node:path";
const root = fileURLToPath(new URL("../", import.meta.url));
const json = async (name) =>
  JSON.parse((await readFile(path.join(root, name), "utf8")).replace(/^\uFEFF/, ""));
const unit = await json(".build/unit-results.json"),
  e2e = await json(".build/e2e-results.json"),
  consumer = await json(".build/consumer-browser.json"),
  packages = await json(".build/package-verification.json"),
  clean = await json(".build/clean-install.json"),
  word = await json(".build/native-qa/word-observations.json"),
  licenses = await json(".build/licenses/sbom.json");
if (
  unit.numFailedTests ||
  !unit.success ||
  e2e.stats.unexpected ||
  e2e.stats.flaky ||
  e2e.stats.skipped ||
  !packages.passed ||
  !clean.passed ||
  !word.passed ||
  consumer.some((result) => !result.passed)
)
  throw new Error("Validation evidence contains a failure.");
const projects = {};
function walk(suites) {
  for (const suite of suites) {
    for (const spec of suite.specs ?? [])
      for (const test of spec.tests)
        projects[test.projectName] = (projects[test.projectName] ?? 0) + 1;
    walk(suite.suites ?? []);
  }
}
walk(e2e.suites);
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
const artifacts = [];
for (const name of ["core", "react", "engine-docx", "engine-rhwp"]) {
  const bytes = await readFile(path.join(root, ".build/packs", `${name}.tgz`)),
    manifest = await json(`packages/${name}/package.json`);
  artifacts.push({
    name: manifest.name,
    version: manifest.version,
    file: `.build/packs/${name}.tgz`,
    bytes: bytes.length,
    sha256: sha(bytes),
  });
}
const source = await readFile(
    path.join(root, "packages/engine-rhwp/assets/document-studio-extension.js"),
  ),
  runtime = await readFile(
    path.join(
      root,
      "packages/engine-rhwp/dist/studio/document-studio-extension.js",
    ),
  );
if (sha(source) !== sha(runtime))
  throw new Error("Released extension differs from tested source.");
const fixtures = [];
for (const name of (await readdir(path.join(root, "fixtures"))).filter((name) =>
  /\.(docx|hwpx)$/.test(name),
))
  fixtures.push({
    name,
    sha256: sha(await readFile(path.join(root, "fixtures", name))),
  });
const report = {
  observedAt: new Date().toISOString(),
  sdkVersion: "0.2.0",
  repository: "D:/dev/document-studio",
  ownLicense: "Apache-2.0",
  results: {
    unit: { passed: unit.numPassedTests, files: unit.testResults.length },
    e2e: {
      passed: e2e.stats.expected,
      failed: e2e.stats.unexpected,
      skipped: e2e.stats.skipped,
      flaky: e2e.stats.flaky,
      projects,
      durationMs: e2e.stats.duration,
    },
    consumer: {
      ...packages,
      combinations: consumer.map(({ browser, version, format, checks }) => ({
        browser,
        version,
        format,
        checks,
      })),
    },
    cleanInstall: clean,
    word: {
      passed: word.passed,
      version: word.version,
      scope:
        "Rich DOCX text, header/footer, table/image, 14pt and 150% line spacing",
    },
    licenses: {
      npm: licenses.npm.length,
      rust: licenses.rust.packages.length,
      gitRust: licenses.rust.packages.filter((pkg) => pkg.gitCommit).length,
      inventorySha256: sha(
        await readFile(path.join(root, ".build/licenses/sbom.json")),
      ),
    },
    security: {
      command:
        "yarn npm audit --all --recursive --environment production --json",
      reportedAdvisories: 0,
      scope:
        "Registry report on 2026-10-05, after Next example upgrade to 16.3.8",
    },
  },
  fixtures,
  artifacts,
  rhwpExtensionSha256: sha(runtime),
  notExecuted: [
    "Native Hancom HWPX Open",
    "Physical Windows IME",
    "Firefox/Safari/touch/screen readers",
    "Every upstream advanced menu",
    "Real institutional/customer corpus",
    "Production sandbox BFF/lease/sync",
    "Remote GitHub CI",
    "Complete government-office feature parity",
  ],
  published: false,
};
await writeFile(
  path.join(root, "docs/practical-validation-results.json"),
  JSON.stringify(report, null, 2) + "\n",
);
console.log(
  `Evidence saved: ${unit.numPassedTests} unit, ${e2e.stats.expected} E2E, ${consumer.length} consumer combinations.`,
);
