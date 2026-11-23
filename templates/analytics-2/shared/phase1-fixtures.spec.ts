import { randomUUID } from "node:crypto";

import {
  actionCallIntent,
  preparedCallArguments,
} from "@agent-native/core/action";
import {
  actionsToEngineTools,
  hasSameOriginBrowserEvidence,
  loadActionsFromStaticRegistry,
} from "@agent-native/core/server";
import {
  request,
  type APIRequestContext,
  type Browser,
  type Page,
} from "@playwright/test";
import { H3 } from "h3";
import { expect, it, vi } from "vitest";
import { z } from "zod";

import createProject from "../actions/create-project.js";
import getProject from "../actions/get-project.js";
import saveProjectCell from "../actions/save-project-cell.js";
import {
  answerModelRequest,
  createModelState,
} from "../e2e/local/fake-model.js";
import { openProviderActionClient } from "../e2e/phase1/fixtures/provider-action.js";
import { entitlementControl } from "../e2e/phase1/fixtures/provider-entitlement.js";
import { createPhase1UploadStorage } from "../e2e/phase1/fixtures/upload-storage.js";
import { createWorkerControl } from "../e2e/phase1/fixtures/worker-control.js";
import { rejectStaleNotebookReview } from "../e2e/phase1/flows-11-15.js";
import {
  attestKernel,
  validateExpectedKernelDigest,
} from "../e2e/phase1/kernel-attestation.js";
import { FlowContext } from "../e2e/phase1/runtime.js";
import { Evidence } from "../e2e/phase1/verdict.js";
import { createWarehouseEntitlementProject } from "../e2e/phase1/warehouse-entitlement.js";
import { warehouseCellRunIntent } from "../e2e/phase1/warehouse-fixtures.js";
import { resolveConnectionPresentation } from "../server/model/data-connection-policy.js";
import { CONTRACT_VERSION } from "./kernel-contract.js";
import {
  executionSnapshotSchema,
  runRequestSchema,
} from "./notebook-execution.js";

it("binds the scripted Ask query to the warehouse from the SQL creation receipt", async () => {
  const connectionId = "wconn1:fixture-warehouse";
  const projectId = "ask-project";
  const cellId = "ask-query";
  const threadId = "ask-thread";
  const contents = {
    id: cellId,
    order: "a1",
    kind: "sql",
    label: null,
    hidden: false,
    gridX: null,
    gridY: null,
    gridWidth: null,
    gridHeight: null,
    source: "SELECT 'web' AS channel, 14042 AS orders",
    dataConnectionId: null,
    databaseSchema: null,
    connectionMode: "dataframes",
    resultVariable: "channel_orders",
    outputResult: true,
  };
  const actions = loadActionsFromStaticRegistry({
    "get-project": { default: getProject },
    "save-project-cell": { default: saveProjectCell },
  });
  const end = vi.fn<(response?: string) => void>();
  await answerModelRequest(
    {
      tools: actionsToEngineTools(actions).map((tool) => ({
        name: tool.name,
        description: tool.description,
        input_schema: tool.inputSchema,
      })),
      messages: [
        {
          role: "user",
          content: `Orders by channel for fixture 14 using warehouse ${connectionId}`,
        },
        {
          role: "user",
          content: [
            ["screen", { threadId }],
            ["summary", { binding: { projectId, threadId } }],
            [
              "sql",
              {
                createdCellId: cellId,
                project: { cells: [{ id: cellId, contents }] },
              },
            ],
          ].map(([step, value]) => ({
            type: "tool_result",
            tool_use_id: `toolu_phase1_${step}_test`,
            content: JSON.stringify(value),
          })),
        },
      ],
    },
    { writeHead: vi.fn(), write: vi.fn(), end },
    createModelState(),
  );
  const {
    content: [call],
  } = z
    .object({
      content: z.tuple([
        z.object({
          type: z.literal("tool_use"),
          name: z.literal("save-project-cell"),
          input: z.unknown(),
        }),
      ]),
    })
    .parse(JSON.parse(z.string().parse(end.mock.lastCall?.[0])));
  const action = actions[call.name];
  if (!action) throw new Error(`Missing registered action ${call.name}`);
  const intent = await actionCallIntent(action, call.input);
  if (!intent.valid) throw intent.error;
  const { connectionMode: _, ...warehouseContents } = contents;
  expect(preparedCallArguments(intent)).toEqual({
    projectId,
    cellId,
    contents: { ...warehouseContents, dataConnectionId: connectionId },
  });
});

it("labels only a verified loopback development kernel as dev-attested", async () => {
  const observed = {
    appBuildSha: "a".repeat(40),
    protocolVersion: CONTRACT_VERSION,
    builds: [{ sha: "development", digest: "development" }],
  };
  const action = vi
    .fn()
    .mockResolvedValueOnce(observed)
    .mockResolvedValueOnce({ ...observed, developmentAttested: true });
  const id = vi.fn();
  const flow = {
    action,
    id,
    expectedSha: observed.appBuildSha,
    baseUrl: "http://localhost:4400",
    expectedKernelDigest: "development",
    unavailable(message: string): never {
      throw new Error(message);
    },
  };
  expect(() =>
    validateExpectedKernelDigest(
      "development",
      new URL("https://analytics.example"),
    ),
  ).toThrow();
  await expect(attestKernel(flow)).rejects.toThrow();
  expect(id).not.toHaveBeenCalled();
  await attestKernel(flow);
  expect(id.mock.calls).toEqual([["kernelAttestation", "dev-attested"]]);
});

it("uses a dedicated warehouse group and only removes or restores the fixture colleague", async () => {
  const colleagueEmail = "colleague@local.test";
  const action = vi.fn(async (name: string, input: object) => {
    if (name === "save-data-connection") return { id: "warehouse-fixture" };
    return {
      id: "fixture-group",
      memberEmails: Reflect.get(input, "memberEmails"),
    };
  });
  const control = entitlementControl({
    action,
    credential: "synthetic",
    projectId: "fixture-project",
  });
  const fixture = z
    .object({
      fixtureId: z.uuid(),
      connectionId: z.literal("warehouse-fixture"),
    })
    .parse(
      await control({
        operation: "warehouse-create-entitlement",
        colleagueEmail,
      }),
    );
  const saved = z
    .object({ values: z.record(z.string(), z.unknown()) })
    .parse(action.mock.calls[1]?.[1]);
  expect(saved).toMatchObject({
    values: {
      queryAccessGroupIds: ["fixture-group"],
      viewAccessGroupIds: ["fixture-group"],
    },
  });
  expect(
    resolveConnectionPresentation(saved.values, null).effectiveAiUsage,
  ).toBe("included");
  await expect(
    control({
      operation: "warehouse-revoke-entitlement",
      fixtureId: randomUUID(),
    }),
  ).rejects.toThrow();
  await expect(
    control({
      operation: "warehouse-revoke-entitlement",
      fixtureId: fixture.fixtureId,
    }),
  ).resolves.toMatchObject({ entitled: false });
  await expect(
    control({
      operation: "warehouse-restore-entitlement",
      fixtureId: fixture.fixtureId,
    }),
  ).resolves.toMatchObject({ entitled: true });
  expect(action.mock.calls.slice(2)).toEqual([
    [
      "upsert-workspace-user-group",
      { id: "fixture-group", name: expect.any(String), memberEmails: [] },
    ],
    [
      "upsert-workspace-user-group",
      {
        id: "fixture-group",
        name: expect.any(String),
        memberEmails: [colleagueEmail],
      },
    ],
  ]);
});

it("stores and removes only encrypted fixture attachments on the loopback provider", async () => {
  const { provider, read } = createPhase1UploadStorage(4412);
  const input = {
    data: Buffer.from("encrypted fixture bytes"),
    filename: `phase1-ask-${randomUUID()}.csv`,
    mimeType: "application/octet-stream",
    recordAsset: false,
  };
  await expect(
    provider.upload({ ...input, mimeType: "text/csv" }),
  ).rejects.toThrow("Expected an encrypted Phase 1 fixture upload");
  const { url } = await provider.upload(input);
  const address = new URL(url);
  expect(address.origin).toBe("http://127.0.0.1:4412");
  expect(read(address.pathname)).toEqual(input.data);
  const remove = provider.delete;
  if (!remove) throw new Error("Missing fixture file deletion");
  await expect(remove({ url })).resolves.toBe(true);
  expect(read(address.pathname)).toBeUndefined();
});

function reply(response: Response) {
  return {
    headers: () => Object.fromEntries(response.headers),
    dispose: async () => {},
    json: () => response.json(),
    ok: () => response.ok,
    status: () => response.status,
  };
}

it("passes the production same-origin gate from the loopback fixture", async () => {
  const app = new H3().get("/_agent-native/ui-capability", (event) =>
    hasSameOriginBrowserEvidence(event)
      ? Response.json({ ok: true })
      : Response.json(
          { error: "Same-origin request required" },
          { status: 403 },
        ),
  );
  const post = vi.fn(async () =>
    reply(Response.json({ id: "warehouse-fixture" })),
  );
  const newContext = vi.spyOn(request, "newContext").mockImplementation(
    async (options) =>
      ({
        get: async (url: string) => {
          const parsed = new URL(url);
          parsed.protocol = "https:";
          return reply(
            await app.fetch(
              new Request(parsed, {
                headers: new Headers(options?.extraHTTPHeaders),
              }),
            ),
          );
        },
        post,
        dispose: async () => {},
      }) as unknown as APIRequestContext,
  );
  try {
    const provider = await openProviderActionClient(
      "http://localhost:4400",
      "owner-state.json",
    );
    await expect(
      provider.action("save-data-connection", { requestId: "save" }, true),
    ).resolves.toEqual({
      id: "warehouse-fixture",
    });
    expect(post).toHaveBeenCalledExactlyOnceWith(
      "http://localhost:4400/_agent-native/actions/save-data-connection",
      expect.objectContaining({ data: { requestId: "save" }, maxRedirects: 0 }),
    );
    await provider.dispose();
  } finally {
    newContext.mockRestore();
  }
});

it("mints the UI capability before checking table and stale-review rejections on production loopback", async () => {
  vi.stubEnv("NODE_ENV", "production");
  let minted = false;
  const app = new H3()
    .get("/_agent-native/ui-capability", (event) => {
      minted = hasSameOriginBrowserEvidence(event);
      return Response.json({}, { status: minted ? 200 : 403 });
    })
    .post("/_agent-native/actions/query-notebook-table", (event) =>
      minted && hasSameOriginBrowserEvidence(event)
        ? Response.json({ errorCode: "table_not_found" }, { status: 404 })
        : Response.json(
            { errorCode: "ui_capability_required" },
            { status: 403 },
          ),
    )
    .post("/_agent-native/actions/decide-notebook-pending-changes", (event) =>
      minted && hasSameOriginBrowserEvidence(event)
        ? Response.json({ errorCode: "overlay_conflict" }, { status: 409 })
        : Response.json(
            { errorCode: "ui_capability_required" },
            { status: 403 },
          ),
    );
  const newContext = vi.spyOn(request, "newContext").mockImplementation(
    async () =>
      ({
        get: async (
          url: string,
          options: { headers: Record<string, string> },
        ) =>
          reply(
            await app.fetch(new Request(url, { headers: options.headers })),
          ),
        fetch: async (url: string, options: RequestInit) =>
          reply(await app.fetch(new Request(url, options))),
        dispose: async () => {},
      }) as unknown as APIRequestContext,
  );
  try {
    const storageState = { cookies: [], origins: [] };
    const evidence = new Evidence();
    const flow = new FlowContext({
      browser: {} as Browser,
      page: {
        context: () => ({ storageState: async () => storageState }),
      } as unknown as Page,
      baseUrl: "http://localhost:4400",
      expectedSha: "a".repeat(40),
      evidenceDir: ".",
      flowId: "02-catalog-table-to-query",
      ownerInitialState: storageState,
      states: {},
      evidence,
    });
    await flow.rejectAction(
      "query-notebook-table",
      {},
      /table_not_found/,
      "owner",
      { uiOnly: true },
    );
    minted = false;
    await rejectStaleNotebookReview(flow, {
      projectId: "project",
      threadId: "thread",
      proposalId: "proposal",
      overlayRevision: "1",
      acceptedHead: { versionId: "version", revision: "1" },
    });
    expect(evidence.actions).toEqual([
      expect.objectContaining({
        name: "query-notebook-table",
        method: "POST",
        status: 404,
      }),
      expect.objectContaining({
        name: "decide-notebook-pending-changes",
        method: "POST",
        status: 409,
      }),
    ]);
    expect(evidence.steps).toEqual([
      expect.objectContaining({ status: "passed", proof: "rejecting" }),
      expect.objectContaining({ status: "passed", proof: "rejecting" }),
    ]);
  } finally {
    newContext.mockRestore();
    vi.unstubAllEnvs();
  }
});

it("creates a valid warehouse SQL starter for the revoked-source probe", async () => {
  const warehouse = {
    label: "Warehouse source",
    source: "select max(sentinel) as sentinel from fixture.sql_v2_04",
    dataConnectionId: "fixture-warehouse",
    resultVariable: "warehouse_source",
  };
  const action = vi.fn(async (_name: string, input: object) => {
    const intent = await actionCallIntent(createProject, input);
    if (!intent.valid) throw intent.error;
    expect(preparedCallArguments(intent)).toMatchObject({
      starter: { kind: "cells", cells: [{ kind: "sql", ...warehouse }] },
    });
    return { id: "project-qa" };
  });
  await expect(
    createWarehouseEntitlementProject({ action }, "SQL denial", [warehouse]),
  ).resolves.toBe("project-qa");
  expect(action).toHaveBeenCalledExactlyOnceWith(
    "create-project",
    expect.objectContaining({ title: "SQL denial" }),
  );
});

it("seeds a warehouse producer after a Dataframes consumer", async () => {
  const cells = [
    {
      dataConnectionId: "fixture-warehouse",
      source: "select 42 as n",
      resultVariable: "protected_values",
    },
    {
      dataConnectionId: null,
      source: "select n from protected_values",
      resultVariable: "read_protected",
    },
    {
      dataConnectionId: "fixture-warehouse",
      source: "select 84 as n",
      resultVariable: "partial_values",
    },
  ];
  const action = vi.fn(async (_name: string, input: object) => {
    const intent = await actionCallIntent(createProject, input);
    if (!intent.valid) throw intent.error;
    const prepared = preparedCallArguments(intent);
    expect(prepared).toMatchObject({
      starter: {
        kind: "cells",
        cells: [
          { kind: "sql", ...cells[0] },
          { kind: "sql", ...cells[1], connectionMode: "dataframes" },
          { kind: "sql", ...cells[2] },
        ],
      },
    });
    expect(prepared).not.toHaveProperty("starter.cells.2.connectionMode");
    return { id: "project-qa" };
  });
  await expect(
    createWarehouseEntitlementProject(
      { action },
      "Dataframe boundaries",
      cells,
    ),
  ).resolves.toBe("project-qa");
  expect(action).toHaveBeenCalledOnce();
});

it("builds accepted cell-only input for the late SQL replacement and revoked-source probes", () => {
  const snapshot = executionSnapshotSchema.parse({
    ref: {
      workspaceId: "workspace-qa",
      projectId: "project-qa",
      head: { versionId: "version-qa", revision: "9" },
      eventSeq: "10",
    },
    namespace: { kind: "draft", namespaceId: "namespace-qa" },
    inputRevision: "0",
    executionFingerprint: "accepted-sql",
  });
  for (const cache of ["reuse", "bypass"] as const) {
    const input = {
      requestId: randomUUID(),
      snapshot,
      targetCellId: "cell-qa",
      cache,
    };
    expect(runRequestSchema.parse(warehouseCellRunIntent(input))).toEqual({
      ...input,
      mode: "cell-only",
      staleValues: "reject",
    });
  }
});

it("holds one scoped draft attempt through promotion and releases its late output", async () => {
  const { control, draftBridge } = createWorkerControl();
  const scope = { projectId: "project", cellId: "cell" };
  const attempt = { ...scope, runId: "run", attemptId: "attempt" };
  const held = z.object({ holdId: z.uuid() }).parse(
    await control({
      operation: "draft-hold-query",
      ...scope,
      phase: "before-promotion",
    }),
  );
  expect(draftBridge.hold(attempt, "before-dispatch")).toBeUndefined();
  expect(
    draftBridge.hold({ ...attempt, projectId: "another" }, "before-promotion"),
  ).toBeUndefined();
  const pending = draftBridge.hold(attempt, "before-promotion");
  expect(pending).toBeInstanceOf(Promise);
  await expect(
    control({ operation: "draft-hold-status", ...scope, ...held }),
  ).resolves.toEqual({ status: "held", ...attempt });
  expect(
    draftBridge.hold({ ...attempt, attemptId: "winner" }, "before-promotion"),
  ).toBeUndefined();
  await expect(
    control({ operation: "draft-release-query", ...scope, ...held }),
  ).resolves.toEqual({ released: true });
  await expect(pending).resolves.toBeUndefined();
  expect(draftBridge.hold(attempt, "before-promotion")).toBeUndefined();
});

it("cancels a held draft dispatch and makes incomplete results one-shot and cell scoped", async () => {
  const { control, draftBridge } = createWorkerControl();
  const scope = { projectId: "project", cellId: "cell" };
  const held = z.object({ holdId: z.uuid() }).parse(
    await control({
      operation: "draft-hold-query",
      ...scope,
      phase: "before-dispatch",
    }),
  );
  const cancel = new AbortController();
  const pending = draftBridge.hold(
    { ...scope, runId: "run", attemptId: "attempt" },
    "before-dispatch",
    cancel.signal,
  );
  expect(pending).toBeInstanceOf(Promise);
  cancel.abort();
  await expect(pending).rejects.toMatchObject({ name: "AbortError" });
  await expect(
    control({ operation: "draft-reset-query", ...scope, ...held }),
  ).resolves.toEqual({ released: true });
  await expect(
    control({ operation: "draft-incomplete-result", ...scope }),
  ).resolves.toEqual({ armed: true });
  expect(draftBridge.takeIncomplete({ ...scope, cellId: "other" })).toBe(false);
  expect(draftBridge.takeIncomplete(scope)).toBe(true);
  expect(draftBridge.takeIncomplete(scope)).toBe(false);
});

it("delays the real worker query boundary, settles through the registered scheduler and scopes the fault and mail", async () => {
  const { control, bridge } = createWorkerControl();
  const runs = vi.fn(async () => ({ status: "success" as const }));
  bridge.registerScheduler({
    buildSha: "candidate",
    sweep: runs,
    settled: async () => true,
  });
  const projectId = "fixture-project";
  const at = "2026-11-18T07:59:00Z";
  await expect(
    control({ operation: "schedule-clock", projectId, at }),
  ).resolves.toEqual({
    at,
    workerBuildSha: "candidate",
    runner: "analytics2-published-app-schedules",
  });
  expect(bridge.now(projectId)?.toISOString()).toBe("2026-11-18T07:59:00.000Z");
  expect(bridge.now("other-project")).toBeUndefined();
  const first = {
    projectId,
    scheduleId: randomUUID(),
    dueAt: "2026-11-18T08:00:00Z",
  };
  const { holdId } = z.object({ holdId: z.uuid() }).parse(
    await control({
      operation: "schedule-hold-query",
      ...first,
      result: 15042,
    }),
  );
  const completed = vi.fn();
  const query = bridge
    .query(
      { ...first, dueAt: "2026-11-18T08:00:00.000Z" },
      "select 15040 as result",
    )
    .then(completed);
  await control({ operation: "schedule-sweep", ...first });
  await control({ operation: "schedule-sweep", ...first });
  expect(completed).not.toHaveBeenCalled();
  await control({
    operation: "schedule-release-query",
    projectId,
    scheduleId: first.scheduleId,
    holdId,
  });
  await query;
  expect(completed).toHaveBeenCalledExactlyOnceWith("select 15042 as result");
  const second = { ...first, dueAt: "2026-11-19T08:00:00Z" };
  await control({
    operation: "schedule-fail-query",
    ...second,
    code: "fixture_schedule_15_fault",
  });
  await expect(bridge.query(second, "select 15084 as result")).rejects.toThrow(
    "fixture_schedule_15_fault",
  );
  await expect(
    bridge.query(
      { ...second, projectId: "other-project" },
      "select 15084 as result",
    ),
  ).resolves.toBe("select 15084 as result");
  await control({ operation: "schedule-sweep", ...second });
  expect(runs).toHaveBeenCalledTimes(4);
  const mail = {
    to: "colleague@local.test",
    subject: "Scheduled",
    html: "",
    idempotencyKey: "delivery",
  };
  await expect(bridge.deliver(projectId, mail)).resolves.toMatchObject({
    status: "sent",
  });
  await expect(
    bridge.deliver(projectId, { ...mail, to: "somebody@example.com" }),
  ).rejects.toThrow();
  await control({
    operation: "schedule-reset",
    projectId,
    scheduleId: first.scheduleId,
    holdId,
  });
  await control({ operation: "schedule-reset-clock", projectId });
  expect(bridge.now(projectId)).toBeUndefined();
});
