#!/usr/bin/env node
import { execFileSync, execSync, spawn } from "child_process";
import fs from "fs";
import path from "path";

const argv = process.argv.slice(2);

function hasFlag(name: string): boolean {
  return argv.includes(name);
}

function flagValue(name: string): string | null {
  const eq = argv.find((arg) => arg.startsWith(`${name}=`));
  if (eq) return eq.slice(name.length + 1);
  const i = argv.indexOf(name);
  return i !== -1 && argv[i + 1] && !argv[i + 1].startsWith("-")
    ? argv[i + 1]
    : null;
}

function printHelp(): void {
  console.log(`dev-electron

Start the Electron shell together with the template dev servers it loads.

Usage:
  node scripts/dev-electron.ts [options]

Options:
  --apps <names>       Comma-separated templates to start (default: core apps)
  --apps=<names>       Same as --apps <names>
  --dry-run            Print ports and commands without killing ports or spawning
  -h, --help           Show this help message

Examples:
  node scripts/dev-electron.ts --apps calendar,slides
  node scripts/dev-electron.ts --apps=mail,forms --dry-run`);
}

if (hasFlag("--help") || hasFlag("-h")) {
  printHelp();
  process.exit(0);
}

const dryRun = hasFlag("--dry-run");
const FRAME_PORT = 3334;

const configPath = path.resolve("packages/shared-app-config/templates.ts");
const configSrc = fs.readFileSync(configPath, "utf8");
const PORT_MAP: Record<string, number> = {};
const CORE_APPS: string[] = [];
const portRe = /name:\s*"([^"]+)"[\s\S]*?devPort:\s*(\d+)/g;
let portMatch: RegExpExecArray | null;
while ((portMatch = portRe.exec(configSrc)) !== null) {
  PORT_MAP[portMatch[1]] = Number(portMatch[2]);
}
const coreRe = /name:\s*"([^"]+)"(?:(?!name:)[\s\S])*?core:\s*true/g;
while ((portMatch = coreRe.exec(configSrc)) !== null) {
  CORE_APPS.push(portMatch[1]);
}

const appsArg = flagValue("--apps");
const requestedApps = appsArg
  ? appsArg
      .split(",")
      .map((app) => app.trim())
      .filter(Boolean)
  : CORE_APPS;

const portsToUse = requestedApps
  .map((a) => PORT_MAP[a])
  .filter(Boolean) as number[];
portsToUse.push(FRAME_PORT);

function listeningPidsForPort(port: number): number[] {
  if (process.platform === "win32") {
    const output = execFileSync("netstat", ["-ano", "-p", "tcp"], {
      encoding: "utf8",
      windowsHide: true,
    });
    const pids = new Set<number>();
    for (const line of output.split(/\r?\n/)) {
      const fields = line.trim().split(/\s+/);
      if (
        fields[0]?.toUpperCase() !== "TCP" ||
        fields[3]?.toUpperCase() !== "LISTENING"
      ) {
        continue;
      }
      const localAddress = fields[1] ?? "";
      const localPort = localAddress.slice(localAddress.lastIndexOf(":") + 1);
      const pid = Number(fields[4]);
      if (localPort === String(port) && Number.isInteger(pid) && pid > 0) {
        pids.add(pid);
      }
    }
    return [...pids];
  }

  const output = execFileSync("lsof", ["-ti", `:${port}`], {
    encoding: "utf8",
  });
  const pids: number[] = [];
  for (const value of output.split(/\s+/)) {
    if (!value) continue;
    const pid = Number(value);
    if (Number.isInteger(pid) && pid > 0) pids.push(pid);
  }
  return pids;
}

function tryKillPort(port: number) {
  let pids: number[];
  try {
    pids = listeningPidsForPort(port);
  } catch {
    return;
  }

  for (const pid of pids) {
    try {
      if (process.platform === "win32") {
        execFileSync("taskkill", ["/pid", String(pid), "/t", "/f"], {
          stdio: "ignore",
          windowsHide: true,
        });
      } else {
        execFileSync("kill", ["-9", String(pid)], { stdio: "ignore" });
      }
    } catch {
      // coercion-ok: a raced process exit means cleanup already happened.
      // The process may have exited between discovery and termination.
    }
  }
}

function ensureElectronBinary() {
  try {
    execSync(
      `pnpm --filter @agent-native/desktop-app exec node -e "require('electron')"`,
      { stdio: "ignore" },
    );
    return;
  } catch {
    console.log(
      `\x1b[36m[dev-electron]\x1b[0m Electron binary is missing; rebuilding the desktop dependency...`,
    );
  }

  try {
    execSync(`pnpm --filter @agent-native/desktop-app rebuild electron`, {
      stdio: "inherit",
    });
    execSync(
      `pnpm --filter @agent-native/desktop-app exec node -e "require('electron')"`,
      { stdio: "ignore" },
    );
  } catch (err) {
    console.error(
      `\x1b[31m[dev-electron]\x1b[0m Electron is installed but its binary could not be prepared.`,
    );
    console.error(
      `Run this once and retry:\n  pnpm --filter @agent-native/desktop-app rebuild electron`,
    );
    throw err;
  }
}

const names: string[] = [];
const commands: string[] = [];
const colors: string[] = [];

const appColors = ["blue", "green", "cyan", "magenta", "white"];

const STAGGER_DELAY_S = 0.25;

requestedApps.forEach((appName, i) => {
  const port = PORT_MAP[appName];
  if (!port) {
    console.warn(`[dev-electron] Unknown app "${appName}", skipping`);
    return;
  }
  names.push(appName);
  const delayMs = Math.round(i * STAGGER_DELAY_S * 1000);
  commands.push(
    `node scripts/dev-electron-template.ts ${JSON.stringify(appName)} ${port} ${delayMs}`,
  );
  colors.push(appColors[i % appColors.length]);
});

names.push("frame");
commands.push("pnpm --filter @agent-native/frame dev");
colors.push("magenta");

names.push("electron");
commands.push("pnpm --filter @agent-native/desktop-app dev");
colors.push("yellow");

if (dryRun) {
  console.log(`\x1b[36m[dev-electron]\x1b[0m Dry run: ${names.join(", ")}`);
  requestedApps.forEach((app) => {
    const port = PORT_MAP[app];
    if (port) {
      console.log(
        `\x1b[36m[dev-electron]\x1b[0m  ${app}: http://localhost:${port}`,
      );
    }
  });
  console.log(`\nCommands:`);
  names.forEach((name, i) => {
    console.log(`  ${name}: ${commands[i]}`);
  });
  process.exit(0);
}

ensureElectronBinary();

console.log(`\x1b[36m[dev-electron]\x1b[0m Prebuilding workspace packages...`);
execSync("node scripts/prebuild-workspace-packages.ts dev", {
  stdio: "inherit",
});

portsToUse.forEach(tryKillPort);

console.log(`\x1b[36m[dev-electron]\x1b[0m Starting: ${names.join(", ")}`);
requestedApps.forEach((app) => {
  const port = PORT_MAP[app];
  if (port) {
    console.log(
      `\x1b[36m[dev-electron]\x1b[0m  ${app}: http://localhost:${port}`,
    );
  }
});

const proc = spawn(
  "npx",
  [
    "concurrently",
    "--kill-others-on-fail",
    "-n",
    names.join(","),
    "-c",
    colors.join(","),
    ...commands,
  ],
  {
    stdio: "inherit",
    cwd: path.resolve("."),
  },
);

proc.on("exit", (code) => process.exit(code ?? 0));

for (const sig of ["SIGINT", "SIGTERM", "SIGHUP"] as const) {
  process.on(sig, () => {
    proc.kill(sig);
    setTimeout(() => {
      try {
        proc.kill("SIGKILL");
      } catch {}
      portsToUse.forEach(tryKillPort);
      process.exit(1);
    }, 5000).unref();
  });
}
