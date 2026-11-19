#!/usr/bin/env node

import { spawn } from "node:child_process";

import { pnpmCommand } from "./lib/pnpm-command.ts";

const [appName, portText, delayText] = process.argv.slice(2);
const port = Number(portText);
const delayMs = Number(delayText);

if (
  !appName ||
  !Number.isInteger(port) ||
  port <= 0 ||
  !Number.isInteger(delayMs) ||
  delayMs < 0
) {
  console.error(
    "Usage: node scripts/dev-electron-template.ts <app> <port> <delay-ms>",
  );
  process.exit(1);
}

await new Promise<void>((resolve) => setTimeout(resolve, delayMs));

const pnpm = pnpmCommand(["--dir", `templates/${appName}`, "exec", "vite"]);
const child = spawn(pnpm.command, pnpm.args, {
  cwd: process.cwd(),
  env: {
    ...process.env,
    APP_NAME: appName,
    PORT: String(port),
  },
  shell: pnpm.shell,
  stdio: "inherit",
});

let stopping = false;
function stopChild(signal: NodeJS.Signals): void {
  if (stopping) return;
  stopping = true;
  if (process.platform === "win32" && child.pid) {
    const killer = spawn("taskkill", ["/pid", String(child.pid), "/t", "/f"], {
      stdio: "ignore",
      windowsHide: true,
    });
    killer.once("error", () => child.kill());
    return;
  }
  child.kill(signal);
}

for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"] as const) {
  process.on(signal, () => stopChild(signal));
}

child.once("error", () => process.exit(1));
child.once("exit", (code, signal) => process.exit(code ?? (signal ? 1 : 0)));
