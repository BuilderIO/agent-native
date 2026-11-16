import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { pnpmCommand, stopProcessTree } from "./lib/pnpm-command.ts";

type Environment = NodeJS.ProcessEnv;

const args = process.argv.slice(2);
const separator = args.indexOf("--");
const launcherArgs = separator === -1 ? args : args.slice(0, separator);
const commandArgs = separator === -1 ? [] : args.slice(separator + 1);
const appDir = valueOf(launcherArgs, "--dir");
const name = valueOf(launcherArgs, "--name") ?? appDir;
const dryRun = launcherArgs.includes("--dry-run");
const ephemeral = launcherArgs.includes("--ephemeral");
const env = assignments(launcherArgs);

if (!appDir || commandArgs.length === 0) {
  fail(
    "Usage: tsx scripts/claude-launch.ts --dir <app> [--name <label>] [--ephemeral] [--env KEY=VALUE] -- <command> [args]",
  );
}

const resolvedAppDir = path.resolve(process.cwd(), appDir);
const packagePath = path.join(resolvedAppDir, "package.json");
const packageName = readPackageName(packagePath);
const appName = env.APP_NAME ?? packageName ?? path.basename(resolvedAppDir);
const appPrefix = appName.toUpperCase().replace(/[^A-Z0-9]+/g, "_");
// Previews keep their database across restarts: a user who connects storage,
// a provider, or an account mid-session would otherwise lose it on the next
// restart. --ephemeral is for scripted runs that need a clean database.
const scratchDir =
  env.DATABASE_URL === undefined && ephemeral
    ? mkdtempSync(path.join(os.tmpdir(), "agent-native-claude-"))
    : undefined;
const previewDatabaseDir = path.resolve(
  process.cwd(),
  ".tmp",
  "claude-launch",
  `${(name ?? appDir)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")}-pglite`,
);
const databaseUrl =
  env.DATABASE_URL ?? `pglite:${scratchDir ?? previewDatabaseDir}`;
const childEnv: Environment = {
  ...process.env,
  ...env,
  APP_NAME: appName,
  DATABASE_URL: databaseUrl,
  [`${appPrefix}_DATABASE_URL`]: databaseUrl,
};
const command = ["pnpm", "--dir", resolvedAppDir, ...commandArgs];

if (dryRun) {
  console.log(
    JSON.stringify({
      name,
      command,
      appName,
      databaseUrl,
      environment: env,
    }),
  );
  cleanup();
  process.exit(0);
}

if (env.DATABASE_URL === undefined && !scratchDir) {
  mkdirSync(previewDatabaseDir, { recursive: true });
}

const pnpm = pnpmCommand(command.slice(1));
const child = spawn(pnpm.command, pnpm.args, {
  cwd: process.cwd(),
  env: childEnv,
  stdio: "inherit",
  shell: pnpm.shell,
});

let finished = false;
function finish(code: number): void {
  if (finished) return;
  finished = true;
  cleanup();
  process.exit(code);
}

child.on("error", (error) => {
  console.error(`[claude-launch] ${error.message}`);
  finish(1);
});
child.on("exit", (code, signal) => {
  if (signal) {
    console.error(`[claude-launch] child exited from ${signal}`);
    finish(1);
  } else {
    finish(code ?? 1);
  }
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => stopProcessTree(child, signal));
}

function assignments(values: string[]): Environment {
  const result: Environment = {};
  for (let index = 0; index < values.length; index += 1) {
    if (values[index] !== "--env") continue;
    const assignment = values[index + 1];
    if (!assignment || !assignment.includes("=")) {
      fail("--env expects KEY=VALUE");
    }
    const splitAt = assignment.indexOf("=");
    result[assignment.slice(0, splitAt)] = assignment.slice(splitAt + 1);
    index += 1;
  }
  return result;
}

function valueOf(values: string[], flag: string): string | undefined {
  const index = values.indexOf(flag);
  return index === -1 ? undefined : values[index + 1];
}

function readPackageName(packagePath: string): string | undefined {
  try {
    const packageJson = JSON.parse(readFileSync(packagePath, "utf8")) as {
      name?: string;
    };
    const name = packageJson.name?.split("/").at(-1);
    return name || undefined;
    // coercion-ok: an unreadable package name falls back to APP_NAME or the directory name.
  } catch {
    return undefined;
  }
}

function cleanup(): void {
  if (scratchDir) rmSync(scratchDir, { recursive: true, force: true });
}

function fail(message: string): never {
  console.error(`[claude-launch] ${message}`);
  process.exit(1);
}
