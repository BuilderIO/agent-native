#!/usr/bin/env node
import { spawn } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";

import {
  REPO_ROOT,
  parseFlags,
  requireString,
  runDir,
  type Instance,
} from "./lib.ts";

const USAGE = `Usage: node .agents/skills/verify-agent-native/scripts/launch.ts --app <template> [--run <id>] [--port <n>] [--timeout <sec>]`;

const { flags } = parseFlags(process.argv.slice(2));
if (flags.help) {
  console.log(USAGE);
  process.exit(0);
}

const app = requireString(flags, "app");
const appDir = path.join(REPO_ROOT, "templates", app);
if (!fs.existsSync(path.join(appDir, "package.json"))) {
  throw new Error(`templates/${app} is not a template app`);
}
const runId =
  typeof flags.run === "string"
    ? flags.run
    : `${app}-${new Date().toISOString().replace(/[:.]/g, "-")}`;
const dir = runDir(runId);
if (fs.existsSync(path.join(dir, "instance.json"))) {
  throw new Error(`Run "${runId}" already has an instance; clean it up first.`);
}
const scratchDir = path.join(dir, "scratch");
const evidenceDir = path.join(dir, "evidence");
fs.mkdirSync(scratchDir, { recursive: true });
fs.mkdirSync(evidenceDir, { recursive: true });

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (address === null || typeof address === "string") {
        reject(new Error("could not allocate a port"));
        return;
      }
      server.close(() => resolve(address.port));
    });
  });
}

const port =
  typeof flags.port === "string" ? Number(flags.port) : await freePort();
const timeoutMs =
  (typeof flags.timeout === "string" ? Number(flags.timeout) : 180) * 1000;
const dbKey = `${app.toUpperCase().replace(/-/g, "_")}_DATABASE_URL`;
const dbUrl = `pglite:${path.join(scratchDir, "pglite")}`;

// Strip every inherited database URL: containers export shared remote DBs
// (e.g. FORMS_DATABASE_URL on Neon) that a verification run must never touch.
const env: NodeJS.ProcessEnv = {};
for (const [key, value] of Object.entries(process.env)) {
  if (key === "DATABASE_URL" || key.endsWith("_DATABASE_URL")) continue;
  env[key] = value;
}
Object.assign(env, {
  [dbKey]: dbUrl,
  APP_NAME: app,
  PORT: String(port),
  FORCE_COLOR: "0",
});

const log = path.join(dir, "server.log");
const out = fs.openSync(log, "a");
const child = spawn(
  "pnpm",
  [
    "exec",
    "vite",
    "--host",
    "127.0.0.1",
    "--port",
    String(port),
    "--strictPort",
  ],
  { cwd: appDir, env, detached: true, stdio: ["ignore", out, out] },
);
child.unref();
if (child.pid === undefined) throw new Error("failed to spawn vite");

const instance: Instance = {
  runId,
  app,
  port,
  pgid: child.pid,
  url: `http://127.0.0.1:${port}`,
  dbUrl,
  scratchDir,
  evidenceDir,
  log,
  startedAt: new Date().toISOString(),
};
fs.writeFileSync(
  path.join(dir, "instance.json"),
  `${JSON.stringify(instance, null, 2)}\n`,
);

let exited: number | null = null;
child.once("exit", (code) => {
  exited = code ?? -1;
});

const deadline = Date.now() + timeoutMs;
let lastStatus = "no response";
while (Date.now() < deadline) {
  if (exited !== null) {
    console.error(`vite exited with ${exited} before ready. Tail of ${log}:`);
    console.error(
      fs.readFileSync(log, "utf8").split("\n").slice(-30).join("\n"),
    );
    process.exit(1);
  }
  try {
    const res = await fetch(`${instance.url}/`, { redirect: "manual" });
    lastStatus = String(res.status);
    if (res.status < 500) {
      console.log(JSON.stringify({ ready: true, ...instance }, null, 2));
      process.exit(0);
    }
  } catch (error) {
    lastStatus = (error as Error).message;
  }
  await new Promise((r) => setTimeout(r, 1000));
}
console.error(
  `Not ready after ${timeoutMs / 1000}s (last: ${lastStatus}). Instance left running for inspection; run cleanup.ts --run ${runId}.`,
);
process.exit(1);
