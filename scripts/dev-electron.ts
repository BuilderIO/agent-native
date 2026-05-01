#!/usr/bin/env node
/**
 * dev-electron.ts — Start the Electron shell together with the template apps it loads.
 *
 * Usage:  node scripts/dev-electron.ts [--apps calendar,content] [--dry-run]
 *
 * By default starts the core template set (mail, calendar, slides, etc.).
 * Pass --apps to override, e.g.: --apps calendar,slides
 */
import { spawn, execSync } from "child_process";
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

// ── App port assignments ───────────────────────────────────────
// Parsed from packages/shared-app-config/templates.ts (same approach
// as scripts/dev-all.ts) so this script can never drift from the
// canonical port registry. We can't `import` the .ts file directly
// from a node-run script without compiling, hence the regex.
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

// ── Parse --apps flag ──────────────────────────────────────────
const appsArg = flagValue("--apps");
const requestedApps = appsArg
  ? appsArg
      .split(",")
      .map((app) => app.trim())
      .filter(Boolean)
  : CORE_APPS;

// ── Ports that may need cleanup before starting ────────────────
const portsToUse = requestedApps
  .map((a) => PORT_MAP[a])
  .filter(Boolean) as number[];
portsToUse.push(FRAME_PORT);

function tryKillPort(port: number) {
  try {
    const pids = execSync(`lsof -ti :${port}`, { encoding: "utf8" }).trim();
    if (pids) {
      execSync(`kill -9 ${pids.split("\n").join(" ")}`, { stdio: "ignore" });
    }
  } catch {
    // Port not in use — fine
  }
}

// ── Build concurrently command list ───────────────────────────
const names: string[] = [];
const commands: string[] = [];
const colors: string[] = [];

const appColors = ["blue", "green", "cyan", "magenta", "white"];

requestedApps.forEach((appName, i) => {
  const port = PORT_MAP[appName];
  if (!port) {
    console.warn(`[dev-electron] Unknown app "${appName}", skipping`);
    return;
  }
  names.push(appName);
  // Run the Vite dev server directly.
  // The templates' vite.config.ts uses @agent-native/core/vite which integrates
  // the Express API server as Vite middleware — so this single command starts
  // both the frontend and all /api/* routes on the one port.
  // PORT pins the dev server port (Nitro's vite plugin reads process.env.PORT
  // first when resolving the dev server port).
  commands.push(
    `APP_NAME=${appName} PORT=${port} pnpm --dir templates/${appName} exec vite`,
  );
  colors.push(appColors[i % appColors.length]);
});

names.push("frame");
commands.push("pnpm --filter @agent-native/frame dev");
colors.push("magenta");

// Electron shell dev (starts electron-vite which starts renderer + main + Electron)
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

// Forward signals to concurrently so Cmd+C doesn't leave zombie processes holding ports
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
