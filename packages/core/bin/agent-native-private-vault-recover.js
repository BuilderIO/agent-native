#!/usr/bin/env node

import { spawn } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { execPath } from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";

const binDir = dirname(fileURLToPath(import.meta.url));
const distEntry = join(binDir, "../dist/cli/private-vault-recover-entry.js");
const sourceEntry = join(binDir, "../src/cli/private-vault-recover-entry.ts");

function shouldUseSourceFallback() {
  if (!existsSync(sourceEntry)) return false;
  if (!existsSync(distEntry)) return true;
  try {
    return statSync(sourceEntry).mtimeMs > statSync(distEntry).mtimeMs;
  } catch {
    return false;
  }
}

if (!shouldUseSourceFallback() && existsSync(distEntry)) {
  await import(pathToFileURL(distEntry).href);
} else {
  if (!existsSync(sourceEntry)) {
    console.error(
      "Private Vault recovery build output is missing. Reinstall @agent-native/core and try again.",
    );
    process.exit(1);
  }
  const child = spawn(
    execPath,
    ["--import", "tsx", sourceEntry, ...process.argv.slice(2)],
    {
      stdio: "inherit",
      env: process.env,
    },
  );
  child.on("error", (error) => {
    console.error(`Private Vault recovery could not start: ${error.message}`);
    process.exit(1);
  });
  child.on("exit", (code, signal) => {
    if (signal) process.kill(process.pid, signal);
    else process.exit(code ?? 1);
  });
}
