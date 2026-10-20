#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { chromium, type Page } from "@playwright/test";

import {
  CDP_URL,
  GATEWAY_URL,
  parseFlags,
  readInstance,
  requireString,
  runDir,
} from "./lib.ts";

const USAGE = `Usage:
  node .agents/skills/verify-agent-native/scripts/drive.ts --run <id> --recipe <file.ts> [--param k=v ...]
  node .agents/skills/verify-agent-native/scripts/drive.ts --gateway --app <template> --recipe <file.ts> [--run <id>] [--param k=v ...]`;

export interface DriveContext {
  page: Page;
  base: string;
  params: Record<string, string>;
  evidenceDir: string;
  open(pathname: string): Promise<void>;
  shot(name: string): Promise<void>;
  action<T = unknown>(name: string, query?: Record<string, string>): Promise<T>;
  note(message: string): void;
}

const { flags, params } = parseFlags(process.argv.slice(2));
if (flags.help) {
  console.log(USAGE);
  process.exit(0);
}
const recipePath = path.resolve(requireString(flags, "recipe"));
const recipeName = path.basename(recipePath).replace(/\.ts$/, "");

let base: string;
let evidenceRoot: string;
if (flags.gateway) {
  const app = requireString(flags, "app");
  base = `${GATEWAY_URL}/${app}`;
  const runId =
    typeof flags.run === "string"
      ? flags.run
      : `gateway-${app}-${new Date().toISOString().replace(/[:.]/g, "-")}`;
  evidenceRoot = path.join(runDir(runId), "evidence");
} else {
  const instance = readInstance(requireString(flags, "run"));
  base = instance.url;
  evidenceRoot = instance.evidenceDir;
}
const evidenceDir = path.join(evidenceRoot, recipeName);
fs.mkdirSync(evidenceDir, { recursive: true });

const logLines: string[] = [];
const consoleErrors: string[] = [];
const failedResponses: string[] = [];
const artifacts: string[] = [];
const note = (message: string) => {
  logLines.push(`${new Date().toISOString()} ${message}`);
  console.log(message);
};
const write = (name: string, body: string) => {
  const file = path.join(evidenceDir, name);
  fs.writeFileSync(file, body);
  artifacts.push(path.relative(process.cwd(), file));
};

const browser = await chromium.connectOverCDP(CDP_URL);
const context = browser.contexts()[0] ?? (await browser.newContext());
const page = await context.newPage();
await page.bringToFront();
page.on("console", (msg) => {
  if (msg.type() === "error") consoleErrors.push(msg.text());
});
page.on("response", (res) => {
  if (res.status() >= 400) {
    failedResponses.push(
      `${res.status()} ${res.request().method()} ${res.url()}`,
    );
  }
});

let shotIndex = 0;
const ctx: DriveContext = {
  page,
  base,
  params,
  evidenceDir,
  note,
  async open(pathname) {
    note(`open ${base}${pathname}`);
    await page.goto(`${base}${pathname}`, {
      waitUntil: "load",
      timeout: 120_000,
    });
    // A cold Vite app re-optimizes deps on first load (504 Outdated Optimize
    // Dep) and reloads itself with ?__an_vite_dev_recovery=, so the loading
    // state can vanish and come back; require it to stay gone for a while.
    const loading = page
      .getByRole("status", { name: "Loading application" })
      .or(page.getByRole("heading", { name: /Dev server is (restarting|starting)/ }));
    const deadline = Date.now() + 240_000;
    let clearSince: number | null = null;
    while (Date.now() < deadline) {
      if ((await loading.count()) > 0) {
        clearSince = null;
      } else {
        clearSince ??= Date.now();
        if (Date.now() - clearSince >= 3_000) return;
      }
      await page.waitForTimeout(250);
    }
    throw new Error(`${base}${pathname} still loading after 240s`);
  },
  async shot(name) {
    const label = `${String(++shotIndex).padStart(2, "0")}-${name}`;
    await page.screenshot({ path: path.join(evidenceDir, `${label}.png`) });
    artifacts.push(
      path.relative(process.cwd(), path.join(evidenceDir, `${label}.png`)),
    );
    write(`${label}.aria.txt`, await page.locator("body").ariaSnapshot());
    note(`shot ${label} at ${page.url()}`);
  },
  async action(name, query = {}) {
    const url = `${base}/_agent-native/actions/${name}?${new URLSearchParams(query)}`;
    const res = await page.request.get(url);
    const text = await res.text();
    write(`action-${name}.json`, text);
    if (!res.ok())
      throw new Error(
        `action ${name} -> ${res.status()}: ${text.slice(0, 300)}`,
      );
    note(`action ${name} -> ${res.status()}`);
    return JSON.parse(text);
  },
};

let ok = true;
let error: string | null = null;
try {
  const recipe = (await import(pathToFileURL(recipePath).href)) as {
    default: (ctx: DriveContext) => Promise<void>;
  };
  await recipe.default(ctx);
} catch (err) {
  ok = false;
  error = (err as Error).stack ?? String(err);
  await page
    .screenshot({ path: path.join(evidenceDir, "failure.png") })
    .then(() =>
      artifacts.push(
        path.relative(process.cwd(), path.join(evidenceDir, "failure.png")),
      ),
    )
    .catch((shotError: Error) =>
      note(`failure screenshot failed: ${shotError.message}`),
    );
} finally {
  await page.close();
  // Disconnects only; the shared Chromium and its other tabs stay up.
  await browser.close();
}

write("drive.log", `${logLines.join("\n")}\n`);
const result = {
  recipe: recipeName,
  base,
  ok,
  error,
  consoleErrors,
  failedResponses,
  artifacts,
};
fs.writeFileSync(
  path.join(evidenceDir, "result.json"),
  `${JSON.stringify(result, null, 2)}\n`,
);
console.log(JSON.stringify({ ...result, evidenceDir }, null, 2));
process.exit(ok ? 0 : 1);
