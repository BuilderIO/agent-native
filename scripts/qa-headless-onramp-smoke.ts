#!/usr/bin/env node
/**
 * Fresh-repo smoke for the primitive-first headless on-ramp:
 *
 *   agent-native create <name> --headless
 *   cd <name> && pnpm install
 *   pnpm action hello --name Builder
 *
 * Then add one new action file and prove the app grows from that primitive
 * without adding UI scaffolding.
 */
import assert from "node:assert/strict";
import {
  execFileSync,
  type ExecFileSyncOptionsWithStringEncoding,
} from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const nodeBin = process.execPath;
const cliEntry = path.join(repoRoot, "packages/core/dist/cli/index.js");
const appName = process.env.HEADLESS_ONRAMP_SMOKE_APP || "tiny-agent";
const parentDir =
  process.env.HEADLESS_ONRAMP_SMOKE_DIR?.trim() ||
  fs.mkdtempSync(path.join(os.tmpdir(), "an-headless-onramp-"));
const appDir = path.join(parentDir, appName);
const verbose = process.env.HEADLESS_ONRAMP_SMOKE_VERBOSE === "1";
const shellTimeoutMs = process.env.CI ? 240_000 : 180_000;

function log(message: string): void {
  if (verbose) console.log(`[headless-onramp-smoke] ${message}`);
}

function run(
  cmd: string,
  args: string[],
  opts: Partial<ExecFileSyncOptionsWithStringEncoding> & { cwd: string },
): string {
  log(`${cmd} ${args.join(" ")}`);
  return execFileSync(cmd, args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    timeout: shellTimeoutMs,
    ...opts,
    env: {
      ...process.env,
      NO_COLOR: "1",
      ...opts.env,
    },
  });
}

function assertNoUiScaffold(): void {
  for (const relative of [
    "app/root.tsx",
    "app/routes.ts",
    "vite.config.ts",
    "server/plugins/agent-chat.ts",
  ]) {
    assert.equal(
      fs.existsSync(path.join(appDir, relative)),
      false,
      `headless scaffold should not include ${relative}`,
    );
  }
}

function localActionNames(): string[] {
  return fs
    .readdirSync(path.join(appDir, "actions"))
    .filter((name) => name.endsWith(".ts") && name !== "run.ts")
    .map((name) => name.replace(/\.ts$/, ""))
    .sort();
}

function writeAddAction(): void {
  fs.writeFileSync(
    path.join(appDir, "actions", "add.ts"),
    `import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

export default defineAction({
  description: "Add two numbers.",
  schema: z.object({
    a: z.coerce.number().describe("First number"),
    b: z.coerce.number().describe("Second number"),
  }),
  http: { method: "GET" },
  readOnly: true,
  run: async ({ a, b }) => {
    return { sum: a + b };
  },
});
`,
  );
}

function main(): void {
  if (!fs.existsSync(cliEntry)) {
    throw new Error(
      `Missing ${cliEntry}. Run pnpm --filter @agent-native/core build first.`,
    );
  }

  fs.rmSync(appDir, { recursive: true, force: true });

  run(nodeBin, [cliEntry, "create", appName, "--headless"], {
    cwd: parentDir,
    env: {
      AGENT_NATIVE_CREATE_USE_LOCAL_CORE: "1",
    },
  });

  assert.equal(fs.existsSync(path.join(appDir, "package.json")), true);
  assert.deepEqual(localActionNames(), ["hello"]);
  assert.equal(fs.existsSync(path.join(appDir, "actions", "run.ts")), true);
  assertNoUiScaffold();

  run("pnpm", ["install"], { cwd: appDir });
  const pkg = JSON.parse(
    fs.readFileSync(path.join(appDir, "package.json"), "utf8"),
  ) as {
    dependencies?: Record<string, string>;
    scripts?: Record<string, string>;
  };
  assert.equal(pkg.scripts?.action, "agent-native action");
  assert.equal(pkg.scripts?.agent, "agent-native agent");
  assert.match(pkg.dependencies?.["@agent-native/core"] ?? "", /^file:/);

  const hello = run("pnpm", ["action", "hello", "--name", "Builder"], {
    cwd: appDir,
  });
  assert.match(hello, /Hello, Builder!/);

  const helpBefore = run("pnpm", ["action", "--help"], { cwd: appDir });
  assert.match(helpBefore, /App actions:/);
  assert.match(helpBefore, /\n  hello\n/);

  const agentHelp = run("pnpm", ["agent", "--help"], { cwd: appDir });
  assert.match(agentHelp, /production app-agent loop/);

  writeAddAction();
  assert.deepEqual(localActionNames(), ["add", "hello"]);

  run("pnpm", ["typecheck"], { cwd: appDir });

  const add = run("pnpm", ["action", "add", "--a", "2", "--b", "40"], {
    cwd: appDir,
  });
  assert.match(add, /sum:\s*42/);

  const helpAfter = run("pnpm", ["action", "--help"], { cwd: appDir });
  assert.match(helpAfter, /App actions:/);
  assert.match(helpAfter, /\n  add\n/);
  assert.match(helpAfter, /\n  hello\n/);

  console.log("qa-headless-onramp-smoke: clean");
  console.log(`  app:     ${appDir}`);
  console.log("  checked: create --headless -> install -> hello action");
  console.log("  checked: one callable action file at start, no UI scaffold");
  console.log(
    "  checked: agent command is wired without requiring credentials",
  );
  console.log("  checked: add a new action file -> typecheck -> action call");
}

main();
