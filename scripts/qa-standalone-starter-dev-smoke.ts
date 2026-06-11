#!/usr/bin/env node
/**
 * Dev-server smoke for the public standalone Starter create flow:
 *
 *   npx @agent-native/core@latest create <name> --standalone --template starter
 *   cd <name> && pnpm install && pnpm dev
 *
 * Starts a real Vite dev server, hits the same auto-login redirect path local
 * developers use, and fails on SSR/runtime errors such as:
 *
 *   "You must render this element inside a <HydratedRouter> element"
 *   → browser shows "Unexpected Server Error"
 *
 * Production `pnpm build` does not catch this class of bug because it exercises
 * a different SSR pipeline than Vite dev + React Router's environment API.
 */
import assert from "node:assert/strict";
import {
  execFileSync,
  spawn,
  type ChildProcessWithoutNullStreams,
  type ExecFileSyncOptions,
} from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import fs from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { Browser, Page } from "playwright";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const requireFromCore = createRequire(
  path.join(repoRoot, "packages/core/package.json"),
);
const { chromium } = requireFromCore(
  "playwright",
) as typeof import("playwright");

const port = Number(process.env.STANDALONE_STARTER_DEV_SMOKE_PORT || 9327);
const appName =
  process.env.STANDALONE_STARTER_DEV_SMOKE_APP || "test-standalone";
const scaffoldParent =
  process.env.STANDALONE_STARTER_DEV_SMOKE_DIR?.trim() ||
  fs.mkdtempSync(path.join(os.tmpdir(), "an-standalone-dev-smoke-"));
const appDir = path.join(scaffoldParent, appName);
const skipScaffold =
  process.env.STANDALONE_STARTER_DEV_SMOKE_SKIP_CREATE === "1";
const verbose = process.env.STANDALONE_STARTER_DEV_SMOKE_VERBOSE === "1";
const headed = process.env.STANDALONE_STARTER_DEV_SMOKE_HEADED === "1";
const isCi = Boolean(process.env.CI || process.env.GITHUB_ACTIONS);
const shellTimeoutMs = isCi ? 120_000 : 60_000;
const viteWarmupMs = isCi ? 15_000 : 6_000;
const devStartAttempts = 3;

function log(step: string): void {
  if (verbose) console.log(`[standalone-dev-smoke] ${step}`);
}

const cliEntry = path.join(repoRoot, "packages/core/dist/cli/index.js");
const nodeBin = process.execPath;

interface RunningDev {
  baseUrl: string;
  child: ChildProcessWithoutNullStreams;
  logs: string[];
  dbPath: string;
}

function run(
  cmd: string,
  args: string[],
  opts: ExecFileSyncOptions & { cwd: string },
): string {
  return execFileSync(cmd, args, {
    ...opts,
    encoding: "utf8",
    env: {
      ...process.env,
      NO_COLOR: "1",
      ...opts.env,
    },
  }) as string;
}

function scaffoldStandaloneStarter(): void {
  log(`scaffolding ${appName} into ${scaffoldParent}`);
  if (!fs.existsSync(cliEntry)) {
    throw new Error(
      `Missing ${cliEntry}. Run pnpm --filter @agent-native/core build first.`,
    );
  }
  run(
    nodeBin,
    [cliEntry, "create", appName, "--standalone", "--template", "starter"],
    {
      cwd: scaffoldParent,
    },
  );
  assert.equal(fs.existsSync(path.join(appDir, "package.json")), true);
}

function installApp(): void {
  log(`pnpm install in ${appDir}`);
  run("pnpm", ["install"], { cwd: appDir });
}

function assertStandalonePackageJson(): void {
  const pkg = JSON.parse(
    fs.readFileSync(path.join(appDir, "package.json"), "utf8"),
  );
  for (const depType of [
    "dependencies",
    "devDependencies",
    "peerDependencies",
  ] as const) {
    for (const [name, value] of Object.entries(pkg[depType] ?? {})) {
      if (typeof value !== "string") continue;
      assert.ok(
        !value.startsWith("workspace:"),
        `${depType}.${name} must not be workspace:*`,
      );
      assert.ok(
        !value.startsWith("catalog:"),
        `${depType}.${name} must not be catalog:* (${value})`,
      );
    }
  }
}

function tryFreePort(targetPort: number): void {
  try {
    const pids = execFileSync("lsof", ["-ti", `:${targetPort}`], {
      encoding: "utf8",
    })
      .trim()
      .split("\n")
      .filter(Boolean);
    for (const pid of pids) {
      try {
        process.kill(Number(pid), "SIGKILL");
      } catch {
        // ignore stale pid
      }
    }
    if (pids.length > 0) {
      log(`freed port ${targetPort} (killed ${pids.length} stale process(es))`);
    }
  } catch {
    // port was free
  }
}

function prepareIsolatedDataDir(): string {
  const dataDir = path.join(appDir, ".data");
  fs.rmSync(dataDir, { recursive: true, force: true });
  fs.mkdirSync(dataDir, { recursive: true });
  return path.join(dataDir, "smoke.db");
}

function devEnv(baseUrl: string, dbPath: string): NodeJS.ProcessEnv {
  const databaseUrl = `file:${dbPath}`;
  return {
    ...process.env,
    NODE_ENV: "development",
    APP_URL: baseUrl,
    BETTER_AUTH_URL: baseUrl,
    BETTER_AUTH_SECRET: "standalone-starter-dev-smoke-secret",
    DATABASE_URL: databaseUrl,
    DATABASE_AUTH_TOKEN: "",
    AUTH_SKIP_EMAIL_VERIFICATION: "1",
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

function logTail(logs: string[], maxLines = 120): string {
  return logs.slice(-maxLines).join("");
}

function hasStarterMigrations(logs: string[]): boolean {
  return logTail(logs).includes("Applied migration v1007");
}

function hasAuthLockFailure(logs: string[]): boolean {
  return logTail(logs).includes(
    "Auth guard registered despite init failure — app is locked.",
  );
}

function hasRecentDatabaseLock(logs: string[]): boolean {
  const tail = logTail(logs, 40);
  return tail.includes("database is locked") || tail.includes("SQLITE_BUSY");
}

function parseDevAutoLoginCredentials(logs: string[]): {
  email: string;
  password: string;
} | null {
  const text = logs.join("");
  const match = text.match(
    /Local dev auto-login ready\.\s+email:\s+([^\s]+)\s+password:\s+([^\s]+)/,
  );
  if (!match) return null;
  return { email: match[1], password: match[2] };
}

function isLoggedOutBody(body: string): boolean {
  return (
    /create an account to get started/i.test(body) ||
    /sign in/i.test(body) ||
    /log in/i.test(body)
  );
}

async function waitForDevStable(
  baseUrl: string,
  logs: string[],
): Promise<void> {
  const deadline = Date.now() + 180_000;
  let lastError = "";

  while (Date.now() < deadline) {
    if (hasAuthLockFailure(logs)) {
      throw new Error(
        "Dev server auth init failed (app locked). Recent logs:\n" +
          logTail(logs),
      );
    }

    try {
      const ping = await fetch(`${baseUrl}/_agent-native/ping`, {
        redirect: "manual",
        signal: AbortSignal.timeout(3_000),
      });
      if (ping.status >= 500) {
        lastError = `ping HTTP ${ping.status}`;
        await sleep(750);
        continue;
      }
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
      await sleep(750);
      continue;
    }

    if (!hasStarterMigrations(logs)) {
      lastError = "migrations still running";
      await sleep(750);
      continue;
    }

    if (hasRecentDatabaseLock(logs)) {
      lastError = "database is locked (startup race)";
      await sleep(2_000);
      continue;
    }

    // Do not fetch `/` here — Node fetch would consume the one-time auto-login
    // cookie before Playwright opens. Let the browser be the first client.
    await sleep(2_000);
    return;
  }

  throw new Error(
    `Dev server did not stabilize at ${baseUrl}: ${lastError}\n${logTail(logs)}`,
  );
}

async function startDevOnce(): Promise<RunningDev> {
  tryFreePort(port);
  const baseUrl = `http://127.0.0.1:${port}`;
  const dbPath = prepareIsolatedDataDir();
  log(`database: file:${dbPath}`);
  const logs: string[] = [];
  const child = spawn(
    "pnpm",
    [
      "exec",
      "agent-native",
      "dev",
      "--",
      "--host",
      "127.0.0.1",
      "--port",
      String(port),
      "--strictPort",
    ],
    {
      cwd: appDir,
      env: devEnv(baseUrl, dbPath),
      stdio: ["ignore", "pipe", "pipe"],
    },
  );

  child.stdout.on("data", (chunk) => logs.push(chunk.toString()));
  child.stderr.on("data", (chunk) => logs.push(chunk.toString()));
  child.on("exit", (code, signal) => {
    logs.push(`\n[dev] exited code=${code} signal=${signal}\n`);
  });

  const running = { baseUrl, child, logs, dbPath };
  try {
    await waitForDevStable(baseUrl, logs);
    log(`dev server stable at ${baseUrl}`);
    return running;
  } catch (err) {
    await stopDev(running);
    throw err;
  }
}

async function startDev(): Promise<RunningDev> {
  let lastError: unknown;
  for (let attempt = 0; attempt < devStartAttempts; attempt++) {
    try {
      return await startDevOnce();
    } catch (err) {
      lastError = err;
      const message = err instanceof Error ? err.message : String(err);
      const retryable =
        message.includes("app locked") ||
        message.includes("database is locked") ||
        message.includes("SQLITE_BUSY");
      if (!retryable || attempt === devStartAttempts - 1) throw err;
      log(
        `dev startup race (attempt ${attempt + 1}/${devStartAttempts}), retrying…`,
      );
      await sleep(2_000);
    }
  }
  throw lastError;
}

async function stopDev(running: RunningDev): Promise<void> {
  if (running.child.exitCode != null) return;
  running.child.kill("SIGTERM");
  await Promise.race([
    new Promise<void>((resolve) => running.child.once("exit", () => resolve())),
    new Promise<void>((resolve) =>
      setTimeout(() => {
        if (running.child.exitCode == null) running.child.kill("SIGKILL");
        resolve();
      }, 8_000),
    ),
  ]);
}

async function launchBrowser(): Promise<Browser> {
  const channel =
    process.env.PLAYWRIGHT_CHANNEL ||
    (process.env.CI || process.env.GITHUB_ACTIONS ? undefined : "chrome");
  if (channel) {
    try {
      return await chromium.launch({ channel, headless: !headed });
    } catch (channelError) {
      if (process.env.PLAYWRIGHT_CHANNEL) throw channelError;
      log(
        `Chrome channel launch failed (${channelError instanceof Error ? channelError.message.split("\n")[0] : String(channelError)}); using bundled Chromium`,
      );
    }
  }
  try {
    return await chromium.launch({ headless: !headed });
  } catch (bundledError) {
    throw new Error(
      [
        "Could not launch Playwright Chromium.",
        `Bundled Chromium error: ${
          bundledError instanceof Error
            ? bundledError.message.split("\n")[0]
            : String(bundledError)
        }`,
        "Install a browser with `pnpm exec playwright install chromium` or set PLAYWRIGHT_CHANNEL.",
      ].join("\n"),
    );
  }
}

function isNavigationContextError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return (
    message.includes("Execution context was destroyed") ||
    message.includes("context was destroyed") ||
    message.includes("net::ERR_ABORTED")
  );
}

async function retryAfterNavigation<T>(
  label: string,
  fn: () => Promise<T>,
  options: { attempts?: number; delayMs?: number } = {},
): Promise<T> {
  const attempts = options.attempts ?? 12;
  const delayMs = options.delayMs ?? 1_500;
  let lastError: unknown;
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (!isNavigationContextError(err) || attempt === attempts - 1) throw err;
      log(
        `${label} interrupted by navigation (attempt ${attempt + 1}/${attempts}), retrying…`,
      );
      await sleep(delayMs);
    }
  }
  throw lastError;
}

async function gotoCommitted(page: Page, url: string): Promise<void> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      await page.goto(url, { waitUntil: "commit", timeout: 90_000 });
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

function isBenignConsoleError(text: string): boolean {
  if (text.startsWith("Failed to load resource:")) return true;
  if (text.includes("favicon")) return true;
  return false;
}

function isBenignHttpError(status: number, url: string): boolean {
  if (status === 404 && url.includes("/_agent-native/agent-chat/threads/")) {
    return true;
  }
  // First dev load optimizes deps and may 504/503 while Vite/Nitro warm up.
  if (
    (status === 504 || status === 503) &&
    (url.includes("/node_modules/.vite/") || url.includes("/@fs/"))
  ) {
    return true;
  }
  return false;
}

async function signInViaAuthApi(
  page: Page,
  email: string,
  password: string,
): Promise<void> {
  await retryAfterNavigation("auth API login", () =>
    page.evaluate(
      async ({ email, password }) => {
        const post = async (path: string, body: Record<string, unknown>) => {
          const response = await fetch(path, {
            method: "POST",
            credentials: "include",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          });
          const text = await response.text();
          return { ok: response.ok, status: response.status, text };
        };

        let login = await post("/_agent-native/auth/login", {
          email,
          password,
        });
        if (!login.ok) {
          const register = await post("/_agent-native/auth/register", {
            email,
            password,
            name: "Smoke Tester",
            callbackURL: "/",
          });
          if (!register.ok && register.status !== 409) {
            throw new Error(
              `register failed with HTTP ${register.status}: ${register.text}`,
            );
          }
          login = await post("/_agent-native/auth/login", { email, password });
        }
        if (!login.ok) {
          throw new Error(
            `login failed with HTTP ${login.status}: ${login.text}`,
          );
        }
      },
      { email, password },
    ),
  );
}

async function waitForHomeLink(
  page: Page,
  timeoutMs = shellTimeoutMs,
  baseUrl?: string,
): Promise<void> {
  const homeLink = page.getByRole("link", { name: "Home" });
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await homeLink.isVisible().catch(() => false)) return;

    const remaining = deadline - Date.now();
    if (remaining <= 0) break;

    try {
      await homeLink.waitFor({
        state: "visible",
        timeout: Math.min(5_000, remaining),
      });
      return;
    } catch (err) {
      const stillHaveTime = Date.now() < deadline;
      if (!stillHaveTime) break;
      if (
        baseUrl &&
        (isNavigationContextError(err) ||
          (err instanceof Error && err.message.includes("Timeout")))
      ) {
        log("Home not visible — re-navigating after Vite reload");
        await gotoCommitted(page, `${baseUrl}/`);
        await sleep(1_500);
        continue;
      }
      if (isNavigationContextError(err)) {
        await sleep(1_000);
        continue;
      }
      if (stillHaveTime) {
        await sleep(1_000);
        continue;
      }
      throw err;
    }
  }

  const bodyPreview = await page
    .locator("body")
    .innerText({ timeout: 5_000 })
    .catch(() => "");
  throw new Error(
    `Home link not visible within ${timeoutMs}ms at ${page.url()}.\n` +
      `Body preview: ${bodyPreview.slice(0, 400)}`,
  );
}

async function readAuthenticatedSessionEmail(
  page: Page,
  baseUrl: string,
): Promise<string> {
  return retryAfterNavigation(
    "session read",
    async () => {
      await waitForHomeLink(page, shellTimeoutMs, baseUrl);
      const session = await page.evaluate(async () => {
        const response = await fetch("/_agent-native/auth/session", {
          headers: { Accept: "application/json" },
          credentials: "include",
        });
        const text = await response.text();
        return text ? JSON.parse(text) : null;
      });
      const sessionEmail =
        typeof session?.email === "string"
          ? session.email
          : typeof session?.user?.email === "string"
            ? session.user.email
            : "";
      assert.ok(
        sessionEmail.length > 0,
        `expected authenticated session, got ${JSON.stringify(session)}`,
      );
      return sessionEmail;
    },
    { attempts: 20, delayMs: 2_000 },
  );
}

async function waitForAuthenticatedShell(
  page: Page,
  baseUrl: string,
  serverLogs: string[],
): Promise<string> {
  const devCreds = parseDevAutoLoginCredentials(serverLogs);
  const fallbackEmail =
    process.env.STANDALONE_STARTER_DEV_SMOKE_EMAIL ||
    `standalone-smoke-${Date.now()}@example.test`;
  const fallbackPassword =
    process.env.STANDALONE_STARTER_DEV_SMOKE_PASSWORD ||
    "standalone-starter-smoke-password";
  const loginEmail = devCreds?.email ?? fallbackEmail;
  const loginPassword = devCreds?.password ?? fallbackPassword;

  log(`navigating to ${baseUrl}/ (auto-login path)`);
  let lastBody = "";
  let lastUrl = baseUrl;
  const shellAttempts = isCi ? 10 : 6;

  for (let attempt = 0; attempt < shellAttempts; attempt++) {
    await gotoCommitted(page, `${baseUrl}/`);
    lastUrl = page.url();
    lastBody = await retryAfterNavigation("body read", () =>
      page.locator("body").innerText({ timeout: 15_000 }),
    );

    if (/unexpected server error/i.test(lastBody)) {
      throw new Error(
        `page rendered server error text at ${lastUrl}: ${lastBody.slice(0, 240)}`,
      );
    }

    const homeLink = page.getByRole("link", { name: "Home" });
    if (await homeLink.isVisible().catch(() => false)) break;

    const devCredsNow = parseDevAutoLoginCredentials(serverLogs);
    const authEmail = devCredsNow?.email ?? loginEmail;
    const authPassword = devCredsNow?.password ?? loginPassword;

    if (isLoggedOutBody(lastBody)) {
      if (!devCredsNow && attempt < shellAttempts - 2) {
        log(
          `logged out before auto-login creds printed (attempt ${attempt + 1}/${shellAttempts}) — retrying /`,
        );
        await sleep(isCi ? 4_000 : 2_500);
        continue;
      }
      log(
        `still logged out (attempt ${attempt + 1}/${shellAttempts}) — auth API login as ${authEmail}`,
      );
      await signInViaAuthApi(page, authEmail, authPassword);
      continue;
    }

    log(
      `authenticated shell not ready (attempt ${attempt + 1}/${shellAttempts}) — Vite may still be optimizing deps`,
    );
    await sleep(isCi ? 4_000 : 2_500);
  }

  await waitForHomeLink(page, shellTimeoutMs, baseUrl);

  const sessionEmail = await readAuthenticatedSessionEmail(page, baseUrl);
  log(`authenticated session: ${sessionEmail}`);
  return sessionEmail;
}

async function runBrowserSmoke(
  page: Page,
  baseUrl: string,
  serverLogs: string[],
  browserErrors: string[],
  httpErrors: string[],
): Promise<void> {
  // Warmup: auto-login redirect + first Vite dep optimization (noisy HTTP).
  log("warmup: first load + Vite dep optimization");
  await waitForAuthenticatedShell(page, baseUrl, serverLogs);
  await page.waitForTimeout(viteWarmupMs);

  browserErrors.length = 0;
  httpErrors.length = 0;

  log("assertion pass: / and /observability after warmup");
  await gotoCommitted(page, `${baseUrl}/`);
  await waitForHomeLink(page, shellTimeoutMs, baseUrl);
  await readAuthenticatedSessionEmail(page, baseUrl);
  log(`navigating to ${baseUrl}/observability`);
  await gotoCommitted(page, `${baseUrl}/observability`);
  await page
    .getByRole("link", { name: "Observability" })
    .waitFor({ state: "visible", timeout: 20_000 });

  assert.deepEqual(browserErrors, [], "browser console/page errors");
  assert.deepEqual(httpErrors, [], "browser HTTP errors on app origin");
}

function assertCleanServerLogs(logs: string[]): void {
  const text = logs.join("");
  const offenders: string[] = [];
  if (text.includes("HydratedRouter")) offenders.push("HydratedRouter");
  if (text.includes("Unexpected Server Error"))
    offenders.push("Unexpected Server Error");
  if (text.includes("You must render this element inside a")) {
    offenders.push("render outside router context");
  }
  if (hasAuthLockFailure(logs))
    offenders.push("auth init failure (app locked)");
  assert.deepEqual(
    offenders,
    [],
    `dev server logs contained SSR errors: ${offenders.join(", ")}`,
  );
}

async function main(): Promise<void> {
  if (!skipScaffold) {
    scaffoldStandaloneStarter();
    installApp();
    assertStandalonePackageJson();
  } else {
    assert.equal(
      fs.existsSync(path.join(appDir, "package.json")),
      true,
      `STANDALONE_STARTER_DEV_SMOKE_SKIP_CREATE=1 requires ${appDir}/package.json`,
    );
  }

  const running = await startDev();
  let browser: Browser | null = null;
  const browserErrors: string[] = [];
  const httpErrors: string[] = [];

  try {
    browser = await launchBrowser();
    const context = await browser.newContext({
      viewport: { width: 1280, height: 900 },
    });
    const page = await context.newPage();

    page.on("pageerror", (error) => browserErrors.push(error.message));
    page.on("console", (message) => {
      if (message.type() !== "error") return;
      const text = message.text();
      if (isBenignConsoleError(text)) return;
      browserErrors.push(text);
    });
    page.on("response", (response) => {
      const status = response.status();
      if (status < 400) return;
      const url = response.url();
      if (!url.startsWith(running.baseUrl)) return;
      if (isBenignHttpError(status, url)) return;
      httpErrors.push(`${status} ${url}`);
    });

    await runBrowserSmoke(
      page,
      running.baseUrl,
      running.logs,
      browserErrors,
      httpErrors,
    );
    assertCleanServerLogs(running.logs);

    console.log("qa-standalone-starter-dev-smoke: clean");
    console.log(`  url:      ${running.baseUrl}`);
    console.log(`  app:      ${appDir}`);
    console.log(
      "  checked:  scaffold → install → dev server → auto-login → / → /observability",
    );
    console.log(
      "  checked:  no Unexpected Server Error, no HydratedRouter in dev logs",
    );
    console.log("  checked:  no browser console/page errors after warmup");
  } catch (err) {
    const logs = running.logs.slice(-160).join("");
    const message =
      err instanceof Error ? err.stack || err.message : String(err);
    const browserBlock =
      browserErrors.length > 0
        ? `\n\nBrowser errors:\n${browserErrors.join("\n")}`
        : "";
    const httpBlock =
      httpErrors.length > 0
        ? `\n\nBrowser HTTP errors:\n${httpErrors.join("\n")}`
        : "";
    throw new Error(
      `${message}${browserBlock}${httpBlock}\n\nRecent dev logs:\n${logs}`,
    );
  } finally {
    if (browser) await browser.close();
    await stopDev(running);
    if (!process.env.STANDALONE_STARTER_DEV_SMOKE_DIR && !skipScaffold) {
      fs.rmSync(scaffoldParent, {
        recursive: true,
        force: true,
        maxRetries: 3,
      });
    }
  }
}

await main();
