#!/usr/bin/env node
/**
 * Run all template dev servers, core TypeScript watch, and docs concurrently.
 * Ports are read from shared-app-config so they stay stable across
 * template additions/removals and match what the desktop app expects.
 */
import { spawn, execSync } from "child_process";
import fs from "fs";
import path from "path";

const TEMPLATES_DIR = path.resolve("templates");
const DOCS_PORT = 3000;
const FALLBACK_BASE_PORT = 9001; // for templates not in the config

// Import the app config to get stable ports
const configPath = path.resolve("packages/shared-app-config/index.ts");
const configSrc = fs.readFileSync(configPath, "utf8");

// Quick parse: extract { id, devPort } pairs from DEFAULT_APPS
const portMap = new Map<string, number>();
const re = /id:\s*"([^"]+)"[\s\S]*?devPort:\s*(\d+)/g;
let m: RegExpExecArray | null;
while ((m = re.exec(configSrc)) !== null) {
  portMap.set(m[1], Number(m[2]));
}

// Discover templates
const templates = fs
  .readdirSync(TEMPLATES_DIR)
  .filter((d) => fs.existsSync(path.join(TEMPLATES_DIR, d, "package.json")))
  .sort();

// Assign ports: use shared-app-config if available, otherwise fallback
let nextFallback = FALLBACK_BASE_PORT;
const templatePorts = templates.map((name) => {
  const port = portMap.get(name);
  if (port) return { name, port };
  const fallback = nextFallback++;
  console.warn(
    `\x1b[33m[dev-all]\x1b[0m Warning: "${name}" not in shared-app-config, using fallback port ${fallback}`,
  );
  return { name, port: fallback };
});

// Kill any stale processes on our ports
const allPorts = [DOCS_PORT, ...templatePorts.map((t) => t.port)];

function killPortProcesses(): boolean {
  let killed = false;
  for (const port of allPorts) {
    try {
      const pids = execSync(`lsof -ti :${port}`, { encoding: "utf8" }).trim();
      if (pids) {
        execSync(`kill -9 ${pids.split("\n").join(" ")}`, { stdio: "ignore" });
        killed = true;
      }
    } catch {
      // Port not in use — fine
    }
  }
  return killed;
}

if (killPortProcesses()) {
  // Wait for processes to die, then verify
  execSync("sleep 1");
  killPortProcesses(); // Second pass for stragglers
  console.log(`\x1b[33m[dev-all]\x1b[0m Killed stale processes`);
}

console.log(
  `\x1b[36m[dev-all]\x1b[0m Found templates: ${templates.join(", ")}`,
);
console.log(`\x1b[36m[dev-all]\x1b[0m Docs: http://localhost:${DOCS_PORT}`);

const names: string[] = [];
const commands: string[] = [];

templatePorts.forEach(({ name, port }) => {
  console.log(`\x1b[36m[dev-all]\x1b[0m ${name}: http://localhost:${port}`);

  names.push(name);
  commands.push(`pnpm --filter ${name} exec vite --port ${port}`);
});

// Core TypeScript watch
names.push("core");
commands.push(
  "pnpm --filter @agent-native/core exec tsc --watch --preserveWatchOutput",
);

// Docs site
names.push("docs");
commands.push(`pnpm --filter @agent-native/docs dev`);

const proc = spawn(
  "npx",
  [
    "concurrently",
    "-n",
    names.join(","),
    "-c",
    "yellow,blue,yellow,blue,yellow,blue,yellow,blue,magenta,green",
    ...commands,
  ],
  {
    stdio: "inherit",
    cwd: process.cwd(),
  },
);

proc.on("exit", (code) => process.exit(code ?? 0));
