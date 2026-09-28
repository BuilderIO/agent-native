#!/usr/bin/env node
import { spawn, execSync } from "child_process";
import fs from "fs";
import path from "path";

const TEMPLATES_DIR = path.resolve("templates");
const DOCS_PORT = 3000;
const FALLBACK_BASE_PORT = 9001;

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
const includeDesktop = argv.includes("--desktop");

const configPath = path.resolve("packages/shared-app-config/templates.ts");
const configSrc = fs.readFileSync(configPath, "utf8");

const portMap = new Map<string, number>();
const coreSet = new Set<string>();
const re = /name:\s*"([^"]+)"[\s\S]*?devPort:\s*(\d+)/g;
let m: RegExpExecArray | null;
while ((m = re.exec(configSrc)) !== null) {
  portMap.set(m[1], Number(m[2]));
}
const coreRe = /name:\s*"([^"]+)"(?:(?!name:)[\s\S])*?core:\s*true/g;
while ((m = coreRe.exec(configSrc)) !== null) {
  coreSet.add(m[1]);
}

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
      `\x1b[33m[dev-eager]\x1b[0m Warning: unknown apps in --apps: ${unknown.join(", ")}`,
    );
  }
  templates = allTemplates.filter((t) => appsFilter.includes(t));
  if (templates.length === 0) {
    console.error(
      `\x1b[31m[dev-eager]\x1b[0m No templates matched --apps; nothing to start`,
    );
    process.exit(1);
  }
} else {
  templates = allTemplates.filter((t) => coreSet.has(t));
  if (templates.length === 0) {
    templates = allTemplates;
  }
}

let nextFallback = FALLBACK_BASE_PORT;
const templatePorts = templates.map((name) => {
  const port = portMap.get(name);
  if (port) return { name, port };
  const fallback = nextFallback++;
  console.warn(
    `\x1b[33m[dev-eager]\x1b[0m Warning: "${name}" not in shared-app-config, using fallback port ${fallback}`,
  );
  return { name, port: fallback };
});

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
  execSync("sleep 1");
  killPortProcesses();
  console.log(`\x1b[33m[dev-eager]\x1b[0m Killed stale processes`);
}

console.log(
  `\x1b[36m[dev-eager]\x1b[0m Starting eager mode. For lower memory usage, use \`pnpm dev\` (lazy gateway).`,
);
console.log(
  `\x1b[36m[dev-eager]\x1b[0m Found templates: ${templates.join(", ")}`,
);
if (!skipDocs) {
  console.log(`\x1b[36m[dev-eager]\x1b[0m Docs: http://localhost:${DOCS_PORT}`);
}

console.log(`\x1b[36m[dev-eager]\x1b[0m Prebuilding workspace packages...`);
execSync("node scripts/prebuild-workspace-packages.ts dev", {
  stdio: "inherit",
});

const names: string[] = [];
const commands: string[] = [];

const STAGGER_DELAY_S = 0.25;

templatePorts.forEach(({ name, port }, i) => {
  console.log(`\x1b[36m[dev-eager]\x1b[0m ${name}: http://localhost:${port}`);

  const delay = i * STAGGER_DELAY_S;
  const prefix = delay > 0 ? `sleep ${delay} && ` : "";

  names.push(name);
  commands.push(
    `${prefix}APP_NAME=${name} PORT=${port} pnpm --dir templates/${name} exec vite`,
  );
});

names.push("core");
commands.push(
  "pnpm --filter @agent-native/core exec tsc --watch --preserveWatchOutput",
);

if (!skipFrame) {
  names.push("frame");
  commands.push("pnpm --filter @agent-native/frame dev");
  console.log(`\x1b[36m[dev-eager]\x1b[0m frame: http://localhost:3334`);
}

if (!skipDocs) {
  names.push("docs");
  commands.push(`pnpm --filter @agent-native/docs dev`);
}

if (includeDesktop) {
  names.push("tray");
  commands.push("pnpm --filter clips-desktop dev");
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
      ...(process.env.DEBUG ? { VITE_DEBUG: process.env.DEBUG } : {}),
    },
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
      killPortProcesses();
      process.exit(1);
    }, 5000).unref();
  });
}
