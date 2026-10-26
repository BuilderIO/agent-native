import { describe, expect, it } from "vitest";

import { sanitizeDetails } from "../tripwire/redact.js";
import { createCapturingTripwireSink } from "../tripwire/testing.js";
import { WorkflowStoreError } from "../workflow/adapter.js";
import { OPERATION_CATALOG } from "../workflow/catalog/index.js";
import type { WorkflowGraph } from "../workflow/contract.js";
import {
  STORY_GRAPHS,
  buildGraph,
  type NodeSpec,
} from "../workflow/story-graphs.fixture.js";
import { createInMemoryWorkflowStore } from "../workflow/testing/in-memory-store.js";
import {
  RUN_WORKFLOW_OPERATION_ACTION,
  actionsNamedByGraph,
  graphNamesAction,
} from "./operation-gate.js";

const scope = { orgId: "org-1", factoryId: "factory-1" };
const trigger: NodeSpec = ["every5", "trigger", { schedule: { every: "5m" } }];
const done: NodeSpec = ["done", "end", { outcome: "done" }];

function graphWith(...middle: NodeSpec[]) {
  return buildGraph({
    nodes: [trigger, ...middle, done],
    edges: [["every5", "out", "done"]],
  });
}

async function storeWith(graph: WorkflowGraph, automationId = "job-1") {
  const store = createInMemoryWorkflowStore();
  await store.createWorkflow(scope, {
    name: "Test",
    ownerEmail: "owner@example.test",
    automationId,
    graph,
  });
  return store;
}

const input = (actionName: string | undefined, operationId?: string) => ({
  ...scope,
  automationId: "job-1",
  actionName,
  operationId,
});

describe("actionsNamedByGraph", () => {
  it("names the action of each operation a node uses, resolved from the code catalog", () => {
    const { actions } = actionsNamedByGraph(STORY_GRAPHS["builder-to-merge"]);

    expect(actions).toEqual(
      new Set([
        "list-factory-items",
        "get-factory-pull-request",
        "get-factory-merge-gate",
        "merge-factory-pull-request",
        "post-slack-message",
      ]),
    );
  });

  it("names nothing for an operation id the catalog does not know", () => {
    const graph = graphWith([
      "send",
      "action",
      { operation: "slack.deleteWorkspace", args: {} },
    ]);

    expect(actionsNamedByGraph(graph).actions.size).toBe(0);
  });

  it("names the pollers an inbox source reads and list-factory-items for a status source", () => {
    const inbox = graphWith([
      "src",
      "source",
      { source: "inbox-poll", poller: "slack", takeLimit: 3 },
    ]);
    const status = graphWith([
      "src",
      "source",
      { source: "status", status: "automation_started", takeLimit: 10 },
    ]);

    expect(actionsNamedByGraph(inbox).actions).toEqual(
      new Set(["poll-slack-channel", "list-triage-items"]),
    );
    expect(actionsNamedByGraph(status).actions).toEqual(
      new Set(["list-factory-items"]),
    );
  });

  it("lets a reply Wait read its thread, and no other Wait", () => {
    const wait = (settings: Record<string, unknown>) =>
      actionsNamedByGraph(graphWith(["hold", "wait", settings])).actions;

    expect(wait({ wait: "reply", limitHours: 24 })).toEqual(
      new Set(["read-slack-thread"]),
    );
    expect(
      wait({ wait: "time", duration: { amount: 1, unit: "hours" } }).size,
    ).toBe(0);
  });

  it("sends provider-request operations through the wrapper action by operation id", () => {
    const graph = graphWith([
      "lookupPr",
      "lookup",
      {
        operation: "github.readFile",
        args: {
          repo: { mode: "fixed", value: "acme/app" },
          path: { mode: "fixed", value: "README.md" },
        },
      },
    ]);

    const access = actionsNamedByGraph(graph);

    expect(access.actions).toEqual(new Set([RUN_WORKFLOW_OPERATION_ACTION]));
    expect(access.providerOperations).toEqual(new Set(["github.readFile"]));
  });

  it("lets an AI node's tools read but never write", () => {
    const graph = graphWith([
      "think",
      "ai",
      {
        instruction: "Decide.",
        result: { ok: { type: "boolean" } },
        mode: "perItem",
        tools: ["github.readFile", "slack.postMessage"],
      },
    ]);

    const access = actionsNamedByGraph(graph);

    expect(access.providerOperations).toEqual(new Set(["github.readFile"]));
    expect(access.actions.has("post-slack-message")).toBe(false);
  });
});

describe("graphNamesAction", () => {
  const story = STORY_GRAPHS["builder-to-merge"];

  it("allows an action the saved graph names", async () => {
    const store = await storeWith(story);

    await expect(
      graphNamesAction(input("merge-factory-pull-request"), { store }),
    ).resolves.toBe(true);
  });

  it("refuses an action no node names", async () => {
    const store = await storeWith(STORY_GRAPHS["morning-digest"]);

    await expect(
      graphNamesAction(input("merge-factory-pull-request"), { store }),
    ).resolves.toBe(false);
    await expect(
      graphNamesAction(input("govern-factory-pull-request"), { store }),
    ).resolves.toBe(false);
  });

  it("refuses a call with no action name", async () => {
    const store = await storeWith(story);

    await expect(graphNamesAction(input(undefined), { store })).resolves.toBe(
      false,
    );
  });

  it("allows the wrapper action only for an operation the graph names", async () => {
    const store = await storeWith(
      graphWith([
        "lookupFile",
        "lookup",
        {
          operation: "github.readFile",
          args: {
            repo: { mode: "fixed", value: "acme/app" },
            path: { mode: "fixed", value: "README.md" },
          },
        },
      ]),
    );

    await expect(
      graphNamesAction(
        input(RUN_WORKFLOW_OPERATION_ACTION, "github.readFile"),
        { store },
      ),
    ).resolves.toBe(true);
    await expect(
      graphNamesAction(
        input(RUN_WORKFLOW_OPERATION_ACTION, "github.searchCode"),
        { store },
      ),
    ).resolves.toBe(false);
    await expect(
      graphNamesAction(input(RUN_WORKFLOW_OPERATION_ACTION), { store }),
    ).resolves.toBe(false);
  });

  it("reads the current version, so a save that drops the node withdraws the action", async () => {
    const store = await storeWith(story);
    const record = await store.getWorkflowByAutomation(scope, "job-1");
    await store.saveWorkflowGraph(scope, {
      workflowId: record!.id,
      expectedVersion: record!.version,
      graph: STORY_GRAPHS["morning-digest"],
      source: "save",
      summary: "Drop the merge",
      createdBy: "owner@example.test",
    });

    await expect(
      graphNamesAction(input("merge-factory-pull-request"), { store }),
    ).resolves.toBe(false);
  });

  it("does not look across factories", async () => {
    const store = await storeWith(story);

    await expect(
      graphNamesAction(
        { ...input("merge-factory-pull-request"), factoryId: "factory-2" },
        { store },
      ),
    ).rejects.toMatchObject({ errorCode: "workflow_not_found" });
  });

  it("throws, never refuses quietly, when there is no saved workflow", async () => {
    const store = createInMemoryWorkflowStore();

    await expect(
      graphNamesAction(input("merge-factory-pull-request"), { store }),
    ).rejects.toMatchObject({
      errorCode: "workflow_not_found",
      statusCode: 404,
    });
  });

  it("throws when the stored graph is unreadable instead of reading it as empty", async () => {
    const corrupt = {
      async getWorkflowByAutomation() {
        throw new WorkflowStoreError("corrupt_record", "bad graph json");
      },
    };
    const malformed = {
      async getWorkflowByAutomation() {
        return {
          id: "wf-1",
          graph: { nodes: "not a list", edges: [], settings: {} },
        } as never;
      },
    };

    for (const store of [corrupt, malformed]) {
      await expect(
        graphNamesAction(input("merge-factory-pull-request"), { store }),
      ).rejects.toMatchObject({
        errorCode: "workflow_graph_unreadable",
        sideEffect: "none",
      });
    }
  });

  it("lets another store failure through untouched", async () => {
    const store = {
      async getWorkflowByAutomation() {
        throw new Error("connection reset");
      },
    };

    await expect(
      graphNamesAction(input("merge-factory-pull-request"), { store }),
    ).rejects.toThrow("connection reset");
  });

  it("takes meaning from the catalog passed in, never from the graph", async () => {
    const store = await storeWith(story);
    const catalog = {
      get: (id: string) =>
        id === "github.mergePullRequest"
          ? {
              ...OPERATION_CATALOG.get(id)!,
              implementation: {
                type: "action" as const,
                action: "some-other-action",
              },
            }
          : OPERATION_CATALOG.get(id),
    };

    await expect(
      graphNamesAction(input("merge-factory-pull-request"), {
        store,
        catalog,
      }),
    ).resolves.toBe(false);
    await expect(
      graphNamesAction(input("some-other-action"), { store, catalog }),
    ).resolves.toBe(true);
  });
});

describe("operation_gate_denied tripwire", () => {
  const SECRET = "xoxb-FAKE-0000-aaaaaaaaaaaa";
  // Without a sink the gate writes to the database, which a unit test must not
  // reach; the baseline run drops its events instead.
  const dropped = () => {};

  async function thrownBy(run: () => Promise<unknown>) {
    try {
      await run();
    } catch (error) {
      const { message, errorCode, statusCode, sideEffect } = error as {
        message: string;
        errorCode: string;
        statusCode: number;
        sideEffect: string;
      };
      return { message, errorCode, statusCode, sideEffect };
    }
    throw new Error("Expected the call to throw.");
  }

  it("records each denial with the workflow and operation it names, and never a store error's text", async () => {
    const store = await storeWith(
      graphWith([
        "lookupFile",
        "lookup",
        {
          operation: "github.readFile",
          args: {
            repo: { mode: "fixed", value: "acme/app" },
            path: { mode: "fixed", value: "README.md" },
          },
        },
      ]),
    );
    const refusing = createCapturingTripwireSink();

    const refused = await graphNamesAction(
      input(RUN_WORKFLOW_OPERATION_ACTION, "github.searchCode"),
      { store, tripwire: refusing.sink },
    );

    expect(refused).toBe(false);
    expect(
      await graphNamesAction(
        input(RUN_WORKFLOW_OPERATION_ACTION, "github.searchCode"),
        { store, tripwire: dropped },
      ),
    ).toBe(refused);

    const corrupt = {
      async getWorkflowByAutomation() {
        throw new WorkflowStoreError(
          "corrupt_record",
          `bad graph json near ${SECRET}`,
        );
      },
    };
    const reading = createCapturingTripwireSink();

    const thrown = await thrownBy(() =>
      graphNamesAction(input("merge-factory-pull-request"), {
        store: corrupt,
        tripwire: reading.sink,
      }),
    );

    const stored = sanitizeDetails(reading.events[0].details);
    expect(
      JSON.stringify({ ...reading.events[0], details: stored.fields }),
    ).not.toContain(SECRET);
    expect(thrown).toMatchObject({
      errorCode: "workflow_graph_unreadable",
      statusCode: 500,
      sideEffect: "none",
    });
    expect(thrown).toEqual(
      await thrownBy(() =>
        graphNamesAction(input("merge-factory-pull-request"), {
          store: corrupt,
          tripwire: dropped,
        }),
      ),
    );
  });

  it("when the saved graph names the action", async () => {
    const store = await storeWith(STORY_GRAPHS["builder-to-merge"]);
    const { sink } = createCapturingTripwireSink();

    await expect(
      graphNamesAction(input("merge-factory-pull-request"), {
        store,
        tripwire: sink,
      }),
    ).resolves.toBe(true);
  });
});
