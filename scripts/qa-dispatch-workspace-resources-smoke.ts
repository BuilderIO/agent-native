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
  dbPath: string;
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
  path.join(os.tmpdir(), "an-dispatch-workspace-smoke-"),
);
const port = Number(process.env.DISPATCH_WORKSPACE_SMOKE_PORT || 9325);
const runId = Date.now().toString(36);
const qaEmail = "qa-dispatch-workspace-smoke@example.test";
const qaPassword = "local-dev-account";
const resourceName = `Browser Smoke Brand ${runId}`;
const resourcePath = `context/browser-smoke-${runId}.md`;
const initialContent = `# ${resourceName}\n\nInitial workspace default.`;
const approvedContent = `# ${resourceName}\n\nApproved All-app workspace default.`;
const sharedOverrideContent = `# ${resourceName}\n\nOrganization override wins.`;

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

async function gotoCommitted(page: Page, url: string) {
  let lastError: unknown;
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      await page.goto(url, { waitUntil: "commit", timeout: 60_000 });
      return;
    } catch (err) {
      lastError = err;
      const message = err instanceof Error ? err.message : String(err);
      const retryable =
        message.includes("net::ERR_ABORTED") ||
        message.includes("Vite environment") ||
        message.includes("503");
      if (!retryable || attempt === 4) throw err;
      await page.waitForTimeout(750 * (attempt + 1));
    }
  }
  throw lastError;
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
      {
        id: "analytics",
        name: "Analytics",
        description: "Metrics and dashboards",
        path: "/analytics",
        url: `${baseUrl}/analytics`,
        isDispatch: false,
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
    BETTER_AUTH_SECRET: "dispatch-workspace-resource-smoke-secret",
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
  return { baseUrl, child, dbPath, logs };
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

async function expectVisible(
  locator: Locator,
  label: string,
  timeout = 20_000,
) {
  try {
    await locator.first().waitFor({ state: "visible", timeout });
  } catch (err) {
    throw new Error(
      `Expected visible UI for ${label}: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }
}

async function callAction<T = any>(
  page: Page,
  name: string,
  params: Record<string, unknown> = {},
  method: "GET" | "POST" = "POST",
): Promise<T> {
  return page.evaluate(
    async ({ name, params, method }) => {
      const url = new URL(
        `/_agent-native/actions/${name}`,
        window.location.origin,
      );
      const init: RequestInit = {
        method,
        credentials: "include",
        headers: {
          "X-Agent-Native-CSRF": "1",
        },
      };
      if (method === "GET") {
        for (const [key, value] of Object.entries(params)) {
          if (value !== undefined && value !== null) {
            url.searchParams.set(key, String(value));
          }
        }
      } else {
        init.headers = {
          ...init.headers,
          "Content-Type": "application/json",
        };
        init.body = JSON.stringify(params);
      }

      const response = await fetch(url, init);
      const text = await response.text();
      const data = text ? JSON.parse(text) : null;
      if (!response.ok) {
        throw new Error(
          `${name} failed with HTTP ${response.status}: ${text || response.statusText}`,
        );
      }
      return data;
    },
    { name, params, method },
  );
}

async function createSharedOverride(page: Page) {
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
          shared: true,
          mimeType: "text/markdown",
        }),
      });
      const text = await response.text();
      if (!response.ok) {
        throw new Error(
          `shared override failed with HTTP ${response.status}: ${text}`,
        );
      }
    },
    { path: resourcePath, content: sharedOverrideContent },
  );
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
          callbackURL: "/workspace",
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

async function warmDispatchRoutes(page: Page, baseUrl: string) {
  const routes = [
    { path: "/workspace", text: "Workspace Resources" },
    { path: "/approvals", text: "Approval policy" },
    { path: "/apps", text: "Workspace apps" },
  ];

  for (const route of routes) {
    let lastError: unknown;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        await gotoCommitted(page, `${baseUrl}${route.path}`);
        await expectVisible(
          page.getByText(route.text),
          `warm ${route.path}`,
          15_000,
        );
        await page.waitForTimeout(750);
        lastError = null;
        break;
      } catch (err) {
        lastError = err;
        await page.waitForTimeout(1_000);
      }
    }
    if (lastError) throw lastError;
  }
}

async function runSmoke(page: Page, baseUrl: string) {
  await gotoCommitted(page, `${baseUrl}/workspace`);
  await expectVisible(
    page.getByText("Workspace Resources"),
    "Workspace Resources page",
  );

  const created = await callAction(page, "create-workspace-resource", {
    kind: "knowledge",
    name: resourceName,
    description: "Browser smoke resource for global inheritance.",
    path: resourcePath,
    content: initialContent,
    scope: "all",
  });
  assert.equal(created?.scope, "all");
  assert.equal(created?.path, resourcePath);

  await callAction(page, "set-dispatch-approval-policy", {
    enabled: true,
    approverEmails: [qaEmail],
  });

  await gotoCommitted(page, `${baseUrl}/workspace`);
  await expectVisible(
    page.getByRole("tab", { name: /Knowledge/ }),
    "Knowledge tab",
  );
  await page.getByRole("tab", { name: /Knowledge/ }).click();
  await expectVisible(
    page.getByText(resourceName, { exact: true }),
    "created workspace resource row",
  );

  await page.locator("button", { hasText: resourceName }).first().click();
  await expectVisible(
    page.getByText("Effective in app"),
    "workspace resource effective preview",
  );
  await page
    .getByRole("button", { name: /^Edit$/ })
    .last()
    .click();

  const editDialog = page.getByRole("dialog", {
    name: /Edit workspace resource/,
  });
  await expectVisible(editDialog, "edit workspace resource dialog");
  await editDialog.locator("textarea").fill(approvedContent);
  await expectVisible(
    editDialog.getByText("All apps impact"),
    "impact preview",
  );
  await expectVisible(
    editDialog.getByText("Approval required"),
    "approval-required impact badge",
  );
  await editDialog
    .getByRole("button", { name: "Save changes" })
    .click({ force: true });
  await editDialog.waitFor({ state: "hidden", timeout: 15_000 });

  await gotoCommitted(page, `${baseUrl}/approvals`);
  await expectVisible(
    page.getByText(`Update All-app workspace knowledge "${resourceName}"`),
    "pending All-app resource approval",
  );
  await expectVisible(
    page.getByText(new RegExp(`pending · requested by ${qaEmail}`)),
    "pending approval status",
  );
  const approveButton = page.getByRole("button", { name: /^Approve$/ }).first();
  await expectVisible(approveButton, "Approve button");
  assert.equal(await approveButton.isEnabled(), true);
  await approveButton.scrollIntoViewIfNeeded();
  const approveResponsePromise = page.waitForResponse(
    (response) =>
      response.url().includes("/_agent-native/actions/approve-dispatch-change"),
    { timeout: 15_000 },
  );
  await approveButton.click();
  const approveResponse = await approveResponsePromise;
  const approveBody = await approveResponse.text();
  assert.equal(
    approveResponse.ok(),
    true,
    `approve action failed with HTTP ${approveResponse.status()}: ${approveBody}`,
  );

  let approved: any = null;
  const approvalDeadline = Date.now() + 20_000;
  while (Date.now() < approvalDeadline) {
    const approvals = await callAction<any[]>(
      page,
      "list-dispatch-approvals",
      {},
      "GET",
    );
    approved = approvals.find((approval) =>
      String(approval.summary).includes(resourceName),
    );
    if (approved?.status === "approved") break;
    await page.waitForTimeout(500);
  }
  assert.equal(approved?.status, "approved");
  assert.equal(approved?.reviewedBy, qaEmail);

  const resources = await callAction<any[]>(
    page,
    "list-workspace-resources",
    {},
    "GET",
  );
  const updated = resources.find((resource) => resource.path === resourcePath);
  assert.equal(updated?.content, approvedContent);

  await createSharedOverride(page);

  await gotoCommitted(page, `${baseUrl}/apps`);
  await expectVisible(page.getByText("Analytics"), "Analytics app card");
  await page.getByRole("button", { name: "Context" }).first().click();

  const contextDialog = page.getByRole("dialog", {
    name: /Analytics workspace resources/,
  });
  await expectVisible(contextDialog, "Analytics context dialog");
  await expectVisible(
    contextDialog.getByText("Nothing is copied into this app."),
    "runtime inheritance copy",
  );
  await expectVisible(
    contextDialog.getByText(resourceName, { exact: true }),
    "inherited resource in app context",
  );
  const resourceCard = contextDialog
    .getByText(resourceName, { exact: true })
    .locator(
      "xpath=ancestor::div[contains(@class, 'rounded-lg') and contains(@class, 'border')][1]",
    );
  await expectVisible(resourceCard, "inherited resource card");
  await resourceCard.getByRole("button", { name: "Stack" }).first().click();
  await expectVisible(
    resourceCard.getByText("Effective context stack"),
    "effective context stack",
  );
  await expectVisible(
    resourceCard.getByText("Inherited by all apps"),
    "All-app availability",
  );
  await expectVisible(
    resourceCard.getByText("Workspace default"),
    "workspace layer",
  );
  await expectVisible(
    resourceCard.getByText("Organization/app override"),
    "shared override layer",
  );
  await expectVisible(resourceCard.getByText("Overridden"), "overridden badge");
  await expectVisible(resourceCard.getByText("Wins"), "winning override badge");
  await expectVisible(
    resourceCard.getByText(`__shared__/${resourcePath}`),
    "shared override winning layer",
  );
}

async function main() {
  buildCurrentPackages();
  cleanDispatchGeneratedFiles();
  const running = await startDispatch();
  let browser: Browser | null = null;
  const errors: string[] = [];
  const httpErrors: string[] = [];
  try {
    browser = await launchBrowser();
    const context = await browser.newContext({
      viewport: { width: 1440, height: 1200 },
    });
    const page = await context.newPage();

    await signIn(page, running.baseUrl);
    await warmDispatchRoutes(page, running.baseUrl);

    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (message) => {
      if (message.type() !== "error") return;
      const text = message.text();
      if (text.startsWith("Failed to load resource:")) return;
      errors.push(text);
    });
    page.on("response", (response) => {
      const status = response.status();
      if (status < 400) return;
      const url = response.url();
      if (url.startsWith(running.baseUrl)) {
        if (
          status === 404 &&
          url.includes("/_agent-native/agent-chat/threads/")
        ) {
          return;
        }
        httpErrors.push(`${status} ${url}`);
      }
    });

    await runSmoke(page, running.baseUrl);

    assert.deepEqual(errors, [], "browser console/page errors");
    assert.deepEqual(httpErrors, [], "browser HTTP errors");
    console.log(
      `qa-dispatch-workspace-resources-smoke: clean (${resourcePath})`,
    );
  } catch (err) {
    const logs = running.logs.slice(-120).join("");
    const message =
      err instanceof Error ? err.stack || err.message : String(err);
    const browserErrors =
      errors.length > 0 ? `\n\nBrowser errors:\n${errors.join("\n")}` : "";
    const browserHttpErrors =
      httpErrors.length > 0
        ? `\n\nBrowser HTTP errors:\n${httpErrors.join("\n")}`
        : "";
    throw new Error(
      `${message}${browserErrors}${browserHttpErrors}\n\nRecent Dispatch logs:\n${logs}`,
    );
  } finally {
    if (browser) await browser.close();
    await stopDispatch(running);
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.stack || err.message : err);
  process.exit(1);
});
