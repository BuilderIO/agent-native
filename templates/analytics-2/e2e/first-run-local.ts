import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { createWriteStream, unlinkSync, writeFileSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createConnection } from "node:net";
import { homedir } from "node:os";
import { resolve } from "node:path";
import { parseArgs } from "node:util";

import { chromium, errors, expect, type Page } from "@playwright/test";
import postgres from "postgres";
import { z } from "zod";

import { checkSqlEditorHeight } from "../app/components/notebook/notebook.sql-height.e2e.js";
import {
  bridgeSessionCookies,
  diagnoseRendererStall,
  RendererStallError,
  requireResponsiveRenderer,
  stallExitCode,
} from "./first-run-browser.js";
import { projectDocumentSchema } from "../app/lib/model/contracts.js";
import { checkAutosaveRun } from "./autosave-run.js";
import { checkNotebookDataBrowserDialog } from "./data-browser-dialog.js";
import { checkDataFavorites } from "./data-favorites.js";
import { checkDemoMonthlySql } from "./demo-sql.js";
import { checkEditorPreferences } from "./editor-preferences.js";
import {
  safeErrorDiagnostic,
  warehouseFailureCode,
} from "./failure-diagnostic.js";
import {
  createFirstRunArtifacts,
  observeFirstRunNavigation,
} from "./first-run-diagnostics.js";
import { checkHomeCreateCollection } from "./home-create-collection.js";
import { checkHomeIntent, checkHomeIntentTransport } from "./home-intent.js";
import { checkHomeRecents } from "./home-recents.js";
import { checkInputAdjacent } from "./input-adjacent-flow.js";
import { checkInputConfig } from "./input-config.js";
import { checkInputMenu } from "./input-menu.js";
import { checkInputQuery } from "./input-query.js";
import { checkInputSqlLiteral } from "./input-sql-literal.js";
import { checkKeyboardShortcuts } from "./keyboard-shortcuts.js";
import { checkLibrary } from "./library.js";
import { localFlowBase } from "./local-flow-base.js";
import { createLocalQaDescriptor } from "./local-qa-descriptor.js";
import { withClaimModel } from "./local/claim-model.js";
import {
  defaultScenario,
  fakeServiceAccountKey,
  startFakeProviders,
} from "./local/fake-providers.js";
import { checkNotebookTablePreview } from "./notebook-data-preview.js";
import { checkNotifications } from "./notifications.js";
import { checkBrowseDataCatalog } from "./predicted-notebook-flows.js";
import { checkProjectHeaderMenu } from "./project-header-menu.js";
import { checkProjectMetaPickers } from "./project-meta-pickers.js";
import { checkProjectListColumns } from "./projects-list-columns.js";
import { checkPublishedStyles } from "./published-chart-styles.js";
import { connectToQaBrowser } from "./qa-browser.js";
import { checkQueryCancellation } from "./query-cancellation.js";
import {
  checkQueryErrorReload,
  type ExpectedQueryFailure,
} from "./query-error-reload.js";
import { checkEmptyQueryContinuation } from "./query-paging.js";
import { checkHomeFocus } from "./recall-flows.js";
import { checkSampleRerun } from "./sample-rerun.js";
import { checkSayaSqlBasic } from "./saya-cells.js";
import { checkSearchFilters } from "./search-filters.js";
import { checkPublishedAppSearch } from "./search-published-app.js";
import { checkSearchStartThread } from "./search-start-thread.js";
import { checkSettingsSearch } from "./settings-search.js";
import { checkUsersSettings } from "./users-settings.js";

// Run from the repository root with an isolated database and browser context.
const {
  values: {
    regression: requestedRegression,
    "server-database-url": databaseUrl,
  },
  positionals,
} = parseArgs({
  options: {
    regression: { type: "string" },
    "server-database-url": { type: "string" },
  },
  allowPositionals: true,
});
if (databaseUrl) {
  let url: URL;
  try {
    url = new URL(databaseUrl);
  } catch {
    throw new Error("Local QA database URL must identify the isolated fixture");
  }
  if (
    url.protocol !== "postgresql:" ||
    url.hostname !== "127.0.0.1" ||
    !url.port ||
    url.username !== "qa_analytics2" ||
    url.password ||
    url.pathname !== "/qa_analytics2" ||
    url.search ||
    url.hash
  )
    throw new Error("Local QA database URL must identify the isolated fixture");
}
const fixtureSuite = positionals[0] === "first-run-fixtures";
const base = localFlowBase();
const baseUrl = new URL(base);
const port = baseUrl.port;
const profileSchema = z
  .object({
    email: z.literal("qa-fleet@builder.io"),
    workspaceId: z.string().min(1),
  })
  .strict();
let profile: z.infer<typeof profileSchema>;
try {
  profile = profileSchema.parse(
    JSON.parse(
      await readFile(
        resolve(homedir(), ".config/agent-native-qa/analytics-2-profile.json"),
        "utf8",
      ),
    ),
  );
} catch {
  console.error(
    "COULD-NOT-RUN first-run-setup: QA profile fixture is missing or invalid",
  );
  process.exit(2);
}
const existing = await new Promise<boolean>((resolve, reject) => {
  const socket = createConnection({
    host: baseUrl.hostname,
    port: Number(port),
  });
  socket.setTimeout(3000);
  socket.once("connect", () => {
    socket.destroy();
    resolve(true);
  });
  socket.once("timeout", () => {
    socket.destroy();
    reject(new Error(`Port ${port} probe timed out`));
  });
  socket.once("error", (error: NodeJS.ErrnoException) => {
    if (error.code === "ECONNREFUSED") resolve(false);
    else reject(error);
  });
});
if (existing) {
  console.error(
    `COULD-NOT-RUN first-run-setup: port ${port} is already occupied`,
  );
  process.exit(2);
}
const fixtureDir = databaseUrl
  ? await mkdtemp(resolve(".tmp/analytics-first-run-"))
  : undefined;
const pidFile = fixtureDir ? resolve(fixtureDir, "pids") : undefined;
let fake: Awaited<ReturnType<typeof startFakeProviders>> | undefined;
try {
  if (pidFile) {
    await writeFile(pidFile, "");
    const scenario = defaultScenario();
    scenario.tables.push({
      dataset: "agent_native_qa",
      name: "sample_words",
      columns: [
        { name: "word", type: "STRING" },
        { name: "word_count", type: "INT64" },
      ],
      rows: [
        { word: "alpha", word_count: 2 },
        { word: "beta", word_count: 1 },
      ],
    });
    fake = await startFakeProviders({ appPort: Number(port), scenario });
  }
} catch (error) {
  if (fixtureDir) await rm(fixtureDir, { recursive: true, force: true });
  throw error;
}
const preload =
  fake && pidFile ? new URL("./local/preload.ts", import.meta.url) : undefined;
if (preload && fake && pidFile) {
  preload.searchParams.set("fakeUrl", fake.url);
  preload.searchParams.set("pidFile", pidFile);
}
const firstRunArtifacts = createFirstRunArtifacts(
  resolve(".tmp"),
  resolve(".tmp/analytics-owner"),
);
console.log(`FIRST-RUN SERVER LOG ${firstRunArtifacts.serverLogPath}`);
const serverLog = createWriteStream(firstRunArtifacts.serverLogPath, {
  flags: "a",
  mode: 0o600,
});
const server = spawn(
  databaseUrl ? process.execPath : "pnpm",
  databaseUrl
    ? [resolve("templates/analytics-2/.output/server/index.mjs")]
    : [
        "--filter",
        "analytics-2",
        "dev",
        "--host",
        baseUrl.hostname,
        "--port",
        port,
        "--strictPort",
      ],
  {
    ...(databaseUrl ? { cwd: resolve("templates/analytics-2") } : {}),
    detached: true,
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...(databaseUrl && fixtureDir
        ? {
            PATH: `${resolve(process.execPath, "..")}:/usr/bin:/bin`,
            HOME: resolve(fixtureDir, "home"),
            XDG_CONFIG_HOME: resolve(fixtureDir, "config"),
            TMPDIR: fixtureDir,
            NODE_OPTIONS: `--import ${preload?.href}`,
            SECRETS_ENCRYPTION_KEY: randomBytes(32).toString("hex"),
            AGENT_NATIVE_CONFIG_RUNTIME_AUTH_ENABLED: "true",
          }
        : process.env),
      ...(databaseUrl
        ? {
            NODE_ENV: "production",
            AGENT_NATIVE_DEPLOYMENT_ENVIRONMENT: "local",
            PORT: port,
            NITRO_PORT: port,
            NITRO_HOST: baseUrl.hostname,
          }
        : {}),
      DATABASE_URL: databaseUrl ?? "pglite:memory",
      DATABASE_URL_UNPOOLED: "",
      NETLIFY_DATABASE_URL: "",
      NETLIFY_DATABASE_URL_UNPOOLED: "",
      AGENT_NATIVE_DISABLE_AUTO_DEV_ACCOUNT: "1",
      AUTH_SKIP_EMAIL_VERIFICATION: "1",
      AUTH_MAGIC_LINK: "0",
      BETTER_AUTH_SECRET: randomBytes(32).toString("hex"),
      APP_URL: databaseUrl ? undefined : base,
      BETTER_AUTH_URL: databaseUrl ? undefined : base,
    },
  },
);
let serverError: Error | undefined;
server.on("error", (error) => {
  serverError = error;
});
let descriptor: string | undefined;
let browser: Awaited<ReturnType<typeof chromium.connectOverCDP>> | undefined;
server.stdout.pipe(serverLog);
server.stderr.pipe(serverLog);
let stage: "fixture" | "verified" | "complete" = "fixture";
const browserErrors: string[] = [];
const responseDetails: Promise<void>[] = [];
let context:
  | Awaited<
      ReturnType<
        Awaited<ReturnType<typeof chromium.connectOverCDP>>["newContext"]
      >
    >
  | undefined;
let cleanupPromise: Promise<void> | undefined;
let shuttingDown = false;
function cleanup() {
  return (cleanupPromise ??= (async () => {
    try {
      if (descriptor) {
        try {
          unlinkSync(descriptor);
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        }
      }
      try {
        await context?.close();
      } finally {
        await browser?.close();
      }
    } finally {
      try {
        const serverPid = server.pid;
        if (
          serverPid &&
          server.exitCode === null &&
          server.signalCode === null
        ) {
          const exited = new Promise<void>((resolve) =>
            server.once("exit", () => resolve()),
          );
          process.kill(-serverPid, "SIGTERM");
          const timer = setTimeout(() => {
            if (server.exitCode === null && server.signalCode === null)
              process.kill(-serverPid, "SIGKILL");
          }, 3000);
          try {
            await exited;
          } finally {
            clearTimeout(timer);
          }
        }
      } finally {
        serverLog.end();
        try {
          await fake?.close();
        } finally {
          if (fixtureDir)
            await rm(fixtureDir, { recursive: true, force: true });
        }
      }
    }
  })());
}
for (const signal of ["SIGINT", "SIGTERM"] as const)
  process.on(signal, () => {
    shuttingDown = true;
    void cleanup().then(
      () => process.exit(signal === "SIGINT" ? 130 : 143),
      (error) => {
        console.error(`Local QA cleanup failed: ${safeErrorDiagnostic(error)}`);
        process.exit(1);
      },
    );
  });
try {
  await expect
    .poll(
      async () => {
        if (serverError) throw serverError;
        if (server.exitCode !== null)
          throw new Error(`Local QA server exited ${server.exitCode}`);
        return fetch(`${base}/_agent-native/ping`, {
          signal: AbortSignal.timeout(3000),
        }).then(
          (r) => r.ok,
          () => false,
        );
      },
      { timeout: 120_000 },
    )
    .toBe(true);
  browser = await connectToQaBrowser();
  browser.on("disconnected", () =>
    console.error(`QA BROWSER disconnected at=${new Date().toISOString()}`),
  );
  const cdp = await browser.newBrowserCDPSession();
  const beforeContexts = await cdp.send("Target.getBrowserContexts");
  const localContext = await browser.newContext();
  localContext.on("close", () =>
    console.error(`QA CONTEXT closed at=${new Date().toISOString()}`),
  );
  localContext.on("page", (ownedPage) => {
    ownedPage.on("close", () =>
      console.log(`QA PAGE closed at=${new Date().toISOString()}`),
    );
    ownedPage.on("crash", () =>
      console.error(`QA PAGE crashed at=${new Date().toISOString()}`),
    );
  });
  context = localContext;
  const afterContexts = await cdp.send("Target.getBrowserContexts");
  const newIds = afterContexts.browserContextIds.filter(
    (id) => !beforeContexts.browserContextIds.includes(id),
  );
  if (newIds.length !== 1)
    throw new Error("Could not identify isolated QA browser context");
  const browserContextId = newIds[0];
  const page = await context.newPage();
  const password = randomBytes(24).toString("hex");
  const authHeaders = { origin: base };
  const registration = await context.request.post(
    `${base}/_agent-native/auth/register`,
    {
      headers: authHeaders,
      data: { email: profile.email, password, callbackURL: base },
    },
  );
  if (!registration.ok())
    throw new Error(`Local QA registration HTTP ${registration.status()}`);
  const login = await context.request.post(`${base}/_agent-native/auth/login`, {
    headers: authHeaders,
    data: { email: profile.email, password },
  });
  if (!login.ok()) throw new Error(`Local QA login HTTP ${login.status()}`);
  // Over CDP the request context's cookie jar is not the page's: without this
  // the API is signed in while every navigation lands on the sign-in screen.
  await bridgeSessionCookies(context, base);
  const headers = { "x-agent-native-frontend": "1" };
  const shellSchema = z.object({
    user: z.object({ email: z.string() }),
    workspace: z.object({ id: z.string().min(1) }),
    features: z.object({ isAdmin: z.boolean() }),
  });
  let workspaceId = "";
  await expect
    .poll(
      async () => {
        const r = await localContext.request.get(
          `${base}/_agent-native/actions/get-workspace-shell`,
          { headers },
        );
        if (!r.ok()) return false;
        const shell = shellSchema.safeParse(await r.json());
        if (
          !shell.success ||
          shell.data.user.email !== profile.email ||
          !shell.data.features.isAdmin
        )
          return false;
        workspaceId = shell.data.workspace.id;
        return workspaceId !== profile.workspaceId;
      },
      { timeout: 60_000 },
    )
    .toBe(true);
  const assertIdentity = async () => {
    const r = await localContext.request.get(
      `${base}/_agent-native/actions/get-workspace-shell`,
      { headers },
    );
    expect(r.ok()).toBe(true);
    const shell = shellSchema.parse(await r.json());
    expect(shell.user.email).toBe(profile.email);
    expect(shell.workspace.id).toBe(workspaceId);
    expect(shell.features.isAdmin).toBe(true);
  };
  await assertIdentity();
  if (fake) {
    const response = await fetch(new URL("/__control/scenario", fake.url), {
      signal: AbortSignal.timeout(3000),
    });
    if (!response.ok)
      throw new Error(`Local fake provider HTTP ${response.status}`);
    const scenario = z
      .object({
        projectId: z.literal("local-fake-project"),
        bigquery: z.literal("ok"),
        tables: z.array(z.object({ dataset: z.string(), name: z.string() })),
      })
      .parse(await response.json());
    if (
      !scenario.tables.some(
        (table) =>
          table.dataset === "agent_native_qa" && table.name === "sample_words",
      )
    )
      throw new Error("Local fake BigQuery sample_words fixture is absent");
  }
  stage = "verified";
  console.log(`VERIFIED local QA ${profile.email}, workspace ${workspaceId}`);
  const connectionsResponse = await context.request.get(
    `${base}/_agent-native/actions/list-data-connections`,
    { headers },
  );
  expect(connectionsResponse.ok()).toBe(true);
  const connections = z
    .object({ connections: z.array(z.object({ type: z.string() })) })
    .parse(await connectionsResponse.json());
  expect(
    connections.connections.filter(
      (connection) => connection.type !== "sample",
    ),
  ).toEqual([]);
  const keysResponse = await context.request.get(
    `${base}/_agent-native/actions/list-api-keys`,
    { headers },
  );
  expect(keysResponse.ok()).toBe(true);
  const keys = z
    .object({ keys: z.array(z.unknown()), managed: z.array(z.unknown()) })
    .parse(await keysResponse.json());
  expect(keys.keys).toEqual([]);
  expect(keys.managed).toEqual([]);
  const engine = await context.request.get(
    `${base}/_agent-native/agent-engine/status`,
  );
  expect(engine.ok()).toBe(true);
  const readiness = z
    .object({ configured: z.boolean(), chatEligible: z.boolean() })
    .parse(await engine.json());
  expect(readiness.configured).toBe(false);
  expect(readiness.chatEligible).toBe(false);
  console.log("VERIFIED fresh workspace has no keys and chat is unavailable");
  // The API ping bypasses Nitro's HTML-only startup gate.
  await expect
    .poll(
      async () => {
        let response;
        try {
          response = await localContext.request.get(base, {
            headers: { accept: "text/html" },
            timeout: 10_000,
          });
        } catch (error) {
          if (!(error instanceof errors.TimeoutError)) throw error;
          console.log("HTML READINESS unreadable: timeout");
          return { kind: "unreadable" as const, reason: "timeout" as const };
        }
        console.log(`HTML READINESS HTTP ${response.status()}`);
        if (response.status() !== 200 && response.status() !== 503)
          throw new Error(`HTML readiness HTTP ${response.status()}`);
        if (
          response.status() === 200 &&
          !response.headers()["content-type"]?.includes("text/html")
        )
          throw new Error("HTML readiness returned a non-HTML response");
        return { kind: "response" as const, status: response.status() };
      },
      { timeout: 60_000 },
    )
    .toEqual({ kind: "response", status: 200 });
  let phase = "entry";
  const requestPhases = new WeakMap<object, string>();
  let expectedQuery:
    | {
        page: Page;
        failure: ExpectedQueryFailure;
        responses: Array<Promise<boolean>>;
        consoleCount: number;
        validated: boolean;
      }
    | undefined;
  const registerExpectedQueryFailure = (
    page: Page,
    failure: ExpectedQueryFailure,
  ) => {
    if (expectedQuery)
      throw new Error("An expected query failure is already registered");
    const current = {
      page,
      failure,
      responses: [] as Array<Promise<boolean>>,
      consoleCount: 0,
      validated: false,
    };
    expectedQuery = current;
    return {
      verify: async () => {
        const results = await Promise.all(current.responses);
        if (
          results.length !== 1 ||
          results[0] !== true ||
          current.consoleCount > 1
        )
          throw new Error("Expected query failure did not match its fixture");
        current.validated = true;
      },
      dispose: () => {
        if (
          current.consoleCount > 1 ||
          (current.consoleCount && !current.validated)
        )
          browserErrors.push("Unverified expected query console error");
        if (expectedQuery === current) expectedQuery = undefined;
      },
    };
  };
  const attachCollector = (page: Page) => {
    page.on("request", (request) => requestPhases.set(request, phase));
    page.on("requestfailed", (request) => {
      // Query hooks cancel reads when these checks navigate or close a page.
      if (
        request.url().startsWith(`${base}/`) &&
        request.failure()?.errorText !== "net::ERR_ABORTED"
      )
        browserErrors.push(
          `${requestPhases.get(request) ?? phase} request failed ${request.method()} ${new URL(request.url()).pathname}: ${request.failure()?.errorText ?? "unknown error"}`,
        );
    });
    page.on("pageerror", (error) => {
      browserErrors.push(`${phase} pageerror ${safeErrorDiagnostic(error)}`);
    });
    page.on("console", (message) => {
      if (message.type() !== "error") return;
      const location = message.location().url;
      if (
        phase === "app-intent-transport" &&
        location &&
        new URL(location).pathname.endsWith(
          "/actions/start-analytics-thread",
        ) &&
        message.text().startsWith("Failed to load resource:")
      )
        return;
      if (
        phase === "report-search-refusal" &&
        location &&
        new URL(location).pathname.endsWith(
          "/actions/start-analytics-thread",
        ) &&
        message.text().startsWith("Failed to load resource:") &&
        /\b503\b/.test(message.text())
      )
        return;
      if (
        expectedQuery?.page === page &&
        phase === "report-F12-query-error-reload" &&
        location &&
        new URL(location).pathname === expectedQuery.failure.path &&
        message.text().startsWith("Failed to load resource:") &&
        /\b422\b/.test(message.text())
      ) {
        expectedQuery.consoleCount++;
        return;
      }
      browserErrors.push(`${phase} console error`);
    });
    page.on("response", (response) => {
      if (!response.url().startsWith(`${base}/`)) return;
      const request = response.request();
      const url = new URL(response.url());
      if (
        requestPhases.get(request) === "app-intent-transport" &&
        request.method() === "POST" &&
        url.pathname.endsWith("/actions/start-analytics-thread") &&
        response.status() === 503
      )
        return;
      if (
        expectedQuery?.page === page &&
        requestPhases.get(request) === "report-F12-query-error-reload" &&
        request.method() === expectedQuery.failure.method &&
        url.pathname === expectedQuery.failure.path &&
        response.status() === expectedQuery.failure.status
      ) {
        const fixture = expectedQuery;
        let body: unknown;
        try {
          body = request.postDataJSON();
        } catch {
          body = null;
        }
        const parsed = z
          .object({
            snapshot: z.object({
              ref: z.object({ projectId: z.string() }),
            }),
            targetCellId: z.string(),
          })
          .safeParse(body);
        if (
          parsed.success &&
          parsed.data.snapshot.ref.projectId === fixture.failure.projectId &&
          parsed.data.targetCellId === fixture.failure.cellId
        ) {
          fixture.responses.push(
            response.json().then(
              (value: unknown) => {
                const result = z
                  .object({ status: z.string() })
                  .safeParse(value);
                return (
                  result.success &&
                  result.data.status === fixture.failure.errorCode
                );
              },
              () => false,
            ),
          );
          return;
        }
      }
      if (response.status() < 400) return;
      if (
        phase === "report-search-refusal" &&
        response.status() === 503 &&
        request.method() === "POST" &&
        url.pathname.endsWith("/actions/start-analytics-thread")
      )
        return;
      const failure = `${requestPhases.get(request) ?? phase} HTTP ${response.status()} ${request.method()} ${url.pathname} type=${request.resourceType()} navigation=${request.isNavigationRequest()}`;
      browserErrors.push(failure);
      const warehouseForbidden =
        request.method() === "POST" &&
        response.status() === 403 &&
        url.pathname.endsWith("/actions/create-workspace-warehouse-form");
      responseDetails.push(
        Promise.race([
          response.text(),
          new Promise<string>((_resolve, reject) => {
            const timer = setTimeout(
              () => reject(new Error("Response body diagnostic timed out")),
              3000,
            );
            timer.unref();
          }),
        ]).then(
          (body) =>
            console.error(
              `BROWSER RESPONSE ${failure} ${warehouseForbidden ? `errorCode=${warehouseFailureCode(body)}` : "body received"}`,
            ),
          () =>
            console.error(
              `BROWSER RESPONSE ${failure} ${warehouseForbidden ? `errorCode=${warehouseFailureCode(undefined)}` : "body unavailable"}`,
            ),
        ),
      );
    });
  };
  attachCollector(page);
  context.on("page", attachCollector);
  const before = await context.request.get(
    `${base}/_agent-native/onboarding/first-run/status`,
  );
  expect(before.ok()).toBe(true);
  expect(await before.json()).toEqual({ firstRun: true });
  let firstRunStatus: number | null = null;
  let navigationStage = "goto";
  let stalledBrowser: RendererStallError | undefined;
  const navigationObserver = observeFirstRunNavigation(page, baseUrl.origin);
  try {
    await requireResponsiveRenderer(page);
    firstRunStatus = (await page.goto(base))?.status() ?? null;
    navigationStage = "heading";
    await expect(page.getByText("Start your first analysis")).toBeVisible({
      timeout: 60_000,
    });
  } catch (error) {
    console.error(
      `FIRST-RUN NAVIGATION ${JSON.stringify({ stage: navigationStage, status: firstRunStatus, closed: page.isClosed(), pages: context.pages().length, serverLog: firstRunArtifacts.serverLogPath, screenshot: firstRunArtifacts.failureScreenshotPath, requests: navigationObserver.snapshot() })}`,
    );
    let captureTimer: ReturnType<typeof setTimeout> | undefined;
    const capture = { timedOut: false };
    try {
      const state = await Promise.race([
        page.evaluate(() => ({
          origin: location.origin,
          path: location.pathname,
          readyState: document.readyState,
          titlePresent: document.title.length > 0,
          headingCount: document.querySelectorAll("h1, h2, h3").length,
          bodyChildCount:
            document.querySelector("body")?.children.length ?? null,
        })),
        new Promise<never>((_, reject) => {
          captureTimer = setTimeout(() => {
            capture.timedOut = true;
            reject(new Error("First-run state capture timed out"));
          }, 3000);
        }),
      ]);
      console.error(`FIRST-RUN READINESS ${JSON.stringify(state)}`);
    } catch (captureError) {
      console.error(
        `FIRST-RUN STATE CAPTURE ${capture.timedOut ? "timeout" : safeErrorDiagnostic(captureError)}`,
      );
      if (capture.timedOut) {
        const verdict = await diagnoseRendererStall(context, page);
        console.error(`FIRST-RUN RENDERER ${verdict}`);
        if (verdict === "browser-wide")
          stalledBrowser = new RendererStallError(
            "Owned browser stopped answering evaluate on the app page and on a blank tab",
          );
      }
    } finally {
      clearTimeout(captureTimer);
    }
    try {
      await page.screenshot({
        path: firstRunArtifacts.failureScreenshotPath,
        timeout: 3000,
      });
      console.error(
        `FIRST-RUN FAILURE SCREENSHOT ${firstRunArtifacts.failureScreenshotPath}`,
      );
    } catch (captureError) {
      console.error(
        `FIRST-RUN SCREENSHOT CAPTURE ${safeErrorDiagnostic(captureError)}`,
      );
    }
    throw stalledBrowser ?? error;
  } finally {
    navigationObserver.dispose();
  }
  const heading = page.getByText("Start your first analysis");
  const orders = page.getByRole("button", { name: "orders", exact: true });
  await expect(heading).toBeInViewport();
  await orders.click({ trial: true });
  const geometry = await orders.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    const hit = document.elementFromPoint(
      rect.x + rect.width / 2,
      rect.y + rect.height / 2,
    );
    return {
      x: rect.x,
      y: rect.y,
      width: rect.width,
      height: rect.height,
      hit: hit === element || element.contains(hit),
    };
  });
  expect(geometry.hit).toBe(true);
  console.log(`FIRST-RUN ACTIONABLE ${JSON.stringify(geometry)}`);
  const screenshot = `.tmp/analytics-2-first-run-${Date.now()}.png`;
  await page.screenshot({ path: screenshot });
  await expect(heading).toBeVisible();
  console.log(`FIRST-RUN SCREENSHOT ${screenshot}`);
  await assertIdentity();
  phase = "sample creation";
  await page.getByRole("button", { name: "orders", exact: true }).click();
  await expect(page).toHaveURL(/\/project\/[^/]+\/latest$/, {
    timeout: 60_000,
  });
  await assertIdentity();
  const projectId = page.url().match(/\/project\/([^/]+)\/latest$/)?.[1];
  if (!projectId) throw new Error("Sample project ID missing");
  const projectResponse = await context.request.get(
    `${base}/_agent-native/actions/get-project?projectId=${encodeURIComponent(projectId)}`,
    { headers },
  );
  expect(projectResponse.ok()).toBe(true);
  const saved = z
    .object({ project: projectDocumentSchema })
    .parse(await projectResponse.json());
  expect(saved.project.cells).toHaveLength(1);
  expect(saved.project.cells[0]?.contents).toMatchObject({
    kind: "sql",
    source: "SELECT * FROM orders LIMIT 100",
    resultVariable: "orders",
  });
  phase = "reload";
  await page.reload();
  await expect(page).toHaveURL(new RegExp(`/project/${projectId}/latest$`));
  await assertIdentity();
  const after = await context.request.get(
    `${base}/_agent-native/onboarding/first-run/status`,
  );
  expect(after.ok()).toBe(true);
  expect(await after.json()).toEqual({ firstRun: false });
  stage = "complete";
  await Promise.all(responseDetails);
  if (browserErrors.length) {
    console.error(
      "FAIL first-run-setup: browser errors observed",
      JSON.stringify(browserErrors),
    );
    process.exitCode = 1;
  } else
    console.log(
      `PASS first-run-setup: ${profile.email}, workspace ${workspaceId}; orders opened and onboarding completed`,
    );
  const emittedFlowIds = ["first-run-setup"];
  // Thread-starting flows need a saved model key; withClaimModel saves the
  // fake key through the settings UI and removes it afterwards, so the
  // fresh-workspace and ask-question-get-chart key checks still hold.
  const withFakeModel = async (page: Page, run: () => Promise<void>) => {
    if (!fake || !databaseUrl)
      throw new Error(
        "Thread-starting flow requires the isolated local fake model fixture",
      );
    await withClaimModel(page, base, fake.url, run);
  };
  const regressions: Array<[string, (page: Page) => Promise<void>]> = [
    ["report-1794900799-home-recents", (page) => checkHomeRecents(page, base)],
    ["rename-persists", (page) => checkProjectHeaderMenu(page, base)],
    ["report-1795066971-input-menu", (page) => checkInputMenu(page, base)],
    ["report-1795067325-input-config", (page) => checkInputConfig(page, base)],
    ["report-1795071219-input-query", (page) => checkInputQuery(page, base)],
    [
      "report-1795071321-input-adjacent",
      (page) => checkInputAdjacent(page, base),
    ],
    [
      "report-1795073129-input-dependencies",
      (page) => checkInputSqlLiteral(page, base),
    ],
    [
      "report-QA-1795062135-project-status-categories",
      (page) => checkProjectMetaPickers(page, base),
    ],
    [
      "report-B-SAMPLE-RERUN-CANCELLATION-TOAST",
      (page) => withFakeModel(page, () => checkSampleRerun(page, base)),
    ],
    [
      "report-A2-PUBLISHED-CHART-STYLES",
      (page) => checkPublishedStyles(page, base),
    ],
    [
      "browse-data-catalog",
      async (page) => {
        await checkBrowseDataCatalog(page, base);
        await checkNotebookTablePreview(page, base);
      },
    ],
    [
      "report-1794948257.991429-sql-editor-preview",
      (page) => checkSayaSqlBasic(page, base),
    ],
    [
      "report-1795063839-data-browser-dialog",
      (page) => checkNotebookDataBrowserDialog(page, base),
    ],
    [
      "report-1795065529-sql-height",
      (page) => checkSqlEditorHeight(page, base),
    ],
    ["steve-demo-monthly-revenue", (page) => checkDemoMonthlySql(page, base)],
    ["DATA-FAVORITES", (page) => checkDataFavorites(page, base)],
    [
      "report-F12-query-error-reload",
      (page) =>
        checkQueryErrorReload(page, base, (failure) =>
          registerExpectedQueryFailure(page, failure),
        ),
    ],
    [
      "report-1794900229.518749-home-create-collection",
      (page) => checkHomeCreateCollection(page, base),
    ],
    [
      "report-1794899960.825799-home-app-intent",
      async (page) => {
        if (!fake || !databaseUrl)
          throw new Error(
            "Home intent requires the isolated local fake model fixture",
          );
        try {
          await withClaimModel(page, base, fake.url, () =>
            checkHomeIntent(page, base),
          );
        } finally {
          await assertIdentity();
          console.log(
            `VERIFIED identity after Home intent ${profile.email}, workspace ${workspaceId}`,
          );
        }
      },
    ],
    [
      "app-intent-transport",
      (page) => withFakeModel(page, () => checkHomeIntentTransport(page, base)),
    ],
    [
      "report-1794900076.228569-home-focus",
      async (page) => {
        if (!fake || !databaseUrl)
          throw new Error(
            "Home focus requires the isolated local fake model fixture",
          );
        try {
          await withClaimModel(page, base, fake.url, async () => {
            await checkHomeFocus(page, base);
            await page.screenshot({
              path: ".tmp/analytics-owner/home-focus-local.png",
            });
          });
        } finally {
          await assertIdentity();
          console.log(
            `VERIFIED identity after Home focus ${profile.email}, workspace ${workspaceId}`,
          );
        }
      },
    ],
    [
      "report-1794899542.541439-notifications",
      (page) => checkNotifications(page, base),
    ],
    ["report-1794899298.142179-library", (page) => checkLibrary(page, base)],
    ["report-A2-AUTOSAVE-RUN-DROPPED", (page) => checkAutosaveRun(page, base)],
    [
      "report-published-app-search",
      (page) => checkPublishedAppSearch(page, base),
    ],
    [
      "report-project-list-columns",
      (page) => checkProjectListColumns(page, base),
    ],
    [
      "report-455-456-editor-preferences",
      (page) => checkEditorPreferences(page, base, workspaceId),
    ],
    [
      "report-M5-T2-F-04-settings-search",
      (page) => checkSettingsSearch(page, base),
    ],
    [
      "report-M5-T2-F-03-users-settings",
      async (page) => {
        if (!databaseUrl)
          throw new Error(
            "Users role checks require the isolated local database",
          );
        await checkUsersSettings(page, base, true);
        const sql = postgres(databaseUrl, { max: 1 });
        try {
          const members =
            await sql`SELECT role FROM org_members WHERE org_id = ${workspaceId} AND email = ${profile.email}`;
          expect(members).toHaveLength(1);
          const role = members[0]!.role;
          try {
            await sql`UPDATE org_members SET role = 'member' WHERE org_id = ${workspaceId} AND email = ${profile.email}`;
            await checkUsersSettings(page, base, false);
          } finally {
            await sql`UPDATE org_members SET role = ${role} WHERE org_id = ${workspaceId} AND email = ${profile.email}`;
          }
        } finally {
          await sql.end();
        }
        await assertIdentity();
      },
    ],
    [
      "report-M5-T2-F-01-keyboard-shortcuts",
      (page) => checkKeyboardShortcuts(page, base),
    ],
    ["report-search-filters", (page) => checkSearchFilters(page, base)],
    [
      "report-search-refusal",
      (page) =>
        withFakeModel(page, () =>
          checkSearchStartThread(page, localContext, base),
        ),
    ],
    [
      "query-cancellation-transport",
      (page) =>
        withFakeModel(page, () =>
          checkQueryCancellation(page, localContext, base, workspaceId),
        ),
    ],
    [
      "report-pager-empty-continuation",
      (page) =>
        withFakeModel(page, () =>
          checkEmptyQueryContinuation({
            page,
            context: localContext,
            base,
            workspaceId,
          }),
        ),
    ],
  ];
  if (
    requestedRegression !== undefined &&
    !regressions.some(([name]) => name === requestedRegression)
  )
    throw new Error(`Unknown regression: ${requestedRegression}`);
  const selectedRegressions = requestedRegression
    ? regressions.filter(([name]) => name === requestedRegression)
    : positionals[0]
      ? []
      : regressions;
  for (const [name, check] of selectedRegressions) {
    phase = name;
    const checkPage = await localContext.newPage();
    const startErrors = browserErrors.length;
    try {
      await check(checkPage);
      await Promise.all(responseDetails);
      if (browserErrors.length !== startErrors)
        throw new Error("Browser errors during regression");
      console.log(`PASS ${name}: local regression assertions verified`);
    } catch (error) {
      console.error(`FAIL ${name}: ${safeErrorDiagnostic(error)}`);
      process.exitCode = 1;
    } finally {
      emittedFlowIds.push(name);
      await checkPage.close();
    }
  }
  await Promise.all(responseDetails);
  if (browserErrors.length) {
    console.error(
      "FAIL local-browser: browser errors observed",
      JSON.stringify(browserErrors),
    );
    process.exitCode = 1;
  }
  if (!requestedRegression) {
    if (shuttingDown) throw new Error("Local QA run interrupted");
    // Defer this fixture until fresh-account and no-key checks finish; its verdict comes from the second phase.
    const phasedDefault =
      (!positionals[0] || fixtureSuite) && !!fake && !!databaseUrl;
    const setupDefault = async () => {
      phase = "default connection fixture";
      const name = `Local default BigQuery ${randomBytes(8).toString("hex")}`;
      await page.goto(`${base}/data`, { waitUntil: "domcontentloaded" });
      await page.getByText("Warehouse", { exact: true }).click();
      await page
        .getByRole("button", {
          name: /^(Add data connection|Connect your data)/,
        })
        .click();
      await page.getByText("Google BigQuery", { exact: true }).click();
      await page.locator('input[name="name"]').fill(name);
      await page.locator('input[name="projectId"]').fill("local-fake-project");
      await page.locator('input[name="datasetNames"]').fill("agent_native_qa");
      const storageApi = page.locator('input[name="useBQStorageAPI"]');
      if (await storageApi.isChecked()) await storageApi.click();
      await page
        .locator('input[name="serviceAccount"]')
        .fill(JSON.stringify(fakeServiceAccountKey()));
      const [created] = await Promise.all([
        page.waitForResponse(
          (response) =>
            response.request().method() === "POST" &&
            new URL(response.url()).pathname.endsWith(
              "/actions/create-workspace-warehouse-form",
            ),
          { timeout: 30000 },
        ),
        page
          .getByRole("button", { name: "Create connection", exact: true })
          .click(),
      ]);
      if (!created.ok())
        throw new Error("Default fixture connection creation failed");
      await expect(page.getByText(name, { exact: true }).first()).toBeVisible({
        timeout: 120000,
      });
      await page.getByRole("button", { name: `${name} options` }).click();
      await page.getByRole("menuitem", { name: "Set as default" }).click();
      await expect
        .poll(
          async () => {
            const response = await localContext.request.get(
              `${base}/_agent-native/actions/list-data-connections`,
              { headers },
            );
            if (!response.ok())
              throw new Error("Default fixture readback failed");
            const result = z
              .object({
                connections: z.array(
                  z.object({
                    name: z.string(),
                    type: z.string(),
                    isDraft: z.boolean(),
                    isDefault: z.boolean(),
                  }),
                ),
              })
              .parse(await response.json());
            return result.connections.some(
              (connection) =>
                connection.name === name &&
                connection.type === "bigquery" &&
                !connection.isDraft &&
                connection.isDefault,
            );
          },
          { timeout: 30000 },
        )
        .toBe(true);
      console.log("DEFAULT fixture created and selected in isolated database");
    };
    if (positionals[0] === "default-connection-new-cell" && fake && databaseUrl)
      await setupDefault();
    const writeDescriptor = (deferDefault: boolean) => {
      const contents = JSON.stringify({
        base,
        email: profile.email,
        workspaceId,
        browserContextId,
        emittedFlowIds: deferDefault
          ? [...emittedFlowIds, "default-connection-new-cell"]
          : emittedFlowIds,
        runtime: databaseUrl ? "production" : "development",
        ...(fake
          ? {
              providerFixture: { kind: "local-fake-bigquery", url: fake.url },
            }
          : {}),
      });
      if (descriptor) writeFileSync(descriptor, contents, { mode: 0o600 });
      else descriptor = createLocalQaDescriptor(resolve(".tmp"), contents);
    };
    const runCore = async (name?: string) => {
      if (!descriptor) throw new Error("Local QA descriptor is unavailable");
      const args = [
        "exec",
        "tsx",
        "templates/analytics-2/e2e/core-flows.ts",
        "local",
      ];
      if (name) args.push(name);
      args.push("--qa-descriptor", descriptor);
      const flow = spawn("pnpm", args, {
        stdio: "inherit",
        env: {
          ...process.env,
          ...(databaseUrl
            ? {
                ANALYTICS_SQL_REVIEW_DATABASE_URL: databaseUrl,
                DATABASE_URL: databaseUrl,
                DATABASE_URL_UNPOOLED: "",
                NETLIFY_DATABASE_URL: "",
                NETLIFY_DATABASE_URL_UNPOOLED: "",
              }
            : {}),
        },
      });
      const exitCode = await new Promise<number>((resolve, reject) => {
        flow.once("error", reject);
        flow.once("exit", (code, signal) =>
          signal
            ? reject(new Error(`Core flows terminated: ${signal}`))
            : resolve(code ?? 1),
        );
      });
      if (exitCode === 1 || (exitCode !== 0 && process.exitCode !== 1))
        process.exitCode = exitCode;
    };
    const runDefault = async () => {
      if (!fake || !databaseUrl)
        throw new Error(
          "Default flow requires the isolated production fixture",
        );
      await withClaimModel(page, base, fake.url, () =>
        runCore("default-connection-new-cell"),
      );
      const keys = await localContext.request.get(
        `${base}/_agent-native/actions/list-api-keys`,
        { headers },
      );
      expect(keys.ok()).toBe(true);
      const remaining = z
        .object({ keys: z.array(z.object({ name: z.string() })) })
        .parse(await keys.json());
      expect(
        remaining.keys.filter((key) => key.name === "ANTHROPIC_API_KEY"),
      ).toEqual([]);
      const engine = await localContext.request.get(
        `${base}/_agent-native/agent-engine/status`,
        { headers },
      );
      expect(engine.ok()).toBe(true);
      expect(
        z.object({ chatEligible: z.boolean() }).parse(await engine.json())
          .chatEligible,
      ).toBe(false);
      console.log(
        "DEFAULT fixture key absent and chat unavailable after cleanup",
      );
    };
    writeDescriptor(phasedDefault);
    if (fixtureSuite) {
      for (const name of [
        "connect-data-source",
        "ask-question-get-chart",
        "agent-claim-readback",
      ])
        await runCore(name);
    } else if (positionals[0] === "default-connection-new-cell")
      await runDefault();
    else await runCore(positionals[0]);
    if (phasedDefault) {
      try {
        await setupDefault();
        writeDescriptor(false);
        await runDefault();
      } catch (error) {
        console.error(
          `FAIL default-connection-new-cell: ${safeErrorDiagnostic(error)}`,
        );
        process.exitCode = 1;
      }
    }
    if (fixtureSuite && !process.exitCode)
      console.log(
        "PASS first-run-fixtures: warehouse, chart reload, default query and credential cleanup verified",
      );
  }
} catch (error) {
  const stallCode = stallExitCode(error);
  if (stallCode !== undefined) {
    console.error(
      `COULD-NOT-RUN first-run-setup: ${safeErrorDiagnostic(error)}`,
    );
    process.exitCode = stallCode;
  } else if (stage === "fixture") {
    const reason =
      error instanceof Error &&
      /^Local QA (registration|login) HTTP [0-9]+$/.test(error.message)
        ? error.message
        : "Local QA fixture initialization failed";
    console.error(`COULD-NOT-RUN first-run-setup: ${reason}`);
    console.error(safeErrorDiagnostic(error));
    process.exitCode = 2;
  } else if (stage === "verified") {
    console.error(
      "FAIL local fixture: first-run, search, pager, or browser assertion failed; inspect local test output",
    );
    console.error(safeErrorDiagnostic(error));
    process.exitCode = 1;
  } else {
    console.error(
      "FAIL local flow runner: follow-up check or fixture handoff failed",
    );
    console.error(safeErrorDiagnostic(error));
    process.exitCode = 1;
  }
} finally {
  try {
    await Promise.all(responseDetails);
    if (browserErrors.length) {
      console.error("BROWSER ERRORS", JSON.stringify(browserErrors));
      process.exitCode = 1;
    }
  } finally {
    await cleanup();
  }
}
