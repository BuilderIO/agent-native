#!/usr/bin/env node
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const appDir = resolve(scriptDir, "..");
const envPath = resolve(appDir, ".env.local");

function parseEnv(text) {
  const result = new Map();
  for (const line of text.split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!match) continue;
    let value = match[2] ?? "";
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    result.set(match[1], value);
  }
  return result;
}

function serializeEnv(values) {
  return `${[...values.entries()]
    .map(([key, value]) => `${key}=${value}`)
    .join("\n")}\n`;
}

function ensureLocalEnv() {
  const existing = existsSync(envPath) ? readFileSync(envPath, "utf8") : "";
  const values = parseEnv(existing);
  let changed = false;

  if (values.get("AGENT_NATIVE_MODE") !== "database") {
    values.set("AGENT_NATIVE_MODE", "database");
    changed = true;
  }
  const authSecret = values.get("BETTER_AUTH_SECRET") ?? "";
  if (authSecret.length < 32) {
    values.set("BETTER_AUTH_SECRET", randomBytes(32).toString("base64url"));
    changed = true;
  }

  if (changed) {
    writeFileSync(envPath, serializeEnv(values));
    console.log("[content dev] Wrote local database-mode env to .env.local");
  }
  return values;
}

const envValues = ensureLocalEnv();
const childEnv = {
  ...process.env,
  AGENT_NATIVE_MODE: "database",
  BETTER_AUTH_SECRET:
    process.env.BETTER_AUTH_SECRET || envValues.get("BETTER_AUTH_SECRET"),
};

const pnpmBin = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
const child = spawn(pnpmBin, ["exec", "agent-native", "dev"], {
  cwd: appDir,
  env: childEnv,
  stdio: "inherit",
  shell: process.platform === "win32",
});

child.on("error", (error) => {
  console.error(
    `[content dev] Failed to start agent-native dev: ${error.message}`,
  );
  process.exit(1);
});

child.on("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  process.exit(code ?? 0);
});
