#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cli = path.join(repositoryRoot, "node_modules", "@playwright", "test", "cli.js");
const strict = process.argv.slice(2).includes("--strict");
const result = spawnSync(process.execPath, [
  cli,
  "test",
  "tests/e2e/production-smoke.spec.ts",
  "--project=chromium"
], {
  cwd: repositoryRoot,
  env: { ...process.env, PLAYWRIGHT_REQUIRE_LIVE: strict ? "1" : "0" },
  stdio: "inherit"
});

if (result.error) {
  process.stderr.write("[production-smoke] Playwright could not be started.\n");
  process.exitCode = 1;
} else {
  process.exitCode = result.status ?? 1;
}
