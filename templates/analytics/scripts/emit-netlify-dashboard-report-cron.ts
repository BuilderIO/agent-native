#!/usr/bin/env tsx

import { randomBytes } from "node:crypto";
import { existsSync, rmSync, cpSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const FUNCTIONS_DIR = path.join(ROOT, ".netlify", "functions-internal");
const SERVER_DIR = path.join(FUNCTIONS_DIR, "server");
const SCHEDULED_NAME = "dashboard-report-cron";
const WORKER_NAME = "dashboard-report-sweep-background";
const ROUTE_PATH = "/api/dashboard-reports/run";
const SCHEDULE = "*/15 * * * *";
const ALERT_SCHEDULED_NAME = "analytics-alert-cron";
const ALERT_WORKER_NAME = "analytics-alert-sweep-background";
const ALERT_ROUTE_PATH = "/api/analytics-alerts/run";
const ALERT_SCHEDULE = "*/5 * * * *";

function ensureDir(dir: string) {
  mkdirSync(dir, { recursive: true });
}

function emitScheduledTrigger(token: string) {
  const dest = path.join(FUNCTIONS_DIR, SCHEDULED_NAME);
  rmSync(dest, { recursive: true, force: true });
  ensureDir(dest);

  const source = `const WORKER_PATH = "/.netlify/functions/${WORKER_NAME}";
const CRON_TOKEN = ${JSON.stringify(token)};

function siteOrigin(request) {
  const configured = process.env.URL || process.env.DEPLOY_URL;
  if (configured) return configured;
  const url = new URL(request.url);
  return url.origin;
}

export default async function handler(request) {
  const url = new URL(WORKER_PATH, siteOrigin(request));
  const response = await fetch(url.toString(), {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-agent-native-dashboard-report-cron": CRON_TOKEN,
    },
    body: JSON.stringify({ scheduled: true }),
  });

  if (!response.ok && response.status !== 202) {
    console.error(
      "[dashboard-report-cron] Background sweep trigger failed:",
      response.status,
      await response.text().catch(() => ""),
    );
  }
}

export const config = {
  name: "dashboard report cron trigger",
  generator: "agent-native analytics build",
  schedule: ${JSON.stringify(SCHEDULE)},
};
`;

  writeFileSync(path.join(dest, `${SCHEDULED_NAME}.mjs`), source);
}

function emitBackgroundWorker(token: string) {
  const dest = path.join(FUNCTIONS_DIR, WORKER_NAME);
  rmSync(dest, { recursive: true, force: true });
  cpSync(SERVER_DIR, dest, { recursive: true });
  rmSync(path.join(dest, "server.mjs"), { force: true });

  const source = `globalThis.__AGENT_NATIVE_DASHBOARD_REPORT_SCHEDULED_RUNTIME__ = true;

const CRON_TOKEN = ${JSON.stringify(token)};
const ROUTE_PATH = ${JSON.stringify(ROUTE_PATH)};
let cachedHandler;

function timingSafeEquals(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

export default async function handler(request, context) {
  const token = request.headers.get("x-agent-native-dashboard-report-cron") || "";
  if (!timingSafeEquals(token, CRON_TOKEN)) {
    return new Response("Unauthorized", { status: 401 });
  }

  cachedHandler ??= (await import("./main.mjs")).default;
  const url = new URL(request.url);
  url.pathname = ROUTE_PATH;
  url.search = "";

  const rewritten = new Request(url.toString(), {
    method: "POST",
    headers: new Headers({ "content-type": "application/json" }),
    body: JSON.stringify({ scheduled: true }),
  });

  return await cachedHandler(rewritten, context);
}

export const config = {
  name: "dashboard report background sweep",
  generator: "agent-native analytics build",
  background: true,
  nodeBundler: "none",
  includedFiles: ["**"],
  preferStatic: false,
};
`;

  writeFileSync(path.join(dest, `${WORKER_NAME}.mjs`), source);
}

function emitAlertScheduledTrigger(token: string) {
  const dest = path.join(FUNCTIONS_DIR, ALERT_SCHEDULED_NAME);
  rmSync(dest, { recursive: true, force: true });
  ensureDir(dest);

  const source = `const WORKER_PATH = "/.netlify/functions/${ALERT_WORKER_NAME}";
const CRON_TOKEN = ${JSON.stringify(token)};

function siteOrigin(request) {
  const configured = process.env.URL || process.env.DEPLOY_URL;
  if (configured) return configured;
  const url = new URL(request.url);
  return url.origin;
}

async function readScheduledInvocation(request) {
  if (request.method !== "POST") return null;
  let body;
  try {
    body = await request.json();
  } catch {
    return null;
  }
  const nextRun = typeof body?.next_run === "string" ? body.next_run : "";
  return nextRun && Number.isFinite(Date.parse(nextRun))
    ? { nextRun }
    : null;
}

export default async function handler(request) {
  const scheduled = await readScheduledInvocation(request);
  if (!scheduled) return new Response("Not Found", { status: 404 });

  const url = new URL(WORKER_PATH, siteOrigin(request));
  const response = await fetch(url.toString(), {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-agent-native-analytics-alert-cron": CRON_TOKEN,
    },
    body: JSON.stringify({ scheduled: true, next_run: scheduled.nextRun }),
  });

  if (!response.ok && response.status !== 202) {
    console.error(
      "[analytics-alert-cron] Background sweep trigger failed:",
      response.status,
      await response.text().catch(() => ""),
    );
  }
}

export const config = {
  name: "analytics alert cron trigger",
  generator: "agent-native analytics build",
  schedule: ${JSON.stringify(ALERT_SCHEDULE)},
};
`;

  writeFileSync(path.join(dest, `${ALERT_SCHEDULED_NAME}.mjs`), source);
}

function emitAlertBackgroundWorker(token: string) {
  const dest = path.join(FUNCTIONS_DIR, ALERT_WORKER_NAME);
  rmSync(dest, { recursive: true, force: true });
  cpSync(SERVER_DIR, dest, { recursive: true });
  rmSync(path.join(dest, "server.mjs"), { force: true });

  const source = `globalThis.__AGENT_NATIVE_ANALYTICS_ALERT_SCHEDULED_RUNTIME__ = true;

const CRON_TOKEN = ${JSON.stringify(token)};
const ROUTE_PATH = ${JSON.stringify(ALERT_ROUTE_PATH)};
let cachedHandler;

function timingSafeEquals(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

export default async function handler(request, context) {
  const token = request.headers.get("x-agent-native-analytics-alert-cron") || "";
  if (!timingSafeEquals(token, CRON_TOKEN)) {
    return new Response("Unauthorized", { status: 401 });
  }

  cachedHandler ??= (await import("./main.mjs")).default;
  const url = new URL(request.url);
  url.pathname = ROUTE_PATH;
  url.search = "";

  const rewritten = new Request(url.toString(), {
    method: "POST",
    headers: new Headers({ "content-type": "application/json" }),
    body: JSON.stringify({ scheduled: true }),
  });

  return await cachedHandler(rewritten, context);
}

export const config = {
  name: "analytics alert background sweep",
  generator: "agent-native analytics build",
  background: true,
  nodeBundler: "none",
  includedFiles: ["**"],
  preferStatic: false,
};
`;

  writeFileSync(path.join(dest, `${ALERT_WORKER_NAME}.mjs`), source);
}

function isDirectRun(): boolean {
  const entrypoint = process.argv[1];
  return Boolean(
    entrypoint &&
    import.meta.url === pathToFileURL(path.resolve(entrypoint)).href,
  );
}

function main(): void {
  if (!existsSync(path.join(SERVER_DIR, "main.mjs"))) {
    console.log(
      "[dashboard-report-cron] Skipped Netlify cron emit: Nitro Netlify server output not found.",
    );
    return;
  }

  const token = randomBytes(32).toString("hex");
  const alertToken = randomBytes(32).toString("hex");
  emitScheduledTrigger(token);
  emitBackgroundWorker(token);
  emitAlertScheduledTrigger(alertToken);
  emitAlertBackgroundWorker(alertToken);
  console.log(
    `[dashboard-report-cron] Emitted Netlify scheduled trigger "${SCHEDULED_NAME}" (${SCHEDULE}) and background worker "${WORKER_NAME}".`,
  );
  console.log(
    `[analytics-alert-cron] Emitted Netlify scheduled trigger "${ALERT_SCHEDULED_NAME}" (${ALERT_SCHEDULE}) and background worker "${ALERT_WORKER_NAME}".`,
  );
}

if (isDirectRun()) {
  main();
}
