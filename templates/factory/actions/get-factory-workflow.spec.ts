import { beforeEach, describe, expect, it, vi } from "vitest";

const readProviderConnectionsMock = vi.hoisted(() => vi.fn());

vi.mock("../server/lib/factory-workflow-connections.js", () => ({
  readProviderConnections: readProviderConnectionsMock,
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
  return kit.memberModule;
});
vi.mock("../server/lib/factory-definitions.js", async () => {
  const kit =
    await import("../server/workflow-host/testing/workflow-actions-kit.js");
  return kit.factoryDefinitionsModule;
});

import * as kit from "../server/workflow-host/testing/workflow-actions-kit.js";
import {
  STORY_GRAPHS,
  buildGraph,
} from "../server/workflow/story-graphs.fixture.js";
import get from "./get-factory-workflow.js";
import save from "./save-factory-workflow.js";

const runSave = kit.runOf(save);
const run = kit.runOf(get);
const scope = { orgId: kit.ORG_ID, factoryId: kit.FACTORY_ID };

async function create() {
  const created = await runSave(
    {
      factoryId: kit.FACTORY_ID,
      name: "Digest",
      graph: kit.simpleGraph({ schedule: { every: "15m" } }),
    },
    kit.context,
  );
  await runSave(
    {
      factoryId: kit.FACTORY_ID,
      workflowId: created.workflowId,
      expectedVersion: 1,
      graph: kit.simpleGraph({ schedule: { every: "30m" } }),
    },
    kit.context,
  );
  return created;
}

const read = (workflowId: string, version?: number) =>
  run({ factoryId: kit.FACTORY_ID, workflowId, version }, kit.context);

beforeEach(() => {
  kit.reset();
  readProviderConnectionsMock.mockReset();
});

describe("get-factory-workflow", () => {
  it("returns the current graph with its version, switch, dry-run state and job health", async () => {
    const created = await create();

    const result = await read(created.workflowId);

    expect(result).toMatchObject({
      id: created.workflowId,
      name: "Digest",
      version: 2,
      currentVersion: 2,
      enabled: false,
      lastCleanDryRunVersion: null,
      dryRunCurrent: false,
      job: {
        exists: true,
        runner: "workflow",
        schedule: "*/30 * * * *",
        drift: [],
      },
    });
    expect(result.graph.nodes[0].settings).toEqual({
      schedule: { every: "30m" },
    });
  });

  it("returns an older graph when asked, and still says what is current", async () => {
    const created = await create();

    const result = await read(created.workflowId, 1);

    expect(result).toMatchObject({ version: 1, currentVersion: 2 });
    expect(result.graph.nodes[0].settings).toEqual({
      schedule: { every: "15m" },
    });
  });

  it("returns the current graph when the current version is named", async () => {
    const created = await create();
    expect((await read(created.workflowId, 2)).version).toBe(2);
  });

  it("fails for a version that was never saved", async () => {
    const created = await create();
    expect(
      await kit.failureOf(() => read(created.workflowId, 7)),
    ).toMatchObject({
      errorCode: "workflow_version_not_found",
      statusCode: 404,
    });
  });

  it("shows where the job file has drifted from what the graph requires", async () => {
    const created = await create();
    await kit.currentStore().recordCleanDryRun(scope, {
      workflowId: created.workflowId,
      version: 2,
    });
    const tampered = (kit.readJob(created.job.path) as string)
      .replace('schedule: "*/30 * * * *"', 'schedule: "0 * * * *"')
      .replace("enabled: false", "enabled: true")
      .replace(/^runner:.*\n/m, "");
    kit.seedJob(created.job.path, tampered);

    const result = await read(created.workflowId);

    expect(result.job.drift).toEqual(["runner", "enabled", "schedule"]);
  });

  it("reports a missing job file", async () => {
    const created = await create();
    kit.removeJob(created.job.path);

    expect((await read(created.workflowId)).job).toMatchObject({
      exists: false,
      drift: ["missing"],
    });
  });

  it("fails for a workflow that does not exist", async () => {
    expect(await kit.failureOf(() => read("missing"))).toMatchObject({
      errorCode: "workflow_not_found",
      statusCode: 404,
    });
  });

  it("lists the providers the graph needs, with status and the nodes that need each", async () => {
    readProviderConnectionsMock.mockImplementation(
      async (providers: string[]) =>
        providers.map((provider) => ({
          provider,
          status: provider === "slack" ? "not connected" : "connected",
          connectWith: "workspace-connection",
        })),
    );
    const created = await runSave(
      {
        factoryId: kit.FACTORY_ID,
        name: "Digest",
        graph: STORY_GRAPHS["morning-digest"],
      },
      kit.context,
    );

    const result = await read(created.workflowId);

    expect(result.connections).toEqual([
      expect.objectContaining({
        provider: "github",
        status: "connected",
        nodes: ["commits"],
      }),
      expect.objectContaining({
        provider: "slack",
        status: "not connected",
        nodes: ["post"],
      }),
    ]);
  });

  describe("a graph too large for one tool result", () => {
    // Five AI nodes with 9,000-character instructions: over 40,000 rendered characters.
    const bigGraph = () =>
      buildGraph({
        nodes: [
          ["start", "trigger", { schedule: { every: "15m" } }],
          ...[1, 2, 3, 4, 5].map(
            (n) =>
              [
                `ask${n}`,
                "ai",
                {
                  instruction: "x".repeat(9_000),
                  result: { answer: { type: "string" } },
                  mode: "perItem",
                },
              ] as [string, "ai", Record<string, unknown>],
          ),
          ["finish", "end", { outcome: "done" }],
        ],
        edges: [
          ["start", "out", "ask1"],
          ["ask1", "out", "ask2"],
          ["ask2", "out", "ask3"],
          ["ask3", "out", "ask4"],
          ["ask4", "out", "ask5"],
          ["ask5", "out", "finish"],
        ],
      });

    async function createBig() {
      return runSave(
        { factoryId: kit.FACTORY_ID, name: "Big", graph: bigGraph() },
        kit.context,
      );
    }

    it("gives an agent an outline with a typed marker instead of cutting the graph off", async () => {
      const created = await createBig();

      const result = await run(
        { factoryId: kit.FACTORY_ID, workflowId: created.workflowId },
        kit.agentContext,
      );

      expect(result.graph).toBeUndefined();
      expect(result.truncated).toMatchObject({
        code: "graph_too_large",
        nodeCount: 7,
        edgeCount: 6,
        nodes: expect.arrayContaining(["ask3 (ask3): ai"]),
        edges: expect.arrayContaining(["e1: start.out -> ask1"]),
      });
      expect(JSON.stringify(result, null, 2).length).toBeLessThan(40_000);
    });

    it("reads the nodes an agent asks for in full, and says the read is partial", async () => {
      const created = await createBig();

      const result = await run(
        {
          factoryId: kit.FACTORY_ID,
          workflowId: created.workflowId,
          nodeIds: ["ask2"],
        },
        kit.agentContext,
      );

      expect(result.graph.nodes.map((node: { id: string }) => node.id)).toEqual(
        ["ask2"],
      );
      expect(result.graph.edges).toHaveLength(2);
      expect(result.partial).toEqual({
        nodeIds: ["ask2"],
        nodeCount: 7,
        edgeCount: 6,
      });
      expect(
        await kit.failureOf(() =>
          run(
            {
              factoryId: kit.FACTORY_ID,
              workflowId: created.workflowId,
              nodeIds: ["ghost"],
            },
            kit.agentContext,
          ),
        ),
      ).toMatchObject({
        errorCode: "workflow_node_not_found",
        statusCode: 404,
      });
    });

    it("never cuts the app's own read", async () => {
      const created = await createBig();

      const result = await read(created.workflowId);

      expect(result.graph.nodes).toHaveLength(7);
      expect(result.truncated).toBeUndefined();
    });
  });
});
