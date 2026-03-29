#!/usr/bin/env node
/**
 * Run all template dev servers, core TypeScript watch, and docs concurrently.
 * Each template gets its own port starting at APP_BASE_PORT.
 */
import { spawn, execSync } from "child_process";
import fs from "fs";
import path from "path";

const TEMPLATES_DIR = path.resolve("templates");
const APP_BASE_PORT = 8081;
const DOCS_PORT = 3000;

// Discover templates
const templates = fs
  .readdirSync(TEMPLATES_DIR)
  .filter((d) => fs.existsSync(path.join(TEMPLATES_DIR, d, "package.json")))
  .sort();

// Kill any stale processes on our ports
const allPorts = [DOCS_PORT];
templates.forEach((_, i) => {
  allPorts.push(APP_BASE_PORT + i);
});

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

templates.forEach((name, i) => {
  const appPort = APP_BASE_PORT + i;
  console.log(`\x1b[36m[dev-all]\x1b[0m ${name}: http://localhost:${appPort}`);

  names.push(name);
  commands.push(`pnpm --filter ${name} exec vite --port ${appPort}`);
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
