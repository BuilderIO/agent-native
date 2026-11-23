import { randomUUID } from "node:crypto";
import { writeSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { resolve } from "node:path";

import {
  expect,
  request,
  type APIRequestContext,
  type BrowserContext,
  type Page,
  type Request,
  type Response,
} from "@playwright/test";
import { z } from "zod";

import {
  projectDocumentSchema,
  UNTITLED_PROJECT_NAME,
} from "../app/lib/model/contracts.js";
import { addCellKind } from "./add-cell-kind.js";
import { checkAgentProjectView } from "./agent-project-view.js";
import {
  observeBuild,
  finishBuildVerdict,
  flowBuildLine,
  type BuildObservation,
} from "./build-boundary.js";
import {
  isTransientCatalogAvailability,
  waitForCatalogReady,
} from "./catalog-readiness.js";
import {
  captureDataBrowserState,
  selectWarehouseDiagnostic,
} from "./data-browser-readiness.js";
import { parseDefaultConnectionFixture } from "./default-connection-fixture.js";
import { selectLiveFlowModel } from "./default-connection.js";
import { checkEditorPreferences } from "./editor-preferences.js";
import {
  failureDiagnostic,
  safeErrorDiagnostic,
  typedCode,
} from "./failure-diagnostic.js";
import { checkFilterLimits } from "./filter-limits.js";
import {
  LedgerSet,
  openFixtureLedger,
  readOutstandingFixtures,
} from "./fixture-ledger.js";
import { recordFlowEvidence, type FlowEvidence } from "./flow-evidence.js";
import { checkHomeRecents } from "./home-recents.js";
import { waitForJsonResponse, type JsonResponse } from "./json-response.js";
import { checkKeyboardShortcuts } from "./keyboard-shortcuts.js";
import { localFlowBase } from "./local-flow-base.js";
import { withClaimModel } from "./local/claim-model.js";
import { cleanupLocalStagedDataset } from "./local/cleanup-staged.js";
import { fakeServiceAccountKey } from "./local/fake-providers.js";
import {
  captureNotebookReloadDom,
  observeNotebookReload,
} from "./notebook-reload-diagnostic.js";
import { readRequestId, retainRequestId } from "./operation-receipt.js";
import {
  addText,
  leaveProject,
  withProject,
} from "./predicted-notebook-flows.js";
import { checkProjectHeaderMenu } from "./project-header-menu.js";
import { openQaBrowser, qaBrowserEndpoint } from "./qa-browser.js";
import { playwrightCookiesFromCdp } from "./qa-cookies.js";
import {
  checkWorkspaceProjects,
  checkHomeFocus,
  checkPopular,
  checkBigQueryDraft,
} from "./recall-flows.js";
import { ResponseDiagnostics } from "./response-diagnostics.js";
import {
  expectedAppIntentTransportFailure,
  expectedMissingProjectFailure,
  type ExpectedRuntimeFailure,
} from "./runtime-errors.js";
import { report1794947190, report1794947983 } from "./saya-project.js";
import { classifyFlows } from "./scope-classification.js";
import { checkSettingsPreferences } from "./settings-preferences.js";
import { checkSettingsSearch } from "./settings-search.js";
import { readSqlEditor } from "./sql-editor.js";
import {
  supplementalFlowNames,
  runSupplementalFlow,
} from "./supplemental-flows.js";
import { fetchUiAction } from "./ui-capability.js";
import { checkUsersSettings } from "./users-settings.js";

function startupStage(stage: string) {
  console.error(`STARTUP ${new Date().toISOString()} ${stage}`);
}

startupStage("imports complete");

// Reuses the team's create/open/readback, notebook, rename and chart scenarios.
// Each run owns its records; old receipts and fleet helpers are not inputs.
const mode = process.argv[2];
if (mode === "phase1") {
  const { runEvidence } = await import("./phase1/evidence-runner.js");
  process.exit(await runEvidence(process.argv.slice(3)));
}
if (mode !== "local" && mode !== "live")
  throw new Error(
    "Usage: core-flows.ts local|live|phase1 (--help for Phase 1)",
  );
const args = process.argv.slice(3);
const requestedFlow = args[0]?.startsWith("--") ? undefined : args.shift();
const fixtureFlag = args[0];
const fixturePathArgument = args[1];
const localDescriptor =
  mode === "local" && fixtureFlag === "--qa-descriptor"
    ? fixturePathArgument
    : undefined;
if (
  args.length > 0 &&
  (!fixturePathArgument ||
    args.length !== 2 ||
    !(
      (mode === "local" && fixtureFlag === "--qa-descriptor") ||
      (mode === "live" &&
        fixtureFlag === "--default-connection-fixture" &&
        requestedFlow === "default-connection-new-cell")
    ))
)
  throw new Error("Invalid default connection fixture arguments");
const base =
  mode === "local"
    ? localFlowBase()
    : "https://labs.agent-native.com/analytics-2";
const names: string[] = [
  ...supplementalFlowNames,
  "new-project-interactive",
  "report-1794947464-agent-view",
  "agent-claim-readback",
  "open-dashboard",
  "connect-data-source",
  "report-792-819-824-org-cell-persistence",
  "ask-question-get-chart",
  "notebook-save-reload",
  "rename-persists",
  "sample-sql-runs",
  "cell-rename-persists",
  "hubspot-key-and-test",
  "setup-links",
  "connect-your-data-entry",
  "report-1794899464.159559-workspace-projects",
  "report-1794900799-home-recents",
  "filter-limits-and-escape",
  "report-1794900076.228569-home-focus",
  "report-1794900494.750729-popular",
  "report-1794913977.330369-bigquery-draft",
];
// Fail closed on unclassified checks; first-run checks remain in the core list.
startupStage("reading scope");
const scope = await readFile(
  new URL("../scope/analytics-2.md", import.meta.url),
  "utf8",
);
const nonCoreFlows = classifyFlows(scope, names);
if (requestedFlow && !names.includes(requestedFlow))
  throw new Error(`Unknown flow: ${requestedFlow}`);
const outputDir = resolve(".tmp/analytics-2-flows", `${mode}-${Date.now()}`);
const createdSchema = z.object({
  id: z.string().min(1),
  href: z.string().min(1),
});
const documentSchema = z.object({ project: projectDocumentSchema });
const fixtureLedger = openFixtureLedger(resolve(outputDir, "fixtures.jsonl"));
startupStage(`fixture ledger ${fixtureLedger.path}`);
const projects = new LedgerSet(fixtureLedger, "project");
const datasets = new LedgerSet(fixtureLedger, "dataset");
const threads = new LedgerSet(fixtureLedger, "thread");
for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"] as const)
  process.once(signal, () => {
    const left = readOutstandingFixtures(fixtureLedger.path)
      .map((fixture) => `${fixture.kind}:${fixture.id}`)
      .join(",");
    writeSync(
      2,
      `INTERRUPTED ${signal} outstanding=${left || "none"} ledger=${fixtureLedger.path}\n`,
    );
    process.exit(
      128 + (signal === "SIGINT" ? 2 : signal === "SIGHUP" ? 1 : 15),
    );
  });
type FlowStatus = "PASS" | "FAIL" | "COULD-NOT-RUN";
type FlowShotHooks = {
  root: string;
  record(input: {
    app: string;
    flow: string;
    status: FlowStatus;
    page: Page | null;
    sha: string | null;
    base: string;
    capture?: () => Promise<Buffer>;
  }): Promise<unknown>;
  invalidate(input: {
    app: string;
    flow: string;
    status: FlowStatus;
    sha: string | null;
  }): Promise<unknown>;
  observeBuild(input: {
    request: APIRequestContext;
    base: string;
  }): Promise<
    { kind: "read"; sha: string } | { kind: "absent" | "unreadable" }
  >;
};
function isFlowShotHooks(value: unknown): value is FlowShotHooks {
  return Boolean(
    value &&
    typeof value === "object" &&
    "root" in value &&
    typeof value.root === "string" &&
    "record" in value &&
    typeof value.record === "function" &&
    "invalidate" in value &&
    typeof value.invalidate === "function" &&
    "observeBuild" in value &&
    typeof value.observeBuild === "function",
  );
}
const injectedShots: unknown = Reflect.get(
  globalThis,
  "__agentNativeFlowShots",
);
let flowShots: FlowShotHooks | undefined;
if (injectedShots !== undefined) {
  if (!isFlowShotHooks(injectedShots))
    throw Error("Flow screenshot adapter is invalid");
  flowShots = injectedShots;
}
const verdicts: FlowStatus[] = [];
let shotSha: string | null = null;
type ConnectionFlowStage =
  | "open-home"
  | "check-access"
  | "check-recovery"
  | "list-connections"
  | "open-data"
  | "select-warehouse"
  | "open-picker"
  | "select-bigquery"
  | "form-ready"
  | "read-fixture"
  | "fill form"
  | "create connection"
  | "verify connection list"
  | "verify connection visible"
  | "verify stable uniqueness"
  | "browse catalog"
  | "run fixture query"
  | "cleanup";
let connectionFlowStage: ConnectionFlowStage | undefined;
const connectionStageSelectors: Partial<Record<ConnectionFlowStage, string>> = {
  "open-home": "route /home",
  "check-access": "action get-data-browser-access",
  "check-recovery": "action get-workspace-warehouse-connection-operation",
  "list-connections": "action list-data-connections",
  "open-data": "route /data",
  "select-warehouse": "text Warehouse",
  "open-picker": "button Add data connection or Connect your data",
  "select-bigquery": "text Google BigQuery",
  "form-ready": "text Service account configuration (JSON)",
};
function connectionErrorKind(error: unknown): string {
  if (error instanceof Error && error.name === "TimeoutError") return "timeout";
  if (error instanceof Error && error.message.startsWith("expect("))
    return "assertion";
  return "error";
}
class Unavailable extends Error {}
class ActionUnavailable extends Unavailable {
  constructor(
    detail: string,
    readonly action: string,
    readonly status: number,
    readonly errorCode: string,
  ) {
    super(detail);
  }
}
function message(error: unknown) {
  if (error instanceof AggregateError) return safeErrorDiagnostic(error);
  const raw = error instanceof Error ? error.message : String(error);
  return raw
    .replace(/\n\s*Call log:[\s\S]*/i, "")
    .replace(
      /\b(cookie|set-cookie|authorization|token|secret)\b\s*[:=]\s*[^\s,;]+/gi,
      "$1=[redacted]",
    )
    .replace(/https?:\/\/[^\s)'\"]+/g, (value) => {
      try {
        const url = new URL(value);
        return `${url.origin}${url.pathname}`;
      } catch {
        return "[url]";
      }
    })
    .slice(0, 350);
}
async function verdict(
  name: string,
  status: FlowStatus,
  detail: string,
  page: Page | null = null,
  evidence?: FlowEvidence,
) {
  if (flowShots && name !== "cleanup") {
    await recordFlowEvidence(
      flowShots.record,
      {
        app: "analytics-2",
        flow: name,
        status,
        page,
        sha: shotSha,
        base,
      },
      evidence,
    );
  }
  verdicts.push(status);
  console.log(
    `${status} ${name}: ${detail.replace(/\s+/g, " ").slice(0, 700)}`,
  );
}

async function boundedVerdict(
  name: string,
  status: FlowStatus,
  detail: string,
  page: Page | null,
  before: BuildObservation,
  buildRequest: APIRequestContext,
  evidence?: FlowEvidence,
) {
  if (mode !== "live") return verdict(name, status, detail, page, evidence);
  const result = await finishBuildVerdict(status, detail, before, () =>
    observeBuild(buildRequest, base),
  );
  shotSha =
    result.status === status &&
    result.after.kind === "read" &&
    result.before.kind === "read" &&
    result.before.sha === result.after.sha
      ? result.after.sha
      : null;
  await writeFile(
    `${outputDir}/${name}.build.json`,
    JSON.stringify(
      {
        name,
        status: result.status,
        observedStatus: status,
        detail,
        before: result.before,
        after: result.after,
      },
      null,
      2,
    ),
  );
  console.log(flowBuildLine(name, result.before, result.after));
  return verdict(name, result.status, result.detail, page, evidence);
}

type ProfilePolicy = "configured" | "admin" | "qa";
type QAProfile = {
  email: string;
  workspaceId: string;
  browserContextId?: string;
  emittedFlowIds?: string[] | undefined;
  runtime?: "production" | "development";
  providerFixture?: { kind: "local-fake-bigquery"; url: string } | undefined;
};
function matchesProfile(
  policy: ProfilePolicy,
  profile: {
    user: { email: string };
    workspace: { id: string };
    features: { canCreateProject: boolean; isAdmin: boolean };
  },
  qaProfile: QAProfile,
) {
  if (
    profile.user.email.toLowerCase() !== qaProfile.email.toLowerCase() ||
    profile.workspace.id !== qaProfile.workspaceId
  )
    return false;
  if (policy === "qa") return true;
  return (
    profile.features.canCreateProject &&
    (policy !== "admin" || profile.features.isAdmin)
  );
}

async function readQAProfile(): Promise<QAProfile> {
  let raw: string;
  try {
    raw = await readFile(
      mode === "local"
        ? (localDescriptor ??
            resolve(
              import.meta.dirname,
              "../../../.tmp/analytics-2-local-qa.json",
            ))
        : resolve(
            homedir(),
            ".config/agent-native-qa/analytics-2-profile.json",
          ),
      "utf8",
    );
  } catch (error) {
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      error.code === "ENOENT"
    )
      throw new Unavailable("QA profile fixture is absent");
    throw new Error("QA profile fixture could not be read");
  }
  try {
    const value: unknown = JSON.parse(raw);
    if (mode === "local") {
      return z
        .object({
          base: z.literal(base),
          email: z.literal("qa-fleet@builder.io"),
          workspaceId: z.string().min(1),
          browserContextId: z.string().min(1),
          emittedFlowIds: z.array(z.string()).optional(),
          runtime: z.enum(["production", "development"]),
          providerFixture: z
            .object({
              kind: z.literal("local-fake-bigquery"),
              url: z.string().url(),
            })
            .strict()
            .optional(),
        })
        .strict()
        .parse(value);
    }
    return z
      .object({
        email: z.literal("qa-fleet@builder.io"),
        workspaceId: z.string().min(1),
      })
      .strict()
      .parse(value);
  } catch {
    throw new Error("QA profile fixture is invalid");
  }
}

async function reuseCookies(
  context: BrowserContext,
  policy: ProfilePolicy = "configured",
) {
  const qaProfile = await readQAProfile();
  if (policy === "admin") await context.clearCookies();
  // Copy cookies into the run's isolated context, never the default context.
  {
    const { url: address } = await qaBrowserEndpoint();
    const port = address.port;
    const socket = new WebSocket(address.href);
    try {
      const cookies = await new Promise<unknown>((accept, reject) => {
        const timer = setTimeout(
          () => reject(new Error("Cookie reuse timed out")),
          4000,
        );
        socket.addEventListener(
          "open",
          () =>
            socket.send(
              JSON.stringify({
                id: 1,
                method: "Storage.getCookies",
                ...(mode === "local"
                  ? { params: { browserContextId: qaProfile.browserContextId } }
                  : {}),
              }),
            ),
          { once: true },
        );
        socket.addEventListener(
          "error",
          () => {
            clearTimeout(timer);
            reject(new Error("Cookie reuse unavailable"));
          },
          { once: true },
        );
        socket.addEventListener("message", (event) => {
          const value = z
            .object({
              id: z.number().optional(),
              result: z
                .object({
                  cookies: z.array(z.unknown()),
                })
                .optional(),
            })
            .parse(JSON.parse(String(event.data)));
          if (value.id === 1) {
            clearTimeout(timer);
            value.result
              ? accept(value.result.cookies)
              : reject(new Error("Cookie read failed"));
          }
        });
      });
      const relevant = playwrightCookiesFromCdp(cookies, `${base}/`);
      if (relevant.length) {
        await context.clearCookies();
        await context.addCookies(relevant);
        const shell = await context.request.get(
          `${base}/_agent-native/actions/get-workspace-shell`,
          { headers: { "x-agent-native-frontend": "1" } },
        );
        if (shell.ok()) {
          const capabilities = z
            .object({
              workspace: z.object({ id: z.string() }),
              user: z.object({ email: z.string() }),
              features: z.object({
                canCreateProject: z.boolean(),
                isAdmin: z.boolean(),
              }),
            })
            .parse(await shell.json());
          if (!matchesProfile(policy, capabilities, qaProfile))
            throw new Unavailable(
              "QA identity or workspace does not match the required fixture",
            );
          const status = await context.request.get(
            `${base}/_agent-native/agent-engine/status`,
            { headers: { "x-agent-native-frontend": "1" } },
          );
          let readinessSummary: string;
          if (!status.ok())
            readinessSummary = `readiness-http=${status.status()}`;
          else {
            const readiness = z
              .object({
                configured: z.boolean(),
                chatEligible: z.boolean(),
              })
              .passthrough()
              .safeParse(await status.json());
            readinessSummary = readiness.success
              ? `configured=${readiness.data.configured} chatEligible=${readiness.data.chatEligible}`
              : "readiness-payload=invalid";
          }
          console.log(
            `AUTH localhost:${port} email=${capabilities.user.email} workspace=${capabilities.workspace.id} create-project=${capabilities.features.canCreateProject} admin=${capabilities.features.isAdmin} ${readinessSummary}`,
          );
          if (matchesProfile(policy, capabilities, qaProfile)) return;
        } else
          throw new Error(`QA workspace verification HTTP ${shell.status()}`);
      }
    } finally {
      socket.close();
    }
  }
  throw new Unavailable(
    "The required QA browser profile is unavailable or lacks permission",
  );
}

async function action(
  page: Page,
  name: string,
  input: Record<string, unknown>,
  method: "GET" | "POST" = "POST",
  surface: "actions" | "webmcp/actions" = "actions",
): Promise<unknown> {
  const query =
    method === "GET"
      ? `?${new URLSearchParams(Object.entries(input).map(([key, value]) => [key, String(value)]))}`
      : "";
  const response = await fetchUiAction(
    page.request,
    base,
    `${base}/_agent-native/${surface}/${name}${query}`,
    {
      method,
      headers: {
        "content-type": "application/json",
      },
      ...(method === "POST" ? { data: input } : {}),
      timeout: 60000,
    },
  );
  if (!response.headers()["content-type"]?.includes("application/json"))
    throw new Error(
      `${name}: HTTP ${response.status()} returned a non-JSON response`,
    );
  const result = {
    status: response.status(),
    body: (await response.json()) as unknown,
  };
  if (result.status !== 200) {
    const detail = failureDiagnostic(
      name,
      method,
      result.status,
      result.body,
      undefined,
      undefined,
      {
        connectionId:
          typeof input.connectionId === "string"
            ? input.connectionId
            : undefined,
        stage: connectionFlowStage,
      },
    );
    console.log(`ACTION-FAILURE ${detail}`);
    if ([401, 403].includes(result.status))
      throw new ActionUnavailable(
        detail,
        name,
        result.status,
        typedCode(result.body),
      );
    throw new Error(detail);
  }
  return result.body;
}

async function create(page: Page, purpose: string) {
  const title = `QA flow ${purpose} ${randomUUID()}`;
  const project = createdSchema.parse(
    await action(page, "create-project", { title }),
  );
  projects.add(project.id);
  console.log(`CREATED project ${project.id}`);
  return { ...project, title };
}
function waitForCreateProject(page: Page) {
  return waitForJsonResponse(
    page,
    (response) =>
      response.request().method() === "POST" &&
      response.url().includes("/_agent-native/actions/create-project"),
    createdSchema,
    { onParsed: (created) => projects.add(created.id) },
  );
}
async function createFromHome(page: Page) {
  await open(page, "/home");
  // oracle-change: Home now creates inline; retain the accepted-route and prompt deadlines.
  const [result] = await Promise.all([
    waitForCreateProject(page),
    page.getByRole("button", { name: "Project", exact: true }).click(),
  ]);
  if (!result.ok) throw new Error(`Create project HTTP ${result.status}`);
  const created = result.body;
  await expect(page).toHaveURL(
    new RegExp(`/project/${encodeURIComponent(created.id)}/latest`),
    { timeout: 2000 },
  );
  return created;
}
async function open(page: Page, href: string) {
  await page.goto(`${base}${href}`, { waitUntil: "domcontentloaded" });
}
// Draft run results live in the notebook execution store, not in get-project outputs.
async function draftResultRows(
  page: Page,
  projectId: string,
  cellId: string,
): Promise<{ rows: number | null; seen: string }> {
  const execution = z
    .object({
      status: z.string(),
      cells: z
        .record(z.string(), z.object({ resultId: z.string().nullable() }))
        .optional(),
    })
    .parse(await action(page, "get-notebook-execution", { projectId }, "GET"));
  const resultId = execution.cells?.[cellId]?.resultId;
  if (!resultId)
    return { rows: null, seen: `execution ${execution.status}, no result id` };
  const result = z
    .object({
      status: z.string(),
      rows: z.array(z.array(z.unknown())).optional(),
    })
    .parse(await action(page, "get-notebook-result-page", { resultId }, "GET"));
  return {
    rows: result.status === "ready" ? (result.rows?.length ?? 0) : null,
    seen: `result page ${result.status}`,
  };
}

async function read(page: Page, id: string) {
  return documentSchema.parse(
    await action(page, "get-project", { projectId: id }, "GET"),
  ).project;
}
function threadIdFromSnapshotRequest(method: string, requestUrl: string) {
  if (method !== "PUT") return null;
  const baseUrl = new URL(base);
  const url = new URL(requestUrl);
  if (url.origin !== baseUrl.origin) return null;
  const basePath = baseUrl.pathname.replace(/\/$/, "");
  const pathname = url.pathname.startsWith(`${basePath}/`)
    ? url.pathname.slice(basePath.length)
    : url.pathname;
  const prefix = "/_agent-native/agent-chat/threads/";
  if (!pathname.startsWith(prefix)) return null;
  const encodedId = pathname.slice(prefix.length);
  if (!encodedId || encodedId.includes("/")) return null;
  return decodeURIComponent(encodedId);
}

const snapshotProbeId = "thread-e2e-contract-only";
const threadApiPath = `/_agent-native/agent-chat/threads/${snapshotProbeId}`;
const baseUrl = new URL(base);
const appPath = baseUrl.pathname.replace(/\/$/, "");
expect(
  threadIdFromSnapshotRequest(
    "PUT",
    new URL(threadApiPath, baseUrl.origin).href,
  ),
).toBe(snapshotProbeId);
expect(
  threadIdFromSnapshotRequest(
    "PUT",
    new URL(`${appPath}${threadApiPath}`, baseUrl.origin).href,
  ),
).toBe(snapshotProbeId);
expect(
  threadIdFromSnapshotRequest(
    "GET",
    new URL(threadApiPath, baseUrl.origin).href,
  ),
).toBeNull();
expect(
  threadIdFromSnapshotRequest(
    "PUT",
    new URL("/_agent-native/not-agent-chat/threads/unrelated", baseUrl.origin)
      .href,
  ),
).toBeNull();
expect(
  threadIdFromSnapshotRequest(
    "PUT",
    `https://elsewhere.invalid${threadApiPath}`,
  ),
).toBeNull();
expect(() =>
  threadIdFromSnapshotRequest(
    "PUT",
    new URL("/_agent-native/agent-chat/threads/%ZZ", baseUrl.origin).href,
  ),
).toThrow(URIError);

startupStage("creating output directory");
await mkdir(outputDir, { recursive: true });
startupStage("creating request context");
const buildRequest = await request.newContext();
startupStage("observing build");
const setupBuild: BuildObservation =
  mode === "live"
    ? await observeBuild(buildRequest, base)
    : { kind: "unreadable", reason: "Local run" };
let browser;
try {
  startupStage("connecting to QA browser");
  browser = await openQaBrowser();
  startupStage("QA browser connected");
} catch (error) {
  for (const name of requestedFlow ? [requestedFlow] : names) {
    if (nonCoreFlows.has(name)) {
      console.log(`SKIP ${name}: Labs/Cut scope`);
      continue;
    }
    await boundedVerdict(
      name,
      "COULD-NOT-RUN",
      `QA browser unavailable: ${message(error)}`,
      null,
      { kind: "unreadable", reason: "Flow not started" },
      buildRequest,
    );
  }
  process.exitCode = requestedFlow && nonCoreFlows.has(requestedFlow) ? 0 : 2;
}
if (browser) {
  startupStage("creating browser context");
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
  });
  context.setDefaultTimeout(25000);
  startupStage("creating setup page");
  const setup = await context.newPage();
  const setupFailures: string[] = [];
  const pendingDiagnostics = new ResponseDiagnostics();
  function recordFailure(response: Response, failures: string[]) {
    if (response.status() < 400 || !response.url().startsWith(`${base}/`))
      return;
    const observedAt = new Date().toISOString();
    const path = new URL(response.url()).pathname;
    const actionName = path.match(
      /\/(?:webmcp\/)?actions\/([a-z][a-z0-9-]*)$/,
    )?.[1];
    pendingDiagnostics.record(
      () => response.json(),
      (body) => {
        const detail = failureDiagnostic(
          actionName,
          response.request().method(),
          response.status(),
          body,
          observedAt,
          path.slice(new URL(base).pathname.replace(/\/$/, "").length),
          {
            connectionId: new URL(response.url()).searchParams.get(
              "connectionId",
            ),
            stage: connectionFlowStage,
          },
        );
        failures.push(detail);
        console.log(`HTTP-FAILURE ${detail}`);
      },
      () => failures.push("HTTP failure diagnostic unreadable"),
    );
  }
  setup.on("pageerror", (error) =>
    setupFailures.push(`pageerror ${safeErrorDiagnostic(error)}`),
  );
  setup.on("console", (item) => {
    if (item.type() === "error") setupFailures.push("browser console error");
  });
  setup.on("response", (response) => recordFailure(response, setupFailures));
  let setupError: unknown;
  let emittedFlowIds = new Set<string>();
  try {
    startupStage("reusing QA cookies");
    await reuseCookies(context, "qa");
    if (mode === "local") {
      const qaProfile = await readQAProfile();
      const shell = await context.request.get(
        `${base}/_agent-native/actions/get-workspace-shell`,
        {
          headers: { "x-agent-native-frontend": "1" },
        },
      );
      if (!shell.ok())
        throw new Unavailable(`Local QA verification HTTP ${shell.status()}`);
      const capabilities = z
        .object({
          user: z.object({ email: z.string() }),
          workspace: z.object({ id: z.string() }),
          features: z.object({
            canCreateProject: z.boolean(),
            isAdmin: z.boolean(),
          }),
        })
        .parse(await shell.json());
      if (!matchesProfile("qa", capabilities, qaProfile))
        throw new Unavailable(
          "Local session does not match the required QA email and workspace; no app actions or onboarding writes permitted",
        );
      emittedFlowIds = new Set(qaProfile.emittedFlowIds ?? []);
      console.log(
        `AUTH local email=${capabilities.user.email} workspace=${capabilities.workspace.id}`,
      );
    }
    startupStage("navigating to app");
    const response = await setup.goto(`${base}/`, {
      waitUntil: "domcontentloaded",
      timeout: 45000,
    });
    console.log(
      `TARGET ${base} served-sha=${response?.headers()["x-agent-native-build-sha"] ?? "absent"}`,
    );
    if (!requestedFlow)
      await action(setup, "list-projects", { view: "active" }, "GET");
    if (mode === "local") {
      const onboarding = await context.request.get(
        `${base}/_agent-native/onboarding/first-run/status`,
      );
      if (!onboarding.ok())
        throw new Unavailable(`First-run status HTTP ${onboarding.status()}`);
      if (
        z.object({ firstRun: z.boolean() }).parse(await onboarding.json())
          .firstRun
      ) {
        await setup.getByRole("button", { name: "Skip", exact: true }).click();
        await expect(
          setup.getByText("Start your first analysis", { exact: true }),
        ).toBeHidden({ timeout: 25000 });
      }
    }
  } catch (error) {
    setupError = error;
    if (!flowShots)
      await setup.screenshot({
        path: `${outputDir}/setup.png`,
        fullPage: true,
      });
    console.log(
      `SETUP ${message(error).slice(0, 350)} ${setupFailures.join("; ")}`,
    );
  }

  if (flowShots) {
    const observation = await flowShots.observeBuild({
      request: context.request,
      base,
    });
    if (observation.kind === "read") shotSha = observation.sha;
    else
      console.error(
        `FLEET_SHOT_UNVERIFIED analytics-2: initial build ${observation.kind}`,
      );
  }

  const expectedFailures = new WeakMap<Page, ExpectedRuntimeFailure>();
  const flows: Array<[string, (page: Page) => Promise<void | FlowEvidence>]> = [
    [
      "report-1794899464.159559-workspace-projects",
      (page) => checkWorkspaceProjects(page, base),
    ],
    [
      "report-1794900076.228569-home-focus",
      (page) => checkHomeFocus(page, base),
    ],
    ["report-1794900799-home-recents", (page) => checkHomeRecents(page, base)],
    ["filter-limits-and-escape", (page) => checkFilterLimits(page, base)],
    ["report-1794900494.750729-popular", (page) => checkPopular(page, base)],
    [
      "report-1794913977.330369-bigquery-draft",
      (page) => checkBigQueryDraft(page, base),
    ],
    [
      "connect-your-data-entry",
      async (page) => {
        await page.goto(`${base}/home`, { waitUntil: "domcontentloaded" });
        const link = page.getByRole("link", {
          name: "Connect your data",
          exact: true,
        });
        await expect(link).toBeVisible();
        await link.click();
        const picker = page.getByRole("dialog", {
          name: "Add a data connection",
        });
        await expect(picker).toBeVisible();
        await expect(page).toHaveURL(`${base}/home/data?connect=1`);
        await expect(
          page.getByText("Personal preferences", { exact: true }),
        ).toHaveCount(0);
        await picker.getByText("Google BigQuery", { exact: true }).click();
        await expect(
          page
            .getByText("Service account configuration (JSON)", { exact: false })
            .first(),
        ).toBeVisible();
        const dialog = page.getByRole("dialog");
        await dialog
          .getByRole("button", { name: "Add a data connection", exact: true })
          .click();
        await expect(picker).toBeVisible();
        await dialog
          .getByRole("button", { name: "Close", exact: true })
          .click();
        await expect(picker).toHaveCount(0);
        await expect(page).toHaveURL(`${base}/home/data`);
        await page.goBack();
        await expect(page).toHaveURL(`${base}/home`);
        await page.goto(`${base}/home/data?connect=1`, {
          waitUntil: "domcontentloaded",
        });
        await expect(picker).toBeVisible();
      },
    ],
    [
      "report-792-819-824-org-cell-persistence",
      async (page) => {
        if (mode === "local")
          throw new Unavailable(
            "Organization BigQuery requires the live QA fixture",
          );
        const connectionId = "__analytics_2_org_source__";
        const connections = z
          .object({ connections: z.array(z.object({ id: z.string() })) })
          .parse(await action(page, "list-data-connections", {}, "GET"));
        if (
          !connections.connections.some(
            (connection) => connection.id === connectionId,
          )
        )
          throw new Unavailable("Organization BigQuery fixture is unavailable");
        const catalog = z.object({
          items: z.array(
            z.object({
              id: z.string(),
              kind: z.string(),
              hasChildren: z.boolean().optional(),
            }),
          ),
        });
        const root = catalog.parse(
          await action(
            page,
            "list-connection-datasets",
            { connectionId, first: 10 },
            "GET",
          ),
        );
        const parent = root.items.find((item) => item.hasChildren);
        if (!parent)
          throw new Unavailable(
            "Organization BigQuery fixture has no browsable schema",
          );
        const child = catalog.parse(
          await action(
            page,
            "list-connection-datasets",
            { connectionId, parentId: parent.id, first: 10 },
            "GET",
          ),
        );
        if (!child.items.some((item) => item.kind === "table"))
          throw new Unavailable(
            "Organization BigQuery fixture has no table on the first schema page",
          );
        const refreshed = z
          .object({
            refreshState: z.string(),
            refreshError: z.unknown().nullable(),
          })
          .parse(
            await action(page, "refresh-data-browser-catalog", {
              connectionId,
            }),
          );
        expect(refreshed.refreshState).toBe("ready");
        expect(refreshed.refreshError).toBeNull();
        const project = await create(page, "org-sql");
        try {
          await action(page, "add-project-cell", {
            projectId: project.id,
            kind: "sql",
          });
          const cell = (await read(page, project.id)).cells.find(
            (item) => item.contents.kind === "sql",
          );
          if (!cell || cell.contents.kind !== "sql")
            throw new Error("SQL cell missing");
          const source = "SELECT 1 AS qa_value";
          await action(page, "save-project-cell", {
            projectId: project.id,
            cellId: cell.id,
            expectedUpdatedAt: cell.updatedAt,
            contents: {
              ...cell.contents,
              dataConnectionId: connectionId,
              source,
            },
          });
          const saved = (await read(page, project.id)).cells.find(
            (item) => item.id === cell.id,
          );
          expect(saved?.contents).toMatchObject({
            kind: "sql",
            dataConnectionId: connectionId,
            source,
          });
          const query = z.object({
            status: z.enum(["running", "complete", "error"]),
            output: z
              .object({
                type: z.string(),
                columns: z.array(z.object({ name: z.string() })),
                rows: z.array(z.array(z.unknown())),
              })
              .nullable(),
          });
          let result = query.parse(
            await action(page, "run-project-cell", {
              projectId: project.id,
              cellId: cell.id,
            }),
          );
          const deadline = Date.now() + 45000;
          while (result.status === "running" && Date.now() < deadline) {
            await new Promise((resolve) => setTimeout(resolve, 2000));
            result = query.parse(
              await action(page, "run-project-cell", {
                projectId: project.id,
                cellId: cell.id,
                operation: "poll",
              }),
            );
          }
          expect(result.status).toBe("complete");
          expect(result.output?.type).toBe("table");
          expect(result.output?.columns.map((column) => column.name)).toEqual([
            "qa_value",
          ]);
          expect(result.output?.rows.map((row) => row.map(String))).toEqual([
            ["1"],
          ]);
          const assertPersistedOutput = async () => {
            const document = z
              .object({
                outputs: z.record(
                  z.string(),
                  z.object({ output: query.shape.output }),
                ),
              })
              .parse(
                await action(
                  page,
                  "get-project",
                  { projectId: project.id },
                  "GET",
                ),
              );
            const output = document.outputs[cell.id]?.output;
            expect(output?.type).toBe("table");
            expect(output?.columns.map((column) => column.name)).toEqual([
              "qa_value",
            ]);
            expect(output?.rows.map((row) => row.map(String))).toEqual([["1"]]);
          };
          await assertPersistedOutput();
          await open(page, project.href);
          const output = page.locator(
            `[data-notebook-cell="${cell.id}"] .nb-output-section`,
          );
          await expect(
            output.getByRole("columnheader", { name: "qa_value" }),
          ).toBeVisible();
          await expect(
            output.getByRole("cell", { name: "1", exact: true }),
          ).toBeVisible();
          await page.reload();
          await expect(
            output.getByRole("columnheader", { name: "qa_value" }),
          ).toBeVisible();
          await expect(
            output.getByRole("cell", { name: "1", exact: true }),
          ).toBeVisible();
          await assertPersistedOutput();
          const reloaded = (await read(page, project.id)).cells.find(
            (item) => item.id === cell.id,
          );
          expect(reloaded?.contents).toMatchObject({
            kind: "sql",
            dataConnectionId: connectionId,
            source,
          });
        } finally {
          await leaveProject(page, base);
          await action(page, "trash-project", { projectId: project.id });
          await action(page, "delete-project", { projectId: project.id });
          const absent = await page.request.get(
            `${base}/_agent-native/actions/get-project`,
            {
              params: { projectId: project.id },
              headers: { "x-agent-native-frontend": "1" },
            },
          );
          expect(absent.status()).toBe(404);
          projects.delete(project.id);
          console.log(`CLEANUP project ${project.id} GET404`);
        }
      },
    ],
    [
      "setup-links",
      async (page) => {
        await page.goto(`${base}/home`, { waitUntil: "domcontentloaded" });
        const nativeBefore =
          mode === "live" ? await observeBuild(buildRequest, base) : setupBuild;
        await boundedVerdict(
          "builder-native-authorization",
          "COULD-NOT-RUN",
          "Native Desktop popup admission requires the real host; browser automation cannot prove the authorization window",
          null,
          nativeBefore,
          buildRequest,
        );
        const link = page.getByRole("link", {
          name: "Connect AI",
          exact: true,
        });
        if (mode === "live" && !(await link.isVisible()))
          throw new Unavailable(
            "Custom keys setup link is absent for this account; existing configured state is not a first-run fixture",
          );
        await expect(link).toBeVisible();
        const href = await link.getAttribute("href");
        const target = new URL(href ?? "", page.url());
        expect(target.origin).toBe(new URL(base).origin);
        expect(target.pathname).toMatch(
          new RegExp(
            `^${new URL(base).pathname.replace(/\/$/, "")}/settings/(?:model|keys)$`,
          ),
        );
        // The link opens settings in a new tab; follow its href in this one.
        await page.goto(target.href, { waitUntil: "domcontentloaded" });
        await expect(
          page.getByText("AI provider", { exact: true }),
        ).toBeVisible();
        await checkSettingsPreferences(page, base);
      },
    ],
    [
      "open-dashboard",
      async (page) => {
        await page.goto(`${base}/home`, { waitUntil: "domcontentloaded" });
        await expect(page).toHaveTitle("Home");
        await page.goto(`${base}/home/all`, { waitUntil: "domcontentloaded" });
        await expect(page).toHaveTitle("Projects");
        const project = await create(page, "open");
        const list = z
          .object({ projects: z.array(z.object({ id: z.string() })) })
          .parse(
            await action(
              page,
              "list-projects",
              { view: "active", search: project.title },
              "GET",
            ),
          );
        expect(list.projects.map((item) => item.id)).toContain(project.id);
        await open(page, project.href);
        await expect(page).toHaveTitle(`${project.title} (Editing)`);
        await expect(
          page.getByText(project.title, { exact: true }).first(),
        ).toBeVisible();
        await expect(
          page.getByText("Query", { exact: true }).first(),
        ).toBeVisible();
        expect((await read(page, project.id)).title).toBe(project.title);
        await open(page, `${project.href}/ui`);
        await expect(
          page.getByText(project.title, { exact: true }).first(),
        ).toBeVisible();
        await page.goBack({ waitUntil: "domcontentloaded" });
        await expect(page).toHaveTitle(`${project.title} (Editing)`);
        const missingId = `missing-${randomUUID()}`;
        const expectedFailure = expectedMissingProjectFailure(base, missingId);
        expectedFailures.set(page, expectedFailure);
        const [missingResponse] = await Promise.all([
          page.waitForResponse((response) =>
            expectedFailure.response({
              url: response.url(),
              method: response.request().method(),
              status: response.status(),
            }),
          ),
          open(page, `/project/${missingId}/latest`),
        ]);
        expect(missingResponse.status()).toBe(404);
        await expect(page.getByText("Project not found")).toBeVisible();
      },
    ],
    [
      "connect-data-source",
      async (page) => {
        connectionFlowStage = "check-access";
        const access = z
          .object({ canBrowseData: z.boolean(), canAddConnection: z.boolean() })
          .parse(await action(page, "get-data-browser-access", {}, "GET"));
        if (!access.canBrowseData || !access.canAddConnection)
          throw new Unavailable(
            `Current account lacks Data browser/connection permission (browse=${access.canBrowseData}, add=${access.canAddConnection})`,
          );
        if (mode === "live") {
          connectionFlowStage = "check-recovery";
          const preflight = await page.request.get(
            `${base}/_agent-native/actions/get-workspace-warehouse-connection-operation?operationId=${encodeURIComponent(randomUUID())}`,
            { headers: { "x-agent-native-frontend": "1" } },
          );
          if (preflight.status() === 404)
            throw new Unavailable(
              "Native connection recovery is not available on this build",
            );
          if (preflight.status() === 403) {
            const body = z
              .object({ errorCode: z.literal("ui_capability_required") })
              .safeParse(await preflight.json());
            if (!body.success)
              throw new Error(
                "Native connection recovery preflight was denied",
              );
          } else if (!preflight.ok() || (await preflight.json()) !== null) {
            throw new Error("Native connection recovery preflight failed");
          }
        }
        connectionFlowStage = "list-connections";
        const granted = z
          .object({
            connections: z.array(
              z.object({
                id: z.string(),
                name: z.string(),
                type: z.string(),
                isDraft: z.boolean(),
                shared: z.boolean(),
              }),
            ),
          })
          .parse(await action(page, "list-data-connections", {}, "GET"));
        const warehouses = granted.connections.filter(
          (item) => item.type !== "sample" && !item.isDraft,
        );
        console.log(
          `CONNECTIONS granted-warehouses=${warehouses.length} shared=${warehouses.filter((item) => item.shared).length} types=${[...new Set(warehouses.map((item) => item.type))].join(",") || "none"}`,
        );
        connectionFlowStage = "open-data";
        await open(page, "/data");
        connectionFlowStage = "select-warehouse";
        await page.getByText("Warehouse", { exact: true }).click();
        connectionFlowStage = "open-picker";
        await page
          .getByRole("button", {
            name: /^(Add data connection|Connect your data)/,
          })
          .click();
        connectionFlowStage = "select-bigquery";
        await page.getByText("Google BigQuery", { exact: true }).click();
        connectionFlowStage = "form-ready";
        await expect(
          page
            .getByText("Service account configuration (JSON)", { exact: false })
            .first(),
        ).toBeVisible();
        connectionFlowStage = "read-fixture";
        let rawCredential: string;
        let fakeUrl: URL | undefined;
        if (mode === "local") {
          const profile = await readQAProfile();
          if (profile.runtime !== "production" || !profile.providerFixture)
            throw new Unavailable("Local fake BigQuery fixture is unavailable");
          try {
            fakeUrl = new URL(profile.providerFixture.url);
            if (
              fakeUrl.protocol !== "http:" ||
              fakeUrl.hostname !== "127.0.0.1" ||
              !fakeUrl.port ||
              fakeUrl.username ||
              fakeUrl.password ||
              fakeUrl.pathname !== "/" ||
              fakeUrl.search ||
              fakeUrl.hash
            )
              throw new Error("Invalid loopback URL");
            const response = await fetch(
              new URL("/__control/scenario", fakeUrl),
              { signal: AbortSignal.timeout(5000) },
            );
            if (!response.ok) throw new Error("Fake provider unavailable");
            z.object({
              projectId: z.literal("local-fake-project"),
              bigquery: z.literal("ok"),
              tables: z.array(
                z.object({ dataset: z.string(), name: z.string() }),
              ),
            })
              .refine((scenario) =>
                scenario.tables.some(
                  (table) =>
                    table.dataset === "agent_native_qa" &&
                    table.name === "sample_words",
                ),
              )
              .parse(await response.json());
          } catch (error) {
            throw new Error(
              "Local fake BigQuery fixture is unreadable or invalid",
              {
                cause: error,
              },
            );
          }
          rawCredential = JSON.stringify(fakeServiceAccountKey());
          console.log("BIGQUERY using isolated local fake provider");
        } else {
          try {
            rawCredential = await readFile(
              resolve(
                homedir(),
                ".config/agent-native-qa/bigquery-qa-key.json",
              ),
              "utf8",
            );
          } catch (error) {
            if (
              error &&
              typeof error === "object" &&
              "code" in error &&
              error.code === "ENOENT"
            )
              throw new Unavailable(
                "BigQuery form opened; disposable service-account fixture is absent",
              );
            throw new Error("BigQuery fixture could not be read");
          }
        }
        const datasetName = "agent_native_qa";
        const tableName = "sample_words";
        let projectId: string;
        try {
          const credential = z
            .object({
              type: z.literal("service_account"),
              project_id: z.string().regex(/^[a-z][a-z0-9-]{4,61}[a-z0-9]$/),
              client_email: z.string().email(),
              private_key: z.string().min(1),
            })
            .parse(JSON.parse(rawCredential));
          projectId = credential.project_id;
        } catch {
          throw new Error("BigQuery fixture is invalid");
        }
        const stableName = fakeUrl
          ? `Local fake BigQuery ${randomUUID()}`
          : "QA BigQuery read-only fixture";
        if (warehouses.filter((item) => item.name === stableName).length > 1)
          throw new Error("BigQuery fixture has duplicate saved connections");
        const stableExists = warehouses.some(
          (item) => item.name === stableName,
        );
        const name = stableExists
          ? `${stableName} ${randomUUID()}`
          : stableName;
        let connectionId: string | undefined;
        let operationId: string | undefined;
        let createRequests = 0;
        let writer: "native" | "legacy" | undefined;
        let recoveryResponse: Response | undefined;
        let primaryFailure: string | undefined;
        let fixtureProjectId: string | undefined;
        let completed = false;
        const creationState: { submitted: boolean } = { submitted: false };
        connectionFlowStage = "fill form";
        const listConnections = async () =>
          z
            .object({
              connections: z.array(
                z.object({
                  id: z.string(),
                  name: z.string(),
                  type: z.string(),
                  isDraft: z.boolean(),
                }),
              ),
            })
            .parse(await action(page, "list-data-connections", {}, "GET"))
            .connections;
        const field = page.locator('input[name="serviceAccount"]');
        const captureOperation = (request: Request) => {
          const path = new URL(request.url()).pathname;
          if (request.method() !== "POST") return;
          if (path.endsWith("/actions/create-workspace-warehouse-form"))
            writer = "native";
          else if (path.endsWith("/actions/save-data-connection"))
            writer = "legacy";
          else return;
          creationState.submitted = true;
          createRequests += 1;
          let body: unknown;
          try {
            body = request.postDataJSON();
          } catch {
            body = undefined;
          }
          const captured = readRequestId(body);
          if (captured) {
            operationId = captured;
            try {
              retainRequestId(
                resolve(".tmp/analytics-owner"),
                captured,
                writer,
              );
            } catch {
              console.log(`BIGQUERY request-id receipt unwritable ${captured}`);
            }
          }
          console.log(
            `BIGQUERY writer=${writer} request-id=${operationId ?? "unreadable"}`,
          );
        };
        const captureRecovery = (response: Response) => {
          const url = new URL(response.url());
          if (
            url.pathname.endsWith(
              "/actions/get-workspace-warehouse-connection-operation",
            ) &&
            response.request().method() === "GET" &&
            operationId &&
            url.searchParams.get("operationId") === operationId
          )
            recoveryResponse = response;
        };
        const recoverLegacyConnection = async () => {
          if (writer !== "legacy" || !operationId || connectionId) return;
          const result = z
            .object({
              connection: z.object({ id: z.string().min(1), name: z.string() }),
            })
            .parse(
              await action(
                page,
                "get-data-connection-save-result",
                { requestId: operationId },
                "GET",
              ),
            );
          expect(result.connection.name).toBe(name);
          connectionId = result.connection.id;
        };
        page.on("response", captureRecovery);
        page.on("request", captureOperation);
        try {
          await page.locator('input[name="name"]').fill(name);
          await page.locator('input[name="projectId"]').fill(projectId);
          await page.locator('input[name="datasetNames"]').fill(datasetName);
          const storageApi = page.locator('input[name="useBQStorageAPI"]');
          if (await storageApi.isChecked()) await storageApi.click();
          await field.fill(rawCredential);
          connectionFlowStage = "create connection";
          const [response] = await Promise.all([
            page.waitForResponse(
              (item) => {
                const path = new URL(item.url()).pathname;
                return (
                  item.request().method() === "POST" &&
                  (path.endsWith("/actions/create-workspace-warehouse-form") ||
                    path.endsWith("/actions/save-data-connection"))
                );
              },
              { timeout: 30000 },
            ),
            page
              .getByRole("button", { name: "Create connection", exact: true })
              .click(),
          ]);
          if (writer === "legacy") {
            await recoverLegacyConnection();
            throw new Error(
              "Native connection contract used the legacy writer",
            );
          }
          if (!response.ok()) throw new Error("Connection create rejected");
          expect(writer).toBe("native");
          expect(createRequests).toBe(1);
          await expect
            .poll(() => recoveryResponse !== undefined, { timeout: 120000 })
            .toBe(true);
          const recovery = recoveryResponse;
          if (!recovery?.ok()) throw new Error("Connection recovery rejected");
          connectionId = z
            .object({ connectionId: z.string().min(1) })
            .parse(await recovery.json()).connectionId;
          console.log(`BIGQUERY created connection-id=${connectionId}`);
          connectionFlowStage = "verify connection list";
          await expect
            .poll(
              async () =>
                (await listConnections()).find(
                  (item) =>
                    item.id === connectionId &&
                    item.name === name &&
                    item.type === "bigquery" &&
                    !item.isDraft,
                )?.id ?? null,
              { timeout: 120000, intervals: [1000, 3000, 5000] },
            )
            .not.toBeNull();
          connectionFlowStage = "verify connection visible";
          await expect(page.locator(".data-connection-form")).toHaveCount(0, {
            timeout: 120000,
          });
          await expect(
            page.getByText(name, { exact: true }).first(),
          ).toBeVisible();
          connectionFlowStage = "verify stable uniqueness";
          if (
            !stableExists &&
            (await listConnections()).filter((item) => item.name === stableName)
              .length !== 1
          )
            throw new Error("Stable fixture name is no longer unique");
          connectionFlowStage = "browse catalog";
          const catalogWait = await waitForCatalogReady({
            read: async () =>
              z
                .object({ refreshState: z.string() })
                .parse(
                  await action(
                    page,
                    "get-data-browser-catalog",
                    { connectionId, first: 1 },
                    "GET",
                  ),
                ).refreshState,
            isTransient: isTransientCatalogAvailability,
            timeoutMs: 90000,
            intervalsMs: [1000, 3000, 5000],
          });
          console.log(
            `BIGQUERY catalog ready attempts=${catalogWait.attempts} transient=${catalogWait.transientFailures}`,
          );
          const catalog = z
            .object({
              resources: z.array(
                z.object({
                  id: z.string(),
                  name: z.string(),
                  kind: z.string(),
                }),
              ),
            })
            .parse(
              await action(
                page,
                "get-data-browser-catalog",
                { connectionId, search: datasetName, first: 100 },
                "GET",
              ),
            );
          const dataset = catalog.resources.find(
            (item) => item.name === datasetName && item.kind === "schema",
          );
          if (!dataset)
            throw new Error("Fixture dataset is absent from the catalog");
          let tableFound = false;
          let after: string | undefined;
          const seenCursors = new Set<string>();
          for (let pageNumber = 0; pageNumber < 100; pageNumber++) {
            const tables = z
              .object({
                items: z.array(
                  z.object({ name: z.string(), kind: z.string() }),
                ),
                hasNextPage: z.boolean(),
                endCursor: z.string().nullable(),
              })
              .parse(
                await action(
                  page,
                  "list-connection-datasets",
                  {
                    connectionId,
                    parentId: dataset.id,
                    search: tableName,
                    first: 100,
                    ...(after ? { after } : {}),
                  },
                  "GET",
                ),
              );
            tableFound = tables.items.some(
              (item) => item.name === tableName && item.kind === "table",
            );
            if (tableFound || !tables.hasNextPage) break;
            if (!tables.endCursor || seenCursors.has(tables.endCursor))
              throw new Error("Fixture table cursor is invalid");
            seenCursors.add(tables.endCursor);
            after = tables.endCursor;
          }
          if (!tableFound)
            throw new Error("Fixture table is absent from the dataset");
          console.log("BIGQUERY fixture dataset and table visible");
          connectionFlowStage = "run fixture query";
          const project = await create(page, "bigquery-fixture");
          fixtureProjectId = project.id;
          await action(page, "add-project-cell", {
            projectId: project.id,
            kind: "sql",
          });
          const document = await read(page, project.id);
          const cell = document.cells.at(0);
          if (
            document.cells.length !== 1 ||
            !cell ||
            cell.contents.kind !== "sql"
          )
            throw new Error("Query cell missing");
          await action(page, "save-project-cell", {
            projectId: project.id,
            cellId: cell.id,
            contents: {
              ...cell.contents,
              dataConnectionId: connectionId,
              source: `SELECT * FROM \`${projectId}.${datasetName}.${tableName}\` LIMIT 10`,
            },
          });
          const querySchema = z.object({
            status: z.enum(["running", "complete", "error"]),
            output: z
              .object({ type: z.string(), rows: z.array(z.array(z.unknown())) })
              .nullable(),
          });
          let fakeCallCount = 0;
          if (fakeUrl) {
            const response = await fetch(new URL("/__control/calls", fakeUrl), {
              signal: AbortSignal.timeout(5000),
            });
            if (!response.ok) throw new Error("Fake provider calls unreadable");
            fakeCallCount = z
              .array(z.unknown())
              .parse(await response.json()).length;
          }
          let result = querySchema.parse(
            await action(page, "run-project-cell", {
              projectId: project.id,
              cellId: cell.id,
            }),
          );
          const deadline = Date.now() + 120000;
          while (result.status === "running" && Date.now() < deadline) {
            await new Promise((resolve) => setTimeout(resolve, 2000));
            result = querySchema.parse(
              await action(page, "run-project-cell", {
                projectId: project.id,
                cellId: cell.id,
                operation: "poll",
              }),
            );
          }
          if (
            result.status !== "complete" ||
            result.output?.type !== "table" ||
            result.output.rows.length === 0
          )
            throw new Error("Fixture query did not return rows");
          connectionFlowStage = "verify stable uniqueness";
          if (
            !stableExists &&
            (await listConnections()).filter((item) => item.name === stableName)
              .length !== 1
          )
            throw new Error("Stable fixture name is no longer unique");
          connectionFlowStage = "run fixture query";
          if (fakeUrl) {
            expect(result.output.rows).toEqual([
              ["alpha", 2],
              ["beta", 1],
            ]);
            const callsResponse = await fetch(
              new URL("/__control/calls", fakeUrl),
              { signal: AbortSignal.timeout(5000) },
            );
            if (!callsResponse.ok)
              throw new Error("Fake provider calls unreadable");
            const calls = z
              .array(
                z.object({
                  host: z.string(),
                  method: z.string(),
                  path: z.string(),
                }),
              )
              .parse(await callsResponse.json());
            if (
              !calls
                .slice(fakeCallCount)
                .some(
                  (call) =>
                    call.host.endsWith("googleapis.com") &&
                    call.method === "POST" &&
                    /\/projects\/local-fake-project\/(queries|jobs)/.test(
                      call.path,
                    ),
                )
            )
              throw new Error("Fake provider query was not observed");
            const saved = await read(page, project.id);
            const savedCell = saved.cells.find((item) => item.id === cell.id);
            if (
              !savedCell ||
              savedCell.contents.kind !== "sql" ||
              savedCell.contents.dataConnectionId !== connectionId ||
              savedCell.contents.source !==
                `SELECT * FROM \`${projectId}.${datasetName}.${tableName}\` LIMIT 10`
            )
              throw new Error("Fake query cell was not persisted");
          }
          completed = true;
          if (!fakeUrl && !stableExists) {
            await mkdir(resolve(".tmp/analytics-owner"), { recursive: true });
            await writeFile(
              resolve(".tmp/analytics-owner/bigquery-fixture.json"),
              JSON.stringify({ id: connectionId, name: stableName }),
            );
          }
          console.log(
            fakeUrl
              ? "BIGQUERY local fake native connection and bounded query verified"
              : "BIGQUERY native connection and bounded fixture query verified",
          );
        } catch (error) {
          primaryFailure = `${connectionFlowStage}; writer=${writer ?? "no-post-observed"}`;
          throw new Error(
            `BigQuery fixture flow failed during ${primaryFailure}`,
            {
              cause: error,
            },
          );
        } finally {
          connectionFlowStage = "cleanup";
          rawCredential = "";
          page.off("request", captureOperation);
          page.off("response", captureRecovery);
          const cleanupFailures: string[] = [];
          let projectCleanupStage: string | undefined;
          let projectReadbackStatus: number | undefined;
          let connectionCleanupStage: string | undefined;
          let connectionDeleteStatus: number | undefined;
          let connectionReadback:
            | "present"
            | "absent"
            | "unreadable"
            | "not-attempted" = "not-attempted";
          const operationReceipt = () => ({
            operationId,
            writer,
            name,
            connectionId,
            fixtureProjectId,
            projectCleanupStage,
            projectReadbackStatus,
            connectionCleanupStage,
            connectionDeleteStatus,
            connectionReadback,
            cleanupFailures,
            primaryFailure,
          });
          if (operationId) {
            try {
              await mkdir(resolve(".tmp/analytics-owner"), { recursive: true });
              await writeFile(
                resolve(
                  ".tmp/analytics-owner",
                  `bigquery-operation-${operationId}.json`,
                ),
                JSON.stringify(operationReceipt()),
              );
            } catch {
              cleanupFailures.push("operation receipt");
            }
          }
          try {
            if (await field.isVisible()) await field.fill("");
          } catch {
            if ((await field.count()) !== 0)
              cleanupFailures.push("credential input");
          }
          if (fixtureProjectId)
            try {
              projectCleanupStage = "trash";
              await action(page, "trash-project", {
                projectId: fixtureProjectId,
              });
              projectCleanupStage = "delete";
              await action(page, "delete-project", {
                projectId: fixtureProjectId,
              });
              projectCleanupStage = "readback";
              const readback = await page.request.get(
                `${base}/_agent-native/actions/get-project?projectId=${encodeURIComponent(fixtureProjectId)}`,
                { headers: { "x-agent-native-frontend": "1" } },
              );
              projectReadbackStatus = readback.status();
              if (readback.status() !== 404)
                throw new Error("Project still exists");
              projects.delete(fixtureProjectId);
            } catch {
              cleanupFailures.push(
                `query project stage=${projectCleanupStage} readbackHTTP=${projectReadbackStatus ?? "unobserved"}`,
              );
            }
          if (creationState.submitted && !connectionId && writer === "legacy") {
            try {
              await recoverLegacyConnection();
            } catch {
              cleanupFailures.push("legacy result unreadable");
            }
          }
          if (creationState.submitted && !connectionId)
            cleanupFailures.push(
              "unconfirmed connection creation; inspect before retrying",
            );
          if ((fakeUrl || stableExists || !completed) && connectionId) {
            connectionCleanupStage = "settings navigation";
            const captureDelete = (response: Response) => {
              const url = new URL(response.url());
              if (
                url.pathname.endsWith("/actions/delete-data-connection") &&
                response.request().method() === "POST"
              )
                connectionDeleteStatus = response.status();
            };
            page.on("response", captureDelete);
            try {
              await open(page, "/settings/data-sources");
              connectionCleanupStage = "open exact connection options";
              await page
                .locator(
                  '[data-rid="settings.data-sources.connections.item.options"]',
                )
                .and(
                  page.locator(
                    `[data-rid-key=${JSON.stringify(connectionId)}]`,
                  ),
                )
                .click();
              connectionCleanupStage = "open delete confirmation";
              await page
                .locator(
                  '[data-rid="settings.data-sources.connections.item.delete"]',
                )
                .and(
                  page.locator(
                    `[data-rid-key=${JSON.stringify(connectionId)}]`,
                  ),
                )
                .click();
              connectionCleanupStage = "confirm exact connection deletion";
              await page
                .locator(
                  '[data-rid="settings.data-sources.connections.item.delete.dialog.confirm"]',
                )
                .and(
                  page.locator(
                    `[data-rid-key=${JSON.stringify(connectionId)}]`,
                  ),
                )
                .click();
              connectionCleanupStage = "delete response";
              await expect
                .poll(() => connectionDeleteStatus, { timeout: 30000 })
                .toBe(200);
              connectionCleanupStage = "catalog readback";
              connectionReadback = "unreadable";
              await expect
                .poll(
                  async () => {
                    const present = (await listConnections()).some(
                      (item) => item.id === connectionId,
                    );
                    connectionReadback = present ? "present" : "absent";
                    return present;
                  },
                  { timeout: 30000 },
                )
                .toBe(false);
              console.log(
                `BIGQUERY cleanup delete HTTP${connectionDeleteStatus}; catalog absent`,
              );
            } catch {
              console.log(
                `BIGQUERY cleanup failed during ${connectionCleanupStage}; delete HTTP${connectionDeleteStatus ?? "unobserved"}`,
              );
              cleanupFailures.push(
                `temporary connection stage=${connectionCleanupStage} deleteHTTP=${connectionDeleteStatus ?? "unobserved"} readback=${connectionReadback}`,
              );
            } finally {
              page.off("response", captureDelete);
            }
          }
          if (operationId) {
            try {
              await writeFile(
                resolve(
                  ".tmp/analytics-owner",
                  `bigquery-operation-${operationId}.json`,
                ),
                JSON.stringify(operationReceipt()),
              );
            } catch {
              cleanupFailures.push("final operation receipt");
            }
          }
          if (cleanupFailures.length)
            throw new Error(
              `BigQuery fixture cleanup incomplete: ${cleanupFailures.join(", ")}; operation=${operationId ?? "unobserved"}; connection=${connectionId ?? "unobserved"}; project=${fixtureProjectId ?? "unobserved"}; primary=${primaryFailure ?? "none"}`,
            );
        }
      },
    ],
    [
      "ask-question-get-chart",
      async (page) => {
        const keyName = "ANTHROPIC_API_KEY";
        const keySchema = z.object({
          name: z.string(),
          scope: z.enum(["user", "org"]),
          storedScope: z.enum(["user", "workspace", "org"]),
        });
        const listKeys = async () =>
          z
            .object({ keys: z.array(keySchema) })
            .parse(await action(page, "list-api-keys", {}, "GET")).keys;
        let keySaveAttempted = false;
        let keySaveSettled = false;
        let localFake = false;
        let primaryFailed = false;
        let primaryError: unknown;
        try {
          if (mode === "local") {
            const profile = await readQAProfile();
            if (profile.runtime !== "production" || !profile.providerFixture)
              throw new Unavailable("Local fake model fixture is unavailable");
            const url = new URL(profile.providerFixture.url);
            if (
              url.protocol !== "http:" ||
              url.hostname !== "127.0.0.1" ||
              !url.port ||
              url.username ||
              url.password ||
              url.pathname !== "/" ||
              url.search ||
              url.hash
            )
              throw new Error("Local fake model fixture URL is invalid");
            const fakeResponse = await fetch(new URL("/v1/models", url), {
              headers: { "x-fake-host": "api.anthropic.com" },
              signal: AbortSignal.timeout(5000),
              redirect: "error",
            });
            if (!fakeResponse.ok)
              throw new Error("Local fake model fixture is unavailable");
            z.object({
              data: z
                .array(z.object({ id: z.literal("claude-sonnet-5-5") }))
                .min(1),
            }).parse(await fakeResponse.json());
            const before = await listKeys();
            if (before.some((key) => key.name === keyName))
              throw new Error("Local fake model key already exists");
            await open(page, "/settings/model");
            await page
              .getByRole("button", { name: "Custom keys", exact: true })
              .click();
            await page
              .getByRole("button", { name: "Choose a provider" })
              .click();
            await page
              .locator("[cmdk-item]")
              .filter({ hasText: "Anthropic" })
              .click();
            const personal = page.getByRole("radio", { name: "Personal" });
            await expect(personal).toBeVisible();
            await personal.check();
            const keyInput = page.locator('input[type="password"]');
            await expect(keyInput).toHaveCount(1);
            await keyInput.fill("local-fake-provider-key");
            keySaveAttempted = true;
            const [saveResponse] = await Promise.all([
              page.waitForResponse(
                (response) =>
                  response.request().method() === "POST" &&
                  new URL(response.url()).pathname.endsWith(
                    "/_agent-native/agent-engine/api-key",
                  ),
                { timeout: 30000 },
              ),
              page.getByRole("button", { name: "Save", exact: true }).click(),
            ]);
            keySaveSettled = true;
            if (!saveResponse.ok())
              throw new Error(
                `Local fake model key save HTTP ${saveResponse.status()}`,
              );
            await expect
              .poll(
                async () =>
                  (await listKeys()).filter(
                    (key) =>
                      key.name === keyName &&
                      key.scope === "user" &&
                      key.storedScope === "user",
                  ).length,
                { timeout: 30000 },
              )
              .toBe(1);
            await expect
              .poll(
                async () => {
                  const response = await context.request.get(
                    `${base}/_agent-native/agent-engine/status`,
                    {
                      headers: { "x-agent-native-frontend": "1" },
                    },
                  );
                  if (!response.ok())
                    throw new Error(
                      `Agent readiness HTTP ${response.status()}`,
                    );
                  return z
                    .object({ chatEligible: z.boolean() })
                    .parse(await response.json()).chatEligible;
                },
                { timeout: 30000 },
              )
              .toBe(true);
            localFake = true;
            console.log("ASK local fake model key saved and chat ready");
          }
          const engine = await context.request.get(
            `${base}/_agent-native/agent-engine/status`,
            { headers: { "x-agent-native-frontend": "1" } },
          );
          if (!engine.ok())
            throw new Unavailable(
              `Agent engine readiness unavailable (HTTP ${engine.status()})`,
            );
          const readiness = z
            .object({ chatEligible: z.boolean() })
            .parse(await engine.json());
          if (!readiness.chatEligible)
            throw new Unavailable(
              "Agent engine reports chatEligible=false; AI send is unavailable for this workspace",
            );

          const project = await create(page, "chart");
          const name = `QA chart ${randomUUID()}`;
          const imported = z
            .object({
              dataset: z.object({
                id: z.string(),
                rowCount: z.number(),
                sourceComplete: z.literal(true),
              }),
            })
            .parse(
              await action(page, "import-project-csv", {
                projectId: project.id,
                filename: `${name}.csv`,
                dataBase64: Buffer.from(
                  "label,amount\nQA North,42\nQA South,84\n",
                ).toString("base64"),
              }),
            );
          datasets.add(imported.dataset.id);
          console.log(`CREATED dataset ${imported.dataset.id}`);
          expect(imported.dataset.rowCount).toBe(2);
          let homeThreadId: string | null = null;
          page.on("request", (request) => {
            const threadId = threadIdFromSnapshotRequest(
              request.method(),
              request.url(),
            );
            if (!threadId) return;
            homeThreadId = threadId;
            threads.add(threadId);
          });
          await open(page, "/home");
          const heroComposer = page.locator(
            '[data-agent-composer-slot="area"][data-agent-composer-variant="hero"]',
          );
          await expect(heroComposer).toHaveCount(1, { timeout: 30000 });
          const composer = heroComposer.locator(
            '[data-slot="editor-input"][role="textbox"][contenteditable="true"], [data-agent-composer-slot="editor-input"][role="textbox"][contenteditable="true"]',
          );
          await expect(composer).toHaveCount(1);
          await expect(composer).toBeVisible();
          if (mode === "live") {
            const choice = await selectLiveFlowModel(page);
            if (choice.status !== "pass") throw new Unavailable(choice.reason);
          }
          await expect(composer).toHaveAttribute(
            "aria-label",
            "Message agent...",
          );
          const sendButton = heroComposer.locator(
            '[data-agent-composer-slot="send-button"]',
          );
          await expect(sendButton).toHaveCount(1);
          await expect(sendButton).toBeVisible();
          const approvalTrigger = heroComposer.getByRole("button", {
            name: /^Approval mode:/,
          });
          await expect(approvalTrigger).toBeVisible();
          await approvalTrigger.click();
          await expect(
            page.getByText("Ask before taking destructive actions."),
          ).toBeVisible();
          await expect(
            page.getByText(
              "Only ask for permission grants that expand access.",
            ),
          ).toBeVisible();
          await page.keyboard.press("Escape");
          await expect(approvalTrigger).toHaveAttribute(
            "aria-expanded",
            "false",
          );
          await expect(page.getByRole("menu")).toBeHidden();
          const prompt = `Query staged dataset ${imported.dataset.id} named "${name}" and make a saved bar chart of amount by label. Show me the chart.`;
          await composer.click();
          await expect(composer).toBeFocused();
          await composer.pressSequentially(prompt, { delay: 5 });
          await expect(composer).toHaveText(prompt);
          await expect(sendButton).toBeEnabled();
          const shell = z
            .object({ workspace: z.object({ id: z.string() }) })
            .parse(await action(page, "get-workspace-shell", {}, "GET"));
          const [persistedSnapshot] = await Promise.all([
            page.waitForRequest(
              (request) =>
                threadIdFromSnapshotRequest(request.method(), request.url()) !==
                null,
              { timeout: 60000 },
            ),
            composer.press("Enter"),
          ]);
          console.log("ASK Enter submitted through the Home hero composer");
          const threadId = threadIdFromSnapshotRequest(
            persistedSnapshot.method(),
            persistedSnapshot.url(),
          );
          if (!threadId)
            throw new Error("Home thread snapshot URL did not contain an id");
          homeThreadId = threadId;
          threads.add(threadId);
          console.log(`CREATED thread ${threadId} from Home snapshot`);
          const appPath = new URL(base).pathname.replace(/\/$/, "");
          const expectedThreadPath = `${appPath}/thread/${encodeURIComponent(threadId)}`;
          await expect
            .poll(() => new URL(page.url()).pathname, {
              message:
                "Home navigates to the persisted thread after its first send",
              timeout: 45000,
            })
            .toBe(expectedThreadPath);
          await expect
            .poll(
              async () =>
                z
                  .object({
                    turns: z.array(
                      z.object({
                        chartArtifacts: z.array(z.object({ id: z.string() })),
                      }),
                    ),
                  })
                  .parse(
                    await action(
                      page,
                      "get-analytics-thread-turns",
                      { threadId },
                      "GET",
                    ),
                  )
                  .turns.some((turn) => turn.chartArtifacts.length > 0),
              {
                message:
                  "The agent saves a chart in the thread's bound project",
                timeout: 180000,
                intervals: [2000, 5000, 10000],
              },
            )
            .toBe(true);
          console.log(`ASK agent saved bar chart in thread ${threadId}`);
          const chart = page.locator("svg.agent-data-chart-renderer").first();
          const expectBars = async () => {
            await expect(chart).toBeVisible({ timeout: 30000 });
            await expect(chart.getByText("QA North")).toBeVisible();
            await expect(chart.getByText("QA South")).toBeVisible();
            await expect
              .poll(async () =>
                chart
                  .locator('rect[role="img"]')
                  .evaluateAll((bars) =>
                    bars.map((bar) => bar.getAttribute("aria-label")).sort(),
                  ),
              )
              .toEqual([
                "label: QA North, Amount: 42",
                "label: QA South, Amount: 84",
              ]);
          };
          await expectBars();
          await page.reload({ waitUntil: "domcontentloaded" });
          await expectBars();
          await expect(
            page.getByRole("button", { name: /^Approval mode:/ }),
          ).toBeVisible();
          const expectedScopeId = `analytics-2:org:${encodeURIComponent(shell.workspace.id)}`;
          const threadListResponse = page.waitForResponse(
            (response) => {
              const url = new URL(response.url());
              const framePath = new URL(response.request().frame().url())
                .pathname;
              return (
                response.request().method() === "GET" &&
                url.pathname.endsWith("/_agent-native/agent-chat/threads") &&
                url.searchParams.get("ownership") === "mine" &&
                url.searchParams.get("scopeType") === "workspace-app" &&
                url.searchParams.get("scopeId") === expectedScopeId &&
                framePath.endsWith("/home/threads") &&
                response.status() === 200
              );
            },
            { timeout: 30000 },
          );
          const threadsHeading = page.getByRole("heading", {
            name: "Threads",
            exact: true,
          });
          const threadsPage = threadsHeading.locator("xpath=ancestor::main[1]");
          const [response] = await Promise.all([
            threadListResponse,
            (async () => {
              await open(page, "/home/threads");
              await expect(threadsPage).toHaveCount(1, { timeout: 30000 });
              await expect(threadsHeading).toBeVisible();
            })(),
          ]);
          const listedThreads = z
            .object({ threads: z.array(z.object({ id: z.string() })) })
            .parse(await response.json());
          expect(listedThreads.threads.map((thread) => thread.id)).toContain(
            threadId,
          );
          const threadTable = threadsPage.getByRole("table", {
            name: "Threads",
          });
          await expect(threadTable).toHaveCount(1);
          const threadLink = threadTable.locator(
            `a[href$="/thread/${encodeURIComponent(threadId)}"]`,
          );
          await expect(threadLink).toHaveCount(1);
          await expect(threadLink).toBeVisible();
          await expect(
            threadLink.locator('xpath=ancestor::*[@role="row"][1]'),
          ).toHaveCount(1);
          expect(homeThreadId).toBe(threadId);
          if (localFake)
            console.log("ASK saved chart verified with local fake model");
        } catch (error) {
          primaryFailed = true;
          primaryError = error;
          throw error;
        } finally {
          try {
            if (keySaveAttempted) {
              const keys = (await listKeys()).filter(
                (key) => key.name === keyName,
              );
              if (
                keys.some(
                  (key) => key.scope !== "user" || key.storedScope !== "user",
                ) ||
                keys.length > 1
              )
                throw new Error(
                  "Local fake model key scope is unexpected; cleanup incomplete",
                );
              if (keys.length === 1) {
                await open(page, "/settings/secrets#secrets:ANTHROPIC_API_KEY");
                const card = page
                  .getByRole("button", { name: /^Anthropic API key/ })
                  .locator("xpath=..");
                await expect(card).toHaveCount(1, { timeout: 30000 });
                await card
                  .getByRole("button", { name: "Delete", exact: true })
                  .click();
                await expect(
                  card.getByText("Remove this saved value?"),
                ).toBeVisible();
                const [response] = await Promise.all([
                  page.waitForResponse(
                    (response) =>
                      response.request().method() === "DELETE" &&
                      new URL(response.url()).pathname.endsWith(
                        "/_agent-native/secrets/ANTHROPIC_API_KEY",
                      ),
                    { timeout: 30000 },
                  ),
                  card
                    .getByRole("button", {
                      name: "Confirm",
                      exact: true,
                    })
                    .click(),
                ]);
                if (!response.ok())
                  throw new Error(
                    `Local fake model key removal HTTP ${response.status()}`,
                  );
              }
              await expect
                .poll(
                  async () =>
                    (await listKeys()).some((key) => key.name === keyName),
                  { timeout: 30000 },
                )
                .toBe(false);
              if (!keySaveSettled)
                throw new Error(
                  "Local fake model key save outcome is unknown; cleanup incomplete",
                );
              await expect
                .poll(
                  async () => {
                    const response = await context.request.get(
                      `${base}/_agent-native/agent-engine/status`,
                      { headers: { "x-agent-native-frontend": "1" } },
                    );
                    if (!response.ok())
                      throw new Error(
                        `Agent readiness HTTP ${response.status()}`,
                      );
                    return z
                      .object({ chatEligible: z.boolean() })
                      .parse(await response.json()).chatEligible;
                  },
                  { timeout: 30000 },
                )
                .toBe(false);
              console.log(
                "ASK local fake model key removed and chat unavailable",
              );
            }
          } catch (cleanupError) {
            if (primaryFailed)
              throw new AggregateError(
                [primaryError, cleanupError],
                "Chart flow and local fake model key cleanup failed",
              );
            throw cleanupError;
          }
        }
      },
    ],
    [
      "notebook-save-reload",
      async (page) => {
        const project = await create(page, "notebook");
        await open(page, project.href);
        await addCellKind(page, "Text");
        const editor = page.getByRole("textbox", { name: /^Edit Text/ });
        const text = `Notebook persistence ${randomUUID()}`;
        await editor.fill(text);
        await expect
          .poll(
            async () => {
              const saved = await read(page, project.id);
              return saved.cells.some(
                (cell) =>
                  cell.contents.kind === "text" && cell.contents.text === text,
              );
            },
            { timeout: 30000 },
          )
          .toBe(true);
        const reloadDiagnostic = observeNotebookReload(page);
        try {
          await page.reload({ waitUntil: "domcontentloaded" });
          try {
            await expect(page.getByText(text, { exact: true })).toBeVisible({
              timeout: 20000,
            });
            await expect(editor).toHaveValue(text);
          } catch (error) {
            try {
              console.error(
                "NOTEBOOK_RELOAD_DIAGNOSTIC",
                JSON.stringify({
                  requests: reloadDiagnostic.snapshot(),
                  dom: await captureNotebookReloadDom(page),
                  identityFlags: "unavailable",
                  queryFlags: "unavailable",
                }),
              );
            } catch {
              console.error("NOTEBOOK_RELOAD_DIAGNOSTIC unavailable");
            }
            throw error;
          }
        } finally {
          reloadDiagnostic.dispose();
        }

        const sample = createdSchema.parse(
          await action(page, "create-project", {
            title: `QA flow shortcuts ${randomUUID()}`,
            sampleDataset: "orders",
          }),
        );
        projects.add(sample.id);
        await open(page, sample.href);
        const cells = page.locator("[data-notebook-cell]");
        const first = page
          .locator(".nb-sql-editor")
          .getByRole("textbox")
          .first();
        await first.click();
        await first.press("ControlOrMeta+a");
        await first.press("Backspace");
        await first.pressSequentially("SELECT * FROM orders LIMIT 3");
        await first.press("Shift+Enter");
        await expect(cells).toHaveCount(2, { timeout: 30000 });
        await expect
          .poll(() => readSqlEditor(first))
          .toBe("SELECT * FROM orders LIMIT 3");
        const second = page
          .locator(".nb-sql-editor")
          .getByRole("textbox")
          .nth(1);
        await expect(second).toBeFocused();
        const beforeAlt = await read(page, sample.id);
        const firstId = beforeAlt.cells[0]?.id;
        const secondId = beforeAlt.cells[1]?.id;
        if (!firstId || !secondId)
          throw new Error("Sample SQL cells are missing");
        const outputRows = async (id: string) =>
          (await draftResultRows(page, sample.id, id)).rows;
        await expect
          .poll(() => outputRows(firstId), { timeout: 30000 })
          .toBe(3);
        await expect(
          page.getByRole("button", { name: "Run SQL 2" }),
        ).toBeEnabled({ timeout: 30000 });
        await second.fill("SELECT * FROM orders LIMIT 2");
        await second.press("Alt+Enter");
        await expect(cells).toHaveCount(3, { timeout: 30000 });
        await expect(cells.nth(2).getByRole("textbox")).toBeFocused();
        const sampleSaved = await read(page, sample.id);
        expect(sampleSaved.cells.map((cell) => cell.contents.kind)).toEqual([
          "sql",
          "sql",
          "code",
        ]);
        await expect
          .poll(() => outputRows(secondId), { timeout: 30000 })
          .toBe(2);
        const selectedId = sampleSaved.cells[2]?.id;
        if (!selectedId) throw new Error("Inserted code cell is missing");
        const tabId = await page.evaluate(
          () =>
            Object.entries(sessionStorage).find(([key]) =>
              key.startsWith("agent-native:browser-tab-id"),
            )?.[1],
        );
        if (!tabId) throw new Error("Browser tab ID is missing");
        await expect
          .poll(
            async () => {
              const response = await page.request.get(
                `${base}/_agent-native/application-state/navigation`,
                { headers: { "x-agent-native-browser-tab": tabId } },
              );
              if (!response.ok())
                throw new Error(`Navigation read HTTP ${response.status()}`);
              const navigation = z
                .object({ resourceKind: z.string(), resourceId: z.string() })
                .parse(await response.json());
              return [navigation.resourceKind, navigation.resourceId];
            },
            { timeout: 30000 },
          )
          .toEqual(["project", sample.id]);
        const stateUrl = `${base}/_agent-native/application-state/selection:${encodeURIComponent(tabId)}`;
        const selection = async () => {
          const response = await page.request.get(stateUrl, {
            headers: { "x-agent-native-browser-tab": tabId },
          });
          if (!response.ok())
            throw new Error(`Selection read HTTP ${response.status()}`);
          return response.text();
        };
        await expect
          .poll(
            async () => {
              const body = await selection();
              return body === ""
                ? null
                : z
                    .object({
                      kind: z.literal("cell"),
                      id: z.string(),
                      projectId: z.string(),
                    })
                    .parse(JSON.parse(body));
            },
            { timeout: 30000 },
          )
          .toEqual({ kind: "cell", id: selectedId, projectId: sample.id });
        await expect(
          page.getByRole("button", { name: "More actions for Code 3" }),
        ).toBeEnabled({ timeout: 30000 });
        await page
          .getByRole("button", { name: "More actions for Code 3" })
          .click();
        await page.getByRole("menuitem", { name: "Delete cell" }).click();
        await expect(cells).toHaveCount(2, { timeout: 30000 });
        await expect.poll(selection, { timeout: 30000 }).toBe("");
        const chartResult = z.object({ createdCellId: z.string() }).parse(
          await action(page, "add-project-cell", {
            projectId: sample.id,
            kind: "chart",
            afterCellId: firstId,
          }),
        );
        await page.reload({ waitUntil: "domcontentloaded" });
        const firstAgain = page
          .locator(".nb-sql-editor")
          .getByRole("textbox")
          .first();
        await expect(firstAgain).toBeVisible();
        await expect(
          page.getByRole("button", { name: "Run Orders" }),
        ).toBeEnabled();
        await Promise.all([
          page.waitForResponse(
            (response) =>
              response.url().includes("/actions/start-notebook-run") &&
              response.request().method() === "POST" &&
              response.ok(),
          ),
          firstAgain.press("Shift+Enter"),
        ]);
        await expect
          .poll(() => outputRows(firstId), { timeout: 30000 })
          .toBe(3);
        const chartCell = page.locator(
          `[data-notebook-cell="${chartResult.createdCellId}"]`,
        );
        await expect(chartCell).toBeFocused();
        await expect
          .poll(
            async () => {
              const body = await selection();
              return body === ""
                ? null
                : z
                    .object({
                      kind: z.literal("cell"),
                      id: z.string(),
                      projectId: z.string(),
                    })
                    .parse(JSON.parse(body));
            },
            { timeout: 30000 },
          )
          .toEqual({
            kind: "cell",
            id: chartResult.createdCellId,
            projectId: sample.id,
          });
      },
    ],
    [
      "sample-sql-runs",
      async (page) => {
        const project = createdSchema.parse(
          await action(page, "create-project", {
            title: `QA flow sample ${randomUUID()}`,
            sampleDataset: "orders",
          }),
        );
        projects.add(project.id);
        const saved = await read(page, project.id);
        const cell = saved.cells.at(0);
        if (!cell || cell.contents.kind !== "sql")
          throw new Error("Sample SQL cell is missing");
        expect(cell.contents.source).toBe("SELECT * FROM orders LIMIT 100");
        await open(page, project.href);
        await expect
          .poll(() =>
            readSqlEditor(
              page.getByRole("textbox", { name: /^Edit Orders/ }).first(),
            ),
          )
          .toBe(cell.contents.source);
        await page.locator("[data-notebook-cell]").first().hover();
        await page.getByRole("button", { name: "Run Orders" }).click();
        let lastSeen = "no result id";
        await expect
          .poll(
            async () => {
              const result = await draftResultRows(page, project.id, cell.id);
              lastSeen = result.seen;
              return result.rows ?? 0;
            },
            {
              timeout: 30000,
              message: () => `Orders cell result: ${lastSeen}`,
            },
          )
          .toBeGreaterThan(0);
      },
    ],
    [
      "cell-rename-persists",
      async (page) => {
        const project = await create(page, "cell rename");
        await open(page, project.href);
        await addCellKind(page, "Text");
        await page.getByRole("button", { name: "Rename cell: Text 1" }).click();
        const title = `QA cell ${randomUUID()}`;
        const input = page.getByRole("textbox", { name: "Cell title" });
        await input.fill(title);
        await input.press("Enter");
        await expect
          .poll(
            async () => (await read(page, project.id)).cells[0]?.contents.label,
            { timeout: 30000 },
          )
          .toBe(title);
        await page.reload({ waitUntil: "domcontentloaded" });
        await expect(page.getByText(title, { exact: true })).toBeVisible();
        await page
          .getByRole("button", { name: `Rename cell: ${title}` })
          .click();
        const clearInput = page.getByRole("textbox", { name: "Cell title" });
        await clearInput.fill("");
        await clearInput.press("Enter");
        await expect
          .poll(
            async () => (await read(page, project.id)).cells[0]?.contents.label,
            { timeout: 30000 },
          )
          .toBeNull();
        await page.reload({ waitUntil: "domcontentloaded" });
        await expect(
          page.getByRole("button", { name: "Rename cell: Text 1" }),
        ).toBeVisible();
      },
    ],
    [
      "rename-persists",
      async (page) => {
        await checkProjectHeaderMenu(page, base);
        const project = await create(page, "rename");
        const title = `${project.title} renamed`;
        await open(page, project.href);
        await page
          .locator(".nb-header")
          .getByRole("button", { name: project.title, exact: true })
          .click();
        const editor = page.getByRole("textbox", {
          name: "Project title",
          exact: true,
        });
        await editor.fill(title);
        await editor.press("Enter");
        await expect
          .poll(async () => (await read(page, project.id)).title, {
            timeout: 30000,
          })
          .toBe(title);
        await expect(page).toHaveTitle(`${title} (Editing)`);
        await page.reload({ waitUntil: "domcontentloaded" });
        await expect(page).toHaveTitle(`${title} (Editing)`);
        expect((await read(page, project.id)).title).toBe(title);
        await expect(
          page.getByText(title, { exact: true }).first(),
        ).toBeVisible();
        const old = z
          .object({ projects: z.array(z.object({ title: z.string() })) })
          .parse(
            await action(
              page,
              "list-projects",
              { search: project.title },
              "GET",
            ),
          );
        expect(old.projects.some((item) => item.title === project.title)).toBe(
          false,
        );
      },
    ],
    [
      "hubspot-key-and-test",
      async (page) => {
        const secretWrites: string[] = [];
        let testStarted = false;
        let testRouteReached = false;
        let testPath: string | null = null;
        page.on("request", (request) => {
          const url = new URL(request.url());
          const secretPrefix =
            `${new URL(base).pathname}/_agent-native/secrets`.replace(
              /\/+/g,
              "/",
            );
          if (
            (url.pathname === secretPrefix ||
              url.pathname.startsWith(`${secretPrefix}/`)) &&
            request.method() !== "GET"
          )
            secretWrites.push(`${request.method()} ${url.pathname}`);
        });

        try {
          const shell = await page.request.get(
            `${base}/_agent-native/actions/get-workspace-shell`,
            { headers: { "x-agent-native-frontend": "1" } },
          );
          if (!shell.ok())
            throw new Unavailable(
              `Workspace access unavailable (HTTP ${shell.status()})`,
            );
          const capabilities = z
            .object({ features: z.object({ isAdmin: z.boolean() }) })
            .parse(await shell.json());
          if (!capabilities.features.isAdmin)
            throw new Unavailable(
              "HubSpot credentials require an admin session",
            );
          await page.goto(`${base}/settings/integrations`, {
            waitUntil: "domcontentloaded",
          });
          await expect(page).toHaveTitle("Settings");
          await page
            .getByRole("button", { name: "Connect HubSpot", exact: true })
            .click();
          const setupForWorkspace = page.getByText("Set up for workspace", {
            exact: true,
          });
          if (await setupForWorkspace.isVisible())
            await setupForWorkspace.click();
          await page
            .getByRole("button", {
              name: "Add workspace credentials",
              exact: true,
            })
            .click();
          await expect(page).toHaveURL(
            /\/settings\/secrets#secrets:HUBSPOT_MCP_CLIENT_ID$/,
          );

          await expect(
            page.getByText("HubSpot MCP OAuth client ID", { exact: true }),
          ).toBeVisible();
          await expect(
            page.getByText("HubSpot MCP OAuth client secret", { exact: true }),
          ).toBeVisible();
          const idInput = page.locator(
            'input[aria-label="HubSpot MCP OAuth client ID"]',
          );
          const secretInput = page.locator(
            'input[aria-label="HubSpot MCP OAuth client secret"]',
          );
          const idUnset = await idInput.isVisible();
          const secretUnset = await secretInput.isVisible();
          if (!idUnset && !secretUnset)
            throw new Unavailable(
              "Both HubSpot OAuth credentials are already saved; there is no unset field to test safely",
            );
          const input = idUnset ? idInput : secretInput;
          expect(
            await input.evaluate(
              (element) => element === document.activeElement,
            ),
          ).toBe(true);
          const inputLabel = idUnset
            ? "HubSpot MCP OAuth client ID"
            : "HubSpot MCP OAuth client secret";
          const row = page
            .locator("div.border-b")
            .filter({ hasText: inputLabel })
            .first();
          const result = row.locator('[data-testid="secret-test-result"]');
          const candidateForm = input.locator(
            "xpath=ancestor::div[contains(concat(' ', normalize-space(@class), ' '), ' space-y-1.5 ')][1]",
          );
          const testButton = candidateForm.locator("button").first();
          const secretPrefix =
            `${new URL(base).pathname}/_agent-native/secrets`.replace(
              /\/+/g,
              "/",
            );
          testPath = `${secretPrefix}/${idUnset ? "HUBSPOT_MCP_CLIENT_ID" : "HUBSPOT_MCP_CLIENT_SECRET"}/test`;

          await page.route(
            (url) => url.pathname === testPath,
            async (route) => {
              testRouteReached = true;
              await new Promise((resolve) => setTimeout(resolve, 1500));
              await route.continue();
            },
          );
          await input.fill("test-not-a-real-key");
          testStarted = true;
          await testButton.click();
          await expect.poll(() => testRouteReached).toBe(true);
          await expect(testButton).toHaveText(/Testing/);
          await expect(result).toContainText("Testing…");
          await expect(result).not.toContainText("Testing…", {
            timeout: 15000,
          });
          // The client ID has a typed validator (server/plugins/hubspot-credentials.ts);
          // only the secret half cannot be checked on its own.
          await expect(result).toContainText(
            idUnset
              ? /did not accept this client ID|could not be reached|unavailable/
              : "This key can't be checked on its own",
          );
          await expect(result).not.toContainText("Working");
          const persistedResult = (await result.innerText()).trim();
          expect(persistedResult).not.toBe("");
          await page.waitForTimeout(3000);
          await expect(result).toHaveText(persistedResult);
          await input.fill("");
        } finally {
          expect(
            secretWrites.every((write) => write === `POST ${testPath}`),
          ).toBe(true);
          if (testStarted) expect(secretWrites).toEqual([`POST ${testPath}`]);
        }
      },
    ],
    ...supplementalFlowNames.map(
      (name): [string, (page: Page) => Promise<void>] => [
        name,
        async (page) => {
          if (
            name === "report-M5-T2-F-04-settings-search" ||
            name === "report-M5-T2-F-01-keyboard-shortcuts" ||
            name === "report-455-456-editor-preferences"
          )
            await mkdir(resolve(".tmp/analytics-owner"), { recursive: true });
          if (name === "report-M5-T2-F-03-users-settings")
            return checkUsersSettings(page, base);
          if (name === "report-M5-T2-F-04-settings-search")
            return checkSettingsSearch(page, base);
          if (name === "report-M5-T2-F-01-keyboard-shortcuts")
            return checkKeyboardShortcuts(page, base);
          if (name === "report-455-456-editor-preferences") {
            const profile = await readQAProfile();
            return checkEditorPreferences(page, base, profile.workspaceId);
          }
          const profile =
            (name === "default-connection-new-cell" ||
              name === "query-error-cancel") &&
            mode === "local"
              ? await readQAProfile()
              : undefined;
          const fixturePath =
            mode === "live" && name === "default-connection-new-cell"
              ? fixturePathArgument
              : undefined;
          const liveFixture = fixturePath
            ? parseDefaultConnectionFixture(await readFile(fixturePath, "utf8"))
            : undefined;
          if (name === "app-intent-transport") {
            expectedFailures.set(page, expectedAppIntentTransportFailure(base));
          }
          const result = await runSupplementalFlow(name, page, base, {
            ...(liveFixture
              ? {
                  warehouseTableQuery: liveFixture.query,
                  warehouseFixtureConnectionId: liveFixture.connectionId,
                  expectedWarehouseRows: liveFixture.expectedRows,
                }
              : {}),
            selectLiveModel: mode === "live",
            ...(profile?.runtime === "production" && profile.providerFixture
              ? {
                  fakeProviderUrl: profile.providerFixture.url,
                  warehouseTableQuery:
                    "SELECT * FROM `agent_native_qa.sample_words` LIMIT 10",
                  expectedWarehouseRows: [
                    ["alpha", 2],
                    ["beta", 1],
                  ],
                }
              : {}),
          });
          if (result.status === "unavailable")
            throw new Unavailable(result.reason);
        },
      ],
    ),
    [
      "report-1794947464-agent-view",
      async (page) => {
        const run = () =>
          checkAgentProjectView(page, base, `${outputDir}/agent-full-page.png`);
        if (mode === "local") {
          const profile = await readQAProfile();
          if (profile.runtime !== "production" || !profile.providerFixture)
            throw new Unavailable("Local fake model fixture is unavailable");
          let evidence: FlowEvidence | undefined;
          await withClaimModel(
            page,
            base,
            profile.providerFixture.url,
            async () => {
              evidence = await run();
            },
          );
          return evidence;
        }
        return run();
      },
    ],
    [
      "new-project-interactive",
      async (page) => {
        const checkPrompt = async () => {
          try {
            await report1794947190(page, {
              create,
              createFromHome,
              open,
              read,
            });
          } catch (error) {
            await page.screenshot({
              path: `${outputDir}/new-project-prompt-failure.png`,
              fullPage: true,
            });
            throw error;
          }
        };
        if (mode === "local") {
          const profile = await readQAProfile();
          if (profile.runtime !== "production" || !profile.providerFixture)
            throw new Unavailable("Local fake model fixture is unavailable");
          await withClaimModel(
            page,
            base,
            profile.providerFixture.url,
            checkPrompt,
          );
        } else await checkPrompt();
        await withProject(page, base, async () => {
          const title = UNTITLED_PROJECT_NAME;
          const stageShot = async (stage: string) => {
            await page
              .screenshot({
                path: `${outputDir}/new-project-${stage}.png`,
                fullPage: true,
                timeout: 3000,
              })
              .catch((error) =>
                console.error(`STAGE screenshot ${stage}: ${message(error)}`),
              );
          };
          const logRequest = (request: Request) => {
            if (request.url().includes("/_agent-native/actions/"))
              console.log(
                `STAGE request ${request.method()} ${new URL(request.url()).pathname}`,
              );
          };
          const logResponse = (response: Response) => {
            if (response.url().includes("/_agent-native/actions/"))
              console.log(
                `STAGE response ${response.status()} ${new URL(response.url()).pathname}`,
              );
          };
          page.on("request", logRequest);
          page.on("response", logResponse);
          await page.getByRole("button", { name: "Project options" }).click();
          console.log(
            `STAGE menu opened; new-project menuitem count=${await page.getByRole("menuitem", { name: "New project", exact: true }).count()}`,
          );
          await stageShot("menu");
          let result: JsonResponse<z.output<typeof createdSchema>>;
          try {
            [result] = await Promise.all([
              waitForCreateProject(page),
              page
                .getByRole("menuitem", { name: "New project", exact: true })
                .click()
                .then(
                  () => console.log("STAGE new-project click succeeded"),
                  (error: unknown) => {
                    console.error(
                      `STAGE new-project click failed: ${message(error)}`,
                    );
                    throw error;
                  },
                ),
            ]);
            await stageShot("after-click");
          } catch (error) {
            console.error(
              `STAGE create-project wait failed: ${message(error)}`,
            );
            await stageShot("failure");
            throw error;
          } finally {
            page.off("request", logRequest);
            page.off("response", logResponse);
          }
          if (!result.ok)
            throw new Error(`Create project HTTP ${result.status}`);
          const created = result.body;
          try {
            // oracle-change: untitled notebook names now include their creation ordinal.
            const initial = await read(page, created.id);
            const ordinal = z
              .number()
              .int()
              .positive()
              .parse(initial.untitledOrdinal);
            const shownTitle = ordinal === 1 ? title : `${title} (${ordinal})`;
            expect(initial.title).toBe(shownTitle);
            await expect(
              page.getByRole("dialog", { name: "New project" }),
            ).toHaveCount(0);
            await expect(page).toHaveURL(
              new RegExp(`/project/${encodeURIComponent(created.id)}/latest`),
            );
            await expect(
              page.getByText(shownTitle, { exact: true }).first(),
            ).toBeVisible();
            await addText(page, "QA menu project saved text");
            await expect
              .poll(async () =>
                (await read(page, created.id)).cells.some(
                  (cell) =>
                    cell.contents.kind === "text" &&
                    cell.contents.text === "QA menu project saved text",
                ),
              )
              .toBe(true);
            await page.reload();
            await expect(
              page
                .getByText("QA menu project saved text", { exact: true })
                .first(),
            ).toBeVisible();
            expect((await read(page, created.id)).title).toBe(shownTitle);
            const listed = await action(
              page,
              "list-projects",
              { view: "active" },
              "GET",
            );
            expect(JSON.stringify(listed)).toContain(created.id);
          } finally {
            await leaveProject(page, base);
            await action(page, "trash-project", { projectId: created.id });
            await action(page, "delete-project", { projectId: created.id });
            const deleted = await page.request.get(
              `${base}/_agent-native/actions/get-project?${new URLSearchParams({ projectId: created.id })}`,
              { headers: { "x-agent-native-frontend": "1" } },
            );
            expect(deleted.status()).toBe(404);
            projects.delete(created.id);
          }
        });
      },
    ],
    [
      "agent-claim-readback",
      async (page) => {
        const runClaim = async () => {
          const engine = await page.request.get(
            `${base}/_agent-native/agent-engine/status`,
            { headers: { "x-agent-native-frontend": "1" } },
          );
          if (!engine.ok())
            throw new Unavailable(
              `Agent engine readiness unavailable (HTTP ${engine.status()})`,
            );
          const readiness = z
            .object({ chatEligible: z.boolean() })
            .parse(await engine.json());
          if (!readiness.chatEligible)
            throw new Unavailable("Agent engine reports chatEligible=false");
          await report1794947983(
            page,
            { create, createFromHome, open, read },
            base,
            (request) => {
              const id = threadIdFromSnapshotRequest(
                request.method(),
                request.url(),
              );
              if (id) threads.add(id);
              return id;
            },
          );
        };
        if (mode === "local") {
          const profile = await readQAProfile();
          if (profile.runtime !== "production" || !profile.providerFixture)
            throw new Unavailable("Local fake model fixture is unavailable");
          await withClaimModel(
            page,
            base,
            profile.providerFixture.url,
            runClaim,
          );
        } else await runClaim();
      },
    ],
  ];
  try {
    for (const [name, run] of flows) {
      if (requestedFlow && name !== requestedFlow) continue;
      if (nonCoreFlows.has(name)) {
        console.log(`SKIP ${name}: Labs/Cut scope`);
        continue;
      }
      if (!setupError && emittedFlowIds.has(name)) continue;
      const isolatedAdminFlow =
        name === "hubspot-key-and-test" && mode === "live";
      const isolatedQAFlow =
        mode === "live" &&
        [
          "connect-data-source",
          "report-M5-T2-F-03-users-settings",
          "report-M5-T2-F-04-settings-search",
          "report-M5-T2-F-01-keyboard-shortcuts",
          "report-455-456-editor-preferences",
        ].includes(name);
      if (setupError && !isolatedAdminFlow && !isolatedQAFlow) {
        await boundedVerdict(
          name,
          setupError instanceof Unavailable ||
            /net::ERR_CONNECTION/.test(message(setupError))
            ? "COULD-NOT-RUN"
            : "FAIL",
          `Setup: ${message(setupError)}`,
          null,
          { kind: "unreadable", reason: "Flow not started" },
          buildRequest,
        );
        continue;
      }
      const errors: string[] = [];
      let beforeBuild: BuildObservation | undefined;
      let flowContext = context;
      let ownsFlowContext = false;
      let page: Page | null = null;
      try {
        if (isolatedAdminFlow || isolatedQAFlow) {
          flowContext = await browser.newContext({
            viewport: { width: 1440, height: 1000 },
          });
          ownsFlowContext = true;
          await reuseCookies(flowContext, isolatedQAFlow ? "qa" : "admin");
        }
        if (mode === "live") {
          beforeBuild = await observeBuild(flowContext.request, base);
          if (beforeBuild.kind !== "read")
            throw new Unavailable(
              `Flow not started: served build identity ${beforeBuild.kind}`,
            );
        }
        page = await flowContext.newPage();
        const flowPage = page;
        page.on("pageerror", (error) =>
          errors.push(
            name === "connect-data-source"
              ? "Browser error during credential flow"
              : `pageerror ${safeErrorDiagnostic(error)}`,
          ),
        );
        page.on("console", (item) => {
          if (
            item.type() === "error" &&
            !expectedFailures
              .get(flowPage)
              ?.console({ url: item.location().url, text: item.text() })
          )
            errors.push(
              name === "connect-data-source"
                ? "Browser console error during credential flow"
                : `browser console error: ${item.text().slice(0, 160)}`,
            );
        });
        page.on("response", (response) => {
          if (
            !expectedFailures.get(flowPage)?.response({
              url: response.url(),
              method: response.request().method(),
              status: response.status(),
            })
          )
            recordFailure(response, errors);
        });
        if (!isolatedAdminFlow) {
          if (name === "connect-data-source") connectionFlowStage = "open-home";
          await open(page, "/home");
        }
        const flowTimeoutMs = 120_000;
        let flowTimer: ReturnType<typeof setTimeout> | undefined;
        const evidence = await Promise.race([
          run(page),
          new Promise<never>((_, reject) => {
            flowTimer = setTimeout(
              () =>
                reject(
                  new Unavailable(
                    `Flow watchdog timed out after ${Math.round(flowTimeoutMs / 1000)}s`,
                  ),
                ),
              flowTimeoutMs,
            );
          }),
        ]).finally(() => {
          if (flowTimer) clearTimeout(flowTimer);
        });
        await pendingDiagnostics.drain();
        if (errors.length) throw new Error(errors.join("; "));
        if (!flowShots && name !== "connect-data-source")
          await page.screenshot({
            path: `${outputDir}/${name}.png`,
            fullPage: true,
          });
        await boundedVerdict(
          name,
          "PASS",
          name === "connect-data-source" && mode === "local"
            ? "Local fake BigQuery UI and server readback verified"
            : name === "ask-question-get-chart" && mode === "local"
              ? "Local fake model saved chart, UI, and server readback verified"
              : "UI and server readback verified",
          page,
          beforeBuild ?? { kind: "unreadable", reason: "Flow not started" },
          flowContext.request,
          evidence || undefined,
        );
      } catch (error) {
        await pendingDiagnostics.drain();
        const warehouseDiagnostic =
          connectionFlowStage === "select-warehouse" && page
            ? selectWarehouseDiagnostic(
                await captureDataBrowserState(
                  page,
                  mode === "live" ? "mounted" : "unmounted",
                ),
                error,
              )
            : undefined;
        const safeNavigationFailure = connectionFlowStage
          ? connectionStageSelectors[connectionFlowStage]
          : undefined;
        const safeConnectionFailure = safeNavigationFailure
          ? `BigQuery connection flow failed stage=${connectionFlowStage} kind=${connectionErrorKind(error)} selector=${safeNavigationFailure}${warehouseDiagnostic ? ` ${warehouseDiagnostic}` : ""}`
          : error instanceof Error &&
              /^BigQuery fixture (?:flow failed during|could not be read|is invalid|has duplicate saved connections|cleanup incomplete)/.test(
                error.message,
              )
            ? `${error.message}: ${safeErrorDiagnostic(error)}`
            : "BigQuery connection flow failed";
        if (!flowShots && page && name !== "connect-data-source")
          await page
            .screenshot({ path: `${outputDir}/${name}.png`, fullPage: true })
            .catch((shot) =>
              console.error(`Screenshot unavailable: ${message(shot)}`),
            );
        await boundedVerdict(
          name,
          error instanceof Unavailable &&
            !(name === "connect-data-source" && errors.length > 0)
            ? "COULD-NOT-RUN"
            : "FAIL",
          name === "connect-data-source" &&
            (!(error instanceof Unavailable) || errors.length > 0)
            ? `${safeConnectionFailure}${errors.length ? `: ${errors.join("; ")}` : ""}`
            : message(error),
          page,
          beforeBuild ?? { kind: "unreadable", reason: "Flow not started" },
          beforeBuild ? flowContext.request : buildRequest,
        );
      } finally {
        await page?.close();
        if (ownsFlowContext) await flowContext.close();
        connectionFlowStage = undefined;
      }
    }
    if (!setupError) {
      for (const id of threads) {
        try {
          const response = await context.request.delete(
            `${base}/_agent-native/agent-chat/threads/${encodeURIComponent(id)}`,
            { headers: { "x-agent-native-csrf": "1" } },
          );
          if (!response.ok())
            throw new Error(`Thread cleanup HTTP ${response.status()}`);
          threads.delete(id);
        } catch (error) {
          await verdict(
            "cleanup",
            "FAIL",
            `RESIDUE thread ${id}: ${message(error)}`,
          );
        }
      }
      for (const datasetId of datasets) {
        try {
          if (mode === "local") {
            const profile = await readQAProfile();
            await cleanupLocalStagedDataset({
              datasetId,
              databaseUrl: process.env.DATABASE_URL,
              email: profile.email,
              workspaceId: profile.workspaceId,
            });
          } else await action(setup, "delete-staged-dataset", { datasetId });
          const remaining = z
            .object({ datasets: z.array(z.object({ id: z.string() })) })
            .parse(await action(setup, "list-staged-datasets", {}, "GET"));
          expect(remaining.datasets.some((item) => item.id === datasetId)).toBe(
            false,
          );
          datasets.delete(datasetId);
        } catch (error) {
          await verdict(
            "cleanup",
            "FAIL",
            `RESIDUE dataset ${datasetId}: ${message(error)}`,
          );
        }
      }
      for (const projectId of projects) {
        try {
          await action(setup, "trash-project", { projectId });
          await action(setup, "delete-project", { projectId });
          const deleted = await setup.request.get(
            `${base}/_agent-native/actions/get-project?${new URLSearchParams({ projectId })}`,
            { headers: { "x-agent-native-frontend": "1" } },
          );
          expect(deleted.status()).toBe(404);
          projects.delete(projectId);
        } catch (error) {
          await verdict(
            "cleanup",
            "FAIL",
            `RESIDUE project ${projectId}: ${message(error)}`,
          );
        }
      }
    }
  } catch (error) {
    await verdict("cleanup", "FAIL", message(error));
  } finally {
    await context.close();
    await browser.close();
  }
  console.log(
    `FIXTURES outstanding=${
      readOutstandingFixtures(fixtureLedger.path)
        .map((fixture) => `${fixture.kind}:${fixture.id}`)
        .join(",") || "none"
    } ledger=${fixtureLedger.path}`,
  );
  console.log(`SCREENSHOTS ${flowShots?.root ?? outputDir}`);
  process.exitCode = verdicts.includes("FAIL")
    ? 1
    : verdicts.includes("COULD-NOT-RUN")
      ? 2
      : 0;
}

await buildRequest.dispose();
