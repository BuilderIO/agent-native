import { spawn } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { once } from "node:events";
import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";

import {
  closeDbExec,
  getDbExec,
  runMigrations,
  sql,
} from "@agent-native/core/db";
import {
  organizations,
  ORG_MIGRATIONS,
  orgMembers,
} from "@agent-native/core/org";
import {
  readPrivateBlob,
  registerPrivateBlobProvider,
  unregisterPrivateBlobProvider,
  type PrivateBlobProvider,
} from "@agent-native/core/private-blob";
import {
  createProviderApiRuntime,
  type ProviderApiRequestArgs,
} from "@agent-native/core/provider-api";
import {
  hasRecurringSweepHandler,
  loadActionsFromStaticRegistry,
  resetAppConfigForTests,
  runRecurringSweepHandlers,
  runWithRequestContext,
} from "@agent-native/core/server";
import { revokeWorkspaceConnectionGrant } from "@agent-native/core/workspace-connections";
import { tableFromIPC, tableFromArrays, tableToIPC } from "apache-arrow";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { z } from "zod";

import clearProjectOutputsAction from "../../../actions/clear-project-outputs.js";
import getNotebookCellExecution from "../../../actions/get-notebook-cell-execution.js";
import getNotebookSnapshot from "../../../actions/get-notebook-snapshot.js";
import getNotebookTableReference from "../../../actions/get-notebook-table-reference.js";
import getNotebookTransform from "../../../actions/get-notebook-transform.js";
import listConnectionDatasets from "../../../actions/list-connection-datasets.js";
import queryNotebookTableAction from "../../../actions/query-notebook-table.js";
import saveProjectCell from "../../../actions/save-project-cell.js";
import startNotebookRun from "../../../actions/start-notebook-run.js";
import {
  chartCellContentsSchema,
  codeCellContentsSchema,
  sqlCellContentsSchema,
  type CellContents,
} from "../../../app/lib/model/contracts.js";
import { readRunAttempts } from "../../../e2e/phase1/execution-readback.js";
import { createWorkerControl } from "../../../e2e/phase1/fixtures/worker-control.js";
import { kernelEventSchema } from "../../../shared/kernel-contract.js";
import {
  appSessionIdSchema,
  cellRunReceiptSchema,
  executionSnapshotSchema,
  kernelGenerationSchema,
  runAdmissionSchema,
  runRequestSchema,
  type RunReceipt,
  type RunRequest,
} from "../../../shared/notebook-execution.js";
import {
  authorizedResultRefSchema,
  completeResultManifestSchema,
} from "../../../shared/notebook-result-contract.js";
import {
  notebookCellIdSchema,
  notebookProjectIdSchema,
  revisionSchema,
} from "../../../shared/notebook-snapshot-contract.js";
import { queryNotebookTableInputSchema } from "../../../shared/notebook-table-query.js";
import { phase1DraftFixtureKey } from "../../../shared/phase1-draft-fixture.js";
import { SAMPLE_DATA_SOURCE_ID } from "../../../shared/sample-data-contract.js";
import { getDb, schema } from "../../db/index.js";
import {
  analyticsMigrations,
  runAnalyticsMigrations,
} from "../../db/migrations.js";
import {
  KernelAttemptError,
  kernelActor,
  type KernelPort,
} from "../../execution/notebook-kernel.js";
import { createNotebookWorker } from "../../execution/notebook-worker.js";
import { openPglitePostgresFixture } from "../../execution/postgres-connector-test-fixture.js";
import type { PostgresReadSession } from "../../execution/postgres-connector.js";
import {
  bigQueryAdapter,
  prepareBigQuery,
} from "../../execution/sql-adapter.js";
import { withWarehouseSource } from "../../execution/warehouse-connector.js";
import registerNotebookExecution from "../../plugins/notebook-execution.js";
import { updateCell } from "../cells-store.js";
import {
  reserveKernelNamespace,
  readKernelNamespace,
} from "../kernel-namespaces.js";
import {
  getNotebookResultPage,
  getNotebookRunDiagnostics,
  setNotebookResultView,
} from "../notebook-results.js";
import { createPostgresWarehouseConnection } from "../postgres-connection.js";
import { createProject } from "../projects-store.js";
import { clearProjectOutputs } from "../runs-store.js";
import { getNotebookExecution, setNotebookRunSettings } from "./draft-state.js";
import { getNotebookInputChoices } from "./input-choices.js";
import { createDraftKernelControl } from "./kernel-control.js";
import { digest } from "./planner.js";
import {
  getCellExecution,
  getExecutionSnapshot,
  getKernelSession,
} from "./readback.js";
import {
  createRunStore,
  invalidateNotebookRunOutputs,
  type Claim,
} from "./run-store.js";
import {
  notebookOutputs,
  notebookResultManifests,
  notebookResultSegments,
  notebookRunAttempts,
  notebookRuns,
  notebookRunWork,
} from "./schema.js";
import {
  getNotebookRunOutput,
  notebookRunStore,
  sweepNotebookRuns,
} from "./service.js";
import {
  draftNamespace,
  readCurrentDraftSnapshot,
  readDraftSnapshot,
  type SnapshotReader,
} from "./snapshot.js";

const postgresFixture = vi.hoisted(() => ({
  open: undefined as
    | ((signal: AbortSignal) => Promise<PostgresReadSession>)
    | undefined,
}));

vi.mock("../../execution/postgres-connector.js", async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import("../../execution/postgres-connector.js")
    >();
  return {
    ...actual,
    createPostgresConnector: (
      _config: Parameters<typeof actual.createPostgresConnector>[0],
      authorize: Parameters<typeof actual.createPostgresConnector>[1],
    ) => {
      if (!postgresFixture.open)
        throw new Error("The provider fixture was not opened");
      return actual.createPostgresSessionConnector(
        postgresFixture.open,
        authorize,
      );
    },
  };
});

const actor = {
  orgId: "e1-fixture-workspace",
  ownerEmail: "owner@example.test",
  caller: "frontend",
};
const cellId = notebookCellIdSchema.parse("sample-cell");
const source = "select 42 as sentinel from orders limit 1";
const point = new Date(0).toISOString();
const directory = await mkdtemp(join(tmpdir(), "notebook-run-"));
const runAsActor = <T>(work: () => T) =>
  runWithRequestContext(
    {
      orgId: actor.orgId,
      userEmail: actor.ownerEmail,
      authUserId: actor.ownerEmail,
    },
    work,
  );
const blobs = new Map<string, Uint8Array>();
const provider: PrivateBlobProvider = {
  id: "notebook-execution-fixture",
  name: "Notebook execution fixture",
  isConfigured: () => true,
  async put(input) {
    if (!input.key) throw new Error("Expected a result segment key");
    blobs.set(input.key, Uint8Array.from(input.data));
    return { id: input.key, provider: this.id, opaque: true, encrypted: false };
  },
  async read(handle) {
    const data = blobs.get(handle.id);
    if (!data) throw new Error("Fixture result was lost");
    return { data, handle };
  },
  async delete(handle) {
    return { deleted: blobs.delete(handle.id), provider: this.id };
  },
};

const kernelFixturePath = fileURLToPath(
  new URL("../../../../../services/analytics-kernel/", import.meta.url),
);
const localPython = existsSync(join(kernelFixturePath, ".venv/bin/python"))
  ? join(kernelFixturePath, ".venv/bin/python")
  : "python3";
const bridgeReply = z.strictObject({
  outcome: z.strictObject({
    status: z.enum(["complete", "failed", "interrupted"]),
    reason: z.string().optional(),
  }),
  frames: z.array(
    z.strictObject({
      event: z.record(z.string(), z.unknown()),
      artifact: z
        .strictObject({ contentType: z.string(), bytesBase64: z.string() })
        .optional(),
    }),
  ),
});
const kernelHost = {
  hostId: "fixture-stdio",
  serviceSha: "development",
  imageDigest: "development",
};

function stdioKernel() {
  const child = spawn(
    localPython,
    [join(kernelFixturePath, "tests/fixtures/worker-stdio.py")],
    {
      env: {
        ...process.env,
        PYTHONPATH: kernelFixturePath,
        PYTHONDONTWRITEBYTECODE: "1",
      },
      stdio: ["pipe", "pipe", "inherit"],
    },
  );
  const closed = once(child, "close");
  const lines = createInterface({ input: child.stdout })[
    Symbol.asyncIterator
  ]();
  const interrupted = { value: false };
  let beforeReturn: (() => Promise<void>) | undefined;
  const port: KernelPort = {
    async generation(claim) {
      const found = await readKernelNamespace(
        kernelActor(actor),
        claim.attempt.namespaceId,
      );
      if (!found) throw new Error("Expected reserved kernel namespace");
      return String(found.generation);
    },
    async execute(_claim, command, readArrow, receive) {
      const inputs: Record<string, string> = {};
      if ("inputs" in command.command)
        for (const { name, manifest } of command.command.inputs)
          inputs[name] = Buffer.from(await readArrow(manifest.result)).toString(
            "base64",
          );
      child.stdin.write(`${JSON.stringify({ command, inputs })}\n`);
      const line = await lines.next();
      if (line.done) throw new Error("Local kernel stopped before its reply");
      const reply = bridgeReply.parse(JSON.parse(line.value));
      for (const [index, { event, artifact }] of reply.frames.entries()) {
        const frame = kernelEventSchema.shape.event.parse({
          ...event,
          ...(event.type === "display" || event.type === "result"
            ? { artifactId: `stdio-${index}` }
            : {}),
        });
        await receive(
          frame,
          artifact
            ? {
                contentType: artifact.contentType,
                bytes: Buffer.from(artifact.bytesBase64, "base64"),
              }
            : undefined,
        );
        if (interrupted.value && frame.type === "stream")
          throw new KernelAttemptError("cancel_confirmed", "cancelled");
      }
      await beforeReturn?.();
      if (reply.outcome.status !== "complete")
        throw new KernelAttemptError(
          reply.outcome.reason ?? "execution_failed",
        );
    },
  };
  return {
    port,
    interrupted,
    hold(callback: (() => Promise<void>) | undefined) {
      beforeReturn = callback;
    },
    async close() {
      child.stdin.end();
      await closed;
    },
  };
}

async function pythonNotebook(id: string) {
  const projectId = notebookProjectIdSchema.parse(id);
  const versionId = `${id}-draft`;
  await getDb().insert(schema.projects).values({
    id,
    ownerEmail: actor.ownerEmail,
    orgId: actor.orgId,
    workingVersionId: versionId,
    createdAt: point,
    updatedAt: point,
  });
  await getDb().insert(schema.projectVersions).values({
    id: versionId,
    projectId,
    number: "1",
    createdAt: point,
    createdBy: actor.ownerEmail,
  });
  const sqlId = notebookCellIdSchema.parse(`${id}-sql`);
  const producerId = notebookCellIdSchema.parse(`${id}-producer`);
  const consumerId = notebookCellIdSchema.parse(`${id}-consumer`);
  const saved = [
    sqlCellContentsSchema.parse({
      ...contents(),
      id: sqlId,
      order: "a",
      connectionMode: "dataframes",
      source: "select 42 as n union all select 84",
      resultVariable: "dataframe",
    }),
    codeCellContentsSchema.parse({
      ...contents(),
      id: producerId,
      order: "b",
      kind: "code",
      language: "python",
      resultVariable: null,
      source:
        'import pandas as pd\ntotal = int(dataframe["n"].sum())\nprint("before display", flush=True)\ndisplay(pd.DataFrame({"n": [total]}))\nprint("before result", flush=True)\ntotal',
    }),
    codeCellContentsSchema.parse({
      ...contents(),
      id: consumerId,
      order: "c",
      kind: "code",
      language: "python",
      resultVariable: null,
      source: "total + 1",
    }),
  ];
  await getDb()
    .insert(schema.cells)
    .values(
      saved.map((cell) => ({
        id: cell.id,
        projectId,
        versionId,
        kind: cell.kind,
        order: cell.order,
        contents: JSON.stringify(cell),
        createdAt: point,
        updatedAt: point,
      })),
    );
  const { namespaceId } = draftNamespace(actor, projectId);
  await reserveKernelNamespace(
    {
      id: namespaceId,
      projectId,
      scopeKind: "draft",
      scopeId: namespaceId,
      principalId: actor.ownerEmail,
      orgId: actor.orgId,
      lineageId: versionId,
    },
    kernelHost,
    new Date(),
    getDb(),
  );
  const load = async () => {
    const current = await readCurrentDraftSnapshot(actor, projectId);
    if (current.status !== "accepted")
      throw new Error("Fixture snapshot was not accepted");
    return current.value.snapshot;
  };
  return { projectId, producerId, consumerId, sqlId, load };
}

const browserActions = import.meta.glob<{
  default:
    | typeof import("../../../actions/admit-browser-notebook-run.js").default
    | typeof import("../../../actions/complete-browser-notebook-run.js").default;
}>("../../../actions/{admit,complete}-browser-notebook-run.ts", {
  eager: true,
});

async function browserFixture() {
  const admitAction = browserActions[
    "../../../actions/admit-browser-notebook-run.ts"
  ]?.default as
    | typeof import("../../../actions/admit-browser-notebook-run.js").default
    | undefined;
  const completeAction = browserActions[
    "../../../actions/complete-browser-notebook-run.ts"
  ]?.default as
    | typeof import("../../../actions/complete-browser-notebook-run.js").default
    | undefined;
  expect(
    admitAction,
    "Browser notebook runs need server admission",
  ).toBeDefined();
  expect(
    completeAction,
    "Browser notebook runs need server completion",
  ).toBeDefined();
  if (!admitAction || !completeAction)
    throw new Error("Browser actions unavailable");
  const code = codeCellContentsSchema.parse({
    ...contents(),
    id: randomUUID(),
    order: "a",
    kind: "code",
    language: "python",
    source:
      "from pandas import DataFrame\nframe = DataFrame({'category': ['A'], 'amount': [1]})",
    resultVariable: null,
  });
  const chart = chartCellContentsSchema.parse({
    ...contents(),
    id: randomUUID(),
    order: "b",
    kind: "chart",
    dataframe: "frame",
    chartSpec: {
      sourceCellId: code.id,
      sourceExportId: "symbol:frame",
      mark: "bar",
      xField: "category",
      yField: "amount",
      yAggregation: "sum",
      seriesField: null,
      title: null,
    },
  });
  const project = await createProject({ ...actor, cells: [code, chart] });
  const python = project.cells.find(({ contents }) => contents.kind === "code");
  const visualization = project.cells.find(
    ({ contents }) => contents.kind === "chart",
  );
  if (!python || !visualization)
    throw new Error("Notebook fixture is incomplete");
  const id = notebookCellIdSchema.parse(python.id);
  const admit = async () => {
    const current = await execution(project.id);
    const result = await runAsActor(() =>
      admitAction.run(
        { snapshot: current.snapshot, requestId: randomUUID(), cellId: id },
        { caller: "frontend" },
      ),
    );
    expect(result).toMatchObject({ status: "admitted" });
    if (result.status !== "admitted") throw new Error("Browser run refused");
    return { runId: result.runId, attemptId: result.attemptId };
  };
  const complete = (
    attempt: Awaited<ReturnType<typeof admit>>,
    events: Parameters<typeof completeAction.run>[0]["events"],
  ) =>
    runAsActor(() =>
      completeAction.run(
        { ...attempt, outcome: "complete", events },
        { caller: "frontend" },
      ),
    );
  return { project, python, visualization, id, admit, complete };
}

const browserJson = (value: object) => ({
  type: "result" as const,
  contentType: "application/json" as const,
  data: Buffer.from(JSON.stringify(value)).toString("base64"),
});

it("reads persisted browser outputs, exports and timing, and charts every exported Arrow row", async () => {
  const { project, visualization, id, admit, complete } =
    await browserFixture();
  const attempt = await admit();
  const arrow = Buffer.from(
    tableToIPC(
      tableFromArrays({
        category: Array.from({ length: 2_050 }, () => "A"),
        amount: new Int32Array(2_050).fill(2),
      }),
      "stream",
    ),
  ).toString("base64");
  const table = {
    type: "display" as const,
    contentType: "application/vnd.apache.arrow.stream" as const,
    data: arrow,
  };
  expect(
    await complete(attempt, [
      { type: "stream", channel: "stdout", text: "before display\n" },
      table,
      browserJson({ "text/plain": "done" }),
      browserJson({ kind: "export", name: "frame" }),
      table,
      browserJson({
        kind: "variables",
        variables: [{ name: "frame", kind: "dataframe", type: "DataFrame" }],
        exports: ["frame"],
      }),
    ]),
  ).toEqual({ status: "saved" });

  const cold = (await execution(project.id)).cells[id];
  expect(cold).toMatchObject({
    stale: false,
    resultId: expect.any(String),
    finishedAt: expect.any(String),
    durationMs: expect.any(Number),
  });
  expect(
    await runAsActor(() =>
      getNotebookCellExecution.run({ projectId: project.id, cellId: id }),
    ),
  ).toMatchObject({
    status: "found",
    resultId: cold?.resultId,
    outputs: [
      { kind: "stream", channel: "stdout", text: "before display\n" },
      { kind: "table", resultId: expect.any(String) },
      { kind: "text", data: "done" },
    ],
    exports: [
      { name: "frame", kind: "dataframe", resultId: expect.any(String) },
    ],
  });
  const chart = await runAsActor(() =>
    getNotebookTransform.run({
      projectId: project.id,
      cellId: visualization.id,
    }),
  );
  expect(chart.sources).toContainEqual(
    expect.objectContaining({
      name: "frame",
      binding: expect.objectContaining({
        cellId: id,
        exportId: "symbol:frame",
      }),
    }),
  );
  expect(chart.result).toMatchObject({
    status: "ready",
    source: { completeness: "complete", rowCount: 2_050 },
    rows: [expect.objectContaining({ value: 4_100 })],
  });
});

it("rejects a superseded browser attempt and preserves stale output after an edit", async () => {
  const { project, python, id, admit, complete } = await browserFixture();
  const late = await admit();
  const current = await admit();
  expect(
    await complete(current, [browserJson({ "text/plain": "current" })]),
  ).toEqual({ status: "saved" });
  expect(await complete(late, [browserJson({ "text/plain": "late" })])).toEqual(
    { status: "rejected", reason: "stale_attempt" },
  );
  const editing = await admit();
  if (python.contents.kind !== "code") throw new Error("Expected Python");
  await runAsActor(() =>
    updateCell({
      ...actor,
      projectId: project.id,
      versionId: project.workingVersionId,
      cellId: id,
      contents: {
        ...codeCellContentsSchema.parse(python.contents),
        source: "42",
      },
    }),
  );
  expect(
    await complete(editing, [browserJson({ "text/plain": "edited" })]),
  ).toEqual({ status: "rejected", reason: "stale_attempt" });
  expect((await execution(project.id)).cells[id]).toMatchObject({
    stale: true,
    resultId: expect.any(String),
  });
  expect(
    await runAsActor(() =>
      getNotebookCellExecution.run({ projectId: project.id, cellId: id }),
    ),
  ).toMatchObject({
    status: "found",
    outputs: [{ kind: "text", data: "current" }],
  });
});

it("fails browser promotion when Arrow is invalid or private result storage is unavailable", async () => {
  const { project, id, admit, complete } = await browserFixture();
  const invalid = await admit();
  await expect(
    complete(invalid, [
      {
        type: "result",
        contentType: "application/vnd.apache.arrow.stream",
        data: "AAAA",
      },
    ]),
  ).rejects.toMatchObject({ errorCode: "browser_notebook_result_invalid" });
  expect((await execution(project.id)).cells[id]?.resultId).toBeNull();

  const unavailable = await admit();
  unregisterPrivateBlobProvider(provider.id);
  try {
    await expect(
      complete(unavailable, [browserJson({ "text/plain": "needs storage" })]),
    ).rejects.toMatchObject({
      errorCode: "notebook_result_storage_unavailable",
    });
    expect((await execution(project.id)).cells[id]?.resultId).toBeNull();
  } finally {
    registerPrivateBlobProvider(provider);
  }
});

it("persists SQL to Python to Python and cold readback reuses the same kernel generation", async () => {
  const fixture = await pythonNotebook("e5-reconnect");
  const kernel = stdioKernel();
  try {
    const store = createRunStore(readDraftSnapshot);
    const worker = createNotebookWorker(store, kernel.port);
    const snapshot = await fixture.load();
    const receipt = admitted(
      await store.admit(
        actor,
        runRequestSchema.parse({
          snapshot,
          requestId: "python-chain",
          mode: "run-all",
          cache: "bypass",
          restart: false,
        }),
      ),
    );
    expect(receipt.plan.admittedCellIds).toEqual([
      fixture.sqlId,
      fixture.producerId,
      fixture.consumerId,
    ]);
    for (const _ of receipt.attempts)
      expect(await runAsActor(() => worker(actor, receipt.runId))).toBe(true);
    const registry = loadActionsFromStaticRegistry(
      (await import("../../../.generated/actions-registry.js")).default,
    );
    const cellAction = registry["get-notebook-cell-execution"];
    const kernelAction = registry["get-notebook-kernel-session"];
    if (!cellAction || !kernelAction)
      throw new Error("Kernel readback actions were not built");
    const producer = await runAsActor(() =>
      getCellExecution(actor, {
        projectId: fixture.projectId,
        cellId: fixture.producerId,
      }),
    );
    if (producer.status !== "found")
      throw new Error("Producer output is missing");
    expect(producer.outputs.map(({ kind }) => kind)).toEqual([
      "stream",
      "table",
      "stream",
      "text",
    ]);
    expect(producer.outputs[0]).toEqual({
      kind: "stream",
      channel: "stdout",
      text: "before display\n",
    });
    const table = producer.outputs[1];
    if (table?.kind !== "table")
      throw new Error("Expected a persisted Arrow display");
    expect(
      await runAsActor(() =>
        getNotebookResultPage(actor, { resultId: table.resultId }),
      ),
    ).toMatchObject({
      status: "ready",
      rows: [[{ type: "integer", value: "126" }]],
    });
    expect(
      await runAsActor(() =>
        setNotebookResultView(actor, {
          resultId: table.resultId,
          requestId: "00000000-0000-4000-8000-000000000001",
          expectedViewRevision: revisionSchema.parse("0"),
          page: 1,
        }),
      ),
    ).toMatchObject({ status: "saved", viewRevision: "1" });
    const primaryResultId = producer.resultId;
    if (!primaryResultId) throw new Error("Primary cell output is missing");
    expect(
      await runAsActor(() =>
        getNotebookResultPage(actor, { resultId: primaryResultId }),
      ),
    ).toMatchObject({ status: "ready", view: { viewRevision: "0" } });
    expect(producer.exports).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "total",
          kind: "scalar",
          referenceCount: 1,
        }),
      ]),
    );
    const old = await runAsActor(() =>
      cellAction.run(
        { projectId: fixture.projectId, cellId: fixture.consumerId },
        { caller: "frontend" },
      ),
    );
    expect(old).toMatchObject({
      status: "found",
      kernelGeneration: "1",
      outputs: [{ kind: "text", data: "127", value: 127 }],
    });
    expect(
      await runAsActor(() =>
        kernelAction.run(
          { scope: { kind: "draft", projectId: fixture.projectId } },
          { caller: "frontend" },
        ),
      ),
    ).toMatchObject({
      status: "found",
      generation: "1",
      variables: expect.arrayContaining([
        expect.objectContaining({ name: "total", preview: "126" }),
      ]),
    });
    const reopened = await runAsActor(() =>
      getExecutionSnapshot(actor, fixture.projectId),
    );
    if (reopened.status !== "found")
      throw new Error("Cold notebook is missing");
    expect(reopened.executedCellIds).toEqual(
      expect.arrayContaining([
        fixture.sqlId,
        fixture.producerId,
        fixture.consumerId,
      ]),
    );
    const repeat = admitted(
      await store.admit(
        actor,
        runRequestSchema.parse({
          ...request(reopened.snapshot, "cold-python"),
          targetCellId: fixture.consumerId,
        }),
      ),
    );
    expect(repeat.plan.admittedCellIds).toEqual([fixture.consumerId]);
    expect(await runAsActor(() => worker(actor, repeat.runId))).toBe(true);
    const again = await runAsActor(() =>
      cellAction.run(
        { projectId: fixture.projectId, cellId: fixture.consumerId },
        { caller: "frontend" },
      ),
    );
    expect(again).toMatchObject({
      kernelGeneration: "1",
      outputs: [{ kind: "text", value: 127 }],
    });
    expect(again).not.toMatchObject({ runId: receipt.runId });
    await runAsActor(() => clearProjectOutputs(actor, fixture.projectId));
    expect(
      await runAsActor(() =>
        setNotebookResultView(actor, {
          resultId: table.resultId,
          requestId: "00000000-0000-4000-8000-000000000002",
          expectedViewRevision: revisionSchema.parse("1"),
          page: 1,
        }),
      ),
    ).toEqual({ status: "conflict", reason: "stale_result" });
    expect(
      await runAsActor(() =>
        getCellExecution(actor, {
          projectId: fixture.projectId,
          cellId: fixture.consumerId,
        }),
      ),
    ).toEqual({ status: "absent", reason: "not_found" });
    expect(await getKernelSession(actor, fixture.projectId)).toMatchObject({
      generation: "1",
      variables: expect.arrayContaining([
        expect.objectContaining({ name: "total" }),
      ]),
    });
    const cleared = admitted(
      await store.admit(
        actor,
        runRequestSchema.parse({
          ...request(reopened.snapshot, "after-clear"),
          targetCellId: fixture.consumerId,
        }),
      ),
    );
    expect(cleared.plan.admittedCellIds).toEqual([fixture.consumerId]);
    expect(await runAsActor(() => worker(actor, cleared.runId))).toBe(true);
    expect(
      await runAsActor(() =>
        cellAction.run(
          { projectId: fixture.projectId, cellId: fixture.consumerId },
          { caller: "frontend" },
        ),
      ),
    ).toMatchObject({
      kernelGeneration: "1",
      outputs: [{ kind: "text", value: 127 }],
    });
  } finally {
    await kernel.close();
  }
});

it("fences old Python output after restart and persists stdout on a confirmed interrupt", async () => {
  const fixture = await pythonNotebook("e5-restart");
  const kernel = stdioKernel();
  try {
    const store = createRunStore(readDraftSnapshot);
    const worker = createNotebookWorker(store, kernel.port);
    const snapshot = await fixture.load();
    const initial = admitted(
      await store.admit(
        actor,
        runRequestSchema.parse({
          ...request(snapshot, "restart-upstream"),
          targetCellId: fixture.producerId,
          mode: "upstream",
        }),
      ),
    );
    expect(await runAsActor(() => worker(actor, initial.runId))).toBe(true);
    kernel.interrupted.value = true;
    expect(await runAsActor(() => worker(actor, initial.runId))).toBe(true);
    kernel.interrupted.value = false;
    expect(
      await runAsActor(() =>
        getCellExecution(actor, {
          projectId: fixture.projectId,
          cellId: fixture.producerId,
        }),
      ),
    ).toMatchObject({
      state: { status: "cancelled" },
      outputs: [
        { kind: "stream", channel: "stdout", text: "before display\n" },
      ],
    });

    let started: () => void = () => undefined;
    const holding = new Promise<void>((resolve) => {
      started = resolve;
    });
    let release: () => void = () => undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    kernel.hold(async () => {
      started();
      await held;
    });
    const rerun = admitted(
      await store.admit(
        actor,
        runRequestSchema.parse({
          ...request(snapshot, "late-python"),
          targetCellId: fixture.producerId,
        }),
      ),
    );
    const running = runAsActor(() => worker(actor, rerun.runId));
    try {
      await Promise.race([
        holding,
        running.then(() => {
          throw new Error("Fixture did not hold a completion");
        }),
      ]);
      const controls = createDraftKernelControl(store, () => undefined);
      const restarted = await controls.control(kernelActor(actor), {
        scope: { kind: "draft", projectId: fixture.projectId },
        operation: "restart",
        expectedGeneration: kernelGenerationSchema.parse("1"),
        requestId: "10000000-0000-4000-8000-000000000000",
      });
      expect(restarted).toMatchObject({ generation: "2" });
      expect(await getKernelSession(actor, fixture.projectId)).toMatchObject({
        generation: "2",
        variables: [],
      });
    } finally {
      release();
      await running;
    }
    expect(
      await runAsActor(() =>
        getCellExecution(actor, {
          projectId: fixture.projectId,
          cellId: fixture.producerId,
        }),
      ),
    ).toMatchObject({
      diagnosticCode: "kernel_generation_changed",
      resultId: null,
      outputs: [],
    });
    expect(
      await getKernelSession(
        { ...actor, ownerEmail: "other@example.test" },
        fixture.projectId,
      ),
    ).toEqual({ status: "absent", reason: "not_found" });
  } finally {
    await kernel.close();
  }
});

beforeAll(async () => {
  vi.stubEnv("DATABASE_URL", `pglite:${join(directory, "upgrade")}`);
  vi.stubEnv("DATABASE_URL_UNPOOLED", "");
  vi.stubEnv("NETLIFY_DATABASE_URL_UNPOOLED", "");
  resetAppConfigForTests();
  await runMigrations(
    ORG_MIGRATIONS.map(({ name, ...entry }) =>
      name ? { ...entry, name } : entry,
    ),
    {
      table: "notebook_run_org_migrations",
    },
  )(undefined);
  await runMigrations(
    analyticsMigrations.filter(({ version }) => version <= 15),
    { table: "analytics2_migrations" },
  )(undefined);
  await getDb().insert(organizations).values({
    id: actor.orgId,
    name: "Notebook fixture",
    createdBy: actor.ownerEmail,
    createdAt: 0,
  });
  await getDb().insert(orgMembers).values({
    id: "fixture-owner",
    orgId: actor.orgId,
    email: actor.ownerEmail,
    role: "owner",
    joinedAt: 0,
  });
  await getDbExec().execute(sql`
    INSERT INTO analytics2_projects (id, title, owner_email, org_id, working_version_id, created_at, updated_at)
    VALUES ('upgrade-marker', 'v15 notebook', ${sql.value(actor.ownerEmail)}, ${sql.value(actor.orgId)}, 'saved', ${sql.value(point)}, ${sql.value(point)})
  `);
  await runAnalyticsMigrations(undefined);
  registerPrivateBlobProvider(provider);
});
afterAll(async () => {
  unregisterPrivateBlobProvider(provider.id);
  await closeDbExec();
  vi.unstubAllEnvs();
  resetAppConfigForTests();
  await rm(directory, { recursive: true, force: true });
});

function contents() {
  return sqlCellContentsSchema.parse({
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
    dataConnectionId: null,
    databaseSchema: null,
    resultVariable: "sample",
    outputResult: true,
  });
}

function seed(projectId: string) {
  return executionSnapshotSchema.parse({
    ref: {
      workspaceId: actor.orgId,
      projectId,
      head: { versionId: "saved", revision: "0" },
      eventSeq: "0",
    },
    namespace: draftNamespace(actor, projectId),
    inputRevision: "0",
    executionFingerprint: "unread",
  });
}

function request(snapshot: RunRequest["snapshot"], requestId: string) {
  return runRequestSchema.parse({
    snapshot,
    requestId,
    mode: "cell-only",
    targetCellId: cellId,
    cache: "reuse",
    staleValues: "reject",
  });
}

function fixture(
  projectId: string,
  kind: "draft" | "release-session" = "draft",
) {
  let snapshot = seed(projectId);
  if (kind === "release-session")
    snapshot = executionSnapshotSchema.parse({
      ...snapshot,
      namespace: {
        kind,
        namespaceId: "private-session",
        sessionId: "session",
        releaseId: "release",
      },
    });
  let deleted = false;
  const load: SnapshotReader = async (viewer) =>
    viewer.orgId !== actor.orgId
      ? { status: "denied" }
      : {
          status: "accepted",
          value: {
            snapshot,
            cells: deleted ? [] : [{ id: cellId, contents: contents() }],
          },
        };
  return {
    store: createRunStore(load),
    deleteCell() {
      deleted = true;
    },
    get snapshot() {
      return snapshot;
    },
    change(update: Partial<RunRequest["snapshot"]>) {
      snapshot = executionSnapshotSchema.parse({ ...snapshot, ...update });
    },
  };
}

function admitted(
  value: Awaited<ReturnType<ReturnType<typeof createRunStore>["admit"]>>,
): RunReceipt {
  expect(value.status).toBe("admitted");
  if (value.status !== "admitted") throw new Error("Expected a run");
  return value;
}

async function claimed(
  store: ReturnType<typeof createRunStore>,
  run: RunReceipt,
  now?: number,
) {
  const value = await store.claim(actor, run.runId, now);
  if (!value) throw new Error("No work reserved");
  return value;
}

function completion(
  claim: Claim,
): Extract<
  Parameters<ReturnType<typeof createRunStore>["finish"]>[1],
  { status: "result" }
> {
  const expected = authorizedResultRefSchema.parse({
    resultId: digest(claim.attempt),
    producer: { ...claim.attempt, exportId: "result" },
    snapshot: claim.run.receipt.request.snapshot.ref,
    inputRevision: claim.run.receipt.request.snapshot.inputRevision,
    dependencyFingerprint: digest(
      claim.dependencies.map(({ result }) => result.resultId),
    ),
    sourceGeneration: null,
    kernelGeneration: null,
  });
  const manifest = completeResultManifestSchema.parse({
    status: "complete-empty",
    rowCount: "0",
    result: expected,
    fields: [],
  });
  return {
    status: "result",
    expected,
    artifact: { manifest, artifacts: [] },
  };
}

it("persists Postgres source and typed E3 rows in cold draft and release-session reads and denies reuse after revocation", async () => {
  const warehouse = await openPglitePostgresFixture();
  postgresFixture.open = warehouse.open;
  const projectId = notebookProjectIdSchema.parse("postgres-worker-project");
  const versionId = "postgres-worker-draft";
  const releaseId = "postgres-worker-release";
  const sessionId = appSessionIdSchema.parse("postgres-session");
  vi.stubEnv("ANALYTICS2_POSTGRES_READBACK_VERIFIED", "true");
  vi.stubEnv(
    "ANALYTICS2_POSTGRES_READ_ENDPOINTS",
    '[{"host":"warehouse.example.test","port":5432}]',
  );
  vi.stubEnv("BETTER_AUTH_SECRET", randomBytes(48).toString("base64url"));
  resetAppConfigForTests();
  try {
    const { connectionId } = await runAsActor(() =>
      createPostgresWarehouseConnection({
        type: "postgres",
        requestId: randomUUID(),
        name: "Postgres worker fixture",
        scope: { kind: "workspace" },
        form: {
          host: "warehouse.example.test",
          port: 5432,
          database: "fixture",
          username: "fixture_reader",
          tls: "verify-full",
          credential: { kind: "replace", value: "fixture-password" },
        },
      }),
    );
    const generation = await runAsActor(() =>
      withWarehouseSource(connectionId, actor, async (source) => {
        if (source.kind !== "postgres")
          throw new Error("Expected the Postgres provider");
        return source.generation;
      }),
    );
    const table = {
      connectionId: connectionId,
      tableId: "table:fixture:phase_east:same.name",
      catalogGeneration: "1",
      authorityGeneration: generation,
      projectId: "fixture",
      schema: "phase_east",
      name: "same.name",
      location: null,
    };
    const cell = sqlCellContentsSchema.parse({
      ...contents(),
      dataConnectionId: connectionId,
      source: `select sentinel, 1234567890.1234567890123456789::numeric, '2026-11-19 10:00:00.123456+02'::timestamptz, null::text from "phase_east"."same.name" limit 100`,
      warehouseTable: table,
    });
    await getDb().insert(schema.projects).values({
      id: projectId,
      ownerEmail: actor.ownerEmail,
      orgId: actor.orgId,
      workingVersionId: versionId,
      notebookVersionId: versionId,
      publishedVersionId: releaseId,
      createdAt: point,
      updatedAt: point,
    });
    await getDb()
      .insert(schema.projectVersions)
      .values([
        { id: versionId, projectId, number: "1", createdAt: point },
        {
          id: releaseId,
          projectId,
          number: "2",
          kind: "published",
          createdAt: point,
        },
      ]);
    await getDb()
      .insert(schema.cells)
      .values({
        id: cellId,
        versionId,
        projectId,
        kind: "sql",
        order: cell.order,
        contents: JSON.stringify(cell),
        createdAt: point,
        updatedAt: point,
      });
    await getDb().insert(schema.publishedAppSessions).values({
      id: sessionId,
      orgId: actor.orgId,
      ownerEmail: actor.ownerEmail,
      projectId,
      releaseId,
      openId: randomUUID(),
      openIntent: "postgres-worker-fixture",
      overrides: {},
      baseline: [],
      pendingInputIds: [],
    });
    const loaded = await runAsActor(() =>
      readCurrentDraftSnapshot(actor, projectId),
    );
    if (loaded.status !== "accepted")
      throw new Error("Draft snapshot was not accepted");
    expect(loaded.value.cells).toMatchObject([
      { contents: { warehouseTable: table } },
    ]);
    const draft = loaded.value.snapshot;
    const released = executionSnapshotSchema.parse({
      ...draft,
      ref: { ...draft.ref, head: { ...draft.ref.head, versionId: releaseId } },
      namespace: {
        kind: "release-session",
        namespaceId: sessionId,
        sessionId,
        releaseId,
      },
    });
    const store = createRunStore(async (viewer, requested, tx) =>
      requested.namespace.kind === "release-session"
        ? {
            status: "accepted",
            value: {
              snapshot: released,
              cells: [{ id: cellId, contents: cell }],
            },
          }
        : readDraftSnapshot(viewer, requested, tx),
    );
    const worker = createNotebookWorker(store);
    const results = [];
    for (const snapshot of [draft, released]) {
      const run = admitted(
        await store.admit(
          actor,
          request(snapshot, `postgres-${snapshot.namespace.kind}`),
        ),
      );
      expect(await runAsActor(() => worker(actor, run.runId))).toBe(true);
      const [saved] = await getDb()
        .select()
        .from(notebookRunWork)
        .where(eq(notebookRunWork.runId, run.runId))
        .limit(1);
      const resultId = saved?.resultId;
      if (!resultId) {
        const [attempt] = await getDb()
          .select({ diagnostic: notebookRunAttempts.diagnostic })
          .from(notebookRunAttempts)
          .where(eq(notebookRunAttempts.runId, run.runId))
          .limit(1);
        throw new Error(
          `Postgres result was not persisted: ${JSON.stringify(attempt?.diagnostic)}`,
        );
      }
      const scope =
        snapshot.namespace.kind === "release-session"
          ? { resultId, sessionId }
          : { resultId };
      results.push(scope);
      expect(saved.resultBuild?.authorities).toEqual([
        { connectionId, generation },
      ]);
      expect(
        await runAsActor(() => getNotebookResultPage(actor, scope)),
      ).toMatchObject({
        status: "ready",
        manifest: {
          status: "complete",
          rowCount: "1",
          result: { sourceGeneration: generation },
        },
        rows: [
          [
            { type: "integer", value: "42" },
            { type: "decimal", value: "1234567890.1234567890123456789" },
            "2026-11-19T08:00:00.123456Z",
            null,
          ],
        ],
      });
    }
    const parents = await runAsActor(() =>
      listConnectionDatasets.run(
        { connectionId, first: 50 },
        { caller: "frontend" },
      ),
    );
    const east = parents.items.find(({ name }) => name === "phase_east");
    const west = parents.items.find(({ name }) => name === "phase_west");
    if (!east || !west) throw new Error("Postgres fixture schemas are missing");
    const [eastPage, westPage] = await runAsActor(() =>
      Promise.all(
        [east, west].map(({ id }) =>
          listConnectionDatasets.run(
            { connectionId, first: 50, parentId: id },
            { caller: "frontend" },
          ),
        ),
      ),
    );
    const eastTable = eastPage?.items.find(({ name }) => name === "same.name");
    const westTable = westPage?.items.find(({ name }) => name === "same.name");
    if (!eastTable || !westTable)
      throw new Error("Postgres fixture tables are missing");
    expect(eastTable.id).not.toBe(westTable.id);
    const tableReference = await runAsActor(() =>
      getNotebookTableReference.run(
        { connectionId, tableId: eastTable.id },
        { caller: "frontend" },
      ),
    );
    const accepted = await runAsActor(() =>
      getNotebookSnapshot.run({ projectId }),
    );
    if (accepted.status !== "accepted")
      throw new Error("Expected an adopted notebook");
    const intent = queryNotebookTableInputSchema.parse({
      projectId,
      workingVersionId: accepted.snapshot.head.versionId,
      observedHead: accepted.snapshot.head,
      expectedOrderRevision: accepted.resources.orderRevision,
      afterCellId: cellId,
      requestId: randomUUID(),
      cellId: randomUUID(),
      table: {
        connectionId,
        tableId: eastTable.id,
        authorityGeneration: tableReference.authorityGeneration,
        catalogGeneration: tableReference.catalogGeneration,
      },
    });
    await expect(
      runAsActor(() =>
        queryNotebookTableAction.run(
          { ...intent, table: { ...intent.table, tableId: westTable.id } },
          { caller: "frontend" },
        ),
      ),
    ).rejects.toMatchObject({ errorCode: "catalog_generation_stale" });
    const tableQuery = await runAsActor(() =>
      queryNotebookTableAction.run(intent, { caller: "frontend" }),
    );
    expect(tableQuery).toMatchObject({
      sourceId: connectionId,
      table: intent.table,
      sql: 'select * from "phase_east"."same.name" limit 100',
    });
    expect(await runAsActor(() => worker(actor, tableQuery.runId))).toBe(true);
    const [queryWork] = await getDb()
      .select()
      .from(notebookRunWork)
      .where(eq(notebookRunWork.runId, tableQuery.runId))
      .limit(1);
    const tableResult = queryWork?.resultId;
    if (!tableResult)
      throw new Error("The catalog query has no persisted result");
    results.push({ resultId: tableResult });
    const cold = await runAsActor(() => getNotebookSnapshot.run({ projectId }));
    if (cold.status !== "accepted")
      throw new Error("The catalog draft could not reopen");
    const coldCell = sqlCellContentsSchema.parse(
      cold.cells.find(({ id }) => id === intent.cellId)?.contents,
    );
    expect(coldCell.warehouseTable).toEqual(tableReference);
    expect(coldCell.source).toBe(tableQuery.sql);
    expect(
      await runAsActor(() =>
        getNotebookResultPage(actor, { resultId: tableResult }),
      ),
    ).toMatchObject({
      status: "ready",
      rows: [[{ type: "integer", value: "42" }]],
    });
    const activeDraft = await runAsActor(() =>
      readCurrentDraftSnapshot(actor, projectId),
    );
    if (activeDraft.status !== "accepted")
      throw new Error("Catalog draft could not reopen");
    const active = activeDraft.value.snapshot;
    const preAdmitted = admitted(
      await store.admit(actor, request(active, "pre-revocation")),
    );
    expect(
      await runAsActor(() =>
        revokeWorkspaceConnectionGrant(connectionId, "analytics-2"),
      ),
    ).toBe(true);
    for (const scope of results)
      expect(
        await runAsActor(() => getNotebookResultPage(actor, scope)),
      ).toEqual({
        status: "denied",
        reason: "access_denied",
      });
    await expect(
      runAsActor(() =>
        startNotebookRun.run(request(active, "revoked-postgres-run"), {
          caller: "frontend",
        }),
      ),
    ).resolves.toEqual({ status: "denied", reason: "access_denied" });
    await expect(
      runAsActor(() =>
        queryNotebookTableAction.run(intent, { caller: "frontend" }),
      ),
    ).rejects.toMatchObject({ errorCode: "table_query_denied" });
    const deniedRun = preAdmitted;
    const initial = deniedRun.attempts[0];
    if (!initial) throw new Error("Expected a reserved attempt");
    expect(await runAsActor(() => worker(actor, deniedRun.runId))).toBe(true);
    expect(
      await runAsActor(() =>
        getNotebookRunDiagnostics(actor, {
          runId: deniedRun.runId,
          attemptId: initial.attempt.attemptId,
        }),
      ),
    ).toMatchObject({
      status: "found",
      diagnostic: { code: "source_access_denied" },
    });
  } finally {
    vi.stubEnv("ANALYTICS2_POSTGRES_READBACK_VERIFIED", undefined);
    vi.stubEnv("ANALYTICS2_POSTGRES_READ_ENDPOINTS", undefined);
    vi.stubEnv("BETTER_AUTH_SECRET", undefined);
    resetAppConfigForTests();
    postgresFixture.open = undefined;
    await warehouse.db.close();
  }
}, 20_000);

async function pointer(namespaceId: string) {
  const [row] = await getDb()
    .select()
    .from(notebookOutputs)
    .where(
      and(
        eq(notebookOutputs.namespaceId, namespaceId),
        eq(notebookOutputs.cellId, cellId),
      ),
    )
    .limit(1);
  return row?.resultId;
}

it("replays a dropped admission acknowledgement and resumes one submission under a fresh attempt and generation", async () => {
  const { store, snapshot } = fixture("retry-project");
  const intent = request(snapshot, "retry");
  const first = admitted(await store.admit(actor, intent));
  const original = await claimed(store, first, 1000);
  const submitted = new Map<string, unknown>();
  const wire = vi.fn(async (args: ProviderApiRequestArgs) => {
    if (args.method === "POST") {
      submitted.set(operation.job.jobId, {
        jobReference: operation.job,
        status: { state: "DONE" },
      });
      return {
        response: {
          status: 200,
          ok: true,
          truncated: false,
          json: submitted.get(operation.job.jobId),
        },
      };
    }
    const job = submitted.get(args.path.split("/").at(-1) ?? "");
    return {
      response: {
        status: job ? 200 : 404,
        ok: Boolean(job),
        truncated: false,
        json: job ?? {},
      },
    };
  });
  const warehouse = {
    runtime: {
      ...createProviderApiRuntime({ appId: "notebook-db-fixture" }),
      executeRequest: wire,
    },
    projectId: "fixture-project",
    location: "US",
    generation: "1",
    storage: null,
  };
  const sql = { sql: "select 42", parameters: [] };
  const operation = prepareBigQuery(
    warehouse,
    sql,
    original.work.submissionId,
    "reuse",
  );
  expect(
    await store.renew(original, 1100, {
      fingerprint: operation.fingerprint,
      dispatch: {
        fingerprint: operation.fingerprint,
        parameters: [],
        sql: "select ?",
      },
    }),
  ).toEqual({ status: "continue" });
  await bigQueryAdapter(warehouse, operation).start(false);

  const replay = admitted(await store.admit(actor, intent));
  expect(digest(replay)).toBe(digest(first));
  expect(await store.admit(actor, { ...intent, cache: "bypass" })).toEqual({
    status: "rejected",
    reason: "request_id_reused",
  });
  const workRows = await getDb()
    .select()
    .from(notebookRunWork)
    .where(eq(notebookRunWork.runId, first.runId));
  expect(workRows).toHaveLength(1);
  expect(
    await getDb()
      .select()
      .from(notebookRuns)
      .where(eq(notebookRuns.requestId, "retry")),
  ).toHaveLength(1);
  expect(
    await getDb()
      .select()
      .from(notebookRunAttempts)
      .where(eq(notebookRunAttempts.runId, first.runId)),
  ).toHaveLength(1);

  const recovered = await claimed(store, replay, 100_000);
  expect(recovered.work).toMatchObject({
    submissionId: original.work.submissionId,
    operationFingerprint: operation.fingerprint,
    dispatched: true,
  });
  expect(recovered.attempt.attemptId).not.toBe(original.attempt.attemptId);
  expect(recovered.attempt.outputGeneration).not.toBe(
    original.attempt.outputGeneration,
  );
  const sameOperation = prepareBigQuery(
    warehouse,
    sql,
    recovered.work.submissionId,
    "reuse",
  );
  expect(
    await bigQueryAdapter(warehouse, sameOperation).start(
      recovered.work.dispatched,
    ),
  ).toEqual({ state: "DONE" });
  expect(wire.mock.calls.map(([call]) => call.method)).toEqual(["POST", "GET"]);
  expect([...submitted.keys()]).toEqual([operation.job.jobId]);
  const result = completion(recovered);
  expect(await store.finish(recovered, result, 100_001)).toBe(true);
  expect(await store.finish(original, completion(original), 100_002)).toBe(
    false,
  );
  expect(await pointer(snapshot.namespace.namespaceId)).toBe(
    result.expected.resultId,
  );
  const [late] = await getDb()
    .select()
    .from(notebookRunAttempts)
    .where(eq(notebookRunAttempts.id, original.attempt.attemptId));
  expect(late?.diagnostic).toMatchObject({
    code: "late_completion",
    dispatch: { sql: "select ?", fingerprint: operation.fingerprint },
  });
  const read = await store.read(actor, first.runId, 1n, 10);
  expect(
    read.status === "found" && read.events.map((event) => event.sequence),
  ).toEqual(["2", "3", "4", "5"]);
});

it.each(["clear", "delete", "restore", "input-change"] as const)(
  "fences a same-lease late result after %s",
  async (cause) => {
    const f = fixture(
      `fence-${cause}`,
      cause === "input-change" ? "release-session" : "draft",
    );
    const original = admitted(
      await f.store.admit(actor, request(f.snapshot, "initial")),
    );
    const late = await claimed(f.store, original, 1000);
    if (cause === "restore")
      f.change({
        ref: {
          ...f.snapshot.ref,
          head: {
            ...f.snapshot.ref.head,
            versionId:
              executionSnapshotSchema.shape.ref.shape.head.shape.versionId.parse(
                "restored",
              ),
          },
        },
      });
    if (cause === "input-change")
      f.change({
        inputRevision: executionSnapshotSchema.shape.inputRevision.parse("1"),
      });
    if (cause === "delete") f.deleteCell();
    if (cause === "clear") {
      await getDb().transaction((tx) =>
        invalidateNotebookRunOutputs(tx, {
          snapshot: f.snapshot.ref,
          namespace: f.snapshot.namespace,
          inputRevision: f.snapshot.inputRevision,
          cause,
          outputs: [
            {
              cellId,
              outputGeneration:
                cellRunReceiptSchema.shape.attempt.shape.outputGeneration.parse(
                  "clear-generation",
                ),
            },
          ],
        }),
      );
    }
    expect(await f.store.finish(late, completion(late), 1001)).toBe(false);
    expect(await pointer(f.snapshot.namespace.namespaceId)).toBeNull();
    const [diagnostic] = await getDb()
      .select()
      .from(notebookRunAttempts)
      .where(eq(notebookRunAttempts.id, late.attempt.attemptId));
    expect(diagnostic?.diagnostic).toEqual({ code: "superseded" });
  },
);

it("distinguishes confirmed cancel, completion won, and an unknown provider outcome", async () => {
  const f = fixture("cancel-project");
  const start = async (id: string) =>
    admitted(await f.store.admit(actor, request(f.snapshot, id)));
  const ready = await start("ready");
  expect(await f.store.cancel(actor, ready.runId)).toEqual({
    status: "cancelled",
    reason: "cancel_confirmed",
  });
  expect(await f.store.claim(actor, ready.runId)).toBeNull();
  const pending = await start("pending");
  const done = await claimed(f.store, pending, 1000);
  await f.store.renew(done, 1001, { fingerprint: "provider-job-84" });
  expect(await f.store.cancel(actor, pending.runId)).toEqual({
    status: "pending",
    reason: "not_ready",
  });
  expect(await f.store.finish(done, completion(done), 1002)).toBe(true);
  expect(await f.store.cancel(actor, pending.runId)).toEqual({
    status: "completed",
    reason: "completion_won",
  });
  const unresolved = await start("unresolved");
  const claim = await claimed(f.store, unresolved, 1000);
  expect(
    await f.store.finish(
      claim,
      { status: "unknown", code: "provider_outcome_unknown" },
      1001,
    ),
  ).toBe(true);
  expect(await f.store.cancel(actor, unresolved.runId)).toEqual({
    status: "unknown",
    reason: "provider_outcome_unknown",
  });
  expect(await f.store.claim(actor, unresolved.runId, 100_000)).toBeNull();
  expect(await pointer(f.snapshot.namespace.namespaceId)).toBe(
    completion(done).expected.resultId,
  );
});

it("upgrades the v15 ledger and runs a persisted sample through registered actions and the registered worker", async () => {
  const [row] = await getDb()
    .select()
    .from(schema.projects)
    .where(eq(schema.projects.id, "upgrade-marker"))
    .limit(1);
  expect(row?.title).toBe("v15 notebook");
  const versions = await getDbExec().execute(sql`
    SELECT name, version FROM analytics2_migrations_named
    WHERE version BETWEEN 19 AND 26
    ORDER BY version
  `);
  expect(
    versions.rows.map(({ name, version }) => [name, String(version)]),
  ).toEqual([
    ["analytics2-cell-output-undo", "19"],
    ["analytics2-notebook-commands", "20"],
    ["analytics2-notebook-execution", "21"],
    ["analytics2-kernel-namespaces", "22"],
    ["analytics2-notebook-result-artifacts", "23"],
    ["analytics2-app-layouts", "24"],
    ["analytics2-notebook-run-controls", "25"],
    ["analytics2-notebook-kernel-results", "26"],
  ]);
  const projectId = "registered-fixture";
  await getDb().insert(schema.projects).values({
    id: projectId,
    ownerEmail: actor.ownerEmail,
    orgId: actor.orgId,
    workingVersionId: "registered-version",
    createdAt: point,
    updatedAt: point,
  });
  await getDb().insert(schema.projectVersions).values({
    id: "registered-version",
    projectId,
    number: "1",
    createdBy: actor.ownerEmail,
    createdAt: point,
  });
  await getDb()
    .insert(schema.cells)
    .values({
      id: cellId,
      projectId,
      versionId: "registered-version",
      kind: "sql",
      order: "i",
      contents: JSON.stringify(contents()),
      createdAt: point,
      updatedAt: point,
    });
  const loaded = await readDraftSnapshot(actor, seed(projectId));
  if (loaded.status !== "accepted")
    throw new Error("Saved fixture is unreadable");
  const registry = loadActionsFromStaticRegistry(
    (await import("../../../.generated/actions-registry.js")).default,
  );
  const start = registry["start-notebook-run"];
  const get = registry["get-notebook-run"];
  if (!start || !get || !registry["cancel-notebook-run"])
    throw new Error("Execution actions were not compiled into the registry");
  const response = await runAsActor(() =>
    start.run(request(loaded.value.snapshot, "registered-run"), {
      caller: "frontend",
    }),
  );
  const receipt = admitted(runAdmissionSchema.parse(response));
  const denied = await runAsActor(() =>
    start.run(
      { ...receipt.request, requestId: "stale", snapshot: seed(projectId) },
      { caller: "frontend" },
    ),
  );
  expect(denied).toEqual({ status: "rejected", reason: "stale_snapshot" });
  registerNotebookExecution();
  expect(hasRecurringSweepHandler("analytics2-notebook-execution")).toBe(true);
  expect(
    await runRecurringSweepHandlers({ deadlineAt: Date.now() + 60_000 }),
  ).toMatchObject({ failed: [] });
  const read = getNotebookRunOutput.parse(
    await runAsActor(() =>
      get.run(
        { runId: receipt.runId, after: receipt.cursor },
        { caller: "frontend" },
      ),
    ),
  );
  expect(read.status).toBe("found");
  if (read.status !== "found") throw new Error("Run readback was unavailable");
  expect(
    read.events.map(
      ({ event }) => event.type === "attempt" && event.receipt.state.status,
    ),
  ).toEqual(["running", "complete"]);
  const id = await pointer(loaded.value.snapshot.namespace.namespaceId);
  const [saved] = id
    ? await getDb()
        .select()
        .from(notebookResultManifests)
        .where(eq(notebookResultManifests.id, id))
        .limit(1)
    : [];
  expect(saved?.manifest).toMatchObject({
    status: "complete",
    rowCount: "1",
    result: { producer: receipt.attempts[0]?.attempt },
  });
  const [segment] = saved?.artifactId
    ? await getDb()
        .select()
        .from(notebookResultSegments)
        .where(eq(notebookResultSegments.artifactId, saved.artifactId))
        .limit(1)
    : [];
  const handle = segment?.handle;
  if (!handle) throw new Error("Result has no Arrow page");
  expect(
    tableFromIPC((await readPrivateBlob(handle)).data)
      .getChildAt(0)
      ?.get(0),
  ).toBe(42);
});

function draftSql(
  id: string,
  source: string,
  resultVariable: string,
  dataframes = false,
) {
  const { order: _order, ...base } = contents();
  return {
    ...base,
    id,
    source,
    resultVariable,
    ...(dataframes ? { connectionMode: "dataframes" as const } : {}),
  };
}

it("runs a built-in sample producer in the local production profile without an upload provider", async () => {
  const project = await createProject({
    ...actor,
    cells: [
      {
        ...draftSql(
          "local-sample",
          "select n from (values (42), (84)) as fixture(n) order by n",
          "sample_output",
        ),
        dataConnectionId: SAMPLE_DATA_SOURCE_ID,
      },
      {
        ...draftSql("local-a", "select 42 as value", "a"),
        dataConnectionId: SAMPLE_DATA_SOURCE_ID,
      },
      draftSql("local-b", "select value + 8 as value from a", "b", true),
      draftSql("local-c", "select value + 12 as value from a", "c", true),
      draftSql(
        "local-d",
        "select b.value + c.value as value from b cross join c",
        "d",
        true,
      ),
      {
        ...draftSql("local-u", "select 84 as value", "u"),
        dataConnectionId: SAMPLE_DATA_SOURCE_ID,
      },
      draftSql("local-v", "select value + 1 as value from u", "v", true),
      draftSql(
        "local-decimal",
        "select cast(null as decimal(10, 2)) as missing, cast('42.50' as decimal(10, 2)) as amount",
        "scaled_amount",
        true,
      ),
    ],
  });
  unregisterPrivateBlobProvider(provider.id);
  const nodeEnvironment = process.env.NODE_ENV;
  const deploymentEnvironment = process.env.AGENT_NATIVE_DEPLOYMENT_ENVIRONMENT;
  const kernel = stdioKernel();
  vi.stubEnv("NODE_ENV", "production");
  vi.stubEnv("AGENT_NATIVE_DEPLOYMENT_ENVIRONMENT", "local");
  const cwd = vi.spyOn(process, "cwd").mockReturnValue(directory);
  try {
    registerNotebookExecution();
  } finally {
    cwd.mockRestore();
  }
  try {
    const run = await draftRun(project.id, "production-sample");
    const { namespace, ref } = run.request.snapshot;
    await reserveKernelNamespace(
      {
        id: namespace.namespaceId,
        projectId: ref.projectId,
        scopeKind: "draft",
        scopeId: namespace.namespaceId,
        principalId: actor.ownerEmail,
        orgId: ref.workspaceId,
        lineageId: ref.head.versionId,
      },
      kernelHost,
      new Date(),
      getDb(),
    );
    const worker = createNotebookWorker(notebookRunStore, kernel.port);
    for (const _ of run.attempts)
      expect(await runAsActor(() => worker(actor, run.runId))).toBe(true);
    const { cells } = await execution(project.id);
    expect(run.plan.admittedCellIds).toEqual([
      "local-sample",
      "local-a",
      "local-b",
      "local-c",
      "local-d",
      "local-u",
      "local-v",
      "local-decimal",
    ]);
    expect(
      run.plan.admittedCellIds.map((id) => cells[id]?.attempt?.state.status),
    ).toEqual(run.plan.admittedCellIds.map(() => "complete"));
    for (const [id, rows] of [
      ["local-sample", [[42], [84]]],
      ["local-d", [[104]]],
      ["local-v", [[85]]],
      ["local-decimal", [[null, { type: "decimal", value: "42.50" }]]],
    ] as const) {
      const resultId = cells[id]?.resultId;
      if (!resultId) throw new Error(`No stored rows for ${id}`);
      expect(
        await runAsActor(() => getNotebookResultPage(actor, { resultId })),
      ).toMatchObject({ status: "ready", rows });
    }
    const badCellId = notebookCellIdSchema.parse("local-b");
    const original = project.cells.find(({ id }) => id === badCellId)?.contents;
    if (original?.kind !== "sql")
      throw new Error("Expected a dataframe SQL cell");
    await editDraft(project.id, {
      ...original,
      source: "select missing_value from a",
    });
    const failed = await draftRun(
      project.id,
      "bad-dataframe-diagnostic",
      "cell-only",
      badCellId,
    );
    expect(await runAsActor(() => worker(actor, failed.runId))).toBe(true);
    expect((await execution(project.id)).cells[badCellId]).toMatchObject({
      attempt: { state: { status: "failed" } },
      diagnostic: {
        message: expect.stringContaining(
          'Referenced column "missing_value" not found',
        ),
      },
    });
  } finally {
    vi.stubEnv("NODE_ENV", nodeEnvironment);
    vi.stubEnv("AGENT_NATIVE_DEPLOYMENT_ENVIRONMENT", deploymentEnvironment);
    unregisterPrivateBlobProvider("analytics2-local-notebook-results");
    registerPrivateBlobProvider(provider);
    await kernel.close();
  }
});

it("keeps the sample engine error body in a fresh notebook read", async () => {
  const project = await createProject({
    ...actor,
    cells: [
      {
        ...draftSql(
          "bad-sample",
          "select missing_value from (values (42)) as fixture(n)",
          "sample_output",
        ),
        dataConnectionId: SAMPLE_DATA_SOURCE_ID,
      },
    ],
  });
  const run = await draftRun(project.id, "bad-sample-diagnostic");
  await runAsActor(() =>
    createNotebookWorker(notebookRunStore)(actor, run.runId),
  );
  expect((await execution(project.id)).cells["bad-sample"]).toMatchObject({
    attempt: { state: { status: "failed" } },
    diagnostic: { message: 'column "missing_value" does not exist at [1:8]' },
  });
});

it("keeps the failed run's error body after the cell is edited", async () => {
  const project = await createProject({
    ...actor,
    cells: [
      {
        ...draftSql(
          "bad-sample-edited",
          "select missing_value from (values (42)) as fixture(n)",
          "sample_output",
        ),
        dataConnectionId: SAMPLE_DATA_SOURCE_ID,
      },
    ],
  });
  const run = await draftRun(project.id, "bad-sample-edited-run");
  await runAsActor(() =>
    createNotebookWorker(notebookRunStore)(actor, run.runId),
  );
  const original = project.cells.find(
    ({ id }) => id === "bad-sample-edited",
  )?.contents;
  if (original?.kind !== "sql") throw new Error("Expected a SQL cell");
  await editDraft(project.id, {
    ...original,
    source: "select missing_value from (values (42)) as fixture(n) ",
  });
  expect(
    (await execution(project.id)).cells["bad-sample-edited"],
  ).toMatchObject({
    stale: true,
    attempt: { state: { status: "failed" } },
    diagnostic: { message: 'column "missing_value" does not exist at [1:8]' },
  });
});

function draftInput(id: string, name: string, defaultValueString = "North") {
  return {
    kind: "input" as const,
    id,
    order: "i",
    label: null,
    hidden: false,
    gridX: null,
    gridY: null,
    gridWidth: null,
    gridHeight: null,
    inputType: "DROPDOWN" as const,
    name,
    defaultValueString,
    options: ["North", "South"],
  };
}

async function execution(projectId: string) {
  const result = await getNotebookExecution(actor, projectId);
  if (result.status !== "found")
    throw new Error("Notebook state was unreadable");
  return result;
}

async function draftRun(
  projectId: string,
  requestId: string,
  mode = "run-all",
  targetCellId = cellId,
) {
  const { snapshot } = await execution(projectId);
  return admitted(
    await notebookRunStore.admit(
      actor,
      runRequestSchema.parse({
        snapshot,
        requestId,
        cache: "bypass",
        ...(mode === "run-all"
          ? { mode, restart: false }
          : { mode, targetCellId, staleValues: "allow-compatible" }),
      }),
    ),
  );
}

async function finishPlan(run: RunReceipt) {
  for (const id of run.plan.admittedCellIds) {
    const item = await claimed(notebookRunStore, run);
    expect(item.attempt.cellId).toBe(id);
    expect(await notebookRunStore.finish(item, completion(item))).toBe(true);
  }
}

async function editDraft(
  projectId: string,
  contents: CellContents,
  inputOptionsResultId?: string,
) {
  return runAsActor(() =>
    saveProjectCell.run(
      {
        projectId,
        cellId: contents.id,
        contents,
        ...(inputOptionsResultId === undefined ? {} : { inputOptionsResultId }),
      },
      { caller: "frontend" },
    ),
  );
}

it("reuses the exact SQL result after an export rename and still detects a source edit", async () => {
  const project = await createProject({
    ...actor,
    cells: [
      draftSql("rename-producer", "select 42", "dataframe"),
      draftSql("rename-consumer", "select * from amounts", "joined", true),
    ],
  });
  const producerId = notebookCellIdSchema.parse("rename-producer");
  const consumerId = notebookCellIdSchema.parse("rename-consumer");
  const initial = await draftRun(
    project.id,
    "before-rename",
    "cell-only",
    producerId,
  );
  await finishPlan(initial);
  const result = (await execution(project.id)).cells[producerId]?.resultId;
  if (!result) throw new Error("Expected a persisted producer result");

  const producer = project.cells[0]?.contents;
  if (producer?.kind !== "sql")
    throw new Error("Expected the producer SQL cell");
  const renamed = { ...producer, resultVariable: "amounts" };
  await editDraft(project.id, renamed);
  expect((await execution(project.id)).cells[producerId]).toMatchObject({
    resultId: result,
    stale: false,
  });
  expect(
    await getCellExecution(actor, {
      projectId: notebookProjectIdSchema.parse(project.id),
      cellId: producerId,
    }),
  ).toMatchObject({
    status: "found",
    runId: initial.runId,
    attemptId: initial.attempts[0]?.attempt.attemptId,
    resultId: result,
  });
  const chained = await draftRun(
    project.id,
    "after-rename",
    "auto",
    consumerId,
  );
  expect(chained.plan.admittedCellIds).toEqual([consumerId]);
  expect(chained.plan.dependencyResultIds).toEqual([result]);
  await finishPlan(chained);

  await editDraft(project.id, { ...renamed, source: "select 84" });
  expect((await execution(project.id)).cells[producerId]?.stale).toBe(true);
  const changed = await draftRun(
    project.id,
    "changed-source",
    "auto",
    consumerId,
  );
  expect(changed.plan.admittedCellIds).toEqual([producerId, consumerId]);
  expect(changed.plan.dependencyResultIds).toEqual([]);
});

it("keeps a failed draft run current until its saved source changes", async () => {
  const project = await createProject({
    ...actor,
    cells: [draftSql("failed-source", "select 42", "sentinel")],
  });
  const contents = project.cells[0]?.contents;
  if (contents?.kind !== "sql")
    throw new Error("Expected a persisted SQL cell");
  const run = await draftRun(project.id, "failed-source");
  const failure = await claimed(notebookRunStore, run);
  expect(
    await notebookRunStore.finish(failure, {
      status: "failed",
      code: "fixture_error",
    }),
  ).toBe(true);
  const attempted = { attempt: failure.attempt, state: { status: "failed" } };
  expect((await execution(project.id)).cells[contents.id]).toMatchObject({
    stale: false,
    attempt: attempted,
  });

  const saved = await runAsActor(() =>
    updateCell({
      ...actor,
      projectId: project.id,
      versionId: project.workingVersionId,
      cellId: contents.id,
      contents: { ...contents, source: "select 84" },
    }),
  );
  expect(saved).not.toBeNull();
  expect((await execution(project.id)).cells[contents.id]).toMatchObject({
    stale: true,
    attempt: attempted,
  });
});

it("reattaches to a durable diamond, marks lineage stale, and clears only the blocked branch", async () => {
  const project = await createProject({
    ...actor,
    cells: [
      draftSql("diamond-a", "select 42", "alpha"),
      draftSql("diamond-b", "select * from alpha", "beta", true),
      draftSql("diamond-c", "select * from alpha", "gamma", true),
      draftSql(
        "diamond-d",
        "select * from beta join gamma on true",
        "delta",
        true,
      ),
      draftSql("diamond-u", "select 84", "independent"),
    ],
  });
  const run = await draftRun(project.id, "initial-diamond");
  const first = await claimed(notebookRunStore, run);
  const attached = await execution(project.id);
  expect(attached.activeRunIds).toEqual([run.runId]);
  expect(attached.cells["diamond-a"]?.attempt?.state.status).toBe("running");
  expect(await notebookRunStore.finish(first, completion(first))).toBe(true);
  for (const id of run.plan.admittedCellIds.slice(1)) {
    const item = await claimed(notebookRunStore, run);
    expect(item.attempt.cellId).toBe(id);
    expect(await notebookRunStore.finish(item, completion(item))).toBe(true);
  }
  const baseline = (await execution(project.id)).cells;
  const stored = await notebookRunStore.read(actor, run.runId, 0n, 50);
  const finished = readRunAttempts(stored, run.runId);
  expect(finished.plan.admittedCellIds).toEqual(run.plan.admittedCellIds);
  expect(finished.attempts.map(({ attempt }) => attempt)).toEqual(
    run.attempts.map(({ attempt }) => attempt),
  );
  expect(finished.attempts).toEqual(
    run.plan.admittedCellIds.map((id) => baseline[id]?.attempt),
  );
  const old = project.cells.find(({ id }) => id === "diamond-b")?.contents;
  if (old?.kind !== "sql") throw new Error("Expected SQL");
  await editDraft(project.id, {
    ...old,
    source: "select * from alpha limit 1",
  });
  const edited = (await execution(project.id)).cells;
  expect(edited["diamond-b"]).toMatchObject({
    stale: true,
    resultId: baseline["diamond-b"]?.resultId,
  });
  expect(edited["diamond-d"]?.stale).toBe(false);
  const only = await draftRun(
    project.id,
    "diamond-cell-only",
    "cell-only",
    notebookCellIdSchema.parse("diamond-b"),
  );
  expect(only.plan.admittedCellIds).toEqual(["diamond-b"]);
  await finishPlan(only);
  expect((await execution(project.id)).cells["diamond-d"]?.stale).toBe(true);
  const failing = await draftRun(
    project.id,
    "diamond-branch-error",
    "auto",
    notebookCellIdSchema.parse("diamond-b"),
  );
  expect(failing.plan.admittedCellIds).toEqual(["diamond-b", "diamond-d"]);
  const failure = await claimed(notebookRunStore, failing);
  expect(
    await notebookRunStore.finish(failure, {
      status: "failed",
      code: "fixture_error",
    }),
  ).toBe(true);
  expect(await notebookRunStore.claim(actor, failing.runId)).toBeNull();
  const completed = await execution(project.id);
  expect(completed.cells["diamond-d"]).toMatchObject({
    resultId: null,
    stale: true,
    attempt: {
      state: {
        status: "blocked",
        reason: "cancelled_upstream",
        blockedBy: "diamond-b",
      },
    },
  });
  expect(completed.cells["diamond-c"]).toEqual(baseline["diamond-c"]);
  expect(completed.cells["diamond-u"]).toEqual(baseline["diamond-u"]);
  expect(completed.activeRunIds).toEqual([]);

  await editDraft(project.id, {
    ...old,
    source: "select * from alpha limit 2",
  });
  expect((await execution(project.id)).cells["diamond-b"]).toMatchObject({
    stale: true,
    attempt: { attempt: failure.attempt, state: { status: "failed" } },
  });
});

it("refuses an older prerequisite result after its saved source selection changes", async () => {
  const project = await createProject({
    ...actor,
    cells: [
      draftSql("source-a", "select 42", "alpha"),
      draftSql("source-b", "select * from alpha", "beta", true),
    ],
  });
  await finishPlan(await draftRun(project.id, "base-source"));
  const base = project.cells[0]?.contents;
  if (base?.kind !== "sql") throw new Error("Expected SQL");
  await editDraft(project.id, { ...base, connectionMode: "dataframes" });
  const rejected = await draftRun(
    project.id,
    "changed-source",
    "cell-only",
    notebookCellIdSchema.parse("source-b"),
  );
  expect(rejected.plan.admittedCellIds).toEqual([]);
  expect(rejected.plan.rejectedCells).toEqual([
    {
      cellId: "source-b",
      reason: "incompatible_prerequisite",
    },
  ]);
});

it("coalesces committed input closures after disconnect and preserves unrelated work across input revisions", async () => {
  const project = await createProject({
    ...actor,
    cells: [
      draftInput("region", "region"),
      { ...draftInput("market", "market"), order: "j" },
      {
        ...draftSql(
          "re-region",
          "select {{ region }} as current_value from orders limit 1",
          "region_result",
        ),
        order: "k",
      },
      {
        ...draftSql(
          "re-market",
          "select {{ market }} as current_value from orders limit 1",
          "market_result",
        ),
        order: "l",
      },
      {
        ...draftSql(
          "re-join",
          "select {{ region }} as one_value, {{ market }} as two_value from orders limit 1",
          "both_results",
        ),
        order: "m",
      },
      {
        ...draftSql(
          "re-unrelated",
          "select 999 as sentinel from orders limit 1",
          "unrelated",
        ),
        order: "n",
      },
    ],
  });
  await finishPlan(await draftRun(project.id, "reactive-base"));
  const baseline = await execution(project.id);
  const independent = await draftRun(
    project.id,
    "running-unrelated",
    "cell-only",
    notebookCellIdSchema.parse("re-unrelated"),
  );
  const held = await claimed(notebookRunStore, independent);
  const older = await draftRun(
    project.id,
    "running-older-input",
    "cell-only",
    notebookCellIdSchema.parse("re-region"),
  );
  const stale = await claimed(notebookRunStore, older);
  const region = project.cells[0]?.contents;
  const market = project.cells[1]?.contents;
  if (region?.kind !== "input" || market?.kind !== "input")
    throw new Error("Expected two inputs");
  await expect(
    editDraft(project.id, { ...region, defaultValueString: "East" }),
  ).rejects.toMatchObject({ errorCode: "input_option_not_allowed" });
  await editDraft(project.id, { ...region, defaultValueString: "South" });
  await editDraft(project.id, { ...market, defaultValueString: "South" });
  const pending = await execution(project.id);
  expect(pending.snapshot.inputRevision).not.toBe(
    baseline.snapshot.inputRevision,
  );
  expect(pending.reactivePending).toBe(true);
  expect(pending.cells["re-region"]).toMatchObject({
    stale: true,
    resultId: baseline.cells["re-region"]?.resultId,
  });
  expect(await notebookRunStore.finish(stale, completion(stale))).toBe(false);
  expect(await notebookRunStore.finish(held, completion(held))).toBe(true);
  await sweepNotebookRuns({ deadlineAt: Date.now() + 60_000 });
  const after = await execution(project.id);
  expect(after.reactivePending).toBe(false);
  const rows = await getDb()
    .select()
    .from(notebookRuns)
    .where(
      and(
        eq(notebookRuns.namespaceId, after.snapshot.namespace.namespaceId),
        eq(notebookRuns.requestId, `reactive:${after.snapshot.inputRevision}`),
      ),
    )
    .limit(2);
  expect(rows).toHaveLength(1);
  expect(rows[0]?.receipt.plan.admittedCellIds).toEqual([
    "re-region",
    "re-market",
    "re-join",
  ]);
  expect(after.cells["re-unrelated"]?.resultId).toBe(
    completion(held).expected.resultId,
  );
  const result = after.cells["re-region"]?.resultId;
  if (!result) throw new Error("Dependent output did not complete");
  expect(
    await runAsActor(() => getNotebookResultPage(actor, { resultId: result })),
  ).toMatchObject({ status: "ready", rows: [["South"]] });
  await expect(
    setNotebookRunSettings(actor, {
      projectId: project.id,
      expectedSettingsRevision: after.settingsRevision,
      defaultMode: "cell-only",
      autoRerun: false,
    }),
  ).resolves.toMatchObject({
    status: "saved",
    defaultMode: "cell-only",
    autoRerun: false,
  });
  await editDraft(project.id, { ...region, defaultValueString: "North" });
  const stopped = await execution(project.id);
  expect(stopped).toMatchObject({
    reactivePending: false,
    autoRerun: false,
    defaultMode: "cell-only",
  });
  expect(stopped.cells["re-region"]).toMatchObject({
    stale: true,
    resultId: result,
  });
});

it("reads a selected SQL result separately and clears while a cancelled or held run cannot repopulate it", async () => {
  const project = await createProject({
    ...actor,
    cells: [
      draftSql(
        "selection",
        "select 42 as saved; select 84 as snippet",
        "saved",
      ),
      draftSql("independent", "select 999", "unrelated"),
    ],
  });
  const target = notebookCellIdSchema.parse("selection");
  const snapshot = (await execution(project.id)).snapshot;
  const savedRequest = runRequestSchema.parse({
    ...request(snapshot, "manual"),
    targetCellId: target,
  });
  await finishPlan(admitted(await notebookRunStore.admit(actor, savedRequest)));
  const baseline = (await execution(project.id)).cells["selection"]?.resultId;
  const selection = admitted(
    await notebookRunStore.admit(
      actor,
      {
        ...savedRequest,
        requestId: runRequestSchema.parse(request(snapshot, "snippet"))
          .requestId,
      },
      { selection: { from: 20, to: 40 } },
    ),
  );
  const snippet = await claimed(notebookRunStore, selection);
  const output = completion(snippet);
  expect(await notebookRunStore.finish(snippet, output)).toBe(true);
  expect((await execution(project.id)).cells["selection"]?.resultId).toBe(
    baseline,
  );
  expect(
    await runAsActor(() =>
      getNotebookResultPage(actor, { resultId: output.expected.resultId }),
    ),
  ).toMatchObject({ status: "ready", manifest: { status: "complete-empty" } });
  const all = await draftRun(project.id, "cancel-cells");
  expect(
    await notebookRunStore.cancel(
      actor,
      all.runId,
      notebookCellIdSchema.parse("independent"),
    ),
  ).toEqual({ status: "cancelled", reason: "cancel_confirmed" });
  const running = await claimed(notebookRunStore, all);
  expect(running.attempt.cellId).toBe(target);
  await runAsActor(() =>
    clearProjectOutputsAction.run({ projectId: project.id }),
  );
  expect(await notebookRunStore.finish(running, completion(running))).toBe(
    false,
  );
  const cleared = await execution(project.id);
  expect(cleared.cells["selection"]).toMatchObject({
    resultId: null,
    attempt: null,
  });
  expect(cleared.cells["independent"]).toMatchObject({
    resultId: null,
    attempt: null,
  });
});

it("interrupts held SQL dispatch and rejects a staged completion after clear", async () => {
  const project = await createProject({
    ...actor,
    cells: [
      {
        ...draftSql("held-sql", "select 42 as sentinel", "sentinel"),
        dataConnectionId: SAMPLE_DATA_SOURCE_ID,
      },
    ],
  });
  const target = { projectId: project.id, cellId: "held-sql" };
  const { control, draftBridge } = createWorkerControl();
  const deploymentEnvironment = process.env.AGENT_NATIVE_DEPLOYMENT_ENVIRONMENT;
  vi.stubEnv("AGENT_NATIVE_DEPLOYMENT_ENVIRONMENT", "local");
  Object.defineProperty(globalThis, phase1DraftFixtureKey, {
    value: draftBridge,
    configurable: true,
  });
  try {
    const worker = createNotebookWorker(notebookRunStore);
    for (const phase of ["before-dispatch", "before-promotion"] as const) {
      const { holdId } = z.object({ holdId: z.uuid() }).parse(
        await control({
          operation: "draft-hold-query",
          ...target,
          phase,
        }),
      );
      const run = await draftRun(project.id, `fixture-${phase}`);
      const attemptId = run.attempts[0]?.attempt.attemptId;
      if (!attemptId) throw new Error("The hold has no admitted attempt");
      const running = runAsActor(() => worker(actor, run.runId));
      try {
        await expect
          .poll(() =>
            control({ operation: "draft-hold-status", ...target, holdId }),
          )
          .toEqual({
            status: "held",
            ...target,
            runId: run.runId,
            attemptId,
          });
        if (phase === "before-dispatch") {
          expect(await notebookRunStore.cancel(actor, run.runId)).toEqual({
            status: "pending",
            reason: "not_ready",
          });
          await expect(running).resolves.toBe(true);
        } else {
          await runAsActor(() => clearProjectOutputs(actor, project.id));
        }
      } finally {
        await control({ operation: "draft-reset-query", ...target, holdId });
        await running;
      }
      expect(
        await runAsActor(() =>
          getNotebookRunDiagnostics(actor, {
            runId: run.runId,
            attemptId,
          }),
        ),
      ).toMatchObject({
        status: "found",
        diagnostic: {
          code: phase === "before-dispatch" ? "cancel_confirmed" : "superseded",
        },
      });
      expect(
        (await execution(project.id)).cells[target.cellId]?.resultId,
      ).toBeNull();
    }
  } finally {
    Reflect.deleteProperty(globalThis, phase1DraftFixtureKey);
    vi.stubEnv("AGENT_NATIVE_DEPLOYMENT_ENVIRONMENT", deploymentEnvironment);
  }
});

it("report 579 keeps an in-flight run visible and confirms cancel after a cell edit", async () => {
  const initialCell = {
    ...draftSql("edit-cancel-sql", "select 42 as sentinel", "sentinel"),
    dataConnectionId: SAMPLE_DATA_SOURCE_ID,
  };
  const project = await createProject({
    ...actor,
    cells: [initialCell],
  });
  const target = { projectId: project.id, cellId: "edit-cancel-sql" };
  const { control, draftBridge } = createWorkerControl();
  const deploymentEnvironment = process.env.AGENT_NATIVE_DEPLOYMENT_ENVIRONMENT;
  vi.stubEnv("AGENT_NATIVE_DEPLOYMENT_ENVIRONMENT", "local");
  Object.defineProperty(globalThis, phase1DraftFixtureKey, {
    value: draftBridge,
    configurable: true,
  });
  try {
    const worker = createNotebookWorker(notebookRunStore);
    const { holdId } = z.object({ holdId: z.uuid() }).parse(
      await control({
        operation: "draft-hold-query",
        ...target,
        phase: "before-dispatch",
      }),
    );
    const run = await draftRun(project.id, "fixture-edit-cancel");
    const attemptId = run.attempts[0]?.attempt.attemptId;
    if (!attemptId) throw new Error("The hold has no admitted attempt");
    const running = runAsActor(() => worker(actor, run.runId));
    try {
      await expect
        .poll(() =>
          control({ operation: "draft-hold-status", ...target, holdId }),
        )
        .toEqual({
          status: "held",
          ...target,
          runId: run.runId,
          attemptId,
        });
      const cell = project.cells[0]?.contents;
      if (!cell || cell.kind !== "sql") throw new Error("Expected SQL cell");
      await runAsActor(() =>
        updateCell({
          ...actor,
          projectId: project.id,
          versionId: project.workingVersionId,
          cellId: target.cellId,
          contents: {
            ...cell,
            source: "select 99 as sentinel",
          },
        }),
      );
      expect((await execution(project.id)).activeRunIds).toContain(run.runId);
      expect(await notebookRunStore.cancel(actor, run.runId)).toEqual({
        status: "pending",
        reason: "not_ready",
      });
      await expect(running).resolves.toBe(true);
    } finally {
      await control({ operation: "draft-reset-query", ...target, holdId });
      await running;
    }
    expect(
      await runAsActor(() =>
        getNotebookRunDiagnostics(actor, {
          runId: run.runId,
          attemptId,
        }),
      ),
    ).toMatchObject({
      status: "found",
      diagnostic: {
        code: "cancel_confirmed",
      },
    });
    expect((await execution(project.id)).activeRunIds).not.toContain(run.runId);
  } finally {
    Reflect.deleteProperty(globalThis, phase1DraftFixtureKey);
    vi.stubEnv("AGENT_NATIVE_DEPLOYMENT_ENVIRONMENT", deploymentEnvironment);
  }
});

it("distinguishes missing, verified empty, and unreadable dynamic choices and rejects stale selection proof", async () => {
  const project = await createProject({
    ...actor,
    cells: [
      draftSql(
        "options-source",
        "select channel from orders limit 5",
        "channels",
      ),
      {
        ...draftInput("options-input", "channel_pick", ""),
        order: "j",
        dynamicOptions: { producerCellId: "options-source", valueFieldId: "0" },
      },
      {
        ...draftSql(
          "option-consumer",
          "select {{ channel_pick }} as picked from orders limit 1",
          "consumer",
        ),
        order: "k",
      },
    ],
  });
  const input = project.cells.find(
    ({ id }) => id === "options-input",
  )?.contents;
  const source = project.cells.find(
    ({ id }) => id === "options-source",
  )?.contents;
  if (input?.kind !== "input" || source?.kind !== "sql")
    throw new Error("Expected a dynamic input and its SQL producer");
  const read = () =>
    runAsActor(() => getNotebookInputChoices(actor, project.id, input.id));
  expect(await read()).toEqual({ status: "missing" });
  await draftRun(project.id, "choices-baseline");
  await sweepNotebookRuns({ deadlineAt: Date.now() + 60_000 });
  const ready = await read();
  if (ready.status !== "ready") throw new Error(`Options were ${ready.status}`);
  const value = ready.values[0]?.value;
  if (!value) throw new Error("Expected an option from the sample");
  await draftRun(project.id, "choices-second-version");
  await sweepNotebookRuns({ deadlineAt: Date.now() + 60_000 });
  await expect(
    editDraft(
      project.id,
      { ...input, defaultValueString: value },
      ready.resultId,
    ),
  ).rejects.toMatchObject({ errorCode: "input_options_changed" });
  const current = await read();
  if (current.status !== "ready") throw new Error("Current choices unreadable");
  await expect(
    editDraft(
      project.id,
      { ...input, defaultValueString: value },
      current.resultId,
    ),
  ).resolves.toMatchObject({ editStatus: "saved" });
  await editDraft(project.id, {
    ...source,
    source:
      "select channel from orders where channel = 'missing-parity-choice' limit 5",
  });
  await draftRun(project.id, "choices-empty");
  await sweepNotebookRuns({ deadlineAt: Date.now() + 60_000 });
  expect(await read()).toEqual({ status: "empty" });
  expect((await execution(project.id)).cells["option-consumer"]).toMatchObject({
    resultId: null,
    attempt: { state: { status: "failed" } },
    diagnostic: { message: "This choice is no longer available." },
  });
  await editDraft(project.id, {
    ...input,
    dynamicOptions: {
      producerCellId: "options-source",
      valueFieldId: "missing-column",
    },
  });
  expect(await read()).toEqual({ status: "unreadable" });
});

it("adopts the run tables on a fresh database", async () => {
  await closeDbExec();
  vi.stubEnv("DATABASE_URL", `pglite:${join(directory, "fresh")}`);
  resetAppConfigForTests();
  await runAnalyticsMigrations(undefined);
  const { store, snapshot } = fixture("fresh");
  const initial = admitted(
    await store.admit(actor, request(snapshot, "fresh")),
  );
  const run = await claimed(store, initial);
  expect(await store.finish(run, completion(run))).toBe(true);
  expect(await pointer(snapshot.namespace.namespaceId)).toBe(
    completion(run).expected.resultId,
  );
});
