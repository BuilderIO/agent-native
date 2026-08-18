#!/usr/bin/env tsx

import { randomBytes } from "node:crypto";
import { cpSync, existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const FUNCTIONS_DIR = path.join(ROOT, ".netlify", "functions-internal");
const SERVER_DIR = path.join(FUNCTIONS_DIR, "server");
export const SCHEDULED_NAME = "clips-brain-export-cron";
export const WORKER_NAME = "clips-brain-export-sweep-background";
export const ROUTE_PATH = "/api/clips/brain-export/run";
export const SCHEDULE = "* * * * *";

function ensureDir(dir: string) {
  mkdirSync(dir, { recursive: true });
}

export function scheduledTriggerSource(token: string) {
  return `const WORKER_PATH = "/.netlify/functions/${WORKER_NAME}";
const CRON_TOKEN = ${JSON.stringify(token)};

export default async function handler(request) {
  const response = await fetch(new URL(WORKER_PATH, new URL(request.url).origin), {
    method: "POST",
    headers: { "content-type": "application/json", "x-agent-native-clips-brain-export-cron": CRON_TOKEN },
    body: JSON.stringify({ scheduled: true }),
  });
  if (!response.ok && response.status !== 202) console.error("[clips-brain-export-cron] Background sweep trigger failed:", response.status);
}

export const config = {
  name: "Clips Brain export cron trigger",
  generator: "agent-native clips build",
  schedule: ${JSON.stringify(SCHEDULE)},
};
`;
}

export function backgroundWorkerSource(token: string) {
  return `globalThis.__AGENT_NATIVE_CLIPS_BRAIN_EXPORT_SCHEDULED_RUNTIME__ = true;
const CRON_TOKEN = ${JSON.stringify(token)};
const ROUTE_PATH = ${JSON.stringify(ROUTE_PATH)};
let cachedHandler;

function timingSafeEquals(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export default async function handler(request, context) {
  const token = request.headers.get("x-agent-native-clips-brain-export-cron") || "";
  if (!timingSafeEquals(token, CRON_TOKEN)) return new Response("Unauthorized", { status: 401 });
  cachedHandler ??= (await import("./main.mjs")).default;
  const url = new URL(request.url);
  url.pathname = ROUTE_PATH;
  url.search = "";
  return cachedHandler(new Request(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ scheduled: true }),
  }), context);
}

export const config = {
  name: "Clips Brain export background sweep",
  generator: "agent-native clips build",
  background: true,
  nodeBundler: "none",
  includedFiles: ["**"],
  preferStatic: false,
};
`;
}

export function emitNetlifyBrainExportCron(
  options: {
    functionsDir?: string;
    serverDir?: string;
    token?: string;
  } = {},
) {
  const functionsDir = options.functionsDir ?? FUNCTIONS_DIR;
  const serverDir = options.serverDir ?? SERVER_DIR;
  if (!existsSync(serverDir))
    throw new Error(
      "Expected Nitro Netlify server output before emitting Clips Brain export functions.",
    );
  const token = options.token ?? randomBytes(32).toString("hex");
  const scheduledDir = path.join(functionsDir, SCHEDULED_NAME);
  const workerDir = path.join(functionsDir, WORKER_NAME);
  rmSync(scheduledDir, { recursive: true, force: true });
  rmSync(workerDir, { recursive: true, force: true });
  ensureDir(scheduledDir);
  cpSync(serverDir, workerDir, { recursive: true });
  rmSync(path.join(workerDir, "server.mjs"), { force: true });
  writeFileSync(
    path.join(scheduledDir, `${SCHEDULED_NAME}.mjs`),
    scheduledTriggerSource(token),
  );
  writeFileSync(
    path.join(workerDir, `${WORKER_NAME}.mjs`),
    backgroundWorkerSource(token),
  );
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  emitNetlifyBrainExportCron();
  console.log(
    "[clips-brain-export-cron] Emitted scheduled export sweep and background worker.",
  );
}
