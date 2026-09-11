#!/usr/bin/env tsx

import { randomBytes } from "node:crypto";
import { cpSync, existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const FUNCTIONS_DIR = path.join(ROOT, ".netlify", "functions-internal");
const SERVER_DIR = path.join(FUNCTIONS_DIR, "server");
export const SCHEDULED_NAME = "brain-queue-cron";
export const WORKER_NAME = "brain-queue-sweep-background";
export const ROUTE_PATH = "/api/brain/queue/run";
export const SCHEDULE = "* * * * *";

function ensureDir(dir: string) {
  mkdirSync(dir, { recursive: true });
}

export function scheduledTriggerSource(token: string) {
  return `const WORKER_PATH = "/.netlify/functions/${WORKER_NAME}";
const CRON_TOKEN = ${JSON.stringify(token)};

function siteOrigin(request) {
  return new URL(request.url).origin;
}

export default async function handler(request) {
  const response = await fetch(new URL(WORKER_PATH, siteOrigin(request)), {
    method: "POST",
    headers: { "content-type": "application/json", "x-agent-native-brain-cron": CRON_TOKEN },
    body: JSON.stringify({ scheduled: true }),
  });
  if (!response.ok && response.status !== 202) {
    console.error("[brain-queue-cron] Background sweep trigger failed:", response.status);
  }
}

export const config = {
  name: "brain queue cron trigger",
  generator: "agent-native brain build",
  schedule: ${JSON.stringify(SCHEDULE)},
};
`;
}

export function backgroundWorkerSource(token: string) {
  return `globalThis.__AGENT_NATIVE_BRAIN_SCHEDULED_RUNTIME__ = true;
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
  const token = request.headers.get("x-agent-native-brain-cron") || "";
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
  name: "brain queue background sweep",
  generator: "agent-native brain build",
  background: true,
  nodeBundler: "none",
  includedFiles: ["**"],
  preferStatic: false,
};
`;
}

export function emitNetlifyBrainQueueCron(
  options: {
    functionsDir?: string;
    serverDir?: string;
    token?: string;
  } = {},
) {
  const functionsDir = options.functionsDir ?? FUNCTIONS_DIR;
  const serverDir = options.serverDir ?? SERVER_DIR;
  if (!existsSync(serverDir)) {
    throw new Error(
      "Expected Nitro Netlify server output before emitting Brain cron functions.",
    );
  }
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
  emitNetlifyBrainQueueCron();
  console.log(
    "[brain-queue-cron] Emitted scheduled queue sweep and background worker.",
  );
}
