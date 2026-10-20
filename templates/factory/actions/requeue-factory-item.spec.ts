import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const worldDb = vi.hoisted(() => ({ current: undefined as unknown }));

vi.mock("@agent-native/core/action", async () => {
  const mod = await import("../server/workflow-host/testing/action-module.js");
  return mod.actionModule;
});
vi.mock("../server/db/index.js", () => ({ getDb: () => worldDb.current }));
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

import { createInboxHost } from "../server/workflow-host/inbox.js";
import { createItemsHost } from "../server/workflow-host/items.js";
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
  rows,
  type World,
} from "../server/workflow-host/testing/read-models-kit.js";
import type { NormalizedItem } from "../server/workflow/items.js";
import dismissAction from "./dismiss-factory-item.js";
import requeueAction from "./requeue-factory-item.js";

const requeue = kit.runOf(requeueAction);
const dismiss = kit.runOf(dismissAction);
const minute = (n: number) =>
  new Date(Date.parse("2026-10-18T09:00:00.000Z") + n * 60_000).toISOString();

afterAll(closeClient);

let world: World;
let workflowId: string;

beforeEach(async () => {
  world = await createWorld(minute(30));
  worldDb.current = world.db;
  kit.bind(world);
});

/** An item a workflow handed to a person after three failed tries, as the engine leaves it. */
async function handedOff(
  id: string,
  source = "slack",
  status = "needs_manual",
) {
  const workflow = await addWorkflow(world);
  workflowId = workflow.id;
  const created = await addRun(world, {
    workflowId,
    tickKey: minute(0),
    startedAt: minute(0),
    status: "succeeded",
  });
  await addInboxItem(world, { id, source, status, title: `Report ${id}` });
  await addItemState(world, { workflowId, itemId: id, attempts: 3 });
  await addEvents(world, SCOPE, [
    { workflowId, runId: created.id, itemId: id, kind: "taken", at: minute(1) },
    {
      workflowId,
      runId: created.id,
      itemId: id,
      kind: "error",
      code: "provider_error",
      at: minute(2),
    },
    {
      workflowId,
      runId: created.id,
      itemId: id,
      kind: "ended",
      outcome: "needsManual",
      at: minute(3),
    },
  ]);
}

const journey = (id: string) =>
  world.models.getItemJourney(SCOPE, { workflowId, itemId: id });
const statusOf = async (id: string) =>
  (await rows(world, "SELECT status FROM factory_items WHERE id = $1", [id]))[0]
    ?.status;

const normalized = (id: string): NormalizedItem => ({
  id,
  externalId: id,
  kind: "message",
  provider: "slack",
  title: `Report ${id}`,
  occurredAt: minute(0),
  extras: {},
});

describe("requeue-factory-item", () => {
  it("sends a handed-off item back to its queue, clears what it spent, and says so on its journey", async () => {
    await handedOff("item-1");
    expect((await journey("item-1")).state?.needsYouReasons).toContain(
      "handed_off",
    );

    expect(
      await requeue({ factoryId: SCOPE.factoryId, itemId: "item-1" }),
    ).toEqual({
      ok: true,
      itemId: "item-1",
      status: "received",
      previousStatus: "needs_manual",
      changed: true,
      workflowIds: [workflowId],
    });

    expect(await statusOf("item-1")).toBe("received");
    const after = await journey("item-1");
    expect(after.state).toMatchObject({ attempts: 0, needsYouReasons: [] });
    expect(after.events.at(-1)).toMatchObject({
      kind: "ended",
      outcome: "released",
      summary: "released: Requeued by teammate@example.test (status received)",
    });
  });

  it("puts a pull request back where the GitHub queue reads, and does nothing the second time", async () => {
    await handedOff("pr-1", "github");
    await requeue({ factoryId: SCOPE.factoryId, itemId: "pr-1" });
    expect(await statusOf("pr-1")).toBe("pr_observed");
    const events = (await journey("pr-1")).events.length;

    expect(
      await requeue({ factoryId: SCOPE.factoryId, itemId: "pr-1" }),
    ).toMatchObject({
      ok: true,
      changed: false,
      status: "pr_observed",
      workflowIds: [],
    });
    expect((await journey("pr-1")).events).toHaveLength(events);
  });

  it("lets the source take the item again: it was held back as handled and is now open", async () => {
    await handedOff("item-2");
    const items = createItemsHost({
      scope: SCOPE,
      ownerEmail: "owner@example.test",
      getDatabase: () => world.db,
      clock: () => new Date(world.now()),
    });
    const offered = () =>
      items.upsertItems({ items: [normalized("item-2")], dryRun: true });
    expect(await offered()).toMatchObject({
      states: [{ id: "item-2", state: "terminal" }],
    });
    const queue = () =>
      createInboxHost({
        scope: SCOPE,
        workflowId,
        getDatabase: () => world.db,
        callAction: async () => {
          throw new Error("a status source calls no poller");
        },
        clock: () => new Date(world.now()),
      }).take({
        settings: { source: "status", status: "received", takeLimit: 5 },
        mode: "live",
        signal: new AbortController().signal,
      });
    expect(await queue()).toMatchObject({ ok: true, items: [] });

    await requeue({ factoryId: SCOPE.factoryId, itemId: "item-2" });

    expect(await offered()).toMatchObject({
      states: [{ id: "item-2", state: "open" }],
    });
    expect(await queue()).toMatchObject({
      ok: true,
      items: [{ id: "item-2" }],
    });
  });

  it("puts the event on the trail of an item that was ended through a combined item and has no state row", async () => {
    await handedOff("group-1");
    await addInboxItem(world, { id: "member-1", status: "needs_manual" });
    await addEvents(world, SCOPE, [
      {
        workflowId,
        runId: (await journey("group-1")).events[0].runId,
        itemId: "member-1",
        kind: "ended",
        outcome: "needsManual",
        at: minute(3),
      },
    ]);

    expect(
      await requeue({ factoryId: SCOPE.factoryId, itemId: "member-1" }),
    ).toMatchObject({ ok: true, changed: true, workflowIds: [workflowId] });
    expect((await journey("member-1")).events.at(-1)).toMatchObject({
      kind: "ended",
      outcome: "released",
    });
  });

  it("brings back an item dismissed by mistake, and refuses one that is done or not in this factory", async () => {
    await handedOff("item-3", "slack", "dismissed");
    expect(
      await requeue({ factoryId: SCOPE.factoryId, itemId: "item-3" }),
    ).toMatchObject({
      ok: true,
      changed: true,
      previousStatus: "dismissed",
    });

    await addInboxItem(world, { id: "item-4", status: "resolved" });
    const refused = await kit.failureOf(() =>
      requeue({ factoryId: SCOPE.factoryId, itemId: "item-4" }),
    );
    expect(refused).toMatchObject({
      errorCode: "item_not_requeueable",
      statusCode: 409,
      details: { itemId: "item-4", currentStatus: "resolved" },
    });

    await addInboxItem(world, {
      id: "item-5",
      status: "needs_manual",
      scope: OTHER_FACTORY,
    });
    expect(
      await kit.failureOf(() =>
        requeue({ factoryId: SCOPE.factoryId, itemId: "item-5" }),
      ),
    ).toMatchObject({ errorCode: "factory_item_not_found", statusCode: 404 });
    expect(await statusOf("item-5")).toBe("needs_manual");
  });

  it("asks a person when the agent calls it, never offers always-allow, and is the one that dismisses without asking", () => {
    expect(requeueAction).toMatchObject({
      needsApproval: true,
      allowPersistentApproval: false,
      retrySafe: true,
    });
    expect(dismissAction).not.toHaveProperty("needsApproval");
  });
});

describe("dismiss-factory-item", () => {
  it("closes an item that needs a person, records it, and does nothing the second time", async () => {
    await handedOff("item-6");

    expect(
      await dismiss({ factoryId: SCOPE.factoryId, itemId: "item-6" }),
    ).toMatchObject({
      ok: true,
      status: "dismissed",
      previousStatus: "needs_manual",
      changed: true,
    });
    expect(await statusOf("item-6")).toBe("dismissed");
    const after = await journey("item-6");
    expect(after.state?.needsYouReasons).toEqual([]);
    expect(after.events.at(-1)).toMatchObject({
      kind: "ended",
      outcome: "dismissed",
    });

    const events = after.events.length;
    expect(
      await dismiss({ factoryId: SCOPE.factoryId, itemId: "item-6" }),
    ).toMatchObject({
      ok: true,
      changed: false,
    });
    expect((await journey("item-6")).events).toHaveLength(events);
  });

  it("refuses an item nobody has to look at", async () => {
    await handedOff("item-7", "slack", "received");
    expect(
      await kit.failureOf(() =>
        dismiss({ factoryId: SCOPE.factoryId, itemId: "item-7" }),
      ),
    ).toMatchObject({
      errorCode: "item_not_dismissable",
      details: { currentStatus: "received" },
    });
    expect(await statusOf("item-7")).toBe("received");
  });
});
