import { beforeEach, describe, expect, it, vi } from "vitest";

const builder = vi.hoisted(() => ({
  startAgent: vi.fn(),
  getStatus: vi.fn(),
}));

vi.mock("@agent-native/core/server", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  runBuilderAgent: builder.startAgent,
  getBuilderBranchStatus: builder.getStatus,
}));
vi.mock("./factory-store.js", () => ({
  getWorkflowStore: () => {
    throw new Error("the production store must not be read in this spec");
  },
}));
vi.mock("../db/index.js", () => ({
  getDb: () => {
    throw new Error("the production database must not be read in this spec");
  },
}));

import { BuilderBranchError } from "@agent-native/core/server";

import type { OperationResult } from "../workflow/adapter.js";
import { OPERATION_CATALOG } from "../workflow/catalog/index.js";
import { workflowSettingsSchema } from "../workflow/contract.js";
import { FakeClock } from "../workflow/testing/fakes.js";
import { createInMemoryWorkflowStore } from "../workflow/testing/in-memory-store.js";
import { createFactoryWorkflowHost } from "./create-host.js";

const T0 = "2026-10-19T12:00:00.000Z";

/** The one row of the inbox this spec's fake database holds, as the poller stored it. */
const storedReport = {
  id: "r1",
  source: "slack",
  externalId: "C1:1760000000.000100",
  sourceUrl: "https://slack.example.test/archives/C1/p1760000000000100",
  title: "Slack user Sam",
  summary: "The export button downloads an empty file.",
  status: "received",
  risk: "unknown",
  confidence: "unknown",
  channelId: "C1",
  threadTs: "1760000000.000100",
  repository: null,
  pullRequestNumber: null,
  headSha: null,
  coverage: "complete",
  dedupeKey: "r1",
  metadataJson: JSON.stringify({
    messageTs: "1760000000.000100",
    headline: "The export button downloads an empty file",
  }),
  payloadJson: "{}",
  textRef: null,
  lastSeenAt: null,
  createdAt: "2026-10-19T11:00:00.000Z",
  updatedAt: "2026-10-19T11:00:00.000Z",
  ownerEmail: "creator@example.test",
  orgId: "org-1",
  factoryId: "support-triage",
};

/** Just the query the report reader makes: select, from, where. */
const fakeDatabase = {
  select: () => ({ from: () => ({ where: async () => [storedReport] }) }),
};

/** Passes the Builder dispatch gate: a clear, low-risk, high-confidence bug nobody claimed. */
const startFields = {
  branchName: "factory-g1",
  prompt: "Fix it",
  reports: [{ id: "r1" }],
  clearBug: true,
  productUxImplications: false,
  risk: "low",
  confidence: "high",
  alreadyClaimed: false,
  categories: [],
};

function startBuilder(
  settings: Record<string, unknown>,
  fields: Record<string, unknown>,
): Promise<OperationResult> {
  const clock = new FakeClock(T0);
  const signal = new AbortController().signal;
  const host = createFactoryWorkflowHost({
    scope: { orgId: "org-1", factoryId: "support-triage" },
    ownerEmail: "creator@example.test",
    workflow: { id: "wf-1" },
    automation: { triggerId: "resource-1", triggerName: "factories/x/wf-1" },
    runId: "history-1",
    mode: "live",
    signal,
    deadlineAt: Date.parse(T0) + 60_000,
    settings: workflowSettingsSchema.parse(settings),
    deps: {
      store: createInMemoryWorkflowStore({ clock: () => clock.now() }),
      clock,
      getDatabase: () => fakeDatabase as never,
      actions: async () => ({}),
      ai: {} as never,
      threads: {} as never,
      tripwire: () => undefined,
    },
  });
  const operation = OPERATION_CATALOG.get("builder.start");
  if (!operation) throw new Error("builder.start is not in the catalog");
  return host.operations.execute({
    operation,
    fields: { ...startFields, ...fields },
    credentialSlot: operation.credential.provider,
    mode: "live",
    signal,
    receiptKey: "wf-1:item-1:start:1",
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  builder.getStatus.mockRejectedValue(
    new BuilderBranchError("branch_not_found", "status", "none"),
  );
  builder.startAgent.mockImplementation(
    async (args: { projectId: string; branchName: string }) => ({
      ...args,
      url: "https://builder.io/app/x",
      status: "processing",
    }),
  );
});

describe("a Builder start in a workflow with a builderProjectId setting", () => {
  it("starts in the workflow's project when the node names none", async () => {
    const result = await startBuilder(
      { builderProjectId: "workflow-project" },
      {},
    );

    expect(result).toMatchObject({ ok: true, externalRef: "factory-g1" });
    expect(builder.startAgent).toHaveBeenCalledWith(
      expect.objectContaining({ projectId: "workflow-project" }),
    );
  });

  it("sends the instruction and then the stored report, read from the host's own inbox", async () => {
    await startBuilder({ builderProjectId: "workflow-project" }, {});

    const [sent] = builder.startAgent.mock.calls[0] ?? [];
    expect(sent.prompt.startsWith("Fix it")).toBe(true);
    // The row's title is who wrote it; the headline the poll recorded names the report.
    expect(sent.prompt).toContain(
      "Report 1 of 1: The export button downloads an empty file",
    );
    expect(sent.prompt).toContain("From: Slack user Sam");
    expect(sent.prompt).toContain(
      "> The export button downloads an empty file.",
    );
    expect(sent.prompt).toContain(storedReport.sourceUrl);
  });

  it("keeps the project the node names over the workflow's", async () => {
    await startBuilder(
      { builderProjectId: "workflow-project" },
      { projectId: "node-project" },
    );

    expect(builder.startAgent).toHaveBeenCalledWith(
      expect.objectContaining({ projectId: "node-project" }),
    );
  });

  it("fails with a typed error, and starts nothing, when neither names a project", async () => {
    const result = await startBuilder({}, { projectId: "  " });

    expect(result).toMatchObject({
      ok: false,
      code: "credential_missing",
      sideEffect: "none",
      retryable: false,
    });
    expect((result as { message: string }).message).toContain(
      "builder_project_missing",
    );
    expect(builder.startAgent).not.toHaveBeenCalled();
  });
});
