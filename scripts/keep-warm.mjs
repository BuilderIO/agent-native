#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REGISTRY = resolve(HERE, "../packages/shared-app-config/templates.ts");
const HEALTH_PATH = "/_agent-native/health";
const PER_REQUEST_TIMEOUT_MS = 25_000;
const ATTEMPTS = 2;
const SLOW_HEALTH_MS = 3_000;

async function readApps() {
  const src = await readFile(REGISTRY, "utf8");
  const apps = [];
  const blockRe = /\{\s*name:\s*"([^"]+)"[\s\S]*?\}/g;
  for (const block of src.matchAll(blockRe)) {
    const name = block[1];
    const prodUrl = /prodUrl:\s*"([^"]+)"/.exec(block[0])?.[1];
    const hidden = /\bhidden:\s*true\b/.test(block[0]);
    if (prodUrl && !hidden) apps.push({ name, prodUrl });
  }
  apps.push({
    name: "docs",
    prodUrl: "https://www.agent-native.com",
    healthPath: null,
  });
  return apps;
}

async function pingOnce(url) {
  const startedAt = Date.now();
  const res = await fetch(url, {
    method: "GET",
    headers: { "user-agent": "agent-native-keep-warm" },
    signal: AbortSignal.timeout(PER_REQUEST_TIMEOUT_MS),
  });
  const ms = Date.now() - startedAt;
  let db;
  let ready;
  let pressure;
  try {
    const body = await res.json();
    db = body?.db;
    ready = body?.ready;
    pressure = body?.pressure;
  } catch {
    // Non-JSON body (e.g. an error page) — still counts as the function awake.
  }
  return { status: res.status, ok: res.ok, db, ready, pressure, ms };
}

async function pingApp({ name, prodUrl, healthPath = HEALTH_PATH }, strict) {
  if (healthPath === null) {
    const shell = await checkShell({ name, prodUrl });
    return {
      name,
      ok: shell.ok,
      shellOnly: true,
      ms: shell.ms,
      error: shell.error,
    };
  }
  const requestPath = strict ? `${healthPath}?strict=1&pressure=1` : healthPath;
  const url = `${prodUrl.replace(/\/$/, "")}${requestPath}`;
  let lastErr;
  for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
    try {
      const r = await pingOnce(url);
      if (r.ok && (!strict || (r.db === true && r.ready === true))) {
        return { name, ok: true, ...r };
      }
      lastErr = r.ok
        ? r.db !== true
          ? "db unavailable"
          : "not ready"
        : `HTTP ${r.status}`;
    } catch (err) {
      lastErr =
        err?.name === "TimeoutError" ? "timeout" : String(err?.message ?? err);
    }
  }
  return { name, ok: false, error: lastErr };
}

function describePressure(pressure) {
  if (pressure == null) {
    return { label: "press:—", warnings: [], measured: false };
  }
  if (pressure.measured !== true) {
    return {
      label: `press:n/a(${pressure.reason ?? "unknown"})`,
      warnings: [],
      measured: false,
    };
  }
  const warnings = Array.isArray(pressure.warnings) ? pressure.warnings : [];
  return {
    label: warnings.length > 0 ? "press:PRESSURED" : "press:ok",
    warnings,
    measured: true,
  };
}

const SHELL_FAILURE_MARKERS = [
  "Application error",
  "Internal Server Error",
  "502 Bad Gateway",
  "Service Unavailable",
  "Deploy failed",
];

async function fetchShellOnce(prodUrl) {
  const startedAt = Date.now();
  const res = await fetch(prodUrl, {
    method: "GET",
    headers: { "user-agent": "agent-native-keep-warm" },
    signal: AbortSignal.timeout(PER_REQUEST_TIMEOUT_MS),
  });
  const ms = Date.now() - startedAt;
  const body = await res.text();
  if (!res.ok) return { ok: false, ms, error: `HTTP ${res.status}` };
  if (!body.toLowerCase().includes("<html")) {
    return { ok: false, ms, error: "response missing <html shell" };
  }
  const marker = SHELL_FAILURE_MARKERS.find((m) => body.includes(m));
  if (marker) return { ok: false, ms, error: `body contains "${marker}"` };
  return { ok: true, ms };
}

async function checkShell({ name, prodUrl }) {
  let lastErr;
  for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
    try {
      const r = await fetchShellOnce(prodUrl);
      if (r.ok) return { name, ok: true, ms: r.ms };
      lastErr = r.error;
    } catch (err) {
      lastErr =
        err?.name === "TimeoutError" ? "timeout" : String(err?.message ?? err);
    }
  }
  return { name, ok: false, error: lastErr };
}

async function main() {
  const strict = process.argv.includes("--strict");
  const filter = process.argv.slice(2).filter((arg) => arg !== "--strict");
  let apps = await readApps();
  if (filter.length) apps = apps.filter((a) => filter.includes(a.name));
  if (!apps.length) {
    console.error(
      filter.length
        ? `No matching apps for: ${filter.join(", ")}`
        : "No apps with a prodUrl found in the registry.",
    );
    process.exit(1);
  }

  const results = await Promise.all(apps.map((app) => pingApp(app, strict)));
  results.sort((a, b) => a.name.localeCompare(b.name));

  const shellResults = strict
    ? await Promise.all(
        apps
          .filter((app) => app.healthPath !== null)
          .map((app) => checkShell(app)),
      )
    : [];
  const shellByName = new Map(shellResults.map((r) => [r.name, r]));

  let warmed = 0;
  const slowApps = [];
  const pressuredApps = [];
  const measuredPressureApps = [];
  for (const r of results) {
    const shell = shellByName.get(r.name);
    const ok = r.ok && (!shell || shell.ok);
    if (ok) {
      warmed++;
      const dbState =
        r.db === true ? "db:warm" : r.db === false ? "db:none" : "db:?";
      const shellState = shell
        ? ` shell:${shell.ms}ms`
        : r.shellOnly
          ? ` shell:${r.ms}ms`
          : "";
      const pressure = strict ? describePressure(r.pressure) : null;
      const slow = shell ? shell.ms > SLOW_HEALTH_MS : r.ms > SLOW_HEALTH_MS;
      const pressured = pressure ? pressure.warnings.length > 0 : false;
      console.log(
        `  ${slow || pressured ? "!" : "✓"} ${r.name.padEnd(12)} ${String(r.ms).padStart(5)}ms  ${dbState}${shellState}${
          pressure ? ` ${pressure.label}` : ""
        }${slow ? `  SLOW (>${SLOW_HEALTH_MS}ms — cold or degrading)` : ""}`,
      );
      if (slow) slowApps.push(r.name);
      if (pressured) pressuredApps.push({ name: r.name, ...pressure });
      if (pressure?.measured) measuredPressureApps.push(r.name);
    } else {
      const reason = !r.ok ? r.error : `shell: ${shell?.error}`;
      console.log(`  ✗ ${r.name.padEnd(12)} ${reason}`);
    }
  }
  console.log(`\nWarmed ${warmed}/${results.length} apps.`);

  if (slowApps.length > 0) {
    console.log(
      `  slow: ${slowApps.join(", ")} — answered, but far above a healthy app's few hundred ms.`,
    );
  }

  if (pressuredApps.length > 0) {
    console.log(
      "\nDatabase pressure — the hour before an outage looks like this\n",
    );
    for (const app of pressuredApps) {
      for (const w of app.warnings)
        console.log(`  ! ${app.name.padEnd(12)} ${w}`);
    }
  }

  if (strict && measuredPressureApps.length === 0) {
    console.log(
      "\n  ! no app reported database pressure — this check is dark, not clean.",
    );
  }

  if (strict && slowApps.length > 0) process.exit(1);
  if (strict && pressuredApps.length > 0) process.exit(1);
  if (strict && measuredPressureApps.length === 0) process.exit(1);
  if (strict ? warmed !== results.length : warmed === 0) process.exit(1);
}

main().catch((err) => {
  console.error("keep-warm failed:", err);
  process.exit(1);
});
