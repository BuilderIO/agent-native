#!/usr/bin/env node

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const binDir = dirname(fileURLToPath(import.meta.url));
const distEntry = join(binDir, "../dist/cli/index.js");

if (existsSync(distEntry)) {
  await import(pathToFileURL(distEntry).href);
} else {
  const sourceEntry = join(binDir, "../src/cli/index.ts");
  if (!existsSync(sourceEntry)) {
    console.error(
      "agent-native CLI build output is missing. Run `pnpm --filter @agent-native/core build` and try again.",
    );
    process.exit(1);
  }

  const child = spawn("tsx", [sourceEntry, ...process.argv.slice(2)], {
    stdio: "inherit",
    env: process.env,
  });

  child.on("error", (error) => {
    console.error(
      `agent-native CLI build output is missing and the source fallback failed: ${error.message}`,
    );
    process.exit(1);
  });

  child.on("exit", (code, signal) => {
    if (signal) {
      process.kill(process.pid, signal);
      return;
    }
    process.exit(code ?? 1);
  });
}
