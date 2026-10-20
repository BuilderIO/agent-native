import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@agent-native/core/action", async () => {
  const mod = await import("../server/workflow-host/testing/action-module.js");
  return mod.actionModule;
});
vi.mock("../server/workflow-host/factory-read-models.js", async () => {
  const kit =
    await import("../server/workflow-host/testing/read-actions-kit.js");
  return kit.readModelsModule;
});
vi.mock("../server/lib/require-workspace-member.js", async () => {
  const kit =
    await import("../server/workflow-host/testing/read-actions-kit.js");
  return kit.memberModule;
});
vi.mock("../server/lib/factory-definitions.js", async () => {
  const kit =
    await import("../server/workflow-host/testing/read-actions-kit.js");
  return kit.factoryDefinitionsModule;
});

import * as kit from "../server/workflow-host/testing/read-actions-kit.js";
import {
  OTHER_FACTORY,
  addInboxItem,
  addItemState,
  addWorkflow,
  closeClient,
  createWorld,
  type World,
} from "../server/workflow-host/testing/read-models-kit.js";
import action from "./list-parked-items.js";

const run = kit.runOf(action);
const minute = (n: number) =>
  new Date(Date.parse("2026-10-18T09:00:00.000Z") + n * 60_000).toISOString();

afterAll(closeClient);

let world: World;

beforeEach(async () => {
  world = await createWorld();
  kit.bind(world);
});

async function seed() {
  const workflow = await addWorkflow(world);
  const parked = [
    ["p-late", "hold", 30],
    ["p-soon", "hold", 10],
    ["p-tell", "tell", 15],
    ["p-ghost", "ghost", 5],
  ] as const;
  for (const [itemId, nodeId, due] of parked) {
    await addInboxItem(world, { id: itemId, title: `Report ${itemId}` });
    world.at(minute(0));
    await addItemState(world, {
      workflowId: workflow.id,
      itemId,
      attempts: itemId === "p-soon" ? 2 : undefined,
      parkAt: {
        nodeId,
        wake: {
          wait: nodeId === "tell" ? "time" : "reply",
          dueAt: minute(due),
          ...(nodeId === "hold" ? { nextCheckAt: minute(due - 5) } : {}),
        },
      },
    });
  }
  await addItemState(world, { workflowId: workflow.id, itemId: "not-parked" });
  return workflow;
}

type Row = { itemId: string };

describe("list-parked-items", () => {
  it("is a read-only GET that needs a workflow", () => {
    const definition = action as unknown as {
      readOnly: boolean;
      http: { method: string };
    };
    expect(definition.readOnly).toBe(true);
    expect(definition.http.method).toBe("GET");
    const schema = kit.schemaOf(action);
    expect(schema.safeParse({ factoryId: kit.FACTORY_ID }).success).toBe(false);
    expect(
      schema.parse({ factoryId: kit.FACTORY_ID, workflowId: "wf" }),
    ).toMatchObject({ limit: 25 });
    expect(
      schema.safeParse({
        factoryId: kit.FACTORY_ID,
        workflowId: "wf",
        limit: 101,
      }).success,
    ).toBe(false);
  });

  it("lists the waiting items soonest first with node, wake kind, due and check times, and counters", async () => {
    const workflow = await seed();
    const result = await run({
      factoryId: kit.FACTORY_ID,
      workflowId: workflow.id,
    });
    expect(result.items.map((row: Row) => row.itemId)).toEqual([
      "p-ghost",
      "p-soon",
      "p-tell",
      "p-late",
    ]);
    expect(result.items[1]).toMatchObject({
      title: "Report p-soon",
      attempts: 2,
      counters: { attempts: 2 },
      parked: {
        nodeId: "hold",
        nodeName: "hold",
        wait: "reply",
        dueAt: minute(10),
        nextCheckAt: minute(5),
        nodeMissingFromGraph: false,
      },
    });
    expect(result.items[0].parked).toMatchObject({
      nodeId: "ghost",
      nodeMissingFromGraph: true,
    });
    expect(result).toMatchObject({ workflowId: workflow.id, hasMore: false });
  });

  it("counts what waits at each node and filters to one", async () => {
    const workflow = await seed();
    const result = await run({
      factoryId: kit.FACTORY_ID,
      workflowId: workflow.id,
    });
    expect(result.byNode).toEqual([
      { nodeId: "ghost", nodeName: null, count: 1, nextDueAt: minute(5) },
      { nodeId: "hold", nodeName: "hold", count: 2, nextDueAt: minute(10) },
      { nodeId: "tell", nodeName: "tell", count: 1, nextDueAt: minute(15) },
    ]);
    const onHold = await run({
      factoryId: kit.FACTORY_ID,
      workflowId: workflow.id,
      nodeId: "hold",
    });
    expect(onHold.items.map((row: Row) => row.itemId)).toEqual([
      "p-soon",
      "p-late",
    ]);
  });

  it("pages across a cursor", async () => {
    const workflow = await seed();
    const first = await run({
      factoryId: kit.FACTORY_ID,
      workflowId: workflow.id,
      limit: 3,
    });
    expect(first.items).toHaveLength(3);
    expect(first.hasMore).toBe(true);
    const second = await run({
      factoryId: kit.FACTORY_ID,
      workflowId: workflow.id,
      limit: 3,
      cursor: first.nextCursor,
    });
    expect(second.items.map((row: Row) => row.itemId)).toEqual(["p-late"]);
    expect(second).toMatchObject({ hasMore: false, nextCursor: null });
  });

  it("tells a workflow with nothing parked from one that does not exist, and a bad cursor from both", async () => {
    const workflow = await addWorkflow(world);
    expect(
      await run({ factoryId: kit.FACTORY_ID, workflowId: workflow.id }),
    ).toMatchObject({
      items: [],
      byNode: [],
      hasMore: false,
      nextCursor: null,
    });
    expect(
      await kit.failureOf(() =>
        run({ factoryId: kit.FACTORY_ID, workflowId: "wf_nope" }),
      ),
    ).toMatchObject({ errorCode: "workflow_not_found", statusCode: 404 });
    expect(
      await kit.failureOf(() =>
        run({
          factoryId: kit.FACTORY_ID,
          workflowId: workflow.id,
          cursor: "garbage",
        }),
      ),
    ).toMatchObject({ errorCode: "bad_cursor", statusCode: 400 });
  });

  it("sees only its own factory and organization", async () => {
    const workflow = await seed();
    const theirs = await addWorkflow(world, {
      scope: OTHER_FACTORY,
      name: "Theirs",
    });
    expect(
      await kit.failureOf(() =>
        run({ factoryId: kit.FACTORY_ID, workflowId: theirs.id }),
      ),
    ).toMatchObject({ errorCode: "workflow_not_found" });
    expect(
      await kit.failureOf(() =>
        run({ factoryId: kit.OTHER_FACTORY_ID, workflowId: workflow.id }),
      ),
    ).toMatchObject({ errorCode: "workflow_not_found" });
    kit.callAsOrg("org-2");
    expect(
      await kit.failureOf(() =>
        run({ factoryId: "factory-1", workflowId: workflow.id }),
      ),
    ).toMatchObject({ errorCode: "workflow_not_found" });
  });

  it("fails with its own code when a parked row's counters are damaged", async () => {
    const workflow = await seed();
    await world.client.query(
      "UPDATE factory_workflow_item_state SET counters_json = 'x' WHERE item_id = 'p-soon'",
    );
    const error = await kit.failureOf(() =>
      run({ factoryId: kit.FACTORY_ID, workflowId: workflow.id }),
    );
    expect(error).toMatchObject({
      errorCode: "stored_record_unreadable",
      statusCode: 500,
    });
    expect(error.message).toContain("p-soon");
  });
});
