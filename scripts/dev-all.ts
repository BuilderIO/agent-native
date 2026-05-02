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

// ── Args ──────────────────────────────────────────────────────
// Lightweight mode for low-RAM machines / focused work:
//   --apps clips,calendar  → only boot listed templates (default: all)
//   --no-docs              → skip docs server
//   --no-frame             → skip dev frame server
const argv = process.argv.slice(2);
function flagValue(name: string): string | null {
  const i = argv.indexOf(name);
  return i !== -1 && argv[i + 1] ? argv[i + 1] : null;
}
const appsFilter = flagValue("--apps")
  ?.split(",")
  .map((s) => s.trim())
  .filter(Boolean);
const skipDocs = argv.includes("--no-docs");
const skipFrame = argv.includes("--no-frame");

// Import the app config to get stable ports. Ports live in templates.ts
// (the single source of truth for template metadata); shared-app-config/index.ts
// derives AppConfig[] from it at runtime, so there are no literal id/port pairs
// there to regex against.
const configPath = path.resolve("packages/shared-app-config/templates.ts");
const configSrc = fs.readFileSync(configPath, "utf8");

// Quick parse: extract { name, devPort, core } from TEMPLATES entries.
const portMap = new Map<string, number>();
const coreSet = new Set<string>();
const re = /name:\s*"([^"]+)"[\s\S]*?devPort:\s*(\d+)/g;
let m: RegExpExecArray | null;
while ((m = re.exec(configSrc)) !== null) {
  portMap.set(m[1], Number(m[2]));
}
// Second pass for core flags (negative lookahead prevents crossing entry boundaries)
const coreRe = /name:\s*"([^"]+)"(?:(?!name:)[\s\S])*?core:\s*true/g;
while ((m = coreRe.exec(configSrc)) !== null) {
  coreSet.add(m[1]);
}

// Discover templates
const allTemplates = fs
  .readdirSync(TEMPLATES_DIR)
  .filter((d) => fs.existsSync(path.join(TEMPLATES_DIR, d, "package.json")))
  .sort();

let templates: string[];

if (appsFilter && appsFilter.length > 0) {
  const known = new Set(allTemplates);
  const unknown = appsFilter.filter((a) => !known.has(a));
  if (unknown.length > 0) {
    console.warn(
      `\x1b[33m[dev-all]\x1b[0m Warning: unknown apps in --apps: ${unknown.join(", ")}`,
    );
  }
  templates = allTemplates.filter((t) => appsFilter.includes(t));
  if (templates.length === 0) {
    console.error(
      `\x1b[31m[dev-all]\x1b[0m No templates matched --apps; nothing to start`,
    );
    process.exit(1);
  }
} else {
  // Default to core templates only (pass --apps to override)
  templates = allTemplates.filter((t) => coreSet.has(t));
  if (templates.length === 0) {
    // Fallback to all if no core flags found
    templates = allTemplates;
  }
}

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
const FRAME_PORT = 3334;
const allPorts = [DOCS_PORT, FRAME_PORT, ...templatePorts.map((t) => t.port)];

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
if (!skipDocs) {
  console.log(`\x1b[36m[dev-all]\x1b[0m Docs: http://localhost:${DOCS_PORT}`);
}

// Prebuild core once before templates boot. Templates import from
// @agent-native/core/server; if tsc --watch is mid-rewrite of dist/ when a
// template SSR-imports it, named exports come back undefined (e.g.
// "createAgentChatPlugin is not a function"). Building first guarantees a
// complete dist; tsc --watch then takes over for incremental rebuilds.
console.log(`\x1b[36m[dev-all]\x1b[0m Prebuilding @agent-native/core...`);
execSync("pnpm --filter @agent-native/core build", { stdio: "inherit" });

const names: string[] = [];
const commands: string[] = [];

// Tiny stagger keeps cold-boot requests from racing Nitro's ViteEnvRunner
// 3-second init (which returns 503 "Vite environment unavailable"). With
// core prebuilt, 250ms is enough to avoid the race without noticeably
// slowing startup.
const STAGGER_DELAY_S = 0.25;

templatePorts.forEach(({ name, port }, i) => {
  console.log(`\x1b[36m[dev-all]\x1b[0m ${name}: http://localhost:${port}`);

  const delay = i * STAGGER_DELAY_S;
  const prefix = delay > 0 ? `sleep ${delay} && ` : "";

  names.push(name);
  // APP_NAME so each app resolves its own DATABASE_URL (e.g.
  // MAIL_DATABASE_URL when APP_NAME=mail).
  //
  // PORT pins the dev server port. Templates run on Nitro's Vite plugin,
  // whose port resolution is:
  //   process.env.PORT || userConfig.server.port || 3000
  // We set PORT in the spawn env so it wins regardless of what the
  // template's vite.config.ts says. dotenv (used to load each template's
  // .env) does NOT override an already-set var, so a stray `PORT=` line
  // in a template's .env can't silently steal the port. The CLI `--port`
  // flag is unreliable here — Nitro reads `server.port` from config first
  // and CLI overrides don't always merge in.
  commands.push(
    `${prefix}APP_NAME=${name} PORT=${port} pnpm --dir templates/${name} exec vite`,
  );
});

// Core TypeScript watch
names.push("core");
commands.push(
  "pnpm --filter @agent-native/core exec tsc --watch --preserveWatchOutput",
);

// Local Dev Frame
if (!skipFrame) {
  names.push("frame");
  commands.push("pnpm --filter @agent-native/frame dev");
  console.log(`\x1b[36m[dev-all]\x1b[0m frame: http://localhost:3334`);
}

// Docs site
if (!skipDocs) {
  names.push("docs");
  commands.push(`pnpm --filter @agent-native/docs dev`);
}

const concurrentlyBin = path.resolve(
  "node_modules",
  ".bin",
  process.platform === "win32" ? "concurrently.cmd" : "concurrently",
);

const proc = spawn(
  concurrentlyBin,
  [
    "-n",
    names.join(","),
    "-c",
    "yellow,blue,yellow,blue,yellow,blue,yellow,blue,magenta,green",
    ...commands,
  ],
  {
    stdio: "inherit",
    cwd: process.cwd(),
    shell: process.platform === "win32",
    env: {
      ...process.env,
      // Forward DEBUG=true to the Vite client as VITE_DEBUG so client code
      // (e.g. mail's thread-cache logs) can opt into verbose output.
      ...(process.env.DEBUG ? { VITE_DEBUG: process.env.DEBUG } : {}),
    },
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
      killPortProcesses();
      process.exit(1);
    }, 5000).unref();
  });
}
