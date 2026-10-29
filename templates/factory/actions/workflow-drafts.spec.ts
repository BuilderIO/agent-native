import { beforeEach, describe, expect, it, vi } from "vitest";

const member = vi.hoisted(() => ({ email: "teammate@example.test" }));

vi.mock("../server/lib/factory-workflow-connections.js", () => ({
  readProviderConnections: vi.fn(async () => []),
}));
vi.mock("@agent-native/core/action", async () => {
  const kit =
    await import("../server/workflow-host/testing/workflow-actions-kit.js");
  return kit.actionModule;
});
vi.mock("@agent-native/core/resources", async () => {
  const kit =
    await import("../server/workflow-host/testing/workflow-actions-kit.js");
  return kit.resourcesModule;
});
vi.mock("@agent-native/core/jobs", async (importActual) => {
  const kit =
    await import("../server/workflow-host/testing/workflow-actions-kit.js");
  return kit.jobsModule(await importActual<Record<string, unknown>>());
});
vi.mock("../server/workflow-host/factory-store.js", async () => {
  const kit =
    await import("../server/workflow-host/testing/workflow-actions-kit.js");
  return kit.workflowStoreModule;
});
vi.mock("../server/lib/require-workspace-member.js", async () => {
  const kit =
    await import("../server/workflow-host/testing/workflow-actions-kit.js");
  return {
    requireWorkspaceMember: async () => ({
      userEmail: member.email,
      orgId: kit.ORG_ID,
      role: "member",
    }),
    workspaceMemberIdentityFromContext: () => ({
      userEmail: member.email,
      orgId: kit.ORG_ID,
    }),
  };
});
vi.mock("../server/lib/factory-definitions.js", async () => {
  const kit =
    await import("../server/workflow-host/testing/workflow-actions-kit.js");
  return kit.factoryDefinitionsModule;
});

import * as kit from "../server/workflow-host/testing/workflow-actions-kit.js";
import {
  WORKFLOW_STORE_LIMITS,
  WorkflowStoreError,
} from "../server/workflow/adapter.js";
import remove from "./delete-factory-workflow.js";
import discard from "./discard-factory-workflow-draft.js";
import getDraft from "./get-factory-workflow-draft.js";
import get from "./get-factory-workflow.js";
import saveDraft from "./save-factory-workflow-draft.js";
import save from "./save-factory-workflow.js";

const runSave = kit.runOf(save);
const runSaveDraft = kit.runOf(saveDraft);
const runGetDraft = kit.runOf(getDraft);
const runDiscard = kit.runOf(discard);
const runGet = kit.runOf(get);
const runRemove = kit.runOf(remove);
const scope = { orgId: kit.ORG_ID, factoryId: kit.FACTORY_ID };

const SECOND_MEMBER = "second@example.test";

// A graph that parses as an object but would be refused by a real save: its
// only node is an End that nothing leads to, beside a Trigger with a loose exit.
const graphWithProblems = (revision = 1) =>
  JSON.stringify({
    nodes: [
      {
        id: "start",
        name: "start",
        kind: "trigger",
        position: { x: 0, y: 0 },
        settings: { schedule: { every: "15m" } },
      },
    ],
    edges: [],
    settings: { extras: { revision } },
  });

async function create() {
  return runSave(
    { factoryId: kit.FACTORY_ID, name: "Digest", graph: kit.simpleGraph() },
    kit.context,
  );
}

const draftOf = (
  workflowId: string,
  graph = graphWithProblems(),
  baseVersion = 1,
) =>
  runSaveDraft(
    { factoryId: kit.FACTORY_ID, workflowId, baseVersion, graph },
    kit.context,
  );
const readDraft = (workflowId: string) =>
  runGetDraft({ factoryId: kit.FACTORY_ID, workflowId }, kit.context);
const hasDraft = async (workflowId: string) =>
  (await runGet({ factoryId: kit.FACTORY_ID, workflowId }, kit.context))
    .hasDraft;
const saveVersion = (
  workflowId: string,
  expectedVersion: number,
  graph: unknown,
  context: unknown = kit.context,
) =>
  runSave(
    { factoryId: kit.FACTORY_ID, workflowId, expectedVersion, graph },
    context,
  );

beforeEach(() => {
  kit.reset();
  member.email = kit.USER_EMAIL;
});

describe("save-factory-workflow-draft and get-factory-workflow-draft", () => {
  it("keeps a graph with problems as written and reads it back", async () => {
    const created = await create();
    const text = graphWithProblems();

    const saved = await draftOf(created.workflowId, text);

    expect(saved).toEqual({ updatedAt: expect.any(String) });
    expect(await readDraft(created.workflowId)).toEqual({
      draft: { baseVersion: 1, graph: text, updatedAt: saved.updatedAt },
    });
  });

  it("answers null when there is no draft, and replaces the last one on a second save", async () => {
    const created = await create();
    expect(await readDraft(created.workflowId)).toEqual({ draft: null });

    await draftOf(created.workflowId, graphWithProblems(1), 1);
    await draftOf(created.workflowId, graphWithProblems(2), 4);

    expect(await readDraft(created.workflowId)).toMatchObject({
      draft: { baseVersion: 4, graph: graphWithProblems(2) },
    });
  });

  it("keeps a second member's draft apart, and shows each member only their own", async () => {
    const created = await create();
    await draftOf(created.workflowId, graphWithProblems(1));

    member.email = SECOND_MEMBER;
    expect(await readDraft(created.workflowId)).toEqual({ draft: null });
    await draftOf(created.workflowId, graphWithProblems(2));
    expect(await readDraft(created.workflowId)).toMatchObject({
      draft: { graph: graphWithProblems(2) },
    });

    member.email = kit.USER_EMAIL;
    expect(await readDraft(created.workflowId)).toMatchObject({
      draft: { graph: graphWithProblems(1) },
    });
  });

  it("refuses text that cannot be a graph as draft_malformed, and keeps the draft it had", async () => {
    const created = await create();
    await draftOf(created.workflowId, graphWithProblems(1));
    const oversize = JSON.stringify({
      nodes: [{ text: "x".repeat(WORKFLOW_STORE_LIMITS.graphJsonBytes) }],
      edges: [],
    });

    for (const graph of [
      "{not json",
      "[]",
      "null",
      JSON.stringify({ nodes: [] }),
      JSON.stringify({ nodes: "none", edges: [] }),
      oversize,
    ]) {
      const failure = await kit.failureOf(() =>
        draftOf(created.workflowId, graph),
      );
      expect(failure).toMatchObject({
        errorCode: "draft_malformed",
        statusCode: 422,
      });
    }
    expect(await readDraft(created.workflowId)).toMatchObject({
      draft: { graph: graphWithProblems(1) },
    });
  });

  it("fails with workflow_not_found for a workflow that is not in the factory", async () => {
    const failure = await kit.failureOf(() => draftOf("wf-missing"));
    expect(failure.errorCode).toBe("workflow_not_found");
  });

  it("fails with draft_unreadable when the stored draft no longer reads, never null", async () => {
    const created = await create();
    await draftOf(created.workflowId);
    vi.spyOn(kit.currentStore(), "getWorkflowDraft").mockRejectedValueOnce(
      new WorkflowStoreError("corrupt_record", "no longer a graph"),
    );

    const failure = await kit.failureOf(() => readDraft(created.workflowId));

    expect(failure).toMatchObject({
      errorCode: "draft_unreadable",
      statusCode: 422,
      details: { workflowId: created.workflowId },
    });
  });

  it("does not hide a store failure that is not a corrupt draft as draft_unreadable", async () => {
    const created = await create();
    vi.spyOn(kit.currentStore(), "getWorkflowDraft").mockRejectedValueOnce(
      new Error("connection reset"),
    );

    const failure = await kit.failureOf(() => readDraft(created.workflowId));

    expect(failure.message).toBe("connection reset");
    expect(failure.errorCode).toBeUndefined();
  });
});

describe("discard-factory-workflow-draft", () => {
  it("deletes the caller's draft only, and says false when there was none", async () => {
    const created = await create();
    await draftOf(created.workflowId);
    member.email = SECOND_MEMBER;
    await draftOf(created.workflowId);

    const discardNow = () =>
      runDiscard(
        { factoryId: kit.FACTORY_ID, workflowId: created.workflowId },
        kit.context,
      );
    expect(await discardNow()).toEqual({ discarded: true });
    expect(await discardNow()).toEqual({ discarded: false });
    expect(await readDraft(created.workflowId)).toEqual({ draft: null });

    member.email = kit.USER_EMAIL;
    expect(await readDraft(created.workflowId)).toMatchObject({
      draft: { baseVersion: 1 },
    });
  });
});

describe("save-factory-workflow with a draft", () => {
  it("deletes the saver's own draft when the save lands, and no one else's", async () => {
    const created = await create();
    await draftOf(created.workflowId);
    member.email = SECOND_MEMBER;
    await draftOf(created.workflowId);
    member.email = kit.USER_EMAIL;

    await saveVersion(
      created.workflowId,
      1,
      kit.simpleGraph({ schedule: { every: "30m" } }),
    );

    expect(await readDraft(created.workflowId)).toEqual({ draft: null });
    member.email = SECOND_MEMBER;
    expect(await hasDraft(created.workflowId)).toBe(true);
  });

  it("keeps the draft when the save is refused as graph_invalid or version_conflict", async () => {
    const created = await create();
    await draftOf(created.workflowId);

    const invalid = await kit.failureOf(() =>
      saveVersion(created.workflowId, 1, JSON.parse(graphWithProblems())),
    );
    expect(invalid.errorCode).toBe("graph_invalid");
    const stale = await kit.failureOf(() =>
      saveVersion(created.workflowId, 9, kit.simpleGraph()),
    );
    expect(stale.errorCode).toBe("version_conflict");

    expect(await hasDraft(created.workflowId)).toBe(true);
  });

  it("keeps the person's draft when the agent saves a version", async () => {
    const created = await create();
    await draftOf(created.workflowId);

    await saveVersion(
      created.workflowId,
      1,
      kit.simpleGraph({ schedule: { every: "30m" } }),
      kit.agentContext,
    );

    expect(await hasDraft(created.workflowId)).toBe(true);
    expect(await readDraft(created.workflowId)).toMatchObject({
      draft: { baseVersion: 1 },
    });
  });
});

describe("delete-factory-workflow with drafts", () => {
  it("removes every member's draft with the workflow", async () => {
    const created = await create();
    await draftOf(created.workflowId);
    member.email = SECOND_MEMBER;
    await draftOf(created.workflowId);

    await runRemove(
      {
        factoryId: kit.FACTORY_ID,
        workflowId: created.workflowId,
        force: false,
      },
      kit.context,
    );

    const store = kit.currentStore();
    for (const email of [kit.USER_EMAIL, SECOND_MEMBER]) {
      expect(
        await store.hasWorkflowDraft(scope, created.workflowId, email),
      ).toBe(false);
    }
  });
});

describe("get-factory-workflow hasDraft", () => {
  it("is true only for the caller who has a draft", async () => {
    const created = await create();
    expect(await hasDraft(created.workflowId)).toBe(false);

    await draftOf(created.workflowId);
    expect(await hasDraft(created.workflowId)).toBe(true);

    member.email = SECOND_MEMBER;
    expect(await hasDraft(created.workflowId)).toBe(false);
  });

  it("is false again once the draft is discarded", async () => {
    const created = await create();
    await draftOf(created.workflowId);
    expect(await hasDraft(created.workflowId)).toBe(true);

    await runDiscard(
      { factoryId: kit.FACTORY_ID, workflowId: created.workflowId },
      kit.context,
    );
    expect(await hasDraft(created.workflowId)).toBe(false);
  });
});
