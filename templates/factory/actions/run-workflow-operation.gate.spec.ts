import { beforeEach, describe, expect, it, vi } from "vitest";

const findDefinitionMock = vi.hoisted(() => vi.fn());
const executeRequestMock = vi.hoisted(() => vi.fn());
const storeHolder = vi.hoisted(() => ({ store: undefined as unknown }));

vi.mock("@agent-native/core/action", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@agent-native/core/action")>()),
  defineAction: (definition: unknown) => definition,
}));
vi.mock("../server/lib/factory-automation-resources.js", () => ({
  findFactoryAutomationDefinition: findDefinitionMock,
  factoryIdFromAutomationName: (name: string) =>
    name.match(/^factories\/([^/]+)\//)?.[1] ?? null,
}));
vi.mock("../server/db/index.js", () => ({
  getDb: () => ({
    select: () => ({
      from: () => ({
        where: () => ({ limit: async () => [{ id: "support-triage" }] }),
      }),
    }),
  }),
}));
vi.mock("../server/workflow-host/factory-store.js", () => ({
  getWorkflowStore: () => storeHolder.store,
}));
vi.mock("../server/lib/require-workspace-member.js", () => ({
  requireWorkspaceMember: async () => ({
    userEmail: "teammate@example.test",
    orgId: "org-1",
    role: "member",
  }),
  workspaceMemberIdentityFromContext: () => ({
    userEmail: "teammate@example.test",
    orgId: "org-1",
  }),
}));
vi.mock("../server/lib/provider-api.js", () => ({
  FACTORY_APP_ID: "factory",
  executeProviderApiRequest: executeRequestMock,
}));

import { buildGraph } from "../server/workflow/story-graphs.fixture.js";
import { createInMemoryWorkflowStore } from "../server/workflow/testing/in-memory-store.js";
import action from "./run-workflow-operation.js";

const factoryId = "support-triage";
const automationId = "resource-workflow";
const jobName = `factories/${factoryId}/support-flow`;

const run = (
  input: Record<string, unknown>,
  context: Record<string, unknown> = {},
) =>
  (
    action as unknown as {
      run: (i: unknown, c: unknown) => Promise<Record<string, any>>;
    }
  ).run(
    { fields: {}, ...input },
    {
      caller: "automation",
      actionName: "run-workflow-operation",
      automation: { triggerId: automationId, triggerName: jobName },
      ...context,
    },
  );

function workflowJob(frontmatter = "domain: factory\nrunner: workflow") {
  return {
    name: jobName,
    body: "Run the workflow.",
    resource: {
      id: automationId,
      path: `jobs/${jobName}.md`,
      content: `---\n${frontmatter}\n---\n`,
    },
    meta: {
      domain: "factory",
      orgId: "org-1",
      runAs: "creator" as const,
      createdBy: "teammate@example.test",
    },
  };
}

async function saveGraph(graph: unknown) {
  const store = createInMemoryWorkflowStore();
  storeHolder.store = store;
  await store.createWorkflow(
    { orgId: "org-1", factoryId },
    {
      name: "Support flow",
      ownerEmail: "teammate@example.test",
      automationId,
      graph: graph as never,
    },
  );
}

const graphNaming = buildGraph({
  nodes: [
    ["every5", "trigger", { schedule: { every: "5m" } }],
    [
      "leads",
      "source",
      {
        source: "provider-query",
        operation: "hubspot.newLeads",
        args: {},
        memory: "inbox",
        maxItems: 50,
      },
    ],
    [
      "note",
      "action",
      {
        operation: "pylon.addNote",
        args: {
          ticketId: { mode: "fixed", value: "t1" },
          bodyHtml: { mode: "fixed", value: "<p>hi</p>" },
        },
      },
    ],
    ["done", "end", { outcome: "done" }],
  ],
  edges: [
    ["every5", "out", "leads"],
    ["leads", "out", "note"],
    ["note", "out", "done"],
  ],
});

const ok = (json: unknown) => ({
  request: { method: "POST", path: "/ok" },
  response: { status: 200, ok: true, truncated: false, size: 10, json },
});

beforeEach(async () => {
  vi.clearAllMocks();
  findDefinitionMock.mockResolvedValue(workflowJob());
  await saveGraph(graphNaming);
  executeRequestMock.mockResolvedValue(ok({ results: [] }));
});

describe("run-workflow-operation behind the real gate", () => {
  it("runs an operation the saved graph names", async () => {
    const result = await run({ operationId: "hubspot.newLeads" });
    expect(result).toMatchObject({ ok: true, items: [] });
    expect(executeRequestMock).toHaveBeenCalledTimes(1);
  });

  it("runs a write the saved graph names", async () => {
    executeRequestMock.mockResolvedValue(ok({ data: { id: "note-1" } }));
    const result = await run({
      operationId: "pylon.addNote",
      fields: { ticketId: "t1", bodyHtml: "<p>hi</p>" },
    });
    expect(result).toMatchObject({ ok: true, externalRef: "note-1" });
  });

  it.each(["stripe.newSubscriptions", "pylon.reply", "jira.createIssue"])(
    "refuses %s, which the saved graph does not name, and calls no provider",
    async (operationId) => {
      await expect(
        run({
          operationId,
          fields: { ticketId: "t1", bodyHtml: "x", messageId: "m1" },
        }),
      ).rejects.toMatchObject({ errorCode: "workflow_action_not_allowed" });
      expect(executeRequestMock).not.toHaveBeenCalled();
    },
  );

  it("refuses an operation the catalog no longer knows", async () => {
    await expect(run({ operationId: "nope.missing" })).rejects.toMatchObject({
      errorCode: "workflow_action_not_allowed",
    });
    expect(executeRequestMock).not.toHaveBeenCalled();
  });

  it("follows the saved graph: a later save that drops the operation closes it", async () => {
    await saveGraph(
      buildGraph({
        nodes: [
          ["every5", "trigger", { schedule: { every: "5m" } }],
          ["done", "end", { outcome: "done" }],
        ],
        edges: [["every5", "out", "done"]],
      }),
    );
    await expect(
      run({ operationId: "hubspot.newLeads" }),
    ).rejects.toMatchObject({ errorCode: "workflow_action_not_allowed" });
    expect(executeRequestMock).not.toHaveBeenCalled();
  });

  it("refuses a caller that is not an automation", async () => {
    await expect(
      run({ operationId: "hubspot.newLeads" }, { caller: "tool" }),
    ).rejects.toThrow("only available to Factory automations");
    expect(executeRequestMock).not.toHaveBeenCalled();
  });

  it("refuses a legacy job: only a workflow's saved graph grants this action", async () => {
    findDefinitionMock.mockResolvedValue(
      workflowJob("domain: factory\nsource: slack"),
    );
    await expect(
      run({ operationId: "hubspot.newLeads" }),
    ).rejects.toBeDefined();
    expect(executeRequestMock).not.toHaveBeenCalled();
  });

  it("fails loudly when the saved graph cannot be read, instead of refusing quietly", async () => {
    storeHolder.store = createInMemoryWorkflowStore();
    await expect(
      run({ operationId: "hubspot.newLeads" }),
    ).rejects.toMatchObject({ errorCode: "workflow_not_found" });
    expect(executeRequestMock).not.toHaveBeenCalled();
  });
});
