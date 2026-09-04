#!/usr/bin/env node
/**
 * Dev-server smoke for the public standalone Chat create flow:
 *
 *   npx @agent-native/core@latest create <name> --standalone --template chat
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
 *
 * CI flake strategy (do not fight Vite first-load dep optimization):
 * 1. Poll the unauthenticated JSON API from process launch until it returns 401.
 * 2. One page.goto to `/home` so local auto-login runs before the Chat handoff.
 * 3. Verify the authenticated `/home` handoff to a durable Chat thread.
 * 4. waitForViteDepsQuiet(server logs) before strict assertions.
 * 5. Retry goto/evaluate only for known Vite startup responses and transient
 *    Playwright navigation errors.
 */
import assert from "node:assert/strict";
import {
  execFileSync,
  spawn,
  type ChildProcess,
  type ExecFileSyncOptions,
} from "node:child_process";
import fs from "node:fs";
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { createRequire } from "node:module";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";

import type { APIResponse, Browser, Page } from "playwright";

import {
  MISSING_BROWSER_HINT,
  MISSING_HEADED_BROWSER_HINT,
} from "./playwright-browser-hint";
import {
  isRetryableSessionReadErrorMessage,
  isTransientCommittedNavigationResponse,
  isTransientStartupPollResponse,
} from "./qa-standalone-chat-dev-smoke-readiness";

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

const port = Number(process.env.STANDALONE_CHAT_DEV_SMOKE_PORT || 9327);
const appName = process.env.STANDALONE_CHAT_DEV_SMOKE_APP || "test-standalone";
const scaffoldParent =
  process.env.STANDALONE_CHAT_DEV_SMOKE_DIR?.trim() ||
  fs.mkdtempSync(path.join(os.tmpdir(), "an-standalone-dev-smoke-"));
const appDir = path.join(scaffoldParent, appName);
const skipScaffold = process.env.STANDALONE_CHAT_DEV_SMOKE_SKIP_CREATE === "1";
const verbose = process.env.STANDALONE_CHAT_DEV_SMOKE_VERBOSE === "1";
const headed = process.env.STANDALONE_CHAT_DEV_SMOKE_HEADED === "1";
const isCi = Boolean(process.env.CI || process.env.GITHUB_ACTIONS);
const shellTimeoutMs = isCi ? 120_000 : 60_000;
const devStartAttempts = 3;
const nitroUnavailableConsoleLine =
  'NitroViteError]: Vite environment "nitro" is unavailable';

function log(step: string): void {
  if (verbose) console.log(`[standalone-dev-smoke] ${step}`);
}

const cliEntry = path.join(repoRoot, "packages/core/dist/cli/index.js");
const pnpmBin = process.env.STANDALONE_CHAT_DEV_SMOKE_PNPM || "pnpm";
const approvalActionFixture = path.join(
  repoRoot,
  "scripts/fixtures/agentkit-acceptance/accept-agentkit-release.ts",
);
const acceptanceTransportFixture = path.join(
  repoRoot,
  "scripts/fixtures/agentkit-acceptance/transport.ts",
);
const nodeBin = process.execPath;
const installTimeoutMs = Number(
  process.env.AGENTKIT_ACCEPTANCE_INSTALL_TIMEOUT_MS || 300_000,
);
const durableChatPathPattern = /^\/chat\/[^/]+$/;

type ApiResponseShape = {
  ok: boolean | (() => boolean);
  status: number | (() => number);
};

function apiResponseOk(response: APIResponse): boolean {
  const ok = (response as unknown as ApiResponseShape).ok;
  return typeof ok === "function" ? ok.call(response) : ok;
}

function apiResponseStatus(response: APIResponse): number {
  const status = (response as unknown as ApiResponseShape).status;
  return typeof status === "function" ? status.call(response) : status;
}

interface ViteReloadTracker {
  /** Wall-clock ms when the latest Vite full-page reload log chunk arrived. */
  lastReloadAt: number;
}

interface RunningDev {
  baseUrl: string;
  child: ChildProcess;
  closed: Promise<void>;
  isClosed: () => boolean;
  logs: string[];
  dbPath: string;
  viteReload: ViteReloadTracker;
}

function appendDevLog(
  logs: string[],
  chunk: string,
  viteReload: ViteReloadTracker,
): void {
  logs.push(chunk);
  if (
    chunk.includes("reloading the page") ||
    chunk.includes("optimized dependencies changed") ||
    chunk.includes("new dependencies optimized") ||
    chunk.includes("bundling dependencies")
  ) {
    viteReload.lastReloadAt = Date.now();
  }
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

async function runLive(
  cmd: string,
  args: string[],
  options: {
    cwd: string;
    timeoutMs: number;
    label: string;
    env?: NodeJS.ProcessEnv;
  },
): Promise<void> {
  log(`${options.label}: ${cmd} ${args.join(" ")}`);
  const child = spawn(cmd, args, {
    cwd: options.cwd,
    env: { ...process.env, NO_COLOR: "1", ...options.env },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const output: string[] = [];
  const append = (chunk: Buffer | string) => {
    const text = chunk.toString();
    output.push(text);
    if (output.length > 300) output.shift();
    process.stdout.write(text);
  };
  child.stdout.on("data", append);
  child.stderr.on("data", append);
  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    child.kill("SIGTERM");
    setTimeout(() => child.kill("SIGKILL"), 5_000).unref();
  }, options.timeoutMs);
  try {
    const result = await new Promise<{
      code: number | null;
      signal: NodeJS.Signals | null;
    }>((resolve, reject) => {
      child.once("error", reject);
      child.once("close", (code, signal) => resolve({ code, signal }));
    });
    if (timedOut) {
      throw new Error(
        `${options.label} exceeded ${options.timeoutMs}ms.\n${output.join("")}`,
      );
    }
    if (result.code !== 0) {
      throw new Error(
        `${options.label} failed with exit ${String(result.code)} (${String(result.signal)}).\n${output.join("")}`,
      );
    }
  } finally {
    clearTimeout(timeout);
  }
}

function scaffoldStandaloneChat(): void {
  log(`scaffolding ${appName} into ${scaffoldParent}`);
  if (!fs.existsSync(cliEntry)) {
    throw new Error(
      `Missing ${cliEntry}. Run pnpm --filter @agent-native/core build first.`,
    );
  }
  run(
    nodeBin,
    [cliEntry, "create", appName, "--standalone", "--template", "chat"],
    {
      cwd: scaffoldParent,
      env: {
        AGENT_NATIVE_CREATE_USE_LOCAL_CORE:
          process.env.AGENT_NATIVE_CREATE_USE_LOCAL_CORE ?? "1",
      },
    },
  );
  assert.equal(fs.existsSync(path.join(appDir, "package.json")), true);
}

function installApprovalActionFixture(): void {
  assert.equal(fs.existsSync(approvalActionFixture), true);
  fs.copyFileSync(
    approvalActionFixture,
    path.join(appDir, "actions/accept-agentkit-release.ts"),
  );

  const agentChatPluginPath = path.join(appDir, "server/plugins/agent-chat.ts");
  const source = fs.readFileSync(agentChatPluginPath, "utf8");
  if (source.includes('"accept-agentkit-release"')) return;

  const initialToolsPattern = /const INITIAL_TOOL_NAMES = \[([\s\S]*?)\n\];/g;
  const initialToolsDeclarations = [...source.matchAll(initialToolsPattern)];
  assert.equal(
    initialToolsDeclarations.length,
    1,
    "generated Chat app must expose the expected initial-tool declaration",
  );
  const initialToolsDeclaration = initialToolsDeclarations[0]![0];
  fs.writeFileSync(
    agentChatPluginPath,
    source.replace(
      initialToolsDeclaration,
      initialToolsDeclaration.replace(
        /\n\];$/,
        '\n  "accept-agentkit-release",\n];',
      ),
    ),
  );
}

function installAcceptanceTransportFixture(): void {
  assert.equal(fs.existsSync(acceptanceTransportFixture), true);
  const fixtureTarget = path.join(
    appDir,
    "app/lib/agentkit-acceptance-transport.ts",
  );
  fs.copyFileSync(acceptanceTransportFixture, fixtureTarget);

  const chatSurfacePath = path.join(
    appDir,
    "app/components/chat/ChatRouteContent.tsx",
  );
  const source = fs.readFileSync(chatSurfacePath, "utf8");
  if (source.includes("instrumentAgentKitAcceptanceTransport(")) return;
  const importAnchor = 'import { TAB_ID } from "@/lib/tab-id";';
  const transportAnchor = "    createAgentNativeAgentKitTransport({";
  const closeAnchor = "    }),\n  );";
  assert.equal(
    source.split(importAnchor).length - 1,
    1,
    "generated Chat surface import anchor changed",
  );
  assert.equal(
    source.split(transportAnchor).length - 1,
    1,
    "generated Chat surface transport anchor changed",
  );
  assert.equal(
    source.split(closeAnchor).length - 1,
    1,
    "generated Chat surface transport close anchor changed",
  );
  fs.writeFileSync(
    chatSurfacePath,
    source
      .replace(
        importAnchor,
        `${importAnchor}\nimport { instrumentAgentKitAcceptanceTransport } from "@/lib/agentkit-acceptance-transport";`,
      )
      .replace(
        transportAnchor,
        "    instrumentAgentKitAcceptanceTransport(\n      createAgentNativeAgentKitTransport({",
      )
      .replace(closeAnchor, "      }),\n    ),\n  );"),
  );
}

async function installApp(): Promise<void> {
  log(`pnpm install in ${appDir}`);
  await runLive(pnpmBin, ["install"], {
    cwd: appDir,
    timeoutMs: installTimeoutMs,
    label: "generated Chat dependency installation",
  });
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

  if (process.env.AGENT_NATIVE_CREATE_USE_LOCAL_CORE !== "0") {
    assert.match(
      pkg.dependencies?.["@agent-native/agentkit"] ?? "",
      /^file:\/\//,
      "standalone Chat must install the current local AgentKit artifact",
    );
    assert.match(
      pkg.dependencies?.["@agent-native/agentkit-react"] ?? "",
      /^file:\/\//,
      "standalone Chat must install the current local AgentKit React artifact",
    );
    const workspaceYaml = fs.readFileSync(
      path.join(appDir, "pnpm-workspace.yaml"),
      "utf8",
    );
    for (const packageName of [
      "agentkit-protocol",
      "agentkit-client",
      "agentkit-adapters",
      "agentkit-conformance",
      "agentkit-react",
      "agentkit",
    ]) {
      assert.match(
        workspaceYaml,
        new RegExp(`\"@agent-native/${packageName}\": \\"file://`),
        `standalone Chat must override @agent-native/${packageName} to the current local artifact`,
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

function devEnv(
  baseUrl: string,
  dbPath: string,
  providerBaseUrl: string,
): NodeJS.ProcessEnv {
  const databaseUrl = `file:${dbPath}`;
  return {
    ...process.env,
    NODE_ENV: "development",
    APP_URL: baseUrl,
    BETTER_AUTH_URL: baseUrl,
    BETTER_AUTH_SECRET: "standalone-chat-dev-smoke-secret",
    DATABASE_URL: databaseUrl,
    DATABASE_AUTH_TOKEN: "",
    AUTH_SKIP_EMAIL_VERIFICATION: "1",
    AGENT_ENGINE: "ai-sdk:openai",
    AGENT_MODEL: "agentkit-loopback",
    OPENAI_API_KEY: "sk-agentkit-loopback-not-a-real-key",
    OPENAI_BASE_URL: providerBaseUrl,
    ANTHROPIC_API_KEY: "",
    BUILDER_PRIVATE_KEY: "",
    BUILDER_PUBLIC_KEY: "",
    COHERE_API_KEY: "",
    GOOGLE_GENERATIVE_AI_API_KEY: "",
    GROQ_API_KEY: "",
    MISTRAL_API_KEY: "",
    OPENROUTER_API_KEY: "",
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

function hasChatMigrations(logs: string[]): boolean {
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

/**
 * Wait until no Vite full-page reload log chunk has arrived for `quietMs`.
 * Uses chunk timestamps — old "reloading" text in the log buffer never clears.
 */
async function waitForViteDepsQuiet(
  viteReload: ViteReloadTracker,
  logs: string[],
  options: { quietMs?: number; timeoutMs?: number } = {},
): Promise<void> {
  const quietMs = options.quietMs ?? (isCi ? 8_000 : 4_000);
  const timeoutMs = options.timeoutMs ?? 120_000;
  const noReloadDeadline = Date.now() + (isCi ? 10_000 : 5_000);
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    if (viteReload.lastReloadAt === 0) {
      if (Date.now() >= noReloadDeadline) return;
      await sleep(500);
      continue;
    }
    if (Date.now() - viteReload.lastReloadAt >= quietMs) return;
    await sleep(500);
  }

  throw new Error(
    `Vite dep optimization did not settle within ${timeoutMs}ms ` +
      `(lastReloadAt=${viteReload.lastReloadAt}).\n${logTail(logs)}`,
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

    try {
      const speculationRules = await fetch(
        `${baseUrl}/_agent-native/speculation-rules.json`,
        {
          redirect: "manual",
          signal: AbortSignal.timeout(3_000),
        },
      );
      if (speculationRules.status !== 200) {
        lastError = `speculation rules HTTP ${speculationRules.status}`;
        await sleep(750);
        continue;
      }
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
      await sleep(750);
      continue;
    }

    if (!hasChatMigrations(logs)) {
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

async function waitForUnauthenticatedPollReady(
  running: RunningDev,
): Promise<void> {
  const deadline = Date.now() + 180_000;
  let lastError = "dev port has not accepted a request";
  let transientResponses = 0;

  while (Date.now() < deadline) {
    if (running.isClosed()) {
      throw new Error(
        "Dev server exited before the startup poll became ready. Recent logs:\n" +
          logTail(running.logs),
      );
    }
    if (hasAuthLockFailure(running.logs)) {
      throw new Error(
        "Dev server auth init failed (app locked). Recent logs:\n" +
          logTail(running.logs),
      );
    }

    let response: Response;
    try {
      response = await fetch(`${running.baseUrl}/_agent-native/poll?since=0`, {
        headers: { accept: "application/json" },
        redirect: "manual",
        signal: AbortSignal.timeout(10_000),
      });
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
      await sleep(50);
      continue;
    }

    const body = await response.text();
    if (response.status === 401) {
      log(
        `startup poll reached HTTP 401 after ${transientResponses} transient response(s)`,
      );
      return;
    }
    if (isTransientStartupPollResponse(response.status, body)) {
      transientResponses += 1;
      lastError = `startup poll HTTP ${response.status} (${transientResponses} transient response(s))`;
      await sleep(100);
      continue;
    }

    throw new Error(
      `Expected unauthenticated startup poll to return HTTP 401 after transient startup responses, ` +
        `got HTTP ${response.status}: ${body.slice(0, 300)}`,
    );
  }

  throw new Error(
    `Unauthenticated startup poll did not reach HTTP 401: ${lastError}\n${logTail(
      running.logs,
    )}`,
  );
}

async function startDevOnce(providerBaseUrl: string): Promise<RunningDev> {
  tryFreePort(port);
  const baseUrl = `http://127.0.0.1:${port}`;
  const dbPath = prepareIsolatedDataDir();
  log(`database: file:${dbPath}`);
  const logs: string[] = [];
  const viteReload: ViteReloadTracker = { lastReloadAt: 0 };
  const child = spawn(
    nodeBin,
    [
      cliEntry,
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
      env: devEnv(baseUrl, dbPath, providerBaseUrl),
      stdio: ["ignore", "pipe", "pipe"],
      detached: process.platform !== "win32",
    },
  );
  let closed = false;
  const closePromise = new Promise<void>((resolve) => {
    child.once("close", () => {
      closed = true;
      resolve();
    });
  });

  child.stdout.on("data", (chunk) =>
    appendDevLog(logs, chunk.toString(), viteReload),
  );
  child.stderr.on("data", (chunk) =>
    appendDevLog(logs, chunk.toString(), viteReload),
  );
  child.on("exit", (code, signal) => {
    appendDevLog(
      logs,
      `\n[dev] exited code=${code} signal=${signal}\n`,
      viteReload,
    );
  });

  const running = {
    baseUrl,
    child,
    closed: closePromise,
    isClosed: () => closed,
    logs,
    dbPath,
    viteReload,
  };
  try {
    await waitForUnauthenticatedPollReady(running);
    await waitForDevStable(baseUrl, logs);
    assertCleanServerLogs(logs);
    log(`dev server stable at ${baseUrl}`);
    return running;
  } catch (err) {
    await stopDev(running);
    throw err;
  }
}

async function startDev(providerBaseUrl: string): Promise<RunningDev> {
  let lastError: unknown;
  for (let attempt = 0; attempt < devStartAttempts; attempt++) {
    try {
      return await startDevOnce(providerBaseUrl);
    } catch (err) {
      lastError = err;
      const message = err instanceof Error ? err.message : String(err);
      // autoMountAuth installs a permanent fallback guard after this failure;
      // restarting here makes the smoke pass even though a real `pnpm dev`
      // session remains locked until the developer restarts it manually.
      const authLocked = message.includes("app locked");
      const retryable =
        !authLocked &&
        (message.includes("database is locked") ||
          message.includes("SQLITE_BUSY") ||
          message.includes("The database connection is not open") ||
          message.includes("database connection is not open") ||
          message.includes("socket hang up"));
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
  const signal = (name: NodeJS.Signals) => {
    try {
      if (process.platform !== "win32" && running.child.pid) {
        process.kill(-running.child.pid, name);
      } else {
        running.child.kill(name);
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
    }
  };
  const waitForClose = (timeoutMs: number) =>
    Promise.race([
      running.closed.then(() => true),
      sleep(timeoutMs).then(() => false),
    ]);

  if (running.isClosed()) return;
  signal("SIGTERM");
  if (await waitForClose(8_000)) return;
  signal("SIGKILL");
  if (!(await waitForClose(2_000))) {
    throw new Error("Dev server process tree did not close after SIGKILL");
  }
}

async function launchBrowser(): Promise<Browser> {
  const launchOptions = {
    headless: !headed,
    args: [
      "--use-fake-device-for-media-stream",
      "--use-fake-ui-for-media-stream",
    ],
  } as const;
  const channel =
    process.env.PLAYWRIGHT_CHANNEL ||
    (process.env.CI || process.env.GITHUB_ACTIONS ? undefined : "chrome");
  if (channel) {
    try {
      return await chromium.launch({ channel, ...launchOptions });
    } catch (channelError) {
      if (process.env.PLAYWRIGHT_CHANNEL) throw channelError;
      log(
        `Chrome channel launch failed (${channelError instanceof Error ? channelError.message.split("\n")[0] : String(channelError)}); using bundled Chromium`,
      );
    }
  }
  try {
    return await chromium.launch(launchOptions);
  } catch (bundledError) {
    throw new Error(
      [
        "Could not launch Playwright Chromium.",
        `Bundled Chromium error: ${
          bundledError instanceof Error
            ? bundledError.message.split("\n")[0]
            : String(bundledError)
        }`,
        headed ? MISSING_HEADED_BROWSER_HINT : MISSING_BROWSER_HINT,
      ].join("\n"),
    );
  }
}

function isNavigationContextError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return (
    message.includes("Execution context was destroyed") ||
    message.includes("context was destroyed") ||
    message.includes("net::ERR_ABORTED") ||
    message.includes("interrupted by another navigation")
  );
}

function isTransientDevServerError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return (
    isNavigationContextError(err) ||
    message.includes("Failed to fetch") ||
    message.includes("Vite environment") ||
    message.includes("HTTP 503") ||
    message.includes("HTTP 504")
  );
}

function isRetryableGotoError(message: string): boolean {
  return (
    message.includes("net::ERR_ABORTED") ||
    message.includes("Vite environment") ||
    message.includes("503") ||
    message.includes("interrupted by another navigation")
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
      if (!isTransientDevServerError(err) || attempt === attempts - 1)
        throw err;
      log(
        `${label} hit transient dev-server reload (attempt ${attempt + 1}/${attempts}), retrying…`,
      );
      await sleep(delayMs);
    }
  }
  throw lastError;
}

async function gotoCommitted(
  page: Page,
  url: string,
  waitUntil: "commit" | "domcontentloaded" = "commit",
): Promise<void> {
  const attempts = isCi ? 12 : 6;
  let lastError: unknown;
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      const response = await page.goto(url, { waitUntil, timeout: 90_000 });
      if (response) {
        const status = response.status();
        if (status === 503 || status === 504) {
          throw new Error(`HTTP ${status} while the Vite server is warming up`);
        }
        if (status === 500) {
          const body = await response.text();
          if (isTransientCommittedNavigationResponse(status, body)) {
            throw new Error(
              `HTTP ${status} while the Vite server is warming up`,
            );
          }
        }
      }
      return;
    } catch (err) {
      lastError = err;
      const message = err instanceof Error ? err.message : String(err);
      if (!isRetryableGotoError(message) || attempt === attempts - 1) throw err;

      // `/home` and `/` intentionally hand off to a durable `/chat/:threadId`
      // route after the client shell hydrates. Playwright reports the original
      // document navigation as aborted when that handoff wins the race; retrying
      // the source URL would reset ClientOnly back to its SSR fallback and can
      // keep the app stuck on "Churning" on a cold Vite graph.
      try {
        const current = new URL(page.url());
        const requested = new URL(url);
        if (
          current.origin === requested.origin &&
          (requested.pathname === "/" || requested.pathname === "/home") &&
          /^\/chat\/chat-[^/]+$/.test(current.pathname)
        ) {
          return;
        }
      } catch {
        // Keep the normal retry path when the browser has no committed URL.
      }

      if (isCi || verbose) {
        console.warn(
          `[standalone-dev-smoke] goto retry ${attempt + 1}/${attempts}: ${message.split("\n")[0]}`,
        );
      }
      await page.waitForTimeout(750 * (attempt + 1));
    }
  }
  throw lastError;
}

/**
 * Console/HTTP noise that is expected during dev warmup and therefore never
 * fails the smoke. It is still the most common explanation for a page that
 * renders blank (an outdated optimized dep 504s, so the app never mounts), so
 * keep the tail around to attach to readiness timeouts.
 */
const suppressedBrowserNoise: string[] = [];

function recordSuppressedNoise(entry: string): void {
  suppressedBrowserNoise.push(entry);
  if (suppressedBrowserNoise.length > 40) suppressedBrowserNoise.shift();
}

function suppressedNoiseBlock(): string {
  if (suppressedBrowserNoise.length === 0) return "";
  return `\nSuppressed browser noise:\n${suppressedBrowserNoise.join("\n")}`;
}

function discardSettledNavigationAborts(httpErrors: string[]): void {
  const retained: string[] = [];
  for (const error of httpErrors) {
    if (
      error.startsWith("requestfailed ") &&
      error.endsWith("net::ERR_ABORTED")
    ) {
      recordSuppressedNoise(`settled Vite navigation cancellation ${error}`);
      continue;
    }
    retained.push(error);
  }
  httpErrors.splice(0, httpErrors.length, ...retained);
}

function isBenignConsoleError(text: string): boolean {
  if (text.includes("favicon")) return true;
  // The response listener classifies these with the request URL and status;
  // Chromium's duplicate console message omits both pieces of evidence.
  if (
    text.startsWith(
      "Failed to load resource: the server responded with a status of",
    )
  ) {
    return true;
  }
  return false;
}

interface BrowserNetworkState {
  allowInitialEphemeralThread404: boolean;
  allowExpectedIncompleteStreamFailure: boolean;
  navigationCancellationUntil: number;
}

function isBenignHttpError(
  status: number,
  url: string,
  state: BrowserNetworkState,
): boolean {
  if (
    state.allowExpectedIncompleteStreamFailure &&
    status >= 500 &&
    url.includes("/_agent-native/agent-chat")
  ) {
    return true;
  }
  if (
    state.allowInitialEphemeralThread404 &&
    status === 404 &&
    url.includes("/_agent-native/agent-chat/threads/")
  ) {
    return true;
  }
  // Chat can request checkpoints for a client-created thread before its first
  // message persists that thread on the server.
  if (
    state.allowInitialEphemeralThread404 &&
    status === 404 &&
    url.includes("/_agent-native/agent-chat/checkpoints?")
  ) {
    return true;
  }
  // Nitro can briefly remount framework routes while Vite optimizes the first
  // browser dependency graph; waitForDevStable verifies this route is ready.
  if (status === 404 && url.includes("/_agent-native/speculation-rules.json")) {
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

async function waitForDurableChatRoute(
  page: Page,
  timeoutMs = shellTimeoutMs,
): Promise<string> {
  try {
    await page.waitForURL((url) => durableChatPathPattern.test(url.pathname), {
      timeout: timeoutMs,
    });
    return new URL(page.url()).pathname;
  } catch (err) {
    const bodyPreview = await page
      .locator("body")
      .innerText({ timeout: 5_000 })
      .catch((bodyError: unknown) => {
        const message =
          bodyError instanceof Error ? bodyError.message : String(bodyError);
        return `<unreadable: ${message.split("\n")[0]}>`;
      });
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(
      `Chat home handoff did not reach a durable thread within ${timeoutMs}ms: ${message}\n` +
        `Current URL: ${page.url()}\n` +
        `Body preview: ${bodyPreview.slice(0, 400)}`,
    );
  }
}

async function readAuthenticatedSessionEmail(
  page: Page,
  baseUrl: string,
): Promise<string> {
  const attempts = isCi ? 40 : 10;
  const delayMs = 1_500;
  let lastError: unknown;

  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      const response = await page
        .context()
        .request.get(`${baseUrl}/_agent-native/auth/session`, {
          headers: { Accept: "application/json" },
          timeout: 5_000,
        });
      const text = await response.text();
      const ok = apiResponseOk(response);
      const status = apiResponseStatus(response);
      if (!ok) {
        throw new Error(
          `session read failed with HTTP ${status}: ${text.slice(0, 200)}`,
        );
      }
      const session = text ? JSON.parse(text) : null;
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
    } catch (err) {
      lastError = err;
      const message = err instanceof Error ? err.message : String(err);
      const retryable =
        isTransientDevServerError(err) ||
        isRetryableSessionReadErrorMessage(message);
      if (!retryable || attempt === attempts - 1) throw err;
      log(
        `session read not ready (attempt ${attempt + 1}/${attempts}), retrying…`,
      );
      await sleep(delayMs);
    }
  }

  throw lastError;
}

/**
 * An empty preview is ambiguous: it means both "app rendered nothing" and "the
 * read raced a reload". Distinguish them so timeouts point at the right cause.
 */
async function readBodyPreview(page: Page): Promise<string> {
  try {
    return await page.locator("body").innerText({ timeout: 2_000 });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return `<unreadable: ${message.split("\n")[0]}>`;
  }
}

async function waitForChatPage(
  page: Page,
  running: RunningDev,
  path: string,
  browserErrors: string[],
  httpErrors: string[],
): Promise<void> {
  const deadline = Date.now() + (isCi ? 300_000 : 45_000);
  let lastError: unknown;
  let lastBody = "";
  let lastUrl = "";

  while (Date.now() < deadline) {
    try {
      await waitForViteDepsQuiet(running.viteReload, running.logs, {
        timeoutMs: 60_000,
      });
      const chat = page.locator("section.agentkit-chat");
      const modelButton = page.locator(
        '[data-agent-composer-slot="model-button"]',
      );
      await chat.waitFor({ state: "visible", timeout: 15_000 });
      await modelButton.waitFor({ state: "visible", timeout: 30_000 });
      await page.waitForLoadState("load", { timeout: 60_000 });
      await waitForViteDepsQuiet(running.viteReload, running.logs, {
        timeoutMs: 60_000,
      });
      await chat.waitFor({ state: "visible", timeout: 8_000 });
      await modelButton.waitFor({ state: "visible", timeout: 8_000 });
      await page.waitForLoadState("load", { timeout: 60_000 });
      discardSettledNavigationAborts(httpErrors);
      await waitForStableChatSurface(page);
      return;
    } catch (err) {
      lastError = err;
      lastBody = await readBodyPreview(page);
      lastUrl = page.url();
      if (Date.now() >= deadline) break;
      if (verbose || isCi) {
        const message = err instanceof Error ? err.message : String(err);
        console.warn(
          `[standalone-dev-smoke] ${path} not ready yet: ${message.split("\n")[0]}`,
        );
      }

      // The `/home` route hands off to a durable chat route with client-side
      // navigation. A matching durable URL can be committed before its lazy
      // route graph mounts, and a different durable URL can be the final
      // result when the handoff is replayed during dev hydration. Starting a
      // second page navigation here aborts the graph that would render Chat;
      // keep observing the browser's in-flight handoff instead.
      await sleep(2_000);
    }
  }

  const message =
    lastError instanceof Error ? lastError.message : String(lastError);
  throw new Error(
    `${path} did not render the Chat surface before timeout: ${message}\n` +
      `Last URL: ${lastUrl}\n` +
      `Body preview: ${lastBody.slice(0, 400)}` +
      suppressedNoiseBlock(),
  );
}

type ChatSurfaceState = {
  pathname: string;
  readyState: DocumentReadyState;
  chatRendered: boolean;
  chatEmpty: string | null;
  transcriptRendered: boolean;
  transcriptVisible: boolean;
  footerRendered: boolean;
  footerVisible: boolean;
  composerRendered: boolean;
  composerVisible: boolean;
};

async function readChatSurfaceState(page: Page): Promise<ChatSurfaceState> {
  return page.evaluate(() => {
    const chat = document.querySelector<HTMLElement>("section.agentkit-chat");
    const composer = document.querySelector<HTMLElement>(
      '.agentkit-composer[data-agent-composer-slot="root"]',
    );
    const transcript = document.querySelector<HTMLElement>(
      ".agentkit-transcript",
    );
    const footer = document.querySelector<HTMLElement>(".agentkit-chat-footer");
    const transcriptRect = transcript?.getBoundingClientRect();
    const footerRect = footer?.getBoundingClientRect();
    const composerRect = composer?.getBoundingClientRect();
    return {
      pathname: window.location.pathname,
      readyState: document.readyState,
      chatRendered: Boolean(chat?.isConnected),
      chatEmpty: chat?.dataset.empty ?? null,
      transcriptRendered: Boolean(transcript?.isConnected),
      transcriptVisible: Boolean(
        transcriptRect && transcriptRect.width > 0 && transcriptRect.height > 0,
      ),
      footerRendered: Boolean(footer?.isConnected),
      footerVisible: Boolean(
        footerRect && footerRect.width > 0 && footerRect.height > 0,
      ),
      composerRendered: Boolean(composer?.isConnected),
      composerVisible: Boolean(
        composerRect && composerRect.width > 0 && composerRect.height > 0,
      ),
    };
  });
}

async function waitForStableChatSurface(page: Page): Promise<void> {
  const timeoutMs = isCi ? 120_000 : 30_000;
  const deadline = Date.now() + timeoutMs;
  let lastState = "unreadable";

  while (Date.now() < deadline) {
    try {
      const candidate = await readChatSurfaceState(page);
      lastState = JSON.stringify(candidate);
      if (
        durableChatPathPattern.test(candidate.pathname) &&
        candidate.readyState === "complete" &&
        candidate.chatRendered &&
        candidate.transcriptRendered &&
        candidate.transcriptVisible &&
        candidate.footerRendered &&
        candidate.footerVisible &&
        candidate.composerRendered &&
        candidate.composerVisible
      ) {
        await sleep(500);
        const settled = await readChatSurfaceState(page);
        if (
          settled.pathname === candidate.pathname &&
          settled.readyState === candidate.readyState &&
          settled.chatRendered &&
          settled.transcriptRendered &&
          settled.transcriptVisible &&
          settled.footerRendered &&
          settled.footerVisible &&
          settled.composerRendered &&
          settled.composerVisible
        ) {
          return;
        }
        lastState = JSON.stringify(settled);
      }
    } catch (err) {
      if (!isNavigationContextError(err)) throw err;
    }
    await sleep(250);
  }

  throw new Error(
    `Chat surface did not remain stable within ${timeoutMs}ms (${lastState}).`,
  );
}

async function waitForAuthenticatedShell(
  page: Page,
  baseUrl: string,
  running: RunningDev,
): Promise<string> {
  const serverLogs = running.logs;

  log(`navigating to ${baseUrl}/home (auto-login path)`);
  await gotoCommitted(page, `${baseUrl}/home`);

  await waitForViteDepsQuiet(running.viteReload, serverLogs);
  const durableThreadPath = await waitForDurableChatRoute(page, shellTimeoutMs);
  assert.match(
    durableThreadPath,
    durableChatPathPattern,
    "authenticated Chat home should hand off to a durable Chat thread",
  );

  const sessionEmail = await readAuthenticatedSessionEmail(page, baseUrl);
  log(`authenticated session: ${sessionEmail}`);

  return durableThreadPath;
}

const helloPrompt =
  "Call the hello action with name AgentKit Browser, then report the greeting in streamed markdown.";
const approvalPrompt =
  "Call accept-agentkit-release with release agentkit-acceptance and wait for my approval.";
const queuedPrompt =
  "Queued follow-up: confirm production queue promotion in one sentence.";
const rejectedSteerPrompt =
  "Rejected steer: prove the queued message is restored before retry.";
const secondMarkdownPrompt =
  "Stream a second independent markdown response with a short checklist.";
const suggestionPrompt =
  "Summarize the accepted AgentKit release in one sentence.";
const incompleteRetryPrompt =
  "Fail this stream once, then recover cleanly when I retry.";
const helloToolCallId = "call_agentkit_hello";
const approvalToolCallId = "call_agentkit_approval";

interface LoopbackRequestRecord {
  prompt: string;
  toolNames: string[];
  toolResultIds: string[];
}

interface LoopbackProviderState {
  requests: LoopbackRequestRecord[];
  helloActionResults: string[];
  approvalActionResults: string[];
  markdownChunks: number;
  queuedPromptSeen: boolean;
  rejectedSteerPromptSeen: boolean;
  suggestionPromptSeen: boolean;
  incompleteAttempts: number;
  errors: string[];
}

interface RunningLoopbackProvider {
  baseUrl: string;
  state: LoopbackProviderState;
  close: () => Promise<void>;
}

function jsonRecord(value: unknown): Record<string, unknown> {
  assert.ok(
    value && typeof value === "object" && !Array.isArray(value),
    "expected a JSON object",
  );
  return value as Record<string, unknown>;
}

function contentText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((part) => {
      if (typeof part === "string") return part;
      if (!part || typeof part !== "object") return "";
      const record = part as Record<string, unknown>;
      return typeof record.text === "string"
        ? record.text
        : typeof record.content === "string"
          ? record.content
          : "";
    })
    .join("");
}

async function readJsonBody(
  request: IncomingMessage,
): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    assert.ok(size <= 1_000_000, "loopback provider request exceeded 1 MB");
    chunks.push(buffer);
  }
  return jsonRecord(JSON.parse(Buffer.concat(chunks).toString("utf8")));
}

function openAiChunk(
  requestNumber: number,
  delta: Record<string, unknown>,
  finishReason: "stop" | "tool_calls" | null = null,
): string {
  return `data: ${JSON.stringify({
    id: `chatcmpl-agentkit-${requestNumber}`,
    object: "chat.completion.chunk",
    created: 1_788_000_000,
    model: "agentkit-loopback",
    choices: [{ index: 0, delta, finish_reason: finishReason }],
  })}\n\n`;
}

async function streamTextResponse(
  response: ServerResponse,
  requestNumber: number,
  chunks: string[],
  state: LoopbackProviderState,
  delayMs = 80,
): Promise<void> {
  response.write(openAiChunk(requestNumber, { role: "assistant" }));
  for (const chunk of chunks) {
    response.write(openAiChunk(requestNumber, { content: chunk }));
    state.markdownChunks += 1;
    await sleep(delayMs);
  }
  response.write(openAiChunk(requestNumber, {}, "stop"));
  response.end("data: [DONE]\n\n");
}

async function streamToolCallResponse(
  response: ServerResponse,
  requestNumber: number,
  call: { id: string; name: string; arguments: Record<string, unknown> },
): Promise<void> {
  response.write(openAiChunk(requestNumber, { role: "assistant" }));
  response.write(
    openAiChunk(requestNumber, {
      tool_calls: [
        {
          index: 0,
          id: call.id,
          type: "function",
          function: {
            name: call.name,
            arguments: JSON.stringify(call.arguments),
          },
        },
      ],
    }),
  );
  response.write(openAiChunk(requestNumber, {}, "tool_calls"));
  response.end("data: [DONE]\n\n");
}

function originalUserPrompt(value: string): string {
  const frameworkSuffixes = [
    "\n\n<current-time>",
    "\n\n<current-screen>",
    "\n\nContinue from where you left off",
    "Approved. Go ahead and run the requested action.",
  ];
  const suffixIndexes = frameworkSuffixes
    .map((suffix) => value.indexOf(suffix))
    .filter((index) => index >= 0);
  const end =
    suffixIndexes.length > 0 ? Math.min(...suffixIndexes) : value.length;
  return value.slice(0, end).trim();
}

async function handleLoopbackCompletion(
  request: IncomingMessage,
  response: ServerResponse,
  state: LoopbackProviderState,
): Promise<void> {
  const body = await readJsonBody(request);
  const messages = Array.isArray(body.messages)
    ? body.messages.map((item) => jsonRecord(item))
    : [];
  const tools = Array.isArray(body.tools)
    ? body.tools.map((item) => jsonRecord(item))
    : [];
  const userMessages = messages.filter((item) => item.role === "user");
  const prompt = originalUserPrompt(contentText(userMessages.at(-1)?.content));
  const toolNames = tools.flatMap((item) => {
    const fn = item.function;
    if (!fn || typeof fn !== "object") return [];
    const name = (fn as Record<string, unknown>).name;
    return typeof name === "string" ? [name] : [];
  });
  const toolResults = messages.filter((item) => item.role === "tool");
  const toolResultIds = toolResults.flatMap((item) =>
    typeof item.tool_call_id === "string" ? [item.tool_call_id] : [],
  );
  state.requests.push({ prompt, toolNames, toolResultIds });
  const requestNumber = state.requests.length;
  log(
    `loopback request ${requestNumber}: prompt=${JSON.stringify(prompt)} tools=${toolNames.length} toolResults=${toolResultIds.length}`,
  );

  if (prompt === incompleteRetryPrompt) {
    const attempt = state.incompleteAttempts++;
    if (attempt === 0) {
      response.writeHead(200, {
        "cache-control": "no-cache",
        connection: "keep-alive",
        "content-type": "text/event-stream; charset=utf-8",
      });
      response.write(openAiChunk(requestNumber, { role: "assistant" }));
      response.write(
        openAiChunk(requestNumber, {
          content: "**This partial response must not survive retry",
        }),
      );
      await sleep(1_000);
      response.destroy(new Error("Deterministic incomplete provider stream"));
      return;
    }
    if (attempt === 1) {
      response.writeHead(400, { "content-type": "application/json" });
      response.end(
        JSON.stringify({
          error: {
            message: "Deterministic non-retryable provider rejection",
            type: "invalid_request_error",
          },
        }),
      );
      return;
    }
  }

  response.writeHead(200, {
    "cache-control": "no-cache",
    connection: "keep-alive",
    "content-type": "text/event-stream; charset=utf-8",
  });

  if (prompt === helloPrompt) {
    assert.ok(toolNames.includes("hello"), "generated app must expose hello");
    const result = toolResults.find(
      (item) => item.tool_call_id === helloToolCallId,
    );
    if (!result) {
      await streamToolCallResponse(response, requestNumber, {
        id: helloToolCallId,
        name: "hello",
        arguments: { name: "AgentKit Browser" },
      });
      return;
    }
    const text = contentText(result.content);
    state.helloActionResults.push(text);
    assert.match(text, /Hello, AgentKit Browser!/u);
    await streamTextResponse(
      response,
      requestNumber,
      [
        "### Loopback complete\n\n**Hello, AgentKit Browser!",
        "** streamed through AgentKit.",
      ],
      state,
      1_000,
    );
    return;
  }

  if (prompt === approvalPrompt) {
    assert.ok(
      toolNames.includes("accept-agentkit-release"),
      "generated app must expose the approval fixture action",
    );
    const result = toolResults.find(
      (item) => item.tool_call_id === approvalToolCallId,
    );
    if (!result) {
      await streamToolCallResponse(response, requestNumber, {
        id: approvalToolCallId,
        name: "accept-agentkit-release",
        arguments: { release: "agentkit-acceptance" },
      });
      return;
    }
    const text = contentText(result.content);
    state.approvalActionResults.push(text);
    assert.match(text, /agentkit-acceptance/u);
    await streamTextResponse(
      response,
      requestNumber,
      ["**Approval continuation", " completed.**"],
      state,
    );
    return;
  }

  if (prompt === queuedPrompt) {
    state.queuedPromptSeen = true;
    await streamTextResponse(
      response,
      requestNumber,
      ["Queued follow-up completed ", "through the production queue."],
      state,
    );
    return;
  }

  if (prompt === rejectedSteerPrompt) {
    state.rejectedSteerPromptSeen = true;
    await streamTextResponse(
      response,
      requestNumber,
      ["Queue rollback preserved the exact prompt, ", "then steering retried."],
      state,
    );
    return;
  }

  if (prompt === secondMarkdownPrompt) {
    await streamTextResponse(
      response,
      requestNumber,
      ["### Second response\n\n", "- independent\n", "- **buffered**"],
      state,
      1_000,
    );
    return;
  }

  if (prompt === suggestionPrompt) {
    state.suggestionPromptSeen = true;
    await streamTextResponse(
      response,
      requestNumber,
      ["The AgentKit release is ready for focused framework review."],
      state,
    );
    return;
  }

  if (prompt === incompleteRetryPrompt) {
    await streamTextResponse(
      response,
      requestNumber,
      ["**Recovered cleanly** ", "after the incomplete stream."],
      state,
    );
    return;
  }

  throw new Error(`Unexpected loopback prompt: ${JSON.stringify(prompt)}`);
}

async function startLoopbackProvider(): Promise<RunningLoopbackProvider> {
  const state: LoopbackProviderState = {
    requests: [],
    helloActionResults: [],
    approvalActionResults: [],
    markdownChunks: 0,
    queuedPromptSeen: false,
    rejectedSteerPromptSeen: false,
    suggestionPromptSeen: false,
    incompleteAttempts: 0,
    errors: [],
  };
  const server = createServer((request, response) => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    if (request.method === "GET" && url.pathname === "/v1/models") {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(
        JSON.stringify({
          object: "list",
          data: [{ id: "agentkit-loopback", object: "model" }],
        }),
      );
      return;
    }
    if (request.method === "POST" && url.pathname === "/v1/chat/completions") {
      void handleLoopbackCompletion(request, response, state).catch((error) => {
        const message = error instanceof Error ? error.message : String(error);
        state.errors.push(message);
        if (!response.headersSent) {
          response.writeHead(500, { "content-type": "application/json" });
        }
        response.end(JSON.stringify({ error: { message } }));
      });
      return;
    }
    const message = `Unexpected loopback request: ${request.method} ${url.pathname}`;
    state.errors.push(message);
    response.writeHead(404, { "content-type": "application/json" });
    response.end(JSON.stringify({ error: { message } }));
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const address = server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${address.port}/v1`;
  log(`loopback provider listening at ${baseUrl}`);
  return {
    baseUrl,
    state,
    close: () =>
      new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      ),
  };
}

async function fillAndSubmitComposer(page: Page, text: string): Promise<void> {
  await waitForStableChatSurface(page);
  await retryAfterNavigation("prepare composer", async () => {
    await page.evaluate((value) => {
      const node = document.querySelector<HTMLElement>(
        '[data-agent-composer-slot="editor-input"]',
      );
      if (!node?.isConnected) {
        throw new Error("Chat composer is not mounted");
      }
      node.focus();
      const selection = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(node);
      range.collapse(false);
      selection?.removeAllRanges();
      selection?.addRange(range);
      if (!document.execCommand("insertText", false, value)) {
        throw new Error("Could not insert text into the Chat composer");
      }
    }, text);
  });
  await page.keyboard.press("Enter");
  await retryAfterNavigation("confirm composer submission", () =>
    page.waitForFunction(() => {
      const editor = document.querySelector(
        '[data-agent-composer-slot="editor-input"]',
      );
      return (editor?.textContent ?? "").trim() === "";
    }),
  );
}

async function assertComposerFocused(page: Page): Promise<void> {
  await page.waitForFunction(() => {
    const active = document.activeElement;
    return Boolean(
      active?.matches('[data-agent-composer-slot="editor-input"]') ||
      active?.closest('[data-agent-composer-slot="editor-input"]'),
    );
  });
}

async function waitForChatText(
  page: Page,
  expected: string,
  timeoutMs = 30_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastError = "";
  while (Date.now() < deadline) {
    try {
      if (
        await page.evaluate(
          (value) => document.body?.innerText.includes(value) ?? false,
          expected,
        )
      ) {
        return;
      }
    } catch (err) {
      if (!isNavigationContextError(err)) throw err;
      lastError = err instanceof Error ? err.message : String(err);
    }
    await sleep(250);
  }
  throw new Error(
    `Chat text ${JSON.stringify(expected)} did not render within ${timeoutMs}ms` +
      (lastError ? ` (${lastError})` : "."),
  );
}

async function waitForLoopbackState(
  label: string,
  predicate: () => boolean | Promise<boolean>,
  timeoutMs = 15_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await sleep(25);
  }
  throw new Error(
    `Loopback provider did not observe ${label} within ${timeoutMs}ms.`,
  );
}

async function setDarkMode(page: Page, enabled: boolean): Promise<void> {
  const theme = enabled ? "dark" : "light";
  await page.evaluate((nextTheme) => {
    window.dispatchEvent(
      new CustomEvent("agent-native:theme-change", {
        detail: {
          type: "agent-native:theme-change",
          theme: nextTheme,
        },
      }),
    );
  }, theme);
  await page.waitForFunction(
    (nextTheme) =>
      document.documentElement.classList.contains(nextTheme) &&
      document.documentElement.dataset.theme === nextTheme,
    theme,
  );
}

type LayoutBox = {
  x: number;
  y: number;
  width: number;
  height: number;
};

async function waitForChatLayoutBoxes(
  page: Page,
): Promise<{ chatBox: LayoutBox; composerBox: LayoutBox }> {
  const deadline = Date.now() + (isCi ? 120_000 : 30_000);
  let lastBoxes: string = "chat=null composer=null";

  while (Date.now() < deadline) {
    try {
      const boxes = await page.evaluate(() => {
        const chatNode = document.querySelector<HTMLElement>(
          "section.agentkit-chat",
        );
        const composerNode = document.querySelector<HTMLElement>(
          '.agentkit-composer[data-agent-composer-slot="root"]',
        );
        const chatRect = chatNode?.getBoundingClientRect();
        const composerRect = composerNode?.getBoundingClientRect();
        return {
          chatBox: chatRect
            ? {
                x: chatRect.x,
                y: chatRect.y,
                width: chatRect.width,
                height: chatRect.height,
              }
            : null,
          composerBox: composerRect
            ? {
                x: composerRect.x,
                y: composerRect.y,
                width: composerRect.width,
                height: composerRect.height,
              }
            : null,
        };
      });
      const { chatBox, composerBox } = boxes;
      lastBoxes = `chat=${JSON.stringify(chatBox)} composer=${JSON.stringify(composerBox)}`;
      if (
        chatBox &&
        composerBox &&
        chatBox.width > 0 &&
        chatBox.height > 0 &&
        composerBox.width > 0 &&
        composerBox.height > 0
      ) {
        return { chatBox, composerBox };
      }
    } catch (err) {
      if (!isNavigationContextError(err)) throw err;
    }
    await sleep(500);
  }

  throw new Error(
    `Chat layout did not settle within ${isCi ? 120_000 : 30_000}ms (${lastBoxes}).`,
  );
}

async function assertViewportContract(
  page: Page,
  label: string,
  options: { dark: boolean },
): Promise<void> {
  const readMetrics = () =>
    page.evaluate(() => {
      const transcript = document.querySelector<HTMLElement>(
        ".agentkit-transcript",
      );
      const footer = document.querySelector<HTMLElement>(
        ".agentkit-chat-footer",
      );
      const composer =
        document.querySelector<HTMLElement>(".agentkit-composer");
      if (!transcript || !footer || !composer) return null;
      const transcriptRect = transcript.getBoundingClientRect();
      const footerRect = footer.getBoundingClientRect();
      const composerStyle = getComputedStyle(composer);
      const composerBorderChannels = composerStyle.borderColor
        .match(/\d+(?:\.\d+)?/gu)
        ?.map(Number);
      const layoutGeometry: Array<Record<string, string | number | boolean>> =
        [];
      for (const selector of [
        ".agent-layout-shell",
        ".agent-layout-main-surface",
        ".agent-native-app-main",
        ".agent-kit-chat-canvas-body",
        ".agentkit-chat",
        ".agentkit-chat-footer",
        ".agentkit-composer-stack",
        '[data-agent-composer-slot="area"]',
        '[data-agent-composer-slot="root"]',
        '[data-agent-composer-slot="toolbar"]',
        '[data-agent-composer-slot="toolbar-spacer"]',
      ]) {
        const node = document.querySelector<HTMLElement>(selector);
        if (!node) {
          layoutGeometry.push({ selector, missing: true });
          continue;
        }
        const rect = node.getBoundingClientRect();
        const style = getComputedStyle(node);
        layoutGeometry.push({
          selector,
          left: Math.round(rect.left),
          right: Math.round(rect.right),
          width: Math.round(rect.width),
          minWidth: style.minWidth,
          overflow: style.overflow,
        });
      }
      return {
        documentOverflow:
          document.documentElement.scrollWidth -
          document.documentElement.clientWidth,
        transcriptBottom: transcriptRect.bottom,
        footerTop: footerRect.top,
        footerBottom: footerRect.bottom,
        viewportHeight: window.innerHeight,
        composerBorder: composerStyle.borderColor,
        composerBorderHasLightRim:
          composerBorderChannels !== undefined &&
          composerBorderChannels.length >= 3 &&
          composerBorderChannels
            .slice(0, 3)
            .every((channel) => channel >= 160) &&
          (composerBorderChannels[3] ?? 1) > 0.01,
        composerShadow: composerStyle.boxShadow,
        layoutGeometry,
        controlGeometry: [
          "plus-button",
          "model-button",
          "mode-button",
          "voice-button",
          "send-button",
        ].map((slot) => {
          const node = document.querySelector<HTMLElement>(
            `[data-agent-composer-slot="${slot}"]`,
          );
          if (!node) return { slot, visible: false, missing: true };
          const rect = node.getBoundingClientRect();
          const style = getComputedStyle(node);
          return {
            slot,
            visible:
              style.display !== "none" &&
              style.visibility !== "hidden" &&
              rect.width > 0 &&
              rect.left >= -1 &&
              rect.right <= window.innerWidth + 1,
            left: Math.round(rect.left),
            right: Math.round(rect.right),
            width: Math.round(rect.width),
            display: style.display,
            visibility: style.visibility,
          };
        }),
      };
    });
  let metrics: Awaited<ReturnType<typeof readMetrics>> | null = null;
  const deadline = Date.now() + (isCi ? 120_000 : 30_000);
  let lastReadError = "";
  while (Date.now() < deadline) {
    try {
      metrics = await readMetrics();
      if (metrics) break;
    } catch (err) {
      if (!isNavigationContextError(err)) throw err;
      lastReadError = err instanceof Error ? err.message : String(err);
    }
    await sleep(250);
  }
  if (!metrics) {
    throw new Error(
      `${label}: required chat geometry did not settle within ${isCi ? 120_000 : 30_000}ms` +
        (lastReadError ? ` (${lastReadError})` : "."),
    );
  }
  assert.ok(
    metrics.documentOverflow <= 1,
    `${label}: horizontal overflow was ${metrics.documentOverflow}px`,
  );
  assert.ok(
    metrics.transcriptBottom <= metrics.footerTop + 1,
    `${label}: transcript must stop above the composer footer`,
  );
  assert.ok(
    metrics.footerBottom <= metrics.viewportHeight + 1,
    `${label}: composer footer must remain inside the viewport`,
  );
  const visibleControls = metrics.controlGeometry
    .filter((control) => control.visible)
    .map((control) => control.slot)
    .sort();
  assert.deepEqual(
    visibleControls,
    [
      "mode-button",
      "model-button",
      "plus-button",
      "send-button",
      "voice-button",
    ],
    `${label}: every composer control must remain reachable (${JSON.stringify({ controls: metrics.controlGeometry, layout: metrics.layoutGeometry })})`,
  );
  if (options.dark) {
    const lightChannel =
      /rgba?\(\s*(?:1[6-9]\d|2\d\d)\s*,\s*(?:1[6-9]\d|2\d\d)\s*,\s*(?:1[6-9]\d|2\d\d)/u;
    assert.doesNotMatch(
      metrics.composerShadow,
      lightChannel,
      `${label}: dark elevation must not use a light shadow`,
    );
    assert.equal(
      metrics.composerBorderHasLightRim,
      false,
      `${label}: dark composer border must not render a light rim (${metrics.composerBorder})`,
    );
  }
}

async function readPersistedFeedback(
  page: Page,
): Promise<Array<Record<string, unknown>>> {
  return page.evaluate(async () => {
    const response = await fetch(
      "/_agent-native/observability/feedback?feedbackType=thumbs_up&limit=50",
    );
    if (!response.ok) {
      throw new Error(`feedback read failed with ${response.status}`);
    }
    const payload: unknown = await response.json();
    if (!Array.isArray(payload)) {
      throw new Error("feedback read did not return an array");
    }
    return payload as Array<Record<string, unknown>>;
  });
}

async function assertAgentKitChatAcceptance(
  page: Page,
  provider: LoopbackProviderState,
  network: BrowserNetworkState,
): Promise<void> {
  const chat = page.locator("section.agentkit-chat");
  const transcript = page.locator(".agentkit-transcript");
  const footer = page.locator(".agentkit-chat-footer");
  const composer = page.locator(
    '.agentkit-composer[data-agent-composer-slot="root"]',
  );

  await chat.waitFor({ state: "visible" });
  assert.equal(await chat.getAttribute("data-empty"), "true");
  assert.equal(await page.locator(".agentkit-chat-header").count(), 0);
  await transcript.waitFor({ state: "visible" });
  await footer.waitFor({ state: "visible" });
  await composer.waitFor({ state: "visible" });
  assert.equal(
    await page.locator(".agentkit-suggestions").count(),
    0,
    "suggestions must not render before the agent publishes them",
  );

  for (const slot of [
    "editor-input",
    "toolbar",
    "plus-button",
    "model-button",
    "mode-button",
    "voice-button",
    "send-button",
  ]) {
    await page
      .locator(`[data-agent-composer-slot="${slot}"]`)
      .waitFor({ state: "visible" });
  }

  const { chatBox, composerBox } = await waitForChatLayoutBoxes(page);
  assert.ok(
    composerBox.width >= 480,
    `new-chat composer must retain its full layout (${composerBox.width}px)`,
  );
  assert.ok(
    composerBox.x > chatBox.x &&
      composerBox.x + composerBox.width < chatBox.x + chatBox.width,
    "new-chat composer must remain centered inside the chat canvas",
  );
  await retryAfterNavigation("set initial light theme", () =>
    setDarkMode(page, false),
  );
  await assertViewportContract(page, "desktop light empty chat", {
    dark: false,
  });

  await fillAndSubmitComposer(page, helloPrompt);
  await waitForLoopbackState(
    "the initial provider request",
    () => provider.requests.length >= 1,
    30_000,
  );
  network.allowInitialEphemeralThread404 = false;
  await waitForStableChatSurface(page);
  const threadUrl = page.url();
  const threadPath = new URL(threadUrl).pathname;
  await waitForChatText(page, "Loopback complete");
  await waitForChatText(page, "Hello, AgentKit Browser!");
  assert.equal(
    await page
      .locator(".agentkit-message-content strong")
      .filter({ hasText: "Hello, AgentKit Browser!" })
      .count(),
    0,
    "partial markdown must render without prematurely completing bold syntax",
  );
  await page
    .locator(".agentkit-message-content strong")
    .filter({ hasText: "Hello, AgentKit Browser!" })
    .waitFor({ state: "visible" });
  const suggestion = page.getByRole("button", {
    name: "Summarize this release",
  });
  await suggestion.waitFor({ state: "visible" });
  await assertComposerFocused(page);
  const helloActivity = page.locator(".agentkit-activities-summary").first();
  await helloActivity.waitFor({ state: "visible" });
  assert.match(
    ((await helloActivity.textContent()) ?? "").trim(),
    /^Worked(?: for .+)?$/u,
    "completed activity must transition from Working to Worked",
  );
  await helloActivity.click();
  await page
    .locator(".agentkit-activity-label")
    .filter({ hasText: /^Hello$/u })
    .waitFor({ state: "visible" });
  await waitForLoopbackState(
    "the real hello action result",
    () => provider.helloActionResults.length === 1,
  );
  assert.equal(
    new URL(page.url()).pathname,
    threadPath,
    "stream completion must preserve the active thread route",
  );

  const helloMessage = page
    .locator('.agentkit-message[data-role="assistant"]')
    .filter({ hasText: "Hello, AgentKit Browser!" });
  const helloMatches = await helloMessage.evaluateAll((messages) =>
    messages.map((message) => ({
      id: message.getAttribute("data-message-id"),
      text: message.textContent,
    })),
  );
  assert.equal(
    helloMatches.length,
    1,
    `stream reconciliation must leave one assistant response: ${JSON.stringify(helloMatches)}`,
  );
  await helloMessage.hover();
  await helloMessage
    .getByRole("button", { name: "Helpful", exact: true })
    .click();
  await waitForLoopbackState(
    "persisted thumbs-up feedback",
    async () => (await readPersistedFeedback(page)).length > 0,
  );

  await suggestion.click();
  await waitForLoopbackState(
    "agent-authored suggestion submission",
    () => provider.suggestionPromptSeen,
  );
  await page
    .getByText("The AgentKit release is ready for focused framework review.", {
      exact: true,
    })
    .waitFor({ state: "visible" });
  await assertComposerFocused(page);

  await helloMessage.getByRole("button", { name: "Fork conversation" }).click();
  await Promise.race([
    page.waitForURL(
      (url) => url.pathname !== threadPath && url.pathname.startsWith("/chat/"),
    ),
    page
      .locator(".agentkit-command-error")
      .waitFor({ state: "visible" })
      .then(async () => {
        throw new Error(
          `Fork failed in the rendered AgentKit action: ${await page.locator(".agentkit-command-error").innerText()}`,
        );
      }),
  ]);
  const forkPath = new URL(page.url()).pathname;
  assert.notEqual(forkPath, threadPath, "fork must navigate to a new thread");
  await page.goto(threadUrl, { waitUntil: "domcontentloaded" });
  await composer.waitFor({ state: "visible" });

  await fillAndSubmitComposer(page, secondMarkdownPrompt);
  await page
    .getByRole("heading", { name: "Second response" })
    .waitFor({ state: "visible" });
  assert.equal(
    await page
      .locator(".agentkit-message-content strong")
      .filter({ hasText: "buffered" })
      .count(),
    0,
    "the second response must expose an independently buffered intermediate state",
  );
  await page
    .locator(".agentkit-message-content strong")
    .filter({ hasText: "buffered" })
    .waitFor({ state: "visible" });
  await page
    .locator(".agentkit-message-content strong")
    .filter({ hasText: "Hello, AgentKit Browser!" })
    .waitFor({ state: "visible" });

  await setDarkMode(page, true);
  await assertViewportContract(page, "desktop dark conversation", {
    dark: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await assertViewportContract(page, "narrow dark conversation", {
    dark: true,
  });

  await fillAndSubmitComposer(page, approvalPrompt);
  const approval = page.locator(".agentkit-approval");
  await approval.waitFor({ state: "visible" });
  await approval.getByRole("button", { name: "Approve" }).waitFor({
    state: "visible",
  });
  await assertViewportContract(page, "narrow dark approval", { dark: true });
  await assertComposerFocused(page);

  await fillAndSubmitComposer(page, queuedPrompt);
  const queue = page.getByRole("region", { name: "Queued messages" });
  await queue.waitFor({ state: "visible" });
  await queue.getByText(queuedPrompt, { exact: true }).waitFor({
    state: "visible",
  });
  await assertViewportContract(page, "narrow dark queue", { dark: true });
  await assertComposerFocused(page);

  await approval.getByRole("button", { name: "Approve" }).click();
  await page
    .locator(".agentkit-message-content strong")
    .filter({ hasText: "Approval continuation completed." })
    .last()
    .waitFor({ state: "visible" });
  await approval.waitFor({ state: "detached" });
  await page
    .getByText("Queued follow-up completed through the production queue.", {
      exact: true,
    })
    .waitFor({ state: "visible" });
  await queue.waitFor({ state: "hidden" });
  await assertComposerFocused(page);
  await waitForLoopbackState(
    "approval action continuation",
    () => provider.approvalActionResults.length === 1,
  );
  await waitForLoopbackState(
    "automatic queue promotion",
    () => provider.queuedPromptSeen,
  );
  assert.equal(
    new URL(page.url()).pathname,
    threadPath,
    "approval and queue continuation must preserve the active thread route",
  );

  network.allowExpectedIncompleteStreamFailure = true;
  await fillAndSubmitComposer(page, incompleteRetryPrompt);
  await page
    .getByText("This partial response must not survive retry", { exact: false })
    .waitFor({ state: "visible" });
  await fillAndSubmitComposer(page, rejectedSteerPrompt);
  await queue.getByText(rejectedSteerPrompt, { exact: true }).waitFor({
    state: "visible",
  });
  await page.locator(".agentkit-run-failure").waitFor({ state: "visible" });
  network.allowExpectedIncompleteStreamFailure = false;
  await approval.waitFor({ state: "detached" });
  await queue
    .getByRole("button", { name: /Steer/u })
    .waitFor({ state: "visible" });
  const steer = queue.getByRole("button", { name: /Steer/u });
  await steer.click();
  await page
    .getByRole("alert")
    .filter({ hasText: "Deterministic queue steering rejection" })
    .waitFor({ state: "visible" });
  await queue.getByText(rejectedSteerPrompt, { exact: true }).waitFor({
    state: "visible",
  });
  assert.equal(
    provider.rejectedSteerPromptSeen,
    false,
    "rejected steering must not submit the prompt to the provider",
  );

  await steer.click();
  await waitForLoopbackState(
    "the exact manually steered prompt",
    () => provider.rejectedSteerPromptSeen,
  );
  assert.equal(
    provider.requests.filter(
      (request) => request.prompt === rejectedSteerPrompt,
    ).length,
    1,
    "manual steering must submit the exact queued prompt once after rollback",
  );
  await page
    .getByText(
      "Queue rollback preserved the exact prompt, then steering retried.",
      { exact: true },
    )
    .waitFor({ state: "visible" });
  await queue.getByText(rejectedSteerPrompt, { exact: true }).waitFor({
    state: "detached",
  });

  await fillAndSubmitComposer(page, incompleteRetryPrompt);
  await page
    .locator(".agentkit-message-content strong")
    .filter({ hasText: "Recovered cleanly" })
    .waitFor({ state: "visible" });
  assert.equal(
    provider.incompleteAttempts,
    3,
    "the incomplete stream must be retried exactly once without reload",
  );
  assert.equal(
    await page.locator(".agentkit-approval").count(),
    0,
    "recovery must not leave stale human-review state",
  );
  assert.equal(
    await queue.getByText(rejectedSteerPrompt, { exact: true }).count(),
    0,
    "recovery must not leave the promoted queue item behind",
  );
  await assertComposerFocused(page);

  await page.setViewportSize({ width: 1280, height: 900 });
  await setDarkMode(page, false);

  const transcriptBox = await transcript.boundingBox();
  const footerBox = await footer.boundingBox();
  assert.ok(
    transcriptBox && footerBox,
    "transcript and composer footer require layout boxes",
  );
  assert.ok(
    transcriptBox.y + transcriptBox.height <= footerBox.y + 1,
    "the transcript scroll region must stop above the composer footer",
  );
  assert.ok(
    (await page
      .locator('.agentkit-message-content [data-format="markdown"]')
      .count()) >= 3,
    "streamed assistant messages must retain rich markdown parts",
  );

  await page.reload({ waitUntil: "domcontentloaded" });
  await chat.waitFor({ state: "visible" });
  await composer.waitFor({ state: "visible" });
  assert.equal(
    new URL(page.url()).pathname,
    threadPath,
    "reload must preserve the active thread route",
  );
  await page
    .getByRole("heading", { name: "Loopback complete" })
    .waitFor({ state: "visible" });
  assert.ok(
    (await readPersistedFeedback(page)).some(
      (entry) => entry.threadId === threadPath.slice("/chat/".length),
    ),
    "thumbs-up feedback must remain persisted after reload",
  );
  await page
    .locator(".agentkit-message-content strong")
    .filter({ hasText: "Hello, AgentKit Browser!" })
    .waitFor({ state: "visible" });
  await page
    .locator(".agentkit-message-content strong")
    .filter({ hasText: "Approval continuation completed." })
    .last()
    .waitFor({ state: "visible" });
  await page
    .getByText("Queued follow-up completed through the production queue.", {
      exact: true,
    })
    .waitFor({ state: "visible" });
  assert.ok(
    (await page
      .locator('.agentkit-message-content [data-format="markdown"]')
      .count()) >= 3,
    "reload must reconstruct rich markdown history from production persistence",
  );
  await assertComposerFocused(page);
  await assertViewportContract(page, "desktop light persisted conversation", {
    dark: false,
  });

  fs.mkdirSync(path.join(repoRoot, ".tmp"), { recursive: true });
  await page.screenshot({
    path: path.join(repoRoot, ".tmp", "agentkit-chat-acceptance.png"),
    fullPage: false,
  });
}

async function runBrowserSmoke(
  page: Page,
  running: RunningDev,
  provider: LoopbackProviderState,
  network: BrowserNetworkState,
  browserErrors: string[],
  httpErrors: string[],
): Promise<void> {
  const baseUrl = running.baseUrl;
  // Warmup covers `/home` auto-login and the authenticated Chat handoff.
  log("warmup: auto-login, Vite dep quiet, authenticated /home");
  const durableThreadPath = await waitForAuthenticatedShell(
    page,
    baseUrl,
    running,
  );
  assert.match(
    durableThreadPath,
    durableChatPathPattern,
    "authenticated warmup must establish a durable Chat thread",
  );

  log("assertion pass: durable Chat surface after authenticated handoff");
  await waitForChatPage(
    page,
    running,
    durableThreadPath,
    browserErrors,
    httpErrors,
  );

  log("acceptance: real AgentKit loopback lifecycle");
  await assertAgentKitChatAcceptance(page, provider, network);
  log("acceptance pass: real AgentKit loopback lifecycle");
  assert.ok(
    provider.requests.length >= 10,
    "acceptance must exercise tools, rich streaming, suggestions, approval, queue promotion, steering, and recovery",
  );
  assert.equal(provider.helloActionResults.length, 1);
  assert.equal(provider.approvalActionResults.length, 1);
  assert.ok(
    provider.markdownChunks >= 7,
    "loopback provider must stream multiple markdown chunks per response",
  );
  assert.equal(provider.queuedPromptSeen, true);
  assert.equal(provider.rejectedSteerPromptSeen, true);
  assert.equal(provider.suggestionPromptSeen, true);
  assert.equal(provider.incompleteAttempts, 3);
  assert.deepEqual(provider.errors, [], "loopback provider runtime errors");

  assert.deepEqual(browserErrors, [], "browser console/page errors on Chat");
  discardSettledNavigationAborts(httpErrors);
  assert.deepEqual(httpErrors, [], "browser HTTP errors on Chat");
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
  if (text.includes(nitroUnavailableConsoleLine)) {
    offenders.push("Nitro environment unavailable");
  }
  if (text.includes("optimized dependencies changed")) {
    offenders.push("late Vite dependency optimization");
  }
  if (hasAuthLockFailure(logs))
    offenders.push("auth init failure (app locked)");
  const exceptionLines = text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) =>
      /(?:^|\s)(?:Error|Exception|TypeError|ReferenceError|SyntaxError):|UnhandledPromiseRejection|\bHTTP 5\d\d\b/u.test(
        line,
      ),
    )
    .filter(
      (line) =>
        !line.includes(nitroUnavailableConsoleLine) &&
        !line.includes("Deterministic incomplete provider stream") &&
        !line.includes("Vite environment"),
    );
  offenders.push(...exceptionLines.slice(0, 12));
  assert.deepEqual(
    offenders,
    [],
    `dev server logs contained SSR errors: ${offenders.join(", ")}`,
  );
}

async function main(): Promise<void> {
  if (!skipScaffold) {
    scaffoldStandaloneChat();
    installApprovalActionFixture();
    installAcceptanceTransportFixture();
    await installApp();
    assertStandalonePackageJson();
  } else {
    assert.equal(
      fs.existsSync(path.join(appDir, "package.json")),
      true,
      `STANDALONE_CHAT_DEV_SMOKE_SKIP_CREATE=1 requires ${appDir}/package.json`,
    );
    installApprovalActionFixture();
    installAcceptanceTransportFixture();
  }

  const provider = await startLoopbackProvider();
  let running: RunningDev;
  try {
    running = await startDev(provider.baseUrl);
  } catch (error) {
    await provider.close();
    throw error;
  }
  let browser: Browser | null = null;
  let primaryError: Error | null = null;
  let cleanupError: unknown;
  const browserErrors: string[] = [];
  const httpErrors: string[] = [];
  const network: BrowserNetworkState = {
    allowInitialEphemeralThread404: true,
    allowExpectedIncompleteStreamFailure: false,
    navigationCancellationUntil: 0,
  };

  const captureCleanupError = (error: unknown) => {
    const message =
      error instanceof Error ? error.stack || error.message : String(error);
    if (primaryError) {
      primaryError.message += `\n\nCleanup error:\n${message}`;
      return;
    }
    cleanupError ??= error;
  };

  try {
    browser = await launchBrowser();
    const context = await browser.newContext({
      viewport: { width: 1280, height: 900 },
      permissions: ["microphone"],
    });
    const page = await context.newPage();

    page.on("framenavigated", (frame) => {
      if (frame === page.mainFrame()) {
        network.navigationCancellationUntil = Date.now() + 2_000;
      }
    });

    page.on("pageerror", (error) => browserErrors.push(error.message));
    page.on("console", (message) => {
      if (message.type() !== "error") return;
      const text = message.text();
      if (isBenignConsoleError(text)) {
        recordSuppressedNoise(text);
        return;
      }
      browserErrors.push(text);
    });
    page.on("requestfailed", (request) => {
      const url = request.url();
      if (!url.startsWith(running.baseUrl)) return;
      if (
        new URL(url).pathname === "/_agent-native/agent-chat/runs/active" &&
        request.method() === "GET" &&
        request.failure()?.errorText === "net::ERR_ABORTED"
      ) {
        recordSuppressedNoise(
          `expected active-run read cancellation ${request.method()} ${url}`,
        );
        return;
      }
      if (
        new URL(url).pathname === "/_agent-native/events" &&
        request.method() === "GET" &&
        request.failure()?.errorText === "net::ERR_ABORTED"
      ) {
        recordSuppressedNoise(
          `expected event-stream cancellation ${request.method()} ${url}`,
        );
        return;
      }
      if (
        request.failure()?.errorText === "net::ERR_ABORTED" &&
        Date.now() <= network.navigationCancellationUntil
      ) {
        recordSuppressedNoise(
          `expected navigation cancellation ${request.method()} ${url}`,
        );
        return;
      }
      if (
        network.allowExpectedIncompleteStreamFailure &&
        url.includes("/_agent-native/agent-chat")
      ) {
        recordSuppressedNoise(
          `expected requestfailed ${request.method()} ${url}: ${request.failure()?.errorText ?? "unknown failure"}`,
        );
        return;
      }
      httpErrors.push(
        `requestfailed ${request.method()} ${url}: ${request.failure()?.errorText ?? "unknown failure"}`,
      );
    });
    page.on("response", (response) => {
      const status = response.status();
      if (status < 400) return;
      const url = response.url();
      if (!url.startsWith(running.baseUrl)) return;
      if (isBenignHttpError(status, url, network)) {
        recordSuppressedNoise(`${status} ${url}`);
        return;
      }
      httpErrors.push(`${status} ${url}`);
    });

    await runBrowserSmoke(
      page,
      running,
      provider.state,
      network,
      browserErrors,
      httpErrors,
    );
    assertCleanServerLogs(running.logs);

    console.log("qa-standalone-chat-dev-smoke: clean");
    console.log(`  url:      ${running.baseUrl}`);
    console.log(`  app:      ${appDir}`);
    console.log(
      "  checked:  scaffold → install → dev server → /home auth → Chat handoff → durable Chat thread",
    );
    console.log(
      "  checked:  unauthenticated startup poll recovers to HTTP 401",
    );
    console.log("  checked:  no Nitro startup noise or SSR errors in dev logs");
    console.log("  checked:  no browser console/page errors after warmup");
    console.log(
      "  checked:  no-spend loopback → hello action → HITL → queue → rich reload",
    );
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
    const providerBlock = `\n\nLoopback provider state:\n${JSON.stringify(
      provider.state,
      null,
      2,
    )}`;
    primaryError = new Error(
      `${message}${browserBlock}${httpBlock}${providerBlock}\n\nRecent dev logs:\n${logs}`,
    );
  } finally {
    try {
      if (browser) await browser.close();
    } catch (error) {
      captureCleanupError(error);
    }
    try {
      await stopDev(running);
    } catch (error) {
      captureCleanupError(error);
    }
    try {
      await provider.close();
    } catch (error) {
      captureCleanupError(error);
    }
    if (!process.env.STANDALONE_CHAT_DEV_SMOKE_DIR && !skipScaffold) {
      try {
        fs.rmSync(scaffoldParent, {
          recursive: true,
          force: true,
          maxRetries: 10,
          retryDelay: 250,
        });
      } catch (error) {
        captureCleanupError(error);
      }
    }
  }

  if (primaryError) throw primaryError;
  if (cleanupError) throw cleanupError;
}

await main();
