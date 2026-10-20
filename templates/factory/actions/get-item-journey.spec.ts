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
  SCOPE,
  addEvents,
  addInboxItem,
  addItemState,
  addReceipt,
  addRun,
  addWorkflow,
  closeClient,
  createWorld,
  type World,
} from "../server/workflow-host/testing/read-models-kit.js";
import { receiptKey } from "../server/workflow/contract.js";
import action from "./get-item-journey.js";

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
  const wf = workflow.id;
  await addInboxItem(world, {
    id: "item-alice",
    title: "Alice: Export button does nothing",
    status: "automation_started",
  });
  world.at(minute(41));
  await addItemState(world, { workflowId: wf, itemId: "item-alice" });
  const reply = receiptKey({
    workflowId: wf,
    itemId: "item-alice",
    nodeId: "reply",
    attempt: 0,
  });
  const first = await addRun(world, {
    workflowId: wf,
    tickKey: minute(0),
    startedAt: minute(0),
    status: "succeeded",
    steps: [
      {
        nodeId: "assess",
        status: "succeeded",
        ports: { out: { count: 1, itemIds: ["item-alice"] } },
      },
      {
        nodeId: "reply",
        status: "succeeded",
        startedAt: minute(0.2),
        ports: { out: { count: 1, itemIds: ["item-alice"] } },
        receiptKeys: [reply],
      },
    ],
  });
  const second = await addRun(world, {
    workflowId: wf,
    tickKey: minute(40),
    startedAt: minute(40),
    status: "succeeded",
  });
  await addEvents(world, SCOPE, [
    {
      workflowId: wf,
      runId: first.id,
      itemId: "item-alice",
      kind: "taken",
      nodeId: "feedback",
      at: minute(0),
      summary: "taken from #feedback",
    },
    {
      workflowId: wf,
      runId: first.id,
      itemId: "item-alice",
      kind: "output",
      nodeId: "assess",
      at: minute(0.1),
      summary: "clear false",
    },
    {
      workflowId: wf,
      runId: first.id,
      itemId: "item-alice",
      kind: "effect",
      nodeId: "reply",
      at: minute(0.2),
      receiptKey: reply,
      summary: "asked a question",
    },
    {
      workflowId: wf,
      runId: second.id,
      itemId: "item-alice",
      kind: "woke",
      nodeId: "hold",
      at: minute(40),
      summary: "reply from Alice",
    },
    {
      workflowId: wf,
      runId: second.id,
      itemId: "item-alice",
      kind: "ended",
      outcome: "done",
      nodeId: "finish",
      at: minute(40.3),
      summary: "done (status resolved)",
    },
  ]);
  await addReceipt(world, SCOPE, wf, {
    key: reply,
    status: "done",
    externalRef: "1760000000.000100",
    url: "https://slack.example.test/p2",
    at: minute(0.25),
  });
  return { wf, first, second };
}

describe("get-item-journey", () => {
  it("is a read-only GET with a bounded event page", () => {
    const definition = action as unknown as {
      readOnly: boolean;
      http: { method: string };
    };
    expect(definition.readOnly).toBe(true);
    expect(definition.http.method).toBe("GET");
    const schema = kit.schemaOf(action);
    const base = { factoryId: kit.FACTORY_ID, workflowId: "wf", itemId: "i" };
    expect(schema.parse(base)).toMatchObject({ limit: 100 });
    for (const bad of [{ limit: 0 }, { limit: 301 }, { itemId: "" }]) {
      expect(schema.safeParse({ ...base, ...bad }).success).toBe(false);
    }
    expect(
      schema.safeParse({ factoryId: kit.FACTORY_ID, workflowId: "wf" }).success,
    ).toBe(false);
  });

  it("returns the item, its events oldest first, steps, receipts, and the route as node ids", async () => {
    const { wf } = await seed();
    const journey = await run({
      factoryId: kit.FACTORY_ID,
      workflowId: wf,
      itemId: "item-alice",
    });
    expect(journey.item).toMatchObject({
      id: "item-alice",
      inbox: true,
      title: "Alice: Export button does nothing",
      status: "automation_started",
    });
    expect(journey.events.map((e: { kind: string }) => e.kind)).toEqual([
      "taken",
      "output",
      "effect",
      "woke",
      "ended",
    ]);
    expect(
      journey.path.map((n: { nodeId: string; visits: number }) => [
        n.nodeId,
        n.visits,
      ]),
    ).toEqual([
      ["feedback", 1],
      ["assess", 1],
      ["reply", 1],
      ["hold", 1],
      ["finish", 1],
    ]);
    expect(journey.steps).toHaveLength(2);
    expect(journey.receipts).toMatchObject([
      {
        status: "done",
        externalRef: "1760000000.000100",
        url: "https://slack.example.test/p2",
        nodeId: "reply",
      },
    ]);
    expect(journey.state).toMatchObject({ parked: null, needsYouReasons: [] });
  });

  it("pages older events behind olderCursor", async () => {
    const { wf } = await seed();
    const newest = await run({
      factoryId: kit.FACTORY_ID,
      workflowId: wf,
      itemId: "item-alice",
      limit: 2,
    });
    expect(newest.events.map((e: { kind: string }) => e.kind)).toEqual([
      "woke",
      "ended",
    ]);
    expect(newest.eventsHasMore).toBe(true);
    const older = await run({
      factoryId: kit.FACTORY_ID,
      workflowId: wf,
      itemId: "item-alice",
      limit: 2,
      cursor: newest.olderCursor,
    });
    expect(older.events.map((e: { kind: string }) => e.kind)).toEqual([
      "output",
      "effect",
    ]);
    expect(older.path).toHaveLength(5);
  });

  it("separates a missing item and workflow from an item with no events yet", async () => {
    const { wf } = await seed();
    expect(
      await kit.failureOf(() =>
        run({ factoryId: kit.FACTORY_ID, workflowId: wf, itemId: "item-nope" }),
      ),
    ).toMatchObject({ errorCode: "workflow_item_not_found", statusCode: 404 });
    expect(
      await kit.failureOf(() =>
        run({
          factoryId: kit.FACTORY_ID,
          workflowId: "wf_nope",
          itemId: "item-alice",
        }),
      ),
    ).toMatchObject({ errorCode: "workflow_not_found", statusCode: 404 });
    expect(
      await kit.failureOf(() =>
        run({
          factoryId: kit.FACTORY_ID,
          workflowId: wf,
          itemId: "item-alice",
          cursor: "garbage",
        }),
      ),
    ).toMatchObject({ errorCode: "bad_cursor", statusCode: 400 });

    await addItemState(world, { workflowId: wf, itemId: "item-fresh" });
    expect(
      await run({
        factoryId: kit.FACTORY_ID,
        workflowId: wf,
        itemId: "item-fresh",
      }),
    ).toMatchObject({ events: [], path: [], steps: [], receipts: [] });
  });

  it("does not show another factory's or organization's item", async () => {
    const { wf } = await seed();
    expect(
      await kit.failureOf(() =>
        run({
          factoryId: kit.OTHER_FACTORY_ID,
          workflowId: wf,
          itemId: "item-alice",
        }),
      ),
    ).toMatchObject({ errorCode: "workflow_not_found" });
    const theirs = await addWorkflow(world, {
      scope: OTHER_FACTORY,
      name: "Theirs",
    });
    expect(
      await kit.failureOf(() =>
        run({
          factoryId: kit.FACTORY_ID,
          workflowId: theirs.id,
          itemId: "item-alice",
        }),
      ),
    ).toMatchObject({ errorCode: "workflow_not_found" });
    kit.callAsOrg("org-2");
    expect(
      await kit.failureOf(() =>
        run({ factoryId: "factory-1", workflowId: wf, itemId: "item-alice" }),
      ),
    ).toMatchObject({ errorCode: "workflow_not_found" });
  });

  it("fails with its own code when a stored event is damaged", async () => {
    const { wf } = await seed();
    await world.client.query(
      "UPDATE factory_workflow_item_events SET kind = 'bogus' WHERE item_id = 'item-alice'",
    );
    const error = await kit.failureOf(() =>
      run({ factoryId: kit.FACTORY_ID, workflowId: wf, itemId: "item-alice" }),
    );
    expect(error).toMatchObject({
      errorCode: "stored_record_unreadable",
      statusCode: 500,
    });
    expect(error.message).toContain("factory_workflow_item_events");
  });
});
