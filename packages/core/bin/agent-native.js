#!/usr/bin/env node

import { spawn } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { shouldUseSourceFallback, supportsNodeVersion } from "./launcher.js";

if (!supportsNodeVersion(process.versions.node)) {
  console.error(
    `agent-native requires Node.js 22.22.0 or newer, but you're on Node ${process.versions.node}.\n` +
      "Upgrade Node (https://nodejs.org) and re-run. With nvm: `nvm install 22.22`.",
  );
  process.exit(1);
}

const binDir = dirname(fileURLToPath(import.meta.url));
const distEntry = join(binDir, "../dist/cli/index.js");
const sourceEntry = join(binDir, "../src/cli/index.ts");
const freshnessChecks = [
  [sourceEntry, distEntry],
  [
    join(binDir, "../src/cli/design-connect.ts"),
    join(binDir, "../dist/cli/design-connect.js"),
  ],
];

const isSourceCheckout = existsSync(join(binDir, "../tsconfig.cli.json"));

function statMtimeMs(path) {
  try {
    return statSync(path).mtimeMs;
  } catch {
    return 0;
  }
}

const freshness = freshnessChecks.map(([source, dist]) => {
  const sourceExists = existsSync(source);
  const distExists = existsSync(dist);
  return {
    sourceExists,
    distExists,
    sourceMtimeMs: sourceExists ? statMtimeMs(source) : 0,
    distMtimeMs: distExists ? statMtimeMs(dist) : 0,
  };
});

const useSourceFallback = shouldUseSourceFallback({
  isSourceCheckout,
  sourceEntryExists: existsSync(sourceEntry),
  distEntryExists: existsSync(distEntry),
  freshness,
});

if (!useSourceFallback) {
  if (!existsSync(distEntry)) {
    console.error(
      "agent-native CLI build output is missing. Run `pnpm --filter @agent-native/core build` and try again.",
    );
    process.exit(1);
  }

  await import(pathToFileURL(distEntry).href);
} else {
  let tsxCli;
  try {
    tsxCli = createRequire(import.meta.url).resolve("tsx/cli");
  } catch (error) {
    console.error(
      `agent-native CLI source fallback could not resolve tsx (${error.message}). Run \`pnpm --filter @agent-native/core build\` and try again.`,
    );
    process.exit(1);
  }

  const child = spawn(
    process.execPath,
    [tsxCli, sourceEntry, ...process.argv.slice(2)],
    {
      stdio: "inherit",
      env: process.env,
    },
  );

  child.on("error", (error) => {
    console.error(
      `agent-native CLI source fallback failed: ${error.message}. Run \`pnpm --filter @agent-native/core build\` and try again.`,
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
