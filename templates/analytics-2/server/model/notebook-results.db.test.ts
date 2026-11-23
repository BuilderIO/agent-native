import { generateKeyPairSync, randomUUID } from "node:crypto";

import { fail } from "@agent-native/core/action";
import { closeDbExec, runMigrations } from "@agent-native/core/db";
import {
  organizations,
  orgMembers,
  ORG_MIGRATIONS,
} from "@agent-native/core/org";
import {
  registerPrivateBlobProvider,
  unregisterPrivateBlobProvider,
  type PrivateBlobHandle,
} from "@agent-native/core/private-blob";
import {
  createProviderApiRuntime,
  type ProviderApiRequestArgs,
} from "@agent-native/core/provider-api";
import {
  loadActionsFromStaticRegistry,
  resetAppConfigForTests,
  runBetterAuthMigrations,
  runWithRequestContext,
} from "@agent-native/core/server";
import { upsertWorkspaceConnection } from "@agent-native/core/workspace-connections";
import { asc, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { z } from "zod";

import {
  type CellDraft,
  parameterCellContentsSchema,
  sqlCellContentsSchema,
} from "../../app/lib/model/contracts.js";
import { readCompleteCellRows } from "../../e2e/phase1/cell-execution.js";
import {
  CHART_CAP_SQL,
  CHART_REPLACEMENT_SQL,
} from "../../e2e/phase1/fixtures/chart-sources.js";
import { applyAppPatches, emptyAppLayout } from "../../shared/app-layout.js";
import { appSessionProjectionSchema } from "../../shared/app-session-operations.js";
import {
  executionSnapshotSchema,
  resultIdSchema,
  runRequestSchema,
  type RunReceipt,
} from "../../shared/notebook-execution.js";
import { completeResultManifestSchema } from "../../shared/notebook-result-contract.js";
import {
  notebookCellIdSchema,
  revisionSchema,
} from "../../shared/notebook-snapshot-contract.js";
import {
  publishPreviewReceiptSchema,
  publishPreviewDetailSchema,
  publishProjectReceiptSchema,
} from "../../shared/project-publish.js";
import { SAMPLE_DATA_SOURCE_ID } from "../../shared/sample-data-contract.js";
import { getDb, schema } from "../db/index.js";
import { runAnalyticsMigrations } from "../db/migrations.js";
import { localDuckDb } from "../execution/local-duckdb.test-support.js";
import type { KernelPort } from "../execution/notebook-kernel.js";
import { createNotebookWorker } from "../execution/notebook-worker.js";
import { writeAppDocument } from "./app-layouts.js";
import * as dataConnections from "./data-connections.js";
import { digest } from "./notebook-execution/planner.js";
import { createRunStore } from "./notebook-execution/run-store.js";
import {
  notebookOutputs,
  notebookResultManifests,
  notebookResultSegments,
  notebookRunWork,
  notebookRunAttempts,
} from "./notebook-execution/schema.js";
import * as execution from "./notebook-execution/service.js";
import {
  draftNamespace,
  readDraftSnapshot,
} from "./notebook-execution/snapshot.js";
import {
  getNotebookResultPageOutput,
  getNotebookRunDiagnosticsOutput,
  openPublishedResultDrillOutput,
  readNotebookKernelInput,
  setNotebookResultViewOutput,
  sweepNotebookResultStaging,
} from "./notebook-results.js";
import { createProject, getProjectDocument } from "./projects-store.js";

const boundary = vi.hoisted(() => ({
  resolve: vi.fn(),
  storageRead: vi.fn(),
  credential: "",
  kernel: undefined as KernelPort | undefined,
}));

vi.mock("../execution/notebook-kernel.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../execution/notebook-kernel.js")>()),
  createHostedKernelPort: () => {
    if (!boundary.kernel) throw new Error("No kernel fixture configured");
    return boundary.kernel;
  },
}));

vi.mock("./data-storage.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./data-storage.js")>()),
  createWarehouseStorageClient: async () => ({ close: async () => {} }),
  readStoragePage: boundary.storageRead,
}));
vi.mock("@agent-native/core/workspace-connections", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("@agent-native/core/workspace-connections")
  >()),
  resolveWorkspaceConnectionCredentialForApp: async () => ({
    available: true,
    value: boundary.credential,
  }),
}));

const actor = {
  orgId: "result-workspace",
  ownerEmail: "owner@example.test",
  caller: "frontend",
};
const other = { ...actor, ownerEmail: "other@example.test" };
const differentOrg = { ...actor, orgId: "other-workspace" };
const dispatchContext = { caller: "frontend" } as const;
const actorContext = <T>(fn: () => T, identity = actor) =>
  runWithRequestContext(
    {
      orgId: identity.orgId,
      userEmail: identity.ownerEmail,
      authUserId: identity.ownerEmail,
    },
    fn,
  );
const now = new Date(0).toISOString();
const connectionId = "provider-fixture";
const columns = [
  { name: "row_id", type: "INT64", mode: "REQUIRED" },
  { name: "sentinel", type: "INT64", mode: "REQUIRED" },
];
const store = createRunStore(readDraftSnapshot);
const worker = createNotebookWorker(store);
const blobs = new Map<string, Uint8Array>();
const storage = {
  id: "e3-fixture",
  name: "Result storage fixture",
  isConfigured: () => true,
  put: vi.fn(async ({ key, data }: { key?: string; data: Uint8Array }) => {
    if (!key || blobs.has(key))
      throw new Error("Artifact key is missing or already exists");
    blobs.set(key, Uint8Array.from(data));
    return {
      id: key,
      provider: "e3-fixture",
      encrypted: false,
      opaque: true,
    } satisfies PrivateBlobHandle;
  }),
  read: vi.fn(async (handle: PrivateBlobHandle) => {
    const data = blobs.get(handle.id);
    if (!data) throw new Error("Fixture blob is missing");
    return { data, handle };
  }),
  delete: vi.fn(async (handle: PrivateBlobHandle) => ({
    deleted: blobs.delete(handle.id),
    provider: "e3-fixture",
  })),
};
const registry = loadActionsFromStaticRegistry(
  (await import("../../.generated/actions-registry.js")).default,
);

async function call(
  name: string,
  input: Record<string, unknown>,
  identity = actor,
) {
  const action = registry[name];
  if (!action) throw new Error(`Action was not registered: ${name}`);
  return actorContext(() => action.run(input, dispatchContext), identity);
}

function deferred<T>() {
  let resolve = (_value: T): void => {
    throw new Error("Fixture promise is not initialized");
  };
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function queryArgs(request: ProviderApiRequestArgs) {
  return request.query as
    | { pageToken?: string; startIndex?: string; fields?: string }
    | undefined;
}

function response(json: unknown) {
  return { response: { ok: true, status: 200, truncated: false, json } };
}

function dryRunResponse(request: ProviderApiRequestArgs) {
  if (
    request.method !== "POST" ||
    request.path !== "/projects/fixture-project/jobs" ||
    (request.body as { configuration?: { dryRun?: boolean } }).configuration
      ?.dryRun !== true
  )
    return undefined;
  return response({
    jobReference: { projectId: "fixture-project", location: "EU" },
    statistics: { query: { statementType: "SELECT" } },
  });
}

function provider({
  total,
  sentinel = 42,
  useStorage = false,
  jobError,
}: {
  total: number;
  sentinel?: number;
  useStorage?: boolean;
  jobError?: { reason: string; message: string };
}) {
  const jobs = new Map<
    string,
    { projectId: string; jobId: string; location: string }
  >();
  const fetch = vi.fn(async (request: ProviderApiRequestArgs) => {
    const validated = dryRunResponse(request);
    if (validated) return validated;
    if (request.method === "POST") {
      const job = (
        request.body as {
          jobReference: { projectId: string; jobId: string; location: string };
        }
      ).jobReference;
      jobs.set(job.jobId, job);
      return response({
        jobReference: job,
        status: {
          state: "DONE",
          ...(jobError ? { errorResult: jobError } : {}),
        },
      });
    }
    const id = request.path.split("/").at(-1) ?? "";
    const jobReference = jobs.get(id);
    if (!jobReference) throw new Error("Fixture received an unknown job");
    if (request.path.includes("/jobs/"))
      return response({ jobReference, status: { state: "DONE" } });
    const query = queryArgs(request);
    const offset = Number(query?.pageToken ?? query?.startIndex ?? 0);
    const metadata = query?.fields !== undefined;
    const count = Math.min(1000, total - offset);
    return response({
      jobReference,
      jobComplete: true,
      totalRows: String(total),
      schema: { fields: columns },
      ...(!metadata
        ? {
            pageToken:
              offset + count < total ? String(offset + count) : undefined,
            rows: Array.from({ length: count }, (_, index) => ({
              f: [{ v: String(offset + index + 1) }, { v: String(sentinel) }],
            })),
          }
        : {}),
    });
  });
  const runtime = {
    ...createProviderApiRuntime({ appId: "result-fixture" }),
    executeRequest: fetch,
  };
  boundary.resolve.mockResolvedValue({
    projectId: "fixture-project",
    location: "EU",
    runtime,
    revision: "fixture-authority",
    storage: useStorage ? { connectionId, credentialKey: "fixture" } : null,
  });
  return fetch;
}

async function setupProject() {
  const projectId = randomUUID();
  const versionId = randomUUID();
  const cellId = notebookCellIdSchema.parse(randomUUID());
  await getDb().insert(schema.projects).values({
    id: projectId,
    ownerEmail: actor.ownerEmail,
    orgId: actor.orgId,
    workingVersionId: versionId,
    createdAt: now,
    updatedAt: now,
  });
  await getDb().insert(schema.projectVersions).values({
    id: versionId,
    projectId,
    number: "1",
    createdBy: actor.ownerEmail,
    createdAt: now,
  });
  return {
    cellId,
    async start(
      source = "select row_id, sentinel from sql_results order by row_id",
      cache = "bypass",
    ) {
      const contents = sqlCellContentsSchema.parse({
        id: cellId,
        order: "i",
        label: null,
        hidden: false,
        kind: "sql",
        source,
        gridX: null,
        gridY: null,
        gridWidth: null,
        gridHeight: null,
        dataConnectionId: connectionId,
        databaseSchema: null,
        resultVariable: "result",
        outputResult: true,
      });
      const row = {
        id: cellId,
        projectId,
        versionId,
        kind: "sql",
        order: "i",
        contents: JSON.stringify(contents),
        createdAt: now,
        updatedAt: now,
      };
      await getDb()
        .insert(schema.cells)
        .values(row)
        .onConflictDoUpdate({
          target: [schema.cells.versionId, schema.cells.id],
          set: { contents: row.contents },
        });
      const read = await readDraftSnapshot(
        actor,
        executionSnapshotSchema.parse({
          ref: {
            workspaceId: actor.orgId,
            projectId,
            head: { versionId, revision: "0" },
            eventSeq: "0",
          },
          namespace: draftNamespace(actor, projectId),
          inputRevision: "0",
          executionFingerprint: "seed",
        }),
      );
      if (read.status !== "accepted")
        throw new Error("Fixture project is missing");
      const result = await store.admit(
        actor,
        runRequestSchema.parse({
          requestId: randomUUID(),
          snapshot: read.value.snapshot,
          targetCellId: cellId,
          mode: "cell-only",
          staleValues: "reject",
          cache,
        }),
      );
      if (result.status !== "admitted")
        throw new Error(`Fixture not admitted: ${JSON.stringify(result)}`);
      return result;
    },
  };
}

function resultId(run: RunReceipt) {
  const attempt = run.attempts[0]?.attempt;
  if (!attempt) throw new Error("No attempt");
  return resultIdSchema.parse(digest(attempt));
}

async function page(id: string, number?: number, identity = actor) {
  return getNotebookResultPageOutput.parse(
    await call(
      "get-notebook-result-page",
      {
        resultId: id,
        ...(number === undefined ? {} : { page: number }),
      },
      identity,
    ),
  );
}

async function saveView(
  id: string,
  number: number,
  revision: string,
  requestId = randomUUID(),
) {
  return setNotebookResultViewOutput.parse(
    await call("set-notebook-result-view", {
      resultId: id,
      page: number,
      expectedViewRevision: revision,
      requestId,
    }),
  );
}

async function diagnostics(run: RunReceipt) {
  return getNotebookRunDiagnosticsOutput.parse(
    await call("get-notebook-run-diagnostics", {
      runId: run.runId,
      attemptId: run.attempts[0]?.attempt.attemptId,
    }),
  );
}

function rows(start: number, count: number, sentinel: number) {
  return Array.from({ length: count }, (_, index) => [
    { type: "integer", value: String(start + index) },
    { type: "integer", value: String(sentinel) },
  ]);
}

beforeAll(async () => {
  vi.spyOn(
    dataConnections,
    "resolveNotebookWarehouseConnection",
  ).mockImplementation(boundary.resolve);
  const { privateKey } = generateKeyPairSync("rsa", {
    modulusLength: 2048,
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
    publicKeyEncoding: { type: "spki", format: "pem" },
  });
  boundary.credential = JSON.stringify({
    client_email: "warehouse@example.test",
    project_id: "fixture-project",
    private_key: privateKey,
  });
  vi.stubEnv("DATABASE_URL", "pglite:memory://");
  vi.stubEnv("DATABASE_URL_UNPOOLED", "");
  vi.stubEnv("NETLIFY_DATABASE_URL_UNPOOLED", "");
  resetAppConfigForTests();
  await runMigrations(
    ORG_MIGRATIONS.map(({ name, ...entry }) =>
      name ? { ...entry, name } : entry,
    ),
    {
      table: "notebook_result_org_migrations",
    },
  )(undefined);
  await runAnalyticsMigrations(undefined);
  await runBetterAuthMigrations(undefined);
  await getDb()
    .insert(organizations)
    .values([
      {
        id: actor.orgId,
        name: "Result fixture",
        createdBy: actor.ownerEmail,
        createdAt: 0,
      },
      {
        id: differentOrg.orgId,
        name: "Other fixture",
        createdBy: actor.ownerEmail,
        createdAt: 0,
      },
    ]);
  await getDb()
    .insert(orgMembers)
    .values(
      [actor, other, differentOrg].map((identity) => ({
        id: identity === other ? "p4-member" : randomUUID(),
        orgId: identity.orgId,
        email: identity.ownerEmail,
        role: "owner",
        joinedAt: 0,
      })),
    );
  await actorContext(() =>
    upsertWorkspaceConnection({
      id: connectionId,
      provider: "bigquery",
      label: "Result fixture warehouse",
      status: "connected",
    }),
  );
  registerPrivateBlobProvider(storage);
});

beforeEach(() => {
  vi.clearAllMocks();
  boundary.kernel = undefined;
  storage.read.mockReset();
  storage.read.mockImplementation(async (handle) => {
    const data = blobs.get(handle.id);
    if (!data) throw new Error("Fixture blob is missing");
    return { data, handle };
  });
});

afterAll(async () => {
  unregisterPrivateBlobProvider(storage.id);
  await closeDbExec();
  vi.unstubAllEnvs();
  resetAppConfigForTests();
});

it("reads page 400 directly in one blob read and reopens the scoped saved page", async () => {
  const fetch = provider({ total: 20_000 });
  const project = await setupProject();
  const run = await project.start();
  await actorContext(() => worker(actor, run.runId));
  const id = resultId(run);
  const providerCalls = fetch.mock.calls.length;
  expect(providerCalls).toBe(22);
  storage.read.mockClear();
  expect(await page(id, 400)).toMatchObject({
    status: "ready",
    page: 400,
    rows: rows(19_951, 50, 42),
    manifest: { status: "complete", rowCount: "20000" },
  });
  expect(storage.read).toHaveBeenCalledTimes(1);
  expect(fetch).toHaveBeenCalledTimes(providerCalls);
  const requestId = randomUUID();
  expect(await saveView(id, 400, "0", requestId)).toEqual({
    status: "saved",
    resultId: id,
    page: 400,
    viewRevision: "1",
  });
  expect(await page(id)).toMatchObject({ status: "ready", page: 400 });
  expect(await saveView(id, 5, "1")).toMatchObject({ page: 5 });
  expect(await saveView(id, 400, "0", requestId)).toMatchObject({
    page: 400,
    viewRevision: "1",
  });
  expect(await page(id)).toMatchObject({ page: 5 });
  expect(await saveView(id, 400, "2")).toMatchObject({ page: 400 });
  provider({ total: 12, sentinel: 84 });
  const shorter = await project.start(
    "select row_id, 84 from sql_results order by row_id",
  );
  await actorContext(() => worker(actor, shorter.runId));
  expect(await page(resultId(shorter))).toMatchObject({
    status: "ready",
    page: 1,
    rows: rows(1, 12, 84),
  });
  expect(await page(resultId(shorter), 400)).toMatchObject({
    status: "out_of_range",
    lastPage: 1,
  });
});

it("restarts a forced Storage fallback from offset zero without mixing provider orderings", async () => {
  const fetch = provider({ total: 2_001, useStorage: true });
  boundary.storageRead
    .mockResolvedValueOnce({
      rows: Array.from({ length: 1000 }, (_, index) => [
        String(2001 - index),
        "7",
      ]),
    })
    .mockRejectedValueOnce(
      Object.assign(new Error("Storage unavailable"), { code: 14 }),
    );
  const run = await (await setupProject()).start();
  await actorContext(() => worker(actor, run.runId));
  expect(boundary.storageRead.mock.calls.map((call) => call[1].offset)).toEqual(
    [0n, 1000n],
  );
  const realRest = fetch.mock.calls
    .map(([call]) => call)
    .filter(
      (call) =>
        call.path.includes("/queries/") &&
        queryArgs(call)?.fields === undefined,
    );
  expect(
    realRest.map((call) => [
      queryArgs(call)?.pageToken,
      queryArgs(call)?.startIndex,
    ]),
  ).toEqual([
    [undefined, undefined],
    ["1000", undefined],
    ["2000", undefined],
  ]);
  expect(
    fetch.mock.calls.filter(
      ([call]) => call.method === "POST" && !dryRunResponse(call),
    ),
  ).toHaveLength(1);
  expect(await page(resultId(run), 1)).toMatchObject({
    status: "ready",
    rows: rows(1, 50, 42),
  });
  expect(await page(resultId(run), 21)).toMatchObject({
    status: "ready",
    rows: rows(1001, 50, 42),
  });
  expect(await diagnostics(run)).toMatchObject({
    status: "found",
    diagnostic: { code: "complete", fallbackCode: "warehouse_query_failed" },
  });
});

it("keeps a far page pending and fences promotion after a staged partial write", async () => {
  provider({ total: 1001 });
  const project = await setupProject();
  const run = await project.start();
  const id = resultId(run);
  const originalRead = storage.read.getMockImplementation();
  if (!originalRead) throw new Error("Fixture has no storage read");
  const entered = deferred<string>();
  const resume = deferred<void>();
  storage.read.mockImplementation(async (handle) => {
    if (!handle.id.includes("/1000/")) return originalRead(handle);
    entered.resolve(handle.id);
    await resume.promise;
    const read = await originalRead(handle);
    const corrupted = Uint8Array.from(read.data);
    corrupted[0] = (corrupted[0] ?? 0) ^ 1;
    return { ...read, data: corrupted };
  });
  const running = actorContext(() => worker(actor, run.runId));
  const first = await Promise.race([entered.promise, running.then(() => null)]);
  try {
    expect(first).toEqual(expect.any(String));
    expect(await page(id, 400)).toEqual({
      status: "pending",
      resultId: id,
      page: 400,
    });
    expect(await call("get-notebook-run", { runId: run.runId })).toMatchObject({
      status: "found",
      building: [
        { attemptId: run.attempts[0]?.attempt.attemptId, resultId: id },
      ],
    });
    const [pointer] = await getDb()
      .select()
      .from(notebookOutputs)
      .where(eq(notebookOutputs.cellId, project.cellId))
      .limit(1);
    expect(pointer?.resultId).toBeNull();
  } finally {
    resume.resolve();
    await running;
  }
  expect(await page(id, 400)).toMatchObject({ status: "absent" });
  expect(await diagnostics(run)).toMatchObject({
    status: "found",
    diagnostic: { code: "execution_failed" },
  });
  const [work] = await getDb()
    .select()
    .from(notebookRunWork)
    .where(eq(notebookRunWork.runId, run.runId))
    .limit(1);
  const artifactId = work?.resultBuild?.artifactId;
  if (!artifactId) throw new Error("Missing staging artifact");
  const segments = await getDb()
    .select()
    .from(notebookResultSegments)
    .where(eq(notebookResultSegments.artifactId, artifactId))
    .orderBy(asc(notebookResultSegments.startRow))
    .limit(2);
  expect(segments.map(({ verified }) => verified)).toEqual([true, false]);
  await getDb()
    .update(notebookResultSegments)
    .set({ createdAt: 0 })
    .where(eq(notebookResultSegments.artifactId, artifactId));
  await sweepNotebookResultStaging({ deadlineAt: Date.now() + 10_000 });
  expect(segments.every(({ handle }) => !blobs.has(handle.id))).toBe(true);
});

it("masks unauthorized result IDs and rejects stale writes while preserving pinned reads", async () => {
  provider({ total: 55 });
  const project = await setupProject();
  const before = await project.start();
  await actorContext(() => worker(actor, before.runId));
  const beforeId = resultId(before);
  expect(await page(beforeId, 1, other)).toEqual({
    status: "absent",
    reason: "not_found",
  });
  expect(await page(beforeId, 1, differentOrg)).toEqual({
    status: "absent",
    reason: "not_found",
  });
  expect(await page("unknown-result", 1)).toEqual({
    status: "absent",
    reason: "not_found",
  });
  provider({ total: 55, sentinel: 84 });
  const after = await project.start(
    "select row_id, 84 from sql_results order by row_id",
  );
  await actorContext(() => worker(actor, after.runId));
  expect(await saveView(beforeId, 2, "0")).toEqual({
    status: "conflict",
    reason: "stale_result",
  });
  expect(await page(beforeId, 2)).toMatchObject({
    status: "ready",
    rows: rows(51, 5, 42),
  });
  expect(await page(resultId(after), 2)).toMatchObject({
    status: "ready",
    rows: rows(51, 5, 84),
  });
});

it("denies revoked source results and diagnostics before any blob or provider read", async () => {
  const fetch = provider({ total: 50 });
  const project = await setupProject();
  const run = await project.start();
  await actorContext(() => worker(actor, run.runId));
  const providerCalls = fetch.mock.calls.length;
  const id = resultId(run);
  expect(await page(id, 1)).toMatchObject({ status: "ready" });
  storage.read.mockClear();
  boundary.resolve.mockImplementation(async () =>
    fail("Fixture grant was revoked", {
      statusCode: 403,
      errorCode: "warehouse_query_denied",
    }),
  );
  expect(await page(id, 1)).toEqual({
    status: "denied",
    reason: "access_denied",
  });
  expect(await diagnostics(run)).toEqual({
    status: "denied",
    reason: "access_denied",
  });
  expect(storage.read).not.toHaveBeenCalled();
  expect(fetch).toHaveBeenCalledTimes(providerCalls);
});

it("pins multi-segment pages to one result even when a newer run promotes during the read", async () => {
  const fetch = provider({ total: 1_040 });
  const project = await setupProject();
  const run = await project.start();
  const rest = fetch.getMockImplementation();
  if (!rest) throw new Error("Fixture has no REST reader");
  fetch.mockImplementation(async (request) => {
    const reply = await rest(request);
    const parsed = reply.response.json as {
      rows?: unknown[];
      pageToken?: string;
    };
    if (parsed.pageToken === "1000")
      return response({
        ...parsed,
        rows: parsed.rows?.slice(0, 975),
        pageToken: "975",
      });
    return reply;
  });
  await actorContext(() => worker(actor, run.runId));
  const [old] = await getDb()
    .select()
    .from(notebookResultManifests)
    .where(eq(notebookResultManifests.id, resultId(run)))
    .limit(1);
  const originalRead = storage.read.getMockImplementation();
  if (!old?.artifactId || !originalRead)
    throw new Error("Old fixture artifact was not published");
  const entered = deferred<void>();
  const resume = deferred<void>();
  storage.read.mockImplementation(async (handle) => {
    if (handle.id.includes(old.artifactId + "/0/")) {
      entered.resolve();
      await resume.promise;
    }
    return originalRead(handle);
  });
  const pending = page(resultId(run), 20);
  try {
    await Promise.race([
      entered.promise,
      pending.then(() => {
        throw new Error("No old page read");
      }),
    ]);
    provider({ total: 1_040, sentinel: 84 });
    const newer = await project.start(
      "select row_id, 84 from sql_results order by row_id",
    );
    await actorContext(() => worker(actor, newer.runId));
    expect(await page(resultId(newer), 20)).toMatchObject({
      status: "ready",
      rows: rows(951, 50, 84),
    });
  } finally {
    resume.resolve();
  }
  expect(await pending).toMatchObject({
    status: "ready",
    rows: rows(951, 50, 42),
  });
});

it("distinguishes bad identifiers from provider permissions and strips query values", async () => {
  const project = await setupProject();
  provider({
    total: 0,
    jobError: {
      reason: "invalidQuery",
      message: "Unrecognized name: no_such_column at [1:8]",
    },
  });
  const bad = await project.start(
    "select no_such_column from sql_results where value = 'fixture-private-value'",
  );
  await actorContext(() => worker(actor, bad.runId));
  expect(await diagnostics(bad)).toMatchObject({
    traceId: expect.stringMatching(/^analytics2_/),
    diagnostic: {
      code: "warehouse_query_failed",
      provider: {
        reason: "invalidQuery",
        message: "Unrecognized name: no_such_column",
        line: 1,
        column: 8,
      },
    },
    compiledSql: "select no_such_column from sql_results where value = ?",
  });
  provider({
    total: 0,
    jobError: {
      reason: "accessDenied",
      message: "Access denied to private table",
    },
  });
  const denied = await project.start();
  await actorContext(() => worker(actor, denied.runId));
  expect(await diagnostics(denied)).toMatchObject({
    diagnostic: {
      code: "warehouse_query_denied",
      provider: { reason: "accessDenied", message: null },
    },
  });
});

it("retains provider query diagnostics after masking echoed SQL values", async () => {
  const project = await setupProject();
  provider({
    total: 0,
    jobError: {
      reason: "invalidQuery",
      message:
        "No matching signature for operator = with 'fixture-private-value' at [1:8]",
    },
  });
  const run = await project.start();
  await actorContext(() => worker(actor, run.runId));
  expect(await diagnostics(run)).toMatchObject({
    diagnostic: {
      code: "warehouse_query_failed",
      message: "No matching signature for operator = with ? at [1:8]",
      provider: {
        reason: "invalidQuery",
        message: "No matching signature for operator = with ? at [1:8]",
        line: 1,
        column: 8,
      },
    },
  });
});

it("reports unavailable result storage after BigQuery returns rows", async () => {
  const project = await setupProject();
  provider({ total: 1 });
  const run = await project.start();
  unregisterPrivateBlobProvider(storage.id);
  try {
    await actorContext(() => worker(actor, run.runId));
    expect(await diagnostics(run)).toMatchObject({
      status: "found",
      diagnostic: {
        code: "notebook_result_storage_unavailable",
        message:
          "Results can’t be saved in this workspace right now. A workspace admin needs to set up storage.",
      },
    });
  } finally {
    registerPrivateBlobProvider(storage);
  }
});

it("distinguishes exact empty, incomplete coverage and an unreadable committed segment", async () => {
  const project = await setupProject();
  provider({ total: 0 });
  const empty = await project.start();
  await actorContext(() => worker(actor, empty.runId));
  expect(await page(resultId(empty), 1)).toMatchObject({
    status: "ready",
    rows: [],
    manifest: { status: "complete-empty", rowCount: "0" },
  });

  const warehouse = provider({ total: 51 });
  const rest = warehouse.getMockImplementation();
  if (!rest) throw new Error("Fixture has no REST reader");
  warehouse.mockImplementation(async (request) => {
    const reply = await rest(request);
    const payload = reply.response.json as { rows?: unknown[] };
    return payload.rows
      ? response({ ...payload, rows: payload.rows.slice(0, 50) })
      : reply;
  });
  const incomplete = await project.start();
  await actorContext(() => worker(actor, incomplete.runId));
  expect(await page(resultId(incomplete), 1)).toMatchObject({
    status: "ready",
    rows: rows(1, 50, 42),
    manifest: { status: "incomplete", verifiedRowCount: "50" },
  });
  expect(await page(resultId(incomplete), 2)).toMatchObject({
    status: "incomplete",
    reason: "coverage_unverified",
    knownRows: "50",
  });

  storage.read.mockRejectedValue(new Error("Storage unavailable"));
  expect(await page(resultId(incomplete), 1)).toEqual({
    status: "unreadable",
    reason: "read_failed",
  });
});

it("reuses verified cache segments for one authority and bypasses them on request", async () => {
  const project = await setupProject();
  const warehouse = provider({ total: 50 });
  const first = await project.start(undefined, "reuse");
  await actorContext(() => worker(actor, first.runId));
  const cached = await project.start(undefined, "reuse");
  await actorContext(() => worker(actor, cached.runId));
  expect(
    warehouse.mock.calls.filter(
      ([call]) => call.method === "POST" && !dryRunResponse(call),
    ),
  ).toHaveLength(1);
  expect(storage.put).toHaveBeenCalledTimes(1);
  expect(await page(resultId(cached))).toMatchObject({
    status: "ready",
    rows: rows(1, 50, 42),
    manifest: {
      result: {
        resultId: resultId(cached),
        producer: cached.attempts[0]?.attempt,
      },
    },
  });

  const bypass = await project.start();
  await actorContext(() => worker(actor, bypass.runId));
  expect(
    warehouse.mock.calls.filter(
      ([call]) => call.method === "POST" && !dryRunResponse(call),
    ),
  ).toHaveLength(2);
  expect(storage.put).toHaveBeenCalledTimes(2);
});

async function warehouseFixtures(
  fixtures: Record<
    string,
    { columns: typeof columns; rows: (string | null)[][] }
  >,
) {
  for (const id of Object.keys(fixtures))
    await actorContext(() =>
      upsertWorkspaceConnection({
        id,
        provider: "bigquery",
        label: `Result fixture ${id}`,
        status: "connected",
      }),
    );
  const denied = new Set<string>();
  const jobs = new Map<
    string,
    { projectId: string; jobId: string; location: string }
  >();
  boundary.resolve.mockImplementation(async (id: string) => {
    const rows = fixtures[id];
    if (!rows || denied.has(id))
      fail("Access denied", {
        statusCode: 403,
        errorCode: "warehouse_query_denied",
      });
    return {
      projectId: "fixture-project",
      location: "EU",
      revision: `grant:${id}`,
      storage: null,
      runtime: {
        ...createProviderApiRuntime({ appId: "result-fixture" }),
        executeRequest: async (request: ProviderApiRequestArgs) => {
          const validated = dryRunResponse(request);
          if (validated) return validated;
          if (request.method === "POST") {
            const job = (
              request.body as {
                jobReference: {
                  projectId: string;
                  jobId: string;
                  location: string;
                };
              }
            ).jobReference;
            jobs.set(`${id}/${job.jobId}`, job);
            return response({ jobReference: job, status: { state: "DONE" } });
          }
          const jobReference = jobs.get(
            `${id}/${request.path.split("/").at(-1)}`,
          );
          if (!jobReference) throw new Error("Fixture received an unknown job");
          return response({
            jobReference,
            jobComplete: true,
            totalRows: String(rows.rows.length),
            schema: { fields: rows.columns },
            rows: rows.rows.map((row) => ({
              f: row.map((value) => ({ v: value })),
            })),
          });
        },
      },
    };
  });
  return denied;
}

type SqlFixture = { name: string; source: string; connectionId?: string };
async function dataframeProject(fixtures: SqlFixture[], inputDate?: string) {
  const projectId = randomUUID();
  const draftId = randomUUID();
  const versionId = randomUUID();
  await getDb().insert(schema.projects).values({
    id: projectId,
    ownerEmail: actor.ownerEmail,
    orgId: actor.orgId,
    workingVersionId: draftId,
    publishedVersionId: versionId,
    createdAt: now,
    updatedAt: now,
  });
  await getDb()
    .insert(schema.projectVersions)
    .values([
      {
        id: draftId,
        projectId,
        number: "1",
        createdBy: actor.ownerEmail,
        createdAt: now,
      },
      {
        id: versionId,
        projectId,
        number: "2",
        kind: "published",
        createdBy: actor.ownerEmail,
        createdAt: now,
      },
    ]);
  const targetIds = new Map<
    string,
    ReturnType<typeof notebookCellIdSchema.parse>
  >();
  const rows = fixtures.map(({ name, source, connectionId }, index) => {
    const id = notebookCellIdSchema.parse(randomUUID());
    targetIds.set(name, id);
    const order = `b${String(index).padStart(2, "0")}i`;
    const contents = sqlCellContentsSchema.parse({
      id,
      order,
      kind: "sql",
      source,
      resultVariable: name,
      outputResult: true,
      dataConnectionId: connectionId ?? null,
      ...(connectionId ? {} : { connectionMode: "dataframes" }),
      databaseSchema: null,
      label: null,
      hidden: false,
      gridX: null,
      gridY: null,
      gridWidth: null,
      gridHeight: null,
    });
    return {
      id,
      projectId,
      kind: contents.kind,
      order,
      contents: JSON.stringify(contents),
      createdAt: now,
      updatedAt: now,
    };
  });
  if (inputDate) {
    const id = notebookCellIdSchema.parse(randomUUID());
    const contents = parameterCellContentsSchema.parse({
      id,
      order: "a",
      kind: "input",
      name: "since",
      inputType: "DATE",
      defaultValueString: inputDate,
      label: null,
      hidden: false,
      gridX: null,
      gridY: null,
      gridWidth: null,
      gridHeight: null,
    });
    await getDb()
      .insert(schema.cells)
      .values(
        [draftId, versionId].map((versionId) => ({
          id,
          projectId,
          versionId,
          kind: contents.kind,
          order: contents.order,
          contents: JSON.stringify(contents),
          createdAt: now,
          updatedAt: now,
        })),
      );
  }
  await getDb()
    .insert(schema.cells)
    .values(
      [draftId, versionId].flatMap((versionId) =>
        rows.map((row) => ({ ...row, versionId })),
      ),
    );
  const read = await readDraftSnapshot(
    actor,
    executionSnapshotSchema.parse({
      ref: {
        workspaceId: actor.orgId,
        projectId,
        head: { versionId: draftId, revision: "0" },
        eventSeq: "0",
      },
      namespace: draftNamespace(actor, projectId),
      inputRevision: "0",
      executionFingerprint: "seed",
    }),
  );
  if (read.status !== "accepted") throw new Error("Fixture draft missing");
  return {
    projectId,
    versionId,
    snapshot: read.value.snapshot,
    id(name: string) {
      const id = targetIds.get(name);
      if (!id) throw new Error(`Fixture cell missing: ${name}`);
      return id;
    },
    admit(name: string, mode: "upstream" | "cell-only") {
      return store.admit(
        actor,
        runRequestSchema.parse({
          requestId: randomUUID(),
          snapshot: read.value.snapshot,
          targetCellId: this.id(name),
          mode,
          staleValues: "reject",
          cache: "bypass",
        }),
      );
    },
  };
}

async function runDataframes(run: RunReceipt, kernel: KernelPort) {
  const work = createNotebookWorker(store, kernel);
  for (const _cell of run.plan.admittedCellIds)
    expect(await actorContext(() => work(actor, run.runId))).toBe(true);
}

async function manifestFor(run: RunReceipt, cellId: string) {
  const receipt = run.attempts.find(({ attempt }) => attempt.cellId === cellId);
  if (!receipt) throw new Error("Fixture attempt missing");
  const id = resultIdSchema.parse(digest(receipt.attempt));
  const [manifest] = await getDb()
    .select()
    .from(notebookResultManifests)
    .where(eq(notebookResultManifests.id, id))
    .limit(1);
  if (!manifest) {
    const [attempt] = await getDb()
      .select()
      .from(notebookRunAttempts)
      .where(eq(notebookRunAttempts.id, receipt.attempt.attemptId))
      .limit(1);
    throw new Error(
      `Fixture manifest missing: ${JSON.stringify(attempt?.diagnostic)}`,
    );
  }
  return manifest;
}

it("keeps the chart cap fixture's bound fields when switching from the demo warehouse to Dataframes", async () => {
  const fixtures = [
    {
      name: "rebound_chart",
      source: CHART_REPLACEMENT_SQL,
      connectionId: SAMPLE_DATA_SOURCE_ID,
      rowCount: "1",
    },
    { name: "capped_chart", source: CHART_CAP_SQL, rowCount: "10001" },
  ];
  const project = await dataframeProject(fixtures);
  const kernel = localDuckDb();
  for (const { name, rowCount } of fixtures) {
    const run = await project.admit(name, "cell-only");
    if (run.status !== "admitted") throw new Error(JSON.stringify(run));
    await runDataframes(run, kernel);
    const { manifest } = await manifestFor(run, project.id(name));
    expect(manifest).toMatchObject({
      status: "complete",
      rowCount,
      fields: [
        { name: "day", type: "date" },
        { name: "amount", type: "number" },
        { name: "channel", type: "string" },
      ],
    });
  }
});

it("runs four levels of DuckDB over warehouse artifacts with direct and transitive lineage in draft and a pinned published session", async () => {
  await warehouseFixtures({
    amounts: {
      columns: [
        { name: "id", type: "INT64", mode: "REQUIRED" },
        { name: "amount", type: "INT64", mode: "REQUIRED" },
      ],
      rows: [
        ["1", "42"],
        ["2", "84"],
      ],
    },
    regions: {
      columns: [
        { name: "id", type: "INT64", mode: "REQUIRED" },
        { name: "region", type: "STRING", mode: "REQUIRED" },
      ],
      rows: [
        ["1", "North"],
        ["2", "South"],
      ],
    },
  });
  const project = await dataframeProject([
    {
      name: "amounts",
      connectionId: "amounts",
      source: "select id, amount from warehouse.amounts",
    },
    {
      name: "regions",
      connectionId: "regions",
      source: "select id, region from warehouse.regions",
    },
    {
      name: "joined",
      source:
        "select r.region, a.amount from amounts a join regions r on r.id = a.id order by a.id",
    },
    {
      name: "by_region",
      source:
        "select region, sum(amount) as total from joined group by region order by region",
    },
    {
      name: "selected_regions",
      source:
        "select region, total from by_region where region in ('North', 'South') order by region",
    },
    {
      name: "grand_total",
      source: "select sum(total) as grand_total from selected_regions",
    },
  ]);
  const kernel = localDuckDb();
  const run = await project.admit("grand_total", "upstream");
  if (run.status !== "admitted") throw new Error(JSON.stringify(run));
  await runDataframes(run, kernel);

  const results = await Promise.all(
    [
      "amounts",
      "regions",
      "joined",
      "by_region",
      "selected_regions",
      "grand_total",
    ].map((name) => manifestFor(run, project.id(name))),
  );
  const [amounts, regions, joined, grouped, selected, grand] = results;
  if (!amounts || !regions || !joined || !grouped || !selected || !grand)
    throw new Error("Fixture results missing");
  expect(joined.bindings).toEqual([
    amounts.manifest.result,
    regions.manifest.result,
  ]);
  expect(grouped.bindings).toEqual([joined.manifest.result]);
  expect(selected.bindings).toEqual([grouped.manifest.result]);
  expect(grand.bindings).toEqual([selected.manifest.result]);
  expect(grand.authorities).toEqual([
    {
      connectionId: "amounts",
      generation: amounts.manifest.result.sourceGeneration,
    },
    {
      connectionId: "regions",
      generation: regions.manifest.result.sourceGeneration,
    },
  ]);
  expect(await page(joined.id, 1)).toMatchObject({
    status: "ready",
    rows: [
      ["North", { type: "integer", value: "42" }],
      ["South", { type: "integer", value: "84" }],
    ],
  });
  expect(await page(grouped.id, 1)).toMatchObject({
    status: "ready",
    rows: [
      ["North", { type: "decimal", value: "42" }],
      ["South", { type: "decimal", value: "84" }],
    ],
  });
  expect(await page(selected.id, 1)).toMatchObject({
    status: "ready",
    rows: [
      ["North", { type: "decimal", value: "42" }],
      ["South", { type: "decimal", value: "84" }],
    ],
  });
  expect(await page(grand.id, 1)).toMatchObject({
    status: "ready",
    rows: [[{ type: "decimal", value: "126" }]],
  });
  expect(kernel.execute).toHaveBeenCalledTimes(4);

  boundary.kernel = kernel;
  await expect(
    call("run-project-cell", {
      projectId: project.projectId,
      cellId: project.id("grand_total"),
    }),
  ).resolves.toMatchObject({
    status: "complete",
    output: { type: "table", rows: [["126"]] },
  });
  expect(kernel.execute).toHaveBeenCalledTimes(5);
  const published = await call("run-published-project-cell", {
    projectId: project.projectId,
    version: project.versionId,
    cellId: project.id("grand_total"),
    values: {},
  });
  expect(published).toMatchObject({
    output: {
      type: "table",
      rows: [["126"]],
      truncated: false,
      totalRows: "1",
    },
  });
  expect(kernel.execute).toHaveBeenCalledTimes(9);
  const release =
    kernel.execute.mock.calls.at(-1)?.[0].run.receipt.request.snapshot;
  expect(release).toMatchObject({
    namespace: { kind: "release-session", releaseId: project.versionId },
  });
  expect(release?.namespace.namespaceId).not.toBe(
    run.request.snapshot.namespace.namespaceId,
  );
});

it("denies page and drill through two published transforms after producing-source authority is revoked", async () => {
  const revoked = await warehouseFixtures({
    confidential: { columns, rows: [["1", "11042"]] },
  });
  const draftCell = (
    resultVariable: string,
    source: string,
    connectionId: string | null = null,
  ): CellDraft => ({
    kind: "sql",
    label: null,
    hidden: false,
    gridX: null,
    gridY: null,
    gridWidth: null,
    gridHeight: null,
    source,
    resultVariable,
    dataConnectionId: connectionId,
    ...(connectionId ? {} : { connectionMode: "dataframes" }),
    databaseSchema: null,
    outputResult: true,
  });
  const project = await createProject({
    ...actor,
    title: "Published source policy",
    cells: [
      draftCell(
        "warehouse_data",
        "select row_id, sentinel from warehouse.confidential",
        "confidential",
      ),
      draftCell("selected", "select sentinel from warehouse_data"),
      draftCell("result", "select max(sentinel) as value from selected"),
    ],
  });
  const draft = await getProjectDocument(actor, project.id);
  const [warehouse, selected, result] = draft?.cells ?? [];
  if (!draft?.draftHead || !warehouse || !selected || !result)
    throw new Error("The published source fixture is absent");
  await writeAppDocument(
    getDb(),
    actor.orgId,
    project.id,
    draft.workingVersionId,
    applyAppPatches(
      emptyAppLayout(revisionSchema.parse("0")),
      [
        { type: "initialize" },
        {
          type: "place",
          tabId: "tab-1",
          cellId: notebookCellIdSchema.parse(result.id),
          elementId: "published-result",
          destination: {
            rowId: "result-row",
            columnId: "result-column",
            left: 0,
            right: 120,
            afterRowId: null,
          },
        },
      ],
      draft.cells,
    ),
  );
  const kernel = localDuckDb();
  boundary.kernel = kernel;
  const stopWake = vi
    .spyOn(execution, "wakeNotebookRun")
    .mockImplementation(() => {});
  try {
    const condition = {
      projectId: project.id,
      expectedHead: draft.draftHead,
      expectedReleaseId: null,
    };
    const created = publishPreviewReceiptSchema.parse(
      await call("create-project-publish-preview", {
        ...condition,
        requestId: randomUUID(),
      }),
    );
    if (!created.runId) throw new Error("The publish preview run is absent");
    const workPreview = createNotebookWorker(
      execution.notebookRunStore,
      kernel,
    );
    const previewRunId = created.runId;
    await actorContext(async () => {
      while (await workPreview(actor, previewRunId)) continue;
    });
    expect(kernel.execute).toHaveBeenCalledTimes(2);
    const preview = publishPreviewDetailSchema.parse(
      await call("get-project-publish-preview", {
        projectId: project.id,
        previewId: created.previewId,
      }),
    );
    expect(preview.state).toBe("ready");
    const release = publishProjectReceiptSchema.parse(
      await call("publish-project", {
        ...condition,
        previewId: created.previewId,
        expectedManifestRevision: preview.manifestRevision,
        requestId: randomUUID(),
        mode: "ready",
      }),
    );
    await expect(
      call("set-published-app-access", {
        projectId: project.id,
        expectedRevision: "0",
        opId: randomUUID(),
        change: { kind: "grant", memberId: "p4-member", role: "app_viewer" },
      }),
    ).resolves.toMatchObject({ revision: "1", effect: "added" });
    const session = appSessionProjectionSchema.parse(
      await call(
        "open-published-app-session",
        {
          projectId: project.id,
          version: "latest",
          openId: randomUUID(),
        },
        other,
      ),
    );
    expect(session.releaseId).toBe(release.releaseId);
    expect(session.projection.project.cells.map(({ id }) => id)).toEqual([
      result.id,
    ]);
    const resultId = session.projection.outputs[result.id]?.resultId;
    if (!resultId) throw new Error("The published result is absent");
    const scope = { resultId, sessionId: session.sessionId };
    const page = getNotebookResultPageOutput.parse(
      await call("get-notebook-result-page", scope, other),
    );
    expect(page).toMatchObject({
      status: "ready",
      rows: [[{ type: "integer", value: "11042" }]],
    });
    if (page.status !== "ready" || !page.manifest.fields[0])
      throw new Error("The drill field is absent");
    const drill = {
      ...scope,
      filters: [
        {
          fieldId: page.manifest.fields[0].fieldId,
          value: { type: "integer", value: "11042" },
        },
      ],
    };
    expect(
      openPublishedResultDrillOutput.parse(
        await call("open-published-result-drill", drill, other),
      ),
    ).toMatchObject({ status: "ready", totalRows: 1 });
    const [artifact] = await getDb()
      .select()
      .from(notebookResultManifests)
      .where(eq(notebookResultManifests.id, resultId))
      .limit(1);
    expect(artifact?.bindings?.[0]?.producer.cellId).toBe(selected.id);
    expect(artifact?.authorities).toEqual([
      { connectionId: "confidential", generation: expect.any(String) },
    ]);
    revoked.add("confidential");
    storage.read.mockClear();
    await expect(
      call("get-notebook-result-page", scope, other),
    ).resolves.toMatchObject({ status: "denied" });
    await expect(
      call("open-published-result-drill", drill, other),
    ).resolves.toMatchObject({ status: "denied" });
    expect(storage.read).not.toHaveBeenCalled();
    revoked.delete("confidential");
    await expect(
      call("get-notebook-result-page", scope, other),
    ).resolves.toMatchObject({ status: "ready" });
  } finally {
    stopWake.mockRestore();
  }
}, 45_000);

it("reads the exact Python producer inputs from the durable SQL attempt", async () => {
  const project = await dataframeProject([
    {
      name: "dataframe",
      source: "select n from (values (42), (84)) as fixture(n) order by n",
      connectionId: SAMPLE_DATA_SOURCE_ID,
    },
  ]);
  const run = await project.admit("dataframe", "cell-only");
  if (run.status !== "admitted") throw new Error("Demo run admission missing");
  expect(await actorContext(() => worker(actor, run.runId))).toBe(true);
  const flow = {
    action: async <T>(name: string, input: object = {}): Promise<T> =>
      z.custom<T>().parse(await call(name, { ...input })),
  };
  const cellId = project.id("dataframe");
  expect(
    await readCompleteCellRows(flow, project.projectId, cellId, "2", run.runId),
  ).toEqual([[42], [84]]);
  await expect(
    readCompleteCellRows(flow, project.projectId, cellId, "2", "old-run"),
  ).rejects.toThrow("The current attempt did not complete with this result");
});

it("stores all 62 demo chart rows with calendar dates and their original order", async () => {
  const project = await dataframeProject([
    {
      name: "chart_source",
      connectionId: SAMPLE_DATA_SOURCE_ID,
      source: `select date '2026-01-01' as day, 42 as amount, 'marketplace' as channel
union all select date '2025-11-01', 84, 'partner'
union all select date '2025-10-02', 1, 'direct' from generate_series(1,50)
union all select date '2025-10-30', 2, 'direct' from generate_series(1,10)`,
    },
  ]);
  const run = await project.admit("chart_source", "cell-only");
  expect(run.status).toBe("admitted");
  if (run.status !== "admitted") throw new Error("Demo run admission missing");
  expect(await actorContext(() => worker(actor, run.runId))).toBe(true);
  const manifest = await manifestFor(run, project.id("chart_source"));
  expect(await page(manifest.id, 1)).toMatchObject({
    status: "ready",
    manifest: {
      status: "complete",
      rowCount: "62",
      fields: [
        { name: "day", type: "date" },
        { name: "amount", type: "number" },
        { name: "channel", type: "string" },
      ],
    },
    rows: [
      ["2026-01-01", 42, "marketplace"],
      ["2025-11-01", 84, "partner"],
      ...Array.from({ length: 48 }, () => ["2025-10-02", 1, "direct"]),
    ],
  });
  expect(await page(manifest.id, 2)).toMatchObject({
    status: "ready",
    rows: [
      ...Array.from({ length: 2 }, () => ["2025-10-02", 1, "direct"]),
      ...Array.from({ length: 10 }, () => ["2025-10-30", 2, "direct"]),
    ],
  });
});

it("uses all 75 warehouse rows and keeps decimal, date, timestamp, null and empty results typed", async () => {
  await warehouseFixtures({
    typed: {
      columns: [
        { name: "amount", type: "NUMERIC", mode: "REQUIRED" },
        { name: "day", type: "DATE", mode: "REQUIRED" },
        { name: "created", type: "TIMESTAMP", mode: "REQUIRED" },
        { name: "blank", type: "INT64", mode: "NULLABLE" },
      ],
      rows: Array.from({ length: 75 }, (_, index) => [
        index === 74 ? "42.123456789" : "0",
        "2026-11-18",
        "1.794988860123456E9",
        null,
      ]),
    },
  });
  const project = await dataframeProject(
    [
      {
        name: "typed",
        connectionId: "typed",
        source: "select amount, day, created, blank from warehouse.typed",
      },
      {
        name: "typed_total",
        source:
          "select sum(amount) as total, min(day) as day, min(created) as created, min(blank) as blank from typed where day >= {{ since }}",
      },
      { name: "empty_result", source: "select * from typed_total where false" },
      {
        name: "empty_count",
        source: "select count(*) as empty_count from empty_result",
      },
    ],
    "2026-11-18",
  );
  const kernel = localDuckDb();
  const run = await project.admit("empty_count", "upstream");
  if (run.status !== "admitted") throw new Error(JSON.stringify(run));
  await runDataframes(run, kernel);
  const [typed, empty, count] = await Promise.all(
    ["typed_total", "empty_result", "empty_count"].map((name) =>
      manifestFor(run, project.id(name)),
    ),
  );
  if (!typed || !empty || !count) throw new Error("Fixture results missing");
  expect(await page(typed.id, 1)).toMatchObject({
    status: "ready",
    rows: [
      [
        { type: "decimal", value: "42.123456789" },
        "2026-11-18",
        "2026-11-18T08:01:00.123456Z",
        null,
      ],
    ],
  });
  expect(await page(empty.id, 1)).toMatchObject({
    status: "ready",
    manifest: {
      status: "complete-empty",
      rowCount: "0",
      fields: [
        { name: "total", type: "decimal" },
        { name: "day", type: "date" },
        { name: "created", type: "datetime" },
        { name: "blank", type: "integer" },
      ],
    },
    rows: [],
  });
  expect(await page(count.id, 1)).toMatchObject({
    status: "ready",
    rows: [[{ type: "integer", value: "0" }]],
  });
});

it("admits no DuckDB command for revoked or incomplete warehouse inputs", async () => {
  const revoked = await warehouseFixtures({
    protected: { columns, rows: [["1", "42"]] },
  });
  const project = await dataframeProject([
    {
      name: "producer",
      connectionId: "protected",
      source: "select row_id, sentinel from warehouse.protected",
    },
    { name: "consumer", source: "select count(*) as count from producer" },
  ]);
  const parent = await project.admit("producer", "upstream");
  if (parent.status !== "admitted") throw new Error(JSON.stringify(parent));
  const kernel = localDuckDb();
  await runDataframes(parent, kernel);
  const stored = await manifestFor(parent, project.id("producer"));
  const manifest = completeResultManifestSchema.parse(stored.manifest);

  revoked.add("protected");
  storage.read.mockClear();
  await expect(
    actorContext(() => readNotebookKernelInput(actor, manifest)),
  ).rejects.toMatchObject({ errorCode: "dataframe_denied" });
  const denied = await project.admit("consumer", "cell-only");
  if (denied.status !== "admitted") throw new Error(JSON.stringify(denied));
  await runDataframes(denied, kernel);
  expect(storage.read).not.toHaveBeenCalled();
  expect(kernel.execute).not.toHaveBeenCalled();

  revoked.delete("protected");
  await getDb()
    .update(notebookResultManifests)
    .set({
      manifest: {
        status: "incomplete",
        reason: "coverage_unverified",
        verifiedRowCount: manifest.rowCount,
        fields: manifest.fields,
        result: manifest.result,
      },
    })
    .where(eq(notebookResultManifests.id, stored.id));
  await expect(
    actorContext(() => readNotebookKernelInput(actor, manifest)),
  ).rejects.toMatchObject({ errorCode: "dataframe_incomplete" });
  const incomplete = await project.admit("consumer", "cell-only");
  expect(incomplete).toMatchObject({
    status: "admitted",
    plan: { admittedCellIds: [] },
  });
  expect(kernel.execute).not.toHaveBeenCalled();
  const [visible] = await getDb()
    .select()
    .from(notebookOutputs)
    .where(eq(notebookOutputs.cellId, project.id("consumer")))
    .limit(1);
  expect(visible?.resultId).toBeNull();
});

it("keeps the visible Dataframes output when a newer producer replaces its bound result during execution", async () => {
  const rows = [["1", "42"]];
  await warehouseFixtures({ source: { columns, rows } });
  const project = await dataframeProject([
    {
      name: "producer",
      connectionId: "source",
      source: "select row_id, sentinel from warehouse.source",
    },
    { name: "consumer", source: "select count(*) as count from producer" },
  ]);
  const kernel = localDuckDb();
  const initial = await project.admit("consumer", "upstream");
  if (initial.status !== "admitted") throw new Error(JSON.stringify(initial));
  await runDataframes(initial, kernel);
  const visible = await manifestFor(initial, project.id("consumer"));
  const execute = kernel.execute.getMockImplementation();
  if (!execute) throw new Error("Missing kernel fixture implementation");
  kernel.execute.mockImplementationOnce(async (...args) => {
    await execute(...args);
    rows.push(["2", "84"]);
    const newer = await project.admit("producer", "cell-only");
    if (newer.status !== "admitted") throw new Error(JSON.stringify(newer));
    await runDataframes(newer, kernel);
  });
  boundary.kernel = kernel;
  await expect(
    call("run-project-cell", {
      projectId: project.projectId,
      cellId: project.id("consumer"),
    }),
  ).rejects.toMatchObject({ errorCode: "project_query_changed" });
  const [pointer] = await getDb()
    .select()
    .from(notebookOutputs)
    .where(eq(notebookOutputs.cellId, project.id("consumer")))
    .limit(1);
  expect(pointer?.resultId).toBe(visible.id);
  expect(await page(visible.id, 1)).toMatchObject({
    status: "ready",
    rows: [[{ type: "integer", value: "1" }]],
  });
});
