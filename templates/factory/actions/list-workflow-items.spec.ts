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
  addRun,
  addWorkflow,
  closeClient,
  createWorld,
  type World,
} from "../server/workflow-host/testing/read-models-kit.js";
import action from "./list-workflow-items.js";

const run = kit.runOf(action);
const minute = (n: number) =>
  new Date(Date.parse("2026-10-18T09:00:00.000Z") + n * 60_000).toISOString();

afterAll(closeClient);

let world: World;

beforeEach(async () => {
  world = await createWorld();
  kit.bind(world);
});

type Row = { itemId: string; needsYouReasons: string[] };
const ids = (result: { items: Row[] }) => result.items.map((row) => row.itemId);

async function seed() {
  const workflow = await addWorkflow(world);
  const wf = workflow.id;
  const created = await addRun(world, {
    workflowId: wf,
    tickKey: minute(0),
    startedAt: minute(0),
    status: "succeeded",
  });
  const items = [
    ["item-alice", "Alice: Export button does nothing", "received", "slack"],
    ["item-bob", "Bob: Crash on login", "automation_started", "github"],
    ["item-dan", "Dan: Billing page returns 500", "needs_manual", "slack"],
    ["item-erin", "Erin: Typo on settings", "received", "slack"],
  ] as const;
  for (const [index, [id, title, status, source]] of items.entries()) {
    await addInboxItem(world, { id, title, status, source });
    world.at(minute(index));
    await addItemState(world, {
      workflowId: wf,
      itemId: id,
      ...(id === "item-alice"
        ? {
            parkAt: {
              nodeId: "hold",
              wake: { wait: "reply" as const, dueAt: minute(60) },
            },
          }
        : {}),
    });
  }
  await addEvents(world, SCOPE, [
    {
      workflowId: wf,
      runId: created.id,
      itemId: "item-alice",
      nodeId: "hold",
      kind: "parked",
      at: minute(0.5),
      summary: "waiting for a reply",
    },
  ]);
  return { wf };
}

describe("list-workflow-items", () => {
  it("is a read-only GET with bounded paging and typed filters", () => {
    const definition = action as unknown as {
      readOnly: boolean;
      http: { method: string };
    };
    expect(definition.readOnly).toBe(true);
    expect(definition.http.method).toBe("GET");
    const schema = kit.schemaOf(action);
    expect(schema.parse({ factoryId: kit.FACTORY_ID })).toMatchObject({
      limit: 25,
    });
    for (const bad of [
      { limit: 101 },
      { needsYou: "yes" },
      { status: "dismissed" },
      { status: Array.from({ length: 21 }, (_, i) => `s${i}`) },
      { search: "x".repeat(101) },
    ]) {
      expect(
        schema.safeParse({ factoryId: kit.FACTORY_ID, ...bad }).success,
      ).toBe(false);
    }
  });

  it("lists items by recent activity, one page at a time", async () => {
    await seed();
    const first = await run({ factoryId: kit.FACTORY_ID, limit: 3 });
    expect(ids(first)).toEqual(["item-erin", "item-dan", "item-bob"]);
    expect(first.hasMore).toBe(true);
    const second = await run({
      factoryId: kit.FACTORY_ID,
      limit: 3,
      cursor: first.nextCursor,
    });
    expect(ids(second)).toEqual(["item-alice"]);
    expect(second).toMatchObject({ hasMore: false, nextCursor: null });
  });

  it("shows where an item is and filters by status, source, parked, and search", async () => {
    const { wf } = await seed();
    const parked = await run({ factoryId: kit.FACTORY_ID, parked: true });
    expect(parked.items).toHaveLength(1);
    expect(parked.items[0]).toMatchObject({
      workflowId: wf,
      title: "Alice: Export button does nothing",
      source: "slack",
      status: "received",
      parked: {
        nodeId: "hold",
        nodeName: "hold",
        wait: "reply",
        dueAt: minute(60),
      },
      lastEvent: { kind: "parked", summary: "waiting for a reply" },
    });
    expect(
      ids(
        await run({
          factoryId: kit.FACTORY_ID,
          status: ["automation_started", "needs_manual"],
        }),
      ).sort(),
    ).toEqual(["item-bob", "item-dan"]);
    expect(
      ids(await run({ factoryId: kit.FACTORY_ID, source: "github" })),
    ).toEqual(["item-bob"]);
    expect(
      ids(await run({ factoryId: kit.FACTORY_ID, search: "billing" })),
    ).toEqual(["item-dan"]);
    // An empty search is no search.
    expect(await run({ factoryId: kit.FACTORY_ID, search: "" })).toMatchObject({
      hasMore: false,
    });
  });

  it("returns the items that need a person, and why", async () => {
    await seed();
    const result = await run({ factoryId: kit.FACTORY_ID, needsYou: true });
    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({
      itemId: "item-dan",
      needsYouReasons: ["handed_off"],
    });
  });

  it("answers an unknown workflow with a typed failure, and a quiet one with an empty list", async () => {
    await seed();
    expect(
      await kit.failureOf(() =>
        run({ factoryId: kit.FACTORY_ID, workflowId: "wf_nope" }),
      ),
    ).toMatchObject({ errorCode: "workflow_not_found", statusCode: 404 });
    const quiet = await addWorkflow(world, { name: "Quiet" });
    expect(
      await run({ factoryId: kit.FACTORY_ID, workflowId: quiet.id }),
    ).toEqual({ items: [], hasMore: false, nextCursor: null });
    expect(
      await kit.failureOf(() =>
        run({ factoryId: kit.FACTORY_ID, cursor: "garbage" }),
      ),
    ).toMatchObject({ errorCode: "bad_cursor", statusCode: 400 });
  });

  it("sees only its own factory and organization", async () => {
    const { wf } = await seed();
    const theirs = await addWorkflow(world, {
      scope: OTHER_FACTORY,
      name: "Theirs",
    });
    await addInboxItem(world, { id: "item-theirs", scope: OTHER_FACTORY });
    await addItemState(world, {
      scope: OTHER_FACTORY,
      workflowId: theirs.id,
      itemId: "item-theirs",
    });
    expect(
      ids(await run({ factoryId: kit.FACTORY_ID, limit: 100 })),
    ).not.toContain("item-theirs");
    expect(
      await kit.failureOf(() =>
        run({ factoryId: kit.FACTORY_ID, workflowId: theirs.id }),
      ),
    ).toMatchObject({ errorCode: "workflow_not_found" });
    expect(ids(await run({ factoryId: kit.OTHER_FACTORY_ID }))).toEqual([
      "item-theirs",
    ]);
    kit.callAsOrg("org-2");
    expect(await run({ factoryId: "factory-1" })).toMatchObject({ items: [] });
    expect(wf).toBeTruthy();
  });

  it("fails with its own code when a stored column cannot be read", async () => {
    await seed();
    await world.client.query(
      "UPDATE factory_workflow_item_state SET counters_json = '[1' WHERE item_id = 'item-bob'",
    );
    const error = await kit.failureOf(() => run({ factoryId: kit.FACTORY_ID }));
    expect(error).toMatchObject({
      errorCode: "stored_record_unreadable",
      statusCode: 500,
    });
    expect(error.message).toContain("item-bob");
  });
});
