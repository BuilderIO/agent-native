import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  actionCallIntent,
  runPreparedActionCall,
  type ActionRunContext,
} from "@agent-native/core/action";
import { createAnthropicEngine } from "@agent-native/core/agent/engine";
import { writeAppState } from "@agent-native/core/application-state";
import { closeDbExec, getDbExec, runMigrations } from "@agent-native/core/db";
import {
  organizations,
  ORG_MIGRATIONS,
  orgMembers,
} from "@agent-native/core/org";
import {
  registerPrivateBlobProvider,
  unregisterPrivateBlobProvider,
  type PrivateBlobProvider,
} from "@agent-native/core/private-blob";
import {
  actionsToEngineTools,
  createThread,
  getRunTurnRef,
  loadActionsFromStaticRegistry,
  resetAppConfigForTests,
  runAgentLoop,
  runWithRequestContext,
} from "@agent-native/core/server";
import { generateActionRegistryForProject } from "@agent-native/core/vite";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { z } from "zod";

import { registerChatThreadsShareable } from "../../../../packages/core/dist/chat-threads/store.js";
import { workspaceChatScope } from "../../app/lib/workspace-chat-scope.js";
import { sqlCellContentsSchema } from "../../app/lib/model/contracts.js";
import {
  answerModelRequest,
  createModelState,
} from "../../e2e/local/fake-model.js";
import { magicEditPrompt } from "../../e2e/local/phase1-model.js";
import {
  resultIdSchema,
  runRequestSchema,
} from "../../shared/notebook-execution.js";
import { notebookSnapshotSchema } from "../../shared/notebook-operations.js";
import {
  notebookPendingChangesSchema,
  notebookProposalDecisionSchema,
  notebookThreadBindingSchema,
} from "../../shared/notebook-proposals.js";
import {
  authorizedResultRefSchema,
  completeResultManifestSchema,
} from "../../shared/notebook-result-contract.js";
import { notebookCellIdSchema } from "../../shared/notebook-snapshot-contract.js";
import {
  publishPreviewDetailSchema,
  publishPreviewReceiptSchema,
} from "../../shared/project-publish.js";
import { SAMPLE_DATA_SOURCE_ID } from "../../shared/sample-data-contract.js";
import { getDb } from "../db/index.js";
import {
  analyticsMigrations,
  runAnalyticsMigrations,
} from "../db/migrations.js";
import { digest } from "./notebook-execution/planner.js";
import { notebookThreadProjects } from "./notebook-proposal-schema.js";
import {
  notebookOutputs,
  notebookProposalRunIntents,
  notebookResultManifests,
} from "./notebook-execution/schema.js";
import {
  getNotebookRunOutput,
  notebookRunStore,
  sweepNotebookRuns,
} from "./notebook-execution/service.js";
import { currentThreadSnapshot } from "./notebook-execution/thread-snapshot.js";
import { getNotebookResultPageOutput } from "./notebook-results.js";
import { createProject } from "./projects-store.js";

vi.mock("../execution/visualization-kernel.js", async (original) => ({
  ...(await original<typeof import("../execution/visualization-kernel.js")>()),
  executeVisualizationSql: (
    await import("../testing/visualization-sql-fixture.js")
  ).runVisualizationInPGlite,
}));

const actor = {
  orgId: "i12-review-fixture",
  ownerEmail: "owner@example.test",
  caller: "frontend",
};
const outsider = "independent-reader@example.test";
const otherOrg = "i12-other-workspace";
const appId = "analytics-2";
const source = (value: number) =>
  `select ${value} as sentinel from orders limit 1`;
const directory = await mkdtemp(join(tmpdir(), "notebook-proposals-"));
const runAs = <T>(
  callback: () => T,
  email = actor.ownerEmail,
  orgId = actor.orgId,
) =>
  runWithRequestContext(
    { orgId, userEmail: email, authUserId: email, isSyntheticTraffic: true },
    callback,
  );
let actions: ReturnType<typeof loadActionsFromStaticRegistry>;
const blobs = new Map<string, Uint8Array>();
const blobsProvider: PrivateBlobProvider = {
  id: "notebook-review-fixture",
  name: "Notebook review fixture",
  isConfigured: () => true,
  async put(input) {
    if (!input.key) throw new Error("Expected a result segment key");
    blobs.set(input.key, Uint8Array.from(input.data));
    return { id: input.key, provider: this.id, opaque: true, encrypted: false };
  },
  async read(handle) {
    const data = blobs.get(handle.id);
    if (!data) throw new Error("Fixture result is missing");
    return { data, handle };
  },
  async delete(handle) {
    return { deleted: blobs.delete(handle.id), provider: this.id };
  },
};

beforeAll(async () => {
  vi.stubEnv("DATABASE_URL", `pglite:${join(directory, "upgrade")}`);
  vi.stubEnv("DATABASE_URL_UNPOOLED", "");
  vi.stubEnv("NETLIFY_DATABASE_URL_UNPOOLED", "");
  resetAppConfigForTests();
  await runMigrations(
    ORG_MIGRATIONS.map(({ name, ...entry }) =>
      name ? { ...entry, name } : entry,
    ),
    { table: "review_fixture_org_migrations" },
  )(undefined);
  await runMigrations(
    analyticsMigrations.filter(({ version }) => version < 30),
    { table: "analytics2_migrations" },
  )(undefined);
  await getDb()
    .insert(organizations)
    .values(
      [actor.orgId, otherOrg].map((id) => ({
        id,
        name: id,
        createdBy: actor.ownerEmail,
        createdAt: 0,
      })),
    );
  await getDb()
    .insert(orgMembers)
    .values(
      [
        { orgId: actor.orgId, email: actor.ownerEmail, role: "owner" },
        { orgId: actor.orgId, email: outsider, role: "member" },
        { orgId: otherOrg, email: actor.ownerEmail, role: "owner" },
      ].map((member) => ({ ...member, id: randomUUID(), joinedAt: 0 })),
    );
  await runAnalyticsMigrations(undefined);
  registerChatThreadsShareable();
  registerPrivateBlobProvider(blobsProvider);
  generateActionRegistryForProject(
    fileURLToPath(new URL("../..", import.meta.url)),
  );
  actions = loadActionsFromStaticRegistry(
    (await import("../../.generated/actions-registry.js")).default,
  );
});

afterAll(async () => {
  unregisterPrivateBlobProvider(blobsProvider.id);
  await closeDbExec();
  vi.unstubAllEnvs();
  resetAppConfigForTests();
  await rm(directory, { recursive: true, force: true });
});

async function invoke(
  name: string,
  input: unknown,
  context: Partial<ActionRunContext> = {},
) {
  const entry = actions[name];
  if (!entry) throw new Error(`Missing registered action ${name}`);
  const next = {
    caller: "frontend" as const,
    userEmail: actor.ownerEmail,
    orgId: actor.orgId,
    appId,
    ...context,
  };
  return runAs(
    async () => {
      const prepared = await actionCallIntent(entry, input);
      if (!prepared.valid) throw prepared.error;
      return runPreparedActionCall(entry, prepared, next);
    },
    next.userEmail,
    next.orgId ?? actor.orgId,
  );
}

const snapshot = async (projectId: string) => {
  const read = await invoke("get-project", { projectId });
  if (!read || typeof read !== "object" || !("notebook" in read))
    throw new Error("Accepted notebook fixture could not be read");
  return notebookSnapshotSchema.parse(read.notebook);
};
const pending = async (projectId: string, threadId: string) =>
  notebookPendingChangesSchema.parse(
    await invoke("get-notebook-pending-changes", { projectId, threadId }),
  );

async function projectFixture(resultVariable = "baseline") {
  const cellId = randomUUID();
  const project = await runAs(() =>
    createProject({
      ...actor,
      title: "Review fixture",
      cells: [
        sqlCellContentsSchema.parse({
          id: cellId,
          order: "i",
          label: "Baseline",
          hidden: false,
          kind: "sql",
          source: source(42),
          gridX: null,
          gridY: null,
          gridWidth: null,
          gridHeight: null,
          dataConnectionId: SAMPLE_DATA_SOURCE_ID,
          databaseSchema: null,
          resultVariable,
          outputResult: true,
        }),
      ],
    }),
  );
  const accepted = await snapshot(project.id);
  const expectedHead = accepted.snapshot.head;
  const preview = publishPreviewReceiptSchema.parse(
    await invoke("create-project-publish-preview", {
      projectId: project.id,
      expectedHead,
      expectedReleaseId: null,
      requestId: randomUUID(),
    }),
  );
  const checked = await vi.waitFor(async () => {
    const detail = publishPreviewDetailSchema.parse(
      await invoke("get-project-publish-preview", {
        projectId: project.id,
        previewId: preview.previewId,
      }),
    );
    expect(detail.state).toBe("ready");
    return detail;
  }, 15_000);
  await invoke("publish-project", {
    projectId: project.id,
    previewId: preview.previewId,
    expectedHead,
    expectedReleaseId: checked.compareReleaseId,
    expectedManifestRevision: checked.manifestRevision,
    mode: "ready",
    requestId: randomUUID(),
    description: "magic13-v1",
  });
  const createThread = async () =>
    notebookThreadBindingSchema.parse(
      await invoke("create-notebook-thread", {
        projectId: project.id,
        head: accepted.snapshot.head,
        opId: randomUUID(),
      }),
    );
  return {
    projectId: project.id,
    cellId,
    threadId: (await createThread()).threadId,
    otherThread: (await createThread()).threadId,
    accepted,
  };
}

async function createRun(threadId: string) {
  const runId = randomUUID();
  const turnId = randomUUID();
  await getRunTurnRef(runId);
  await getDbExec().execute({
    sql: "INSERT INTO agent_runs (id, thread_id, turn_id, status, started_at) VALUES (?, ?, ?, 'running', 1)",
    args: [runId, threadId, turnId],
  });
  return { runId, turnId };
}

async function coreTools(threadId: string) {
  const { runId, turnId } = await createRun(threadId);
  return (name: string, input: unknown, toolCallId = randomUUID()) =>
    invoke(name, input, {
      caller: "tool",
      threadId,
      runId,
      turnId,
      toolCallId,
    });
}

function decision(
  projectId: string,
  threadId: string,
  review: Awaited<ReturnType<typeof pending>>,
  kind: "confirm" | "undo",
  ids?: string[],
) {
  return {
    projectId,
    threadId,
    opId: randomUUID(),
    decision: kind,
    expectedOverlayRevision: review.overlayRevision,
    observedHead: review.acceptedHead,
    selection: ids
      ? { kind: "selected", ids }
      : { kind: "all", reviewedSetDigest: review.reviewedSetDigest },
  };
}

it.each([
  {
    x: "ordered_on",
    unit: "month",
    dimension: "date '2025-01-01' as ordered_on",
  },
  { x: "channel", unit: "none", dimension: "'store' as region" },
])(
  "defaults agent chart axes from a ready thread result ($x) and preserves explicit bindings",
  async ({ x, unit, dimension }) => {
    const { projectId, cellId, threadId } = await projectFixture();
    const call = await coreTools(threadId);
    await call("add-project-cell", {
      projectId,
      kind: "sql",
      name: "orders_by_date",
      afterCellId: cellId,
      source: `select 'web' as channel, 10 as gross, ${dimension}, 8 as net`,
    });
    await sweepNotebookRuns({ deadlineAt: Date.now() + 60_000 });
    await expect
      .poll(
        async () =>
          (await pending(projectId, threadId)).changes[0]?.resultIds.length,
        { timeout: 10_000 },
      )
      .toBe(1);
    const [query] = (await pending(projectId, threadId)).changes;
    if (!query) throw new Error("Missing query proposal");
    await call("add-project-cell", {
      projectId,
      kind: "chart",
      dataframe: "orders_by_date",
      afterCellId: query.cellId,
    });
    const [, chart] = (await pending(projectId, threadId)).changes;
    const contents = chart?.after?.cells.find(
      ({ id }) => id === chart.cellId,
    )?.contents;
    if (contents?.kind !== "chart") throw new Error("Missing chart proposal");
    const spec = contents.chartSpec;
    expect(spec).toMatchObject({
      xField: expect.any(String),
      xTimeUnit: unit,
      yField: expect.any(String),
      yAggregation: "sum",
      sourceCellId: query.cellId,
    });
    expect(spec.fieldLabels?.[spec.xField ?? ""]).toBe(x);
    expect(spec.fieldLabels?.[spec.yField ?? ""]).toBe("gross");

    const blank = {
      ...spec,
      sourceCellId: null,
      sourceExportId: null,
      xField: null,
      yField: null,
    };
    const save = (dataframe: string | null, chartSpec: typeof spec) =>
      call("save-project-cell", {
        projectId,
        cellId: contents.id,
        contents: { ...contents, dataframe, chartSpec },
      });
    const readChart = async () =>
      (await pending(projectId, threadId)).changes.find(
        ({ cellId }) => cellId === contents.id,
      )?.after?.cells[0]?.contents;
    await save(null, blank);
    await save("orders_by_date", blank);
    expect(await readChart()).toMatchObject({ chartSpec: spec });

    const explicit: typeof spec = {
      ...spec,
      xField: digest(["result", "channel", "string"]),
      yField: digest(["result", "net", "number"]),
      xTimeUnit: "none",
      yAggregation: "max",
      seriesField: null,
    };
    await save(null, blank);
    await save("orders_by_date", explicit);
    expect(await readChart()).toMatchObject({ chartSpec: explicit });
  },
);

it("pre-runs one retried core SQL tool in its thread, groups the dependent chart and checkpoints one accepted revision", async () => {
  const { projectId, cellId, threadId, otherThread, accepted } =
    await projectFixture();
  const call = await coreTools(threadId);
  const sql = {
    projectId,
    kind: "sql",
    source: "select 13042 as result",
    name: "review_sample",
    afterCellId: cellId,
  };
  const toolCallId = randomUUID();
  const first = await call("add-project-cell", sql, toolCallId);
  expect(first).toMatchObject({ threadId, proposalIds: [expect.any(String)] });
  expect(await call("add-project-cell", sql, toolCallId)).toEqual(first);
  await expect(
    call("add-project-cell", { ...sql, source: source(13099) }, toolCallId),
  ).rejects.toMatchObject({ errorCode: "intent_mismatch" });
  const [candidate] = (await pending(projectId, threadId)).changes;
  if (!candidate) throw new Error("SQL proposal was not staged");
  expect(
    await call("add-project-cell", {
      projectId,
      kind: "chart",
      dataframe: "review_sample",
      afterCellId: candidate.cellId,
    }),
  ).toMatchObject({ threadId, proposalIds: [expect.any(String)] });
  expect(
    await call("add-project-cell", {
      projectId,
      kind: "text",
      name: "Magic scratch 13",
    }),
  ).toMatchObject({ threadId, proposalIds: [expect.any(String)] });
  await sweepNotebookRuns({ deadlineAt: Date.now() + 60_000 });
  await expect
    .poll(
      async () => {
        const state = await pending(projectId, threadId);
        return state.changes.find(({ id }) => id === candidate.id)?.resultIds;
      },
      { timeout: 10_000 },
    )
    .toHaveLength(1);
  const review = await pending(projectId, threadId);
  const [query, chart, scratch] = review.changes;
  const resultId = query?.resultIds[0];
  if (!query?.runId || !resultId || !chart || !scratch)
    throw new Error(
      "Review fixture did not produce SQL, chart and scratch proposals",
    );
  expect(review.changes).toHaveLength(3);
  expect(chart.dependsOn).toContain(query.id);
  expect(await snapshot(projectId)).toEqual(accepted);
  expect((await pending(projectId, otherThread)).changes).toEqual([]);
  await expect(
    invoke(
      "get-notebook-pending-changes",
      { projectId, threadId },
      { userEmail: outsider },
    ),
  ).rejects.toMatchObject({ statusCode: 404 });
  await expect(
    invoke(
      "get-notebook-pending-changes",
      { projectId, threadId },
      { orgId: otherOrg },
    ),
  ).rejects.toMatchObject({ statusCode: 404 });
  for (const scope of [{}, { threadId: otherThread }]) {
    expect(
      await invoke("get-notebook-result-page", { resultId, ...scope }),
    ).toMatchObject({ status: "denied" });
  }
  expect(
    await invoke("get-notebook-run", {
      runId: query.runId,
      threadId: otherThread,
    }),
  ).toMatchObject({ status: "denied" });
  const result = getNotebookResultPageOutput.parse(
    await invoke("get-notebook-result-page", { resultId, threadId }),
  );
  expect(result).toMatchObject({
    status: "ready",
    rows: [[13042]],
    manifest: {
      result: { producer: { runId: query.runId, cellId: query.cellId } },
    },
  });
  await expect(
    invoke(
      "decide-notebook-pending-changes",
      decision(projectId, threadId, review, "confirm", [chart.id]),
    ),
  ).rejects.toMatchObject({ errorCode: "review_dependency_required" });
  await invoke(
    "decide-notebook-pending-changes",
    decision(projectId, threadId, review, "undo", [scratch.id]),
  );
  const latest = await pending(projectId, threadId);
  const confirm = decision(projectId, threadId, latest, "confirm");
  const receipt = notebookProposalDecisionSchema.parse(
    await invoke("decide-notebook-pending-changes", confirm),
  );
  expect(receipt.proposalIds).toEqual([query.id, chart.id]);
  expect(receipt.checkpointId).toEqual(expect.any(String));
  expect(await invoke("decide-notebook-pending-changes", confirm)).toEqual(
    receipt,
  );
  expect(await invoke("list-project-versions", { projectId })).toMatchObject({
    versions: expect.arrayContaining([
      expect.objectContaining({ id: receipt.checkpointId }),
    ]),
  });
  const committed = await snapshot(projectId);
  expect(committed.snapshot.head).toEqual(receipt.acceptedHead);
  expect(BigInt(committed.snapshot.head.revision)).toBe(
    BigInt(accepted.snapshot.head.revision) + 1n,
  );
  expect(committed.cells.map(({ id }) => id)).toEqual([
    cellId,
    query.cellId,
    chart.cellId,
  ]);
  expect((await pending(projectId, threadId)).changes).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ id: scratch.id, status: "undone" }),
    ]),
  );
  expect(receipt.promotedResultIds).toHaveLength(1);
  const [acceptedResultId] = receipt.promotedResultIds;
  if (!acceptedResultId)
    throw new Error("Candidate SQL output was not promoted");
  expect(acceptedResultId).not.toBe(resultId);
  expect(
    await invoke("get-notebook-result-page", { resultId: acceptedResultId }),
  ).toMatchObject({ status: "ready", rows: [[13042]] });
  expect(
    await invoke("get-notebook-transform", {
      projectId,
      cellId: chart.cellId,
      mode: "chart",
    }),
  ).toMatchObject({
    result: { status: "ready", rows: [{ x: 13042, value: 13042 }] },
  });
  const [originalArtifact] = await getDb()
    .select()
    .from(notebookResultManifests)
    .where(eq(notebookResultManifests.id, resultIdSchema.parse(resultId)))
    .limit(1);
  const [acceptedArtifact] = await getDb()
    .select()
    .from(notebookResultManifests)
    .where(
      eq(notebookResultManifests.id, resultIdSchema.parse(acceptedResultId)),
    )
    .limit(1);
  expect(acceptedArtifact?.artifactId).toBe(originalArtifact?.artifactId);
  expect(acceptedArtifact?.manifest.result.snapshot.head).toEqual(
    receipt.acceptedHead,
  );
  const release = await invoke("get-project", { projectId, version: "latest" });
  expect(release).toMatchObject({
    project: {
      cells: [
        expect.objectContaining({
          id: cellId,
          contents: expect.objectContaining({ source: source(42) }),
        }),
      ],
    },
  });
});

it("rejects unbound MCP and preserves the separate accepted reader after a same-field human conflict", async () => {
  const { projectId, cellId, threadId, otherThread } = await projectFixture();
  const sql = {
    projectId,
    kind: "sql",
    source: source(13042),
    afterCellId: cellId,
  };
  await expect(
    invoke("add-project-cell", sql, { caller: "mcp", networkProtocol: "mcp" }),
  ).rejects.toMatchObject({ errorCode: "review_context_required" });
  const call = await coreTools(threadId);
  const before = await snapshot(projectId);
  const [baseline] = before.cells;
  if (!baseline || baseline.contents.kind !== "sql")
    throw new Error("Missing SQL fixture");
  expect(
    await call("save-project-cell", {
      projectId,
      cellId,
      contents: { ...baseline.contents, source: source(13077) },
    }),
  ).toMatchObject({ threadId, proposalIds: [expect.any(String)] });
  const review = await pending(projectId, threadId);
  expect(review.changes).toHaveLength(1);
  await invoke("save-project-cell", {
    projectId,
    cellId,
    contents: { ...baseline.contents, source: source(13099) },
  });
  await expect(
    invoke(
      "decide-notebook-pending-changes",
      decision(projectId, threadId, review, "confirm"),
    ),
  ).rejects.toMatchObject({ errorCode: "proposal_base_changed" });
  const fresh = await snapshot(projectId);
  expect(fresh.cells).toMatchObject([{ contents: { source: source(13099) } }]);
  expect((await pending(projectId, otherThread)).changes).toEqual([]);
  expect((await pending(projectId, threadId)).changes).toMatchObject([
    { id: review.changes[0]?.id, status: "conflicted" },
  ]);
});

it("binds an unbound shell agent thread on its first notebook edit and stages it for review", async () => {
  const { projectId, cellId, threadId: boundThread } = await projectFixture();
  const shellThread = randomUUID();
  await createThread(actor.ownerEmail, {
    id: shellThread,
    orgId: actor.orgId,
    scope: workspaceChatScope(actor.orgId, appId),
    source: { appId },
  });
  const before = await snapshot(projectId);
  const [baseline] = before.cells;
  if (!baseline || baseline.contents.kind !== "sql")
    throw new Error("Missing SQL fixture");
  const call = await coreTools(shellThread);
  const staged = await call("save-project-cell", {
    projectId,
    cellId,
    contents: { ...baseline.contents, source: source(2025) },
  });
  expect(staged).toMatchObject({
    threadId: shellThread,
    proposalIds: [expect.any(String)],
    editStatus: "pending_review",
  });
  expect((await pending(projectId, shellThread)).changes).toHaveLength(1);
  expect((await pending(projectId, boundThread)).changes).toEqual([]);
  expect((await snapshot(projectId)).cells).toMatchObject([
    { contents: { source: source(42) } },
  ]);
  const bound = await getDb()
    .select()
    .from(notebookThreadProjects)
    .where(eq(notebookThreadProjects.threadId, shellThread));
  expect(bound).toMatchObject([{ projectId, kind: "notebook" }]);
});

it("does not move a thread bound to another notebook", async () => {
  const notebook = async () => {
    const project = await runAs(() =>
      createProject({
        ...actor,
        title: "Binding fixture",
        cells: [
          sqlCellContentsSchema.parse({
            id: randomUUID(),
            order: "i",
            label: "Baseline",
            hidden: false,
            kind: "sql",
            source: source(42),
            gridX: null,
            gridY: null,
            gridWidth: null,
            gridHeight: null,
            dataConnectionId: SAMPLE_DATA_SOURCE_ID,
            databaseSchema: null,
            resultVariable: "baseline",
            outputResult: true,
          }),
        ],
      }),
    );
    const head = (await snapshot(project.id)).snapshot.head;
    const bound = notebookThreadBindingSchema.parse(
      await invoke("create-notebook-thread", {
        projectId: project.id,
        head,
        opId: randomUUID(),
      }),
    );
    return { projectId: project.id, threadId: bound.threadId };
  };
  const first = await notebook();
  const second = await notebook();
  const call = await coreTools(first.threadId);
  await expect(
    call("add-project-cell", {
      projectId: second.projectId,
      kind: "text",
      name: "Cross notebook",
    }),
  ).rejects.toMatchObject({ errorCode: "review_context_required" });
  expect((await pending(second.projectId, second.threadId)).changes).toEqual(
    [],
  );
});

it("stages the scripted notebook follow-up through the Anthropic tool loop and requires a pending receipt", async () => {
  const { projectId, cellId, threadId, accepted } =
    await projectFixture("magic_result");
  const { runId, turnId } = await createRun(threadId);
  await runAs(() =>
    writeAppState("navigation", {
      view: "project",
      resourceKind: "project",
      resourceId: projectId,
    }),
  );
  const model = createModelState();
  vi.stubGlobal("fetch", async (_url: unknown, init?: RequestInit) => {
    const input = z
      .record(z.string(), z.unknown())
      .parse(JSON.parse(z.string().parse(init?.body)));
    const chunks: string[] = [];
    let response = { status: 200, headers: {} };
    return new Promise<Response>((resolve, reject) => {
      void answerModelRequest(
        input,
        {
          writeHead(status, headers) {
            response = { status, headers };
          },
          write: (chunk) => chunks.push(chunk),
          end: () => resolve(new Response(chunks.join(""), response)),
        },
        model,
      ).catch(reject);
    });
  });
  const answer: string[] = [];
  try {
    const engine = createAnthropicEngine({ apiKey: "fake-model-key" });
    const notebookTools = Object.fromEntries(
      Object.entries(actions).filter(([name]) =>
        ["view-screen", "get-project", "save-project-cell"].includes(name),
      ),
    );
    await runAs(() =>
      runAgentLoop({
        engine,
        model: engine.defaultModel,
        systemPrompt: "Stage notebook edits for review.",
        actions: notebookTools,
        tools: actionsToEngineTools(notebookTools),
        messages: [
          {
            role: "user",
            content: [{ type: "text", text: "Prepare an initial query." }],
          },
          {
            role: "assistant",
            content: [{ type: "text", text: "The initial query is ready." }],
          },
          {
            role: "user",
            content: [
              {
                type: "text",
                text: `${magicEditPrompt}\n\n<current-time>2026-11-19T00:00:00Z</current-time>`,
              },
            ],
          },
        ],
        send: (event) => {
          if (event.type === "text") answer.push(event.text);
        },
        signal: new AbortController().signal,
        ownerEmail: actor.ownerEmail,
        orgId: actor.orgId,
        appId,
        runId,
        threadId,
        turnId,
      }),
    );
  } finally {
    vi.unstubAllGlobals();
  }
  expect(answer.join("")).toBe("The SQL edit is ready for review.");
  const review = await pending(projectId, threadId);
  expect(review.changes).toMatchObject([
    {
      cellId,
      kind: "edit",
      status: "pending",
      after: { cells: [{ contents: { source: "SELECT 13077 AS result" } }] },
    },
  ]);
  expect(await snapshot(projectId)).toEqual(accepted);

  const request = z
    .looseObject({
      messages: z.array(z.object({ role: z.string(), content: z.unknown() })),
    })
    .parse(model.requests.at(-1));
  const [receipt] = z
    .tuple([
      z.looseObject({
        type: z.literal("tool_result"),
        tool_use_id: z.string(),
        content: z.string(),
      }),
    ])
    .parse(request.messages.at(-1)?.content);
  await expect(
    answerModelRequest(
      {
        ...request,
        messages: [
          ...request.messages.slice(0, -1),
          {
            role: "user",
            content: [
              {
                ...receipt,
                content: JSON.stringify({
                  ...z
                    .record(z.string(), z.unknown())
                    .parse(JSON.parse(receipt.content)),
                  editStatus: "saved",
                }),
              },
            ],
          },
        ],
      },
      { writeHead: vi.fn(), write: vi.fn(), end: vi.fn() },
      model,
    ),
  ).rejects.toThrow(/pending_review/);
});

it("undo fences an already claimed candidate, reruns the accepted graph and retains the tombstone", async () => {
  const { projectId, cellId, threadId } = await projectFixture();
  const call = await coreTools(threadId);
  const draft = await snapshot(projectId);
  const [baseline] = draft.cells;
  if (!baseline || baseline.contents.kind !== "sql")
    throw new Error("Missing SQL fixture");
  await invoke("save-project-cell", {
    projectId,
    cellId,
    contents: { ...baseline.contents, source: source(13099) },
  });
  expect(
    await call("save-project-cell", {
      projectId,
      cellId,
      contents: { ...baseline.contents, source: source(13077) },
    }),
  ).toMatchObject({ threadId, proposalIds: [expect.any(String)] });
  await sweepNotebookRuns({ deadlineAt: Date.now() + 60_000 });
  const candidateResult = async () =>
    (await pending(projectId, threadId)).changes[0]?.resultIds[0];
  await expect
    .poll(candidateResult, { timeout: 10_000 })
    .toEqual(expect.any(String));
  expect(
    await invoke("get-notebook-result-page", {
      resultId: await candidateResult(),
      threadId,
    }),
  ).toMatchObject({ status: "ready", rows: [[13077]] });
  const branch = await currentThreadSnapshot(actor, { projectId, threadId });
  if (branch.status !== "accepted")
    throw new Error("Missing candidate snapshot");
  const run = await notebookRunStore.admit(
    actor,
    runRequestSchema.parse({
      snapshot: branch.value.snapshot,
      requestId: randomUUID(),
      mode: "cell-only",
      targetCellId: cellId,
      cache: "reuse",
      staleValues: "reject",
    }),
  );
  if (run.status !== "admitted")
    throw new Error("Candidate attempt was not admitted");
  const claim = await notebookRunStore.claim(actor, run.runId);
  if (!claim) throw new Error("Candidate attempt was not claimed");
  const read = await pending(projectId, threadId);
  const undone = notebookProposalDecisionSchema.parse(
    await invoke(
      "decide-notebook-pending-changes",
      decision(projectId, threadId, read, "undo"),
    ),
  );
  expect(undone.rerunIntentId).toEqual(expect.any(String));
  const expected = authorizedResultRefSchema.parse({
    resultId: digest(claim.attempt),
    producer: { ...claim.attempt, exportId: "result" },
    snapshot: run.request.snapshot.ref,
    inputRevision: run.request.snapshot.inputRevision,
    dependencyFingerprint: digest([]),
    sourceGeneration: null,
    kernelGeneration: null,
  });
  const manifest = completeResultManifestSchema.parse({
    status: "complete-empty",
    rowCount: "0",
    result: expected,
    fields: [],
  });
  expect(
    await notebookRunStore.finish(claim, {
      status: "result",
      expected,
      artifact: { manifest, artifacts: [] },
    }),
  ).toBe(false);
  await sweepNotebookRuns({ deadlineAt: Date.now() + 60_000 });
  expect((await pending(projectId, threadId)).changes).toMatchObject([
    { status: "undone" },
  ]);
  expect((await snapshot(projectId)).cells).toMatchObject([
    { contents: { source: source(13099) } },
  ]);
  const [rerun] = undone.rerunIntentId
    ? await getDb()
        .select()
        .from(notebookProposalRunIntents)
        .where(eq(notebookProposalRunIntents.id, undone.rerunIntentId))
        .limit(1)
    : [];
  const namespaceId = rerun?.snapshot?.namespace.namespaceId;
  if (!namespaceId) throw new Error("Accepted rerun has no pinned snapshot");
  const outputPointer = async () => {
    const [pointer] = await getDb()
      .select()
      .from(notebookOutputs)
      .where(
        and(
          eq(notebookOutputs.namespaceId, namespaceId),
          eq(notebookOutputs.cellId, notebookCellIdSchema.parse(cellId)),
        ),
      )
      .limit(1);
    return pointer?.resultId;
  };
  await expect
    .poll(outputPointer, { timeout: 10_000 })
    .toEqual(expect.any(String));
  expect(
    await invoke("get-notebook-result-page", {
      resultId: await outputPointer(),
    }),
  ).toMatchObject({ status: "ready", rows: [[13099]] });
  expect(
    await invoke("get-notebook-result-page", {
      resultId: expected.resultId,
      threadId,
    }),
  ).toMatchObject({ status: "absent" });
  const status = getNotebookRunOutput.parse(
    await invoke("get-notebook-run", { runId: run.runId, threadId }),
  );
  expect(status).toMatchObject({
    status: "found",
    events: expect.arrayContaining([
      expect.objectContaining({
        event: {
          type: "attempt",
          receipt: {
            attempt: claim.attempt,
            state: { status: "failed", reason: "execution_failed" },
          },
        },
      }),
    ]),
  });
});

it("returns authorized repair prefill only for the failed attempt in the bound thread", async () => {
  const { projectId, cellId, threadId, otherThread } = await projectFixture();
  const call = await coreTools(threadId);
  const [baseline] = (await snapshot(projectId)).cells;
  if (!baseline) throw new Error("Missing SQL fixture");
  expect(
    await call("save-project-cell", {
      projectId,
      cellId,
      contents: {
        ...baseline.contents,
        source: "select nonexistent_column from orders limit 1",
      },
    }),
  ).toMatchObject({ threadId, proposalIds: [expect.any(String)] });
  await sweepNotebookRuns({ deadlineAt: Date.now() + 60_000 });
  const failedAttempt = async () => {
    const [query] = (await pending(projectId, threadId)).changes;
    if (!query?.runId) return null;
    const read = getNotebookRunOutput.parse(
      await invoke("get-notebook-run", { runId: query.runId, threadId }),
    );
    if (read.status !== "found") return null;
    return (
      read.run.attempts.find(({ state }) => state.status === "failed")?.attempt
        .attemptId ?? null
    );
  };
  await expect
    .poll(failedAttempt, { timeout: 10_000 })
    .toEqual(expect.any(String));
  const attemptId = await failedAttempt();
  if (!attemptId)
    throw new Error("Fixture SQL ran without the requested failure");
  const input = {
    projectId,
    cellId,
    threadId,
    attemptId,
  };
  expect(await invoke("get-notebook-repair-context", input)).toMatchObject({
    attemptId: input.attemptId,
    prompt: expect.stringMatching(
      /^Verify, fix, and give a concise explanation about the following error in @Baseline\n\n\S/,
    ),
  });
  await expect(
    invoke("get-notebook-repair-context", { ...input, threadId: otherThread }),
  ).rejects.toMatchObject({ errorCode: "repair_context_unavailable" });
  await expect(
    invoke("get-notebook-repair-context", { ...input, cellId: randomUUID() }),
  ).rejects.toMatchObject({ errorCode: "repair_context_unavailable" });
});
