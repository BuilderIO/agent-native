#!/usr/bin/env node

import { execSync, spawn } from "child_process";
import path from "path";
import fs from "fs";

const command = process.argv[2];
const args = process.argv.slice(3);

function findViteBin(): string {
  // Look for vite in node_modules/.bin
  const localVite = path.resolve("node_modules/.bin/vite");
  if (fs.existsSync(localVite)) return localVite;
  return "vite"; // fallback to PATH
}

function findTsxBin(): string {
  const localTsx = path.resolve("node_modules/.bin/tsx");
  if (fs.existsSync(localTsx)) return localTsx;
  return "tsx";
}

function run(cmd: string, cmdArgs: string[], opts?: { stdio?: "inherit" | "pipe" }) {
  const child = spawn(cmd, cmdArgs, {
    stdio: opts?.stdio ?? "inherit",
    shell: process.platform === "win32",
    env: process.env,
  });
  child.on("exit", (code) => process.exit(code ?? 0));
  return child;
}

switch (command) {
  case "dev": {
    // Like `next dev` — runs Vite dev server with express plugin
    // Supports --base <path> for mounting under a prefix (e.g. agent-native dev --base /app/)
    const vite = findViteBin();
    run(vite, args);
    break;
  }

  case "build": {
    // Like `next build` — builds client SPA + server bundle
    const vite = findViteBin();
    console.log("Building client...");
    execSync(`${vite} build`, { stdio: "inherit" });
    console.log("\nBuilding server...");
    execSync(`${vite} build --config vite.config.server.ts`, { stdio: "inherit" });
    console.log("\nBuild complete.");
    break;
  }

  case "start": {
    // Like `next start` — runs production server
    const serverEntry = path.resolve("dist/server/production.mjs");
    if (!fs.existsSync(serverEntry)) {
      console.error(
        'No production build found. Run "agent-native build" first.',
      );
      process.exit(1);
    }
    run("node", [serverEntry, ...args]);
    break;
  }

  case "script": {
    // Run a script from scripts/ — `agent-native script generate-image --prompt "hello"`
    const scriptName = args[0];
    if (!scriptName) {
      console.error("Usage: agent-native script <name> [--args]");
      process.exit(1);
    }
    const tsx = findTsxBin();
    run(tsx, ["scripts/run.ts", ...args]);
    break;
  }

  case "typecheck": {
    // Run TypeScript type checking
    const tsc = path.resolve("node_modules/.bin/tsc");
    const tscBin = fs.existsSync(tsc) ? tsc : "tsc";
    run(tscBin, ["--noEmit", ...args]);
    break;
  }

  case "create": {
    import("./create.js").then((m) => m.createApp(args[0]));
    break;
  }

  case "--version":
  case "-v": {
    const pkgPath = path.resolve(
      path.dirname(new URL(import.meta.url).pathname),
      "../../package.json",
    );
    try {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
      console.log(pkg.version);
    } catch {
      console.log("unknown");
    }
    break;
  }

  case "--help":
  case "-h":
  case undefined:
    console.log(`agent-native v0.2.0

Usage:
  agent-native dev              Start development server
  agent-native build            Build for production (client + server)
  agent-native start            Start production server
  agent-native script <name>    Run a script from scripts/
  agent-native typecheck        Run TypeScript type checking
  agent-native create <name>    Scaffold a new agent-native app

Options:
  -h, --help                    Show this help message
  -v, --version                 Show version number`);
    break;

  default:
    console.error(`Unknown command: ${command}`);
    console.error('Run "agent-native --help" for usage.');
    process.exit(1);
}
