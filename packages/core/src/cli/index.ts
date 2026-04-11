#!/usr/bin/env node

import { execSync, spawn } from "child_process";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";

// Resolve version once at module scope — used by both --version and --help
let _version = "unknown";
try {
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  // dist/cli/index.js → ../../package.json
  const pkg = JSON.parse(
    fs.readFileSync(path.resolve(__dirname, "../../package.json"), "utf-8"),
  );
  _version = pkg.version;
} catch {}

const command = process.argv[2];
// Filter out bare "--" separators that pnpm inserts between its args and script args
const args = process.argv.slice(3).filter((a) => a !== "--");

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

function findReactRouterBin(): string {
  const localBin = path.resolve("node_modules/.bin/react-router");
  if (fs.existsSync(localBin)) return localBin;
  return "react-router";
}

/** Check if the project uses React Router framework mode (has react-router.config.ts) */
function isReactRouterFramework(): boolean {
  return (
    fs.existsSync(path.resolve("react-router.config.ts")) ||
    fs.existsSync(path.resolve("react-router.config.js"))
  );
}

function run(
  cmd: string,
  cmdArgs: string[],
  opts?: { stdio?: "inherit" | "pipe" },
) {
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
    // Like `next dev` — runs Vite dev server (Nitro plugin handles API routes)
    // Supports --base <path> for mounting under a prefix (e.g. agent-native dev --base /app/)
    const vite = findViteBin();
    run(vite, args);
    break;
  }

  case "build": {
    // React Router framework mode uses `react-router build` which
    // internally runs `vite build` with proper environment orchestration.
    // Legacy SPA mode uses `vite build` directly.
    if (isReactRouterFramework()) {
      const rr = findReactRouterBin();
      console.log("Building (React Router framework mode)...");
      execSync(`${rr} build`, { stdio: "inherit" });
    } else {
      const vite = findViteBin();
      console.log("Building...");
      execSync(`${vite} build`, { stdio: "inherit" });
    }

    // Post-build: bundle for deployment target if NITRO_PRESET is set
    const preset = process.env.NITRO_PRESET;
    if (preset && preset !== "node") {
      const __dirname = path.dirname(fileURLToPath(import.meta.url));
      const deployBuild = path.resolve(__dirname, "../deploy/build.js");
      if (fs.existsSync(deployBuild)) {
        execSync(`node ${deployBuild}`, { stdio: "inherit", env: process.env });
      } else {
        console.warn(
          `[build] Deploy build script not found at ${deployBuild}. Skipping post-build step.`,
        );
      }
    }

    console.log("\nBuild complete.");
    break;
  }

  case "start": {
    // Like `next start` — runs Nitro production server
    const serverEntry = path.resolve(".output/server/index.mjs");
    if (!fs.existsSync(serverEntry)) {
      console.error(
        'No production build found. Run "agent-native build" first.',
      );
      process.exit(1);
    }
    run("node", [serverEntry, ...args]);
    break;
  }

  case "action": {
    // Run an action from actions/ (or scripts/ for backwards compat)
    const actionName = args[0];
    if (!actionName) {
      console.error("Usage: agent-native action <name> [--args]");
      process.exit(1);
    }
    const tsxAction = findTsxBin();
    // Try actions/run.ts first, fall back to scripts/run.ts
    const actionsRun = path.resolve("actions/run.ts");
    const scriptsRun = path.resolve("scripts/run.ts");
    const runFile = fs.existsSync(actionsRun) ? actionsRun : scriptsRun;
    run(tsxAction, [runFile, ...args]);
    break;
  }

  case "script": {
    // @deprecated — use `agent-native action` instead
    const scriptName = args[0];
    if (!scriptName) {
      console.error("Usage: agent-native script <name> [--args]");
      process.exit(1);
    }
    const tsx = findTsxBin();
    // Try actions/run.ts first, fall back to scripts/run.ts
    const actionsRunScript = path.resolve("actions/run.ts");
    const scriptsRunScript = path.resolve("scripts/run.ts");
    const runFileScript = fs.existsSync(actionsRunScript)
      ? actionsRunScript
      : scriptsRunScript;
    run(tsx, [runFileScript, ...args]);
    break;
  }

  case "typecheck": {
    // Run TypeScript type checking
    // React Router framework mode generates route types first
    if (isReactRouterFramework()) {
      const rr = findReactRouterBin();
      try {
        execSync(`${rr} typegen`, { stdio: "inherit" });
      } catch {
        // typegen may fail if routes aren't set up yet — continue to tsc
      }
    }
    const tsc = path.resolve("node_modules/.bin/tsc");
    const tscBin = fs.existsSync(tsc) ? tsc : "tsc";
    run(tscBin, ["--noEmit", ...args]);
    break;
  }

  case "create": {
    // Parse --template flag from args
    let createName: string | undefined;
    let createTemplate: string | undefined;
    for (let i = 0; i < args.length; i++) {
      if (args[i] === "--template" && args[i + 1]) {
        createTemplate = args[++i];
      } else if (!args[i].startsWith("-")) {
        createName = args[i];
      }
    }
    import("./create.js").then((m) =>
      m.createApp(createName, { template: createTemplate }),
    );
    break;
  }

  case "create-workspace": {
    // Scaffold an enterprise monorepo (workspace core + example app).
    const wsName = args.find((a) => !a.startsWith("-"));
    import("./create-workspace.js").then((m) =>
      m.createWorkspace({ name: wsName }),
    );
    break;
  }

  case "setup-agents": {
    import("./setup-agents.js").then((m) => m.runSetupAgents());
    break;
  }

  case "--version":
  case "-v": {
    console.log(_version);
    break;
  }

  case "--help":
  case "-h":
  case undefined:
    console.log(`agent-native v${_version}

Usage:
  agent-native dev              Start development server
  agent-native build            Build for production (client + server)
  agent-native start            Start production server
  agent-native action <name>    Run an action from actions/
  agent-native script <name>    Run an action (deprecated alias for 'action')
  agent-native typecheck        Run TypeScript type checking
  agent-native create [name]    Scaffold a new agent-native app (interactive)
  agent-native create-workspace [name]
                                Scaffold an enterprise monorepo with a shared
                                workspace core package and one sample app
  agent-native setup-agents     Create symlinks for all agent tools

Options:
  -h, --help                    Show this help message
  -v, --version                 Show version number
  --template <name>             Skip template picker (mail, calendar, analytics, etc.)
                                Or github:user/repo for community templates`);
    break;

  default:
    console.error(`Unknown command: ${command}`);
    console.error('Run "agent-native --help" for usage.');
    process.exit(1);
}
