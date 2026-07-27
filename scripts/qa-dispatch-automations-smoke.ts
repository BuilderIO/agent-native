#!/usr/bin/env node
import assert from "node:assert/strict";
import {
  execFileSync,
  spawn,
  type ChildProcessWithoutNullStreams,
} from "node:child_process";
import fs from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";

import type { Browser, Locator, Page } from "playwright";

interface RunningDispatch {
  baseUrl: string;
  child: ChildProcessWithoutNullStreams;
  logs: string[];
}

const repoRoot = path.resolve(import.meta.dirname, "..");
const requireFromCore = createRequire(
  path.join(repoRoot, "packages/core/package.json"),
);
const { chromium } = requireFromCore(
  "playwright",
) as typeof import("playwright");
const templateDir = path.join(repoRoot, "templates", "dispatch");
const tmpRoot = fs.mkdtempSync(
  path.join(os.tmpdir(), "an-dispatch-automations-smoke-"),
);
const port = Number(process.env.DISPATCH_AUTOMATIONS_SMOKE_PORT || 9331);
const runId = Date.now().toString(36);
const qaEmail = "qa-dispatch-automations-smoke@example.test";
const qaPassword = "local-dev-account";
const jobName = `qa-automation-${runId}`;
const jobPath = `jobs/${jobName}.md`;
const lastRun = new Date(Date.now() - 5 * 60_000).toISOString();
const nextRun = new Date(Date.now() + 15 * 60_000).toISOString();
const lastError = `Synthetic smoke failure ${runId}`;

function buildCurrentPackages() {
  for (const pkg of ["@agent-native/core", "@agent-native/dispatch"]) {
    execFileSync("pnpm", ["--filter", pkg, "build"], {
      cwd: repoRoot,
      stdio: "inherit",
      env: { ...process.env, NO_COLOR: "1" },
    });
  }
}

function cleanDispatchGeneratedFiles() {
  fs.rmSync(path.join(templateDir, ".react-router"), {
    recursive: true,
    force: true,
  });
}

function workspaceAppsManifest(baseUrl: string): string {
  return JSON.stringify({
    apps: [
      {
        id: "dispatch",
        name: "Dispatch",
        description: "Workspace control plane",
        path: "/dispatch",
        url: baseUrl,
        isDispatch: true,
      },
    ],
  });
}

function dispatchEnv(baseUrl: string, dbPath: string): NodeJS.ProcessEnv {
  const databaseUrl = `file:${dbPath}`;
  return {
    ...process.env,
    APP_NAME: "dispatch",
    APP_URL: baseUrl,
    BETTER_AUTH_URL: baseUrl,
    NODE_ENV: "development",
    AUTO_CREATE_DEFAULT_ORG: "1",
    AGENT_NATIVE_DISABLE_AUTO_DEV_ACCOUNT: "1",
    AUTH_SKIP_EMAIL_VERIFICATION: "1",
    BETTER_AUTH_SECRET: "dispatch-automations-smoke-secret",
    DATABASE_URL: databaseUrl,
    DATABASE_AUTH_TOKEN: "",
    DISPATCH_DATABASE_URL: databaseUrl,
    DISPATCH_DATABASE_AUTH_TOKEN: "",
    AGENT_NATIVE_WORKSPACE_APPS_JSON: workspaceAppsManifest(baseUrl),
    NETLIFY: "",
    VERCEL: "",
    CF_PAGES: "",
    DEPLOY_URL: "",
    URL: "",
    RENDER: "",
    FLY_APP_NAME: "",
    NO_COLOR: "1",
  };
}

async function waitForReady(baseUrl: string, logs: string[]) {
  const deadline = Date.now() + 90_000;
  let lastError = "";
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${baseUrl}/_agent-native/ping`, {
        redirect: "manual",
        signal: AbortSignal.timeout(2_000),
      });
      if (response.status < 500) return;
      lastError = `HTTP ${response.status}`;
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
    }
    await new Promise((resolve) => setTimeout(resolve, 750));
  }
  throw new Error(
    `Dispatch did not become ready at ${baseUrl}: ${lastError}\n${logs
      .slice(-100)
      .join("")}`,
  );
}

async function startDispatch(): Promise<RunningDispatch> {
  const baseUrl = `http://127.0.0.1:${port}`;
  const dbPath = path.join(tmpRoot, "dispatch.db");
  const logs: string[] = [];
  const child = spawn(
    "pnpm",
    [
      "--dir",
      templateDir,
      "dev",
      "--",
      "--host",
      "127.0.0.1",
      "--port",
      String(port),
      "--strictPort",
    ],
    {
      cwd: repoRoot,
      env: dispatchEnv(baseUrl, dbPath),
      stdio: ["ignore", "pipe", "pipe"],
    },
  );

  child.stdout.on("data", (chunk) => logs.push(chunk.toString()));
  child.stderr.on("data", (chunk) => logs.push(chunk.toString()));
  child.on("exit", (code, signal) => {
    logs.push(`\n[dispatch] exited code=${code} signal=${signal}\n`);
  });

  await waitForReady(baseUrl, logs);
  return { baseUrl, child, logs };
}

async function stopDispatch(running: RunningDispatch): Promise<void> {
  if (running.child.exitCode != null) return;
  running.child.kill("SIGTERM");
  await Promise.race([
    new Promise<void>((resolve) => running.child.once("exit", () => resolve())),
    new Promise<void>((resolve) =>
      setTimeout(() => {
        if (running.child.exitCode == null) running.child.kill("SIGKILL");
        resolve();
      }, 5_000),
    ),
  ]);
}

async function launchBrowser(): Promise<Browser> {
  const channel = process.env.PLAYWRIGHT_CHANNEL || "chrome";
  try {
    return await chromium.launch({ channel, headless: true });
  } catch (channelError) {
    if (process.env.PLAYWRIGHT_CHANNEL) throw channelError;
    try {
      return await chromium.launch({ headless: true });
    } catch (bundledError) {
      throw new Error(
        [
          "Could not launch Playwright Chromium.",
          `Chrome channel error: ${
            channelError instanceof Error
              ? channelError.message.split("\n")[0]
              : String(channelError)
          }`,
          `Bundled Chromium error: ${
            bundledError instanceof Error
              ? bundledError.message.split("\n")[0]
              : String(bundledError)
          }`,
          "Install a browser with `pnpm exec playwright install chromium` or set PLAYWRIGHT_CHANNEL to an installed channel.",
        ].join("\n"),
      );
    }
  }
}

async function gotoCommitted(page: Page, url: string) {
  await page.goto(url, { waitUntil: "commit", timeout: 60_000 });
}

async function waitVisible(locator: Locator, label: string, timeout = 30_000) {
  try {
    await locator.waitFor({ state: "visible", timeout });
  } catch (err) {
    const page = locator.page();
    const body = await page
      .locator("body")
      .innerText({ timeout: 5_000 })
      .catch(() => "");
    throw new Error(
      [
        `Expected visible UI for ${label}.`,
        `URL: ${page.url()}`,
        `Title: ${await page.title().catch(() => "")}`,
        `Body: ${body.replace(/\s+/g, " ").trim().slice(0, 1_500)}`,
        err instanceof Error ? err.message : String(err),
      ].join("\n"),
    );
  }
}

async function signIn(page: Page, baseUrl: string) {
  await gotoCommitted(page, `${baseUrl}/login`);
  const result = await page.evaluate(
    async ({ email, password }) => {
      const register = await fetch("/_agent-native/auth/register", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email,
          password,
          callbackURL: "/overview",
        }),
      });
      if (!register.ok && register.status !== 409) {
        throw new Error(
          `register failed with HTTP ${register.status}: ${await register.text()}`,
        );
      }

      const login = await fetch("/_agent-native/auth/login", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const text = await login.text();
      if (!login.ok) {
        throw new Error(`login failed with HTTP ${login.status}: ${text}`);
      }
      return text ? JSON.parse(text) : null;
    },
    { email: qaEmail, password: qaPassword },
  );
  assert.equal(result?.ok, true);
}

async function writeAutomation(page: Page) {
  const content = `---
schedule: "*/15 * * * *"
enabled: true
lastRun: ${lastRun}
lastStatus: error
lastError: "${lastError}"
nextRun: ${nextRun}
createdBy: ${qaEmail}
---

Run the Dispatch automations smoke job.`;

  await page.evaluate(
    async ({ path, content }) => {
      const response = await fetch("/_agent-native/resources", {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
          "X-Agent-Native-CSRF": "1",
        },
        body: JSON.stringify({
          path,
          content,
          mimeType: "text/markdown",
        }),
      });
      const text = await response.text();
      if (!response.ok) {
        throw new Error(
          `write automation failed with HTTP ${response.status}: ${text}`,
        );
      }
    },
    { path: jobPath, content },
  );
}

async function readAutomation(page: Page) {
  const rows = await page.evaluate(async () => {
    const response = await fetch("/_agent-native/automations", {
      credentials: "include",
    });
    const text = await response.text();
    if (!response.ok) {
      throw new Error(
        `list automations failed with HTTP ${response.status}: ${text}`,
      );
    }
    return text ? JSON.parse(text) : [];
  });
  assert.ok(Array.isArray(rows), "automations response must be an array");
  const row = rows.find((item: { path?: string }) => item.path === jobPath);
  assert.ok(row, `expected ${jobPath} in automations response`);
  return row as { enabled: boolean; lastError?: string };
}

async function runSmoke(page: Page, baseUrl: string) {
  const consoleErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() !== "error") return;
    const text = message.text();
    if (text.startsWith("Failed to load resource:")) return;
    consoleErrors.push(text);
  });

  await signIn(page, baseUrl);
  await writeAutomation(page);

  await gotoCommitted(page, `${baseUrl}/overview`);
  await waitVisible(
    page.getByRole("heading", { name: "Automations" }),
    "Automations panel",
  );
  await waitVisible(page.getByText(jobName, { exact: true }), jobName);
  await waitVisible(page.getByText(lastError), "automation last error");
  await waitVisible(page.getByText(/Last /).first(), "automation last run");
  await waitVisible(page.getByText(/Next /).first(), "automation next run");
  await waitVisible(page.getByText("Error", { exact: true }), "error status");

  const before = await readAutomation(page);
  assert.equal(before.enabled, true);
  assert.equal(before.lastError, lastError);

  const disableResponse = page.waitForResponse(
    (response) =>
      response.request().method() === "PATCH" &&
      response.url().includes("/_agent-native/automations"),
    { timeout: 15_000 },
  );
  await page
    .getByRole("switch", { name: `Disable automation ${jobName}` })
    .click();
  const disable = await disableResponse;
  assert.equal(
    disable.ok(),
    true,
    `disable automation failed with HTTP ${disable.status()}: ${await disable.text()}`,
  );
  await page
    .getByRole("switch", { name: `Enable automation ${jobName}` })
    .waitFor({ state: "visible", timeout: 15_000 });
  await page.getByText("Paused", { exact: true }).waitFor({
    state: "visible",
    timeout: 15_000,
  });
  const disabled = await readAutomation(page);
  assert.equal(disabled.enabled, false);

  const enableResponse = page.waitForResponse(
    (response) =>
      response.request().method() === "PATCH" &&
      response.url().includes("/_agent-native/automations"),
    { timeout: 15_000 },
  );
  await page
    .getByRole("switch", { name: `Enable automation ${jobName}` })
    .click();
  const enable = await enableResponse;
  assert.equal(
    enable.ok(),
    true,
    `enable automation failed with HTTP ${enable.status()}: ${await enable.text()}`,
  );
  await page
    .getByRole("switch", { name: `Disable automation ${jobName}` })
    .waitFor({ state: "visible", timeout: 15_000 });
  const enabled = await readAutomation(page);
  assert.equal(enabled.enabled, true);

  assert.deepEqual(consoleErrors, [], "overview must not log console errors");
}

async function main() {
  let running: RunningDispatch | null = null;
  let browser: Browser | null = null;
  try {
    buildCurrentPackages();
    cleanDispatchGeneratedFiles();
    running = await startDispatch();
    browser = await launchBrowser();
    const page = await browser.newPage();
    await runSmoke(page, running.baseUrl);
    console.log("qa-dispatch-automations-smoke: clean");
  } finally {
    if (browser) await browser.close().catch(() => undefined);
    if (running) await stopDispatch(running).catch(() => undefined);
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : error);
  process.exit(1);
});
