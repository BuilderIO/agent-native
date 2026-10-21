import { createRequire } from "node:module";

import { count, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

const { PGlite } = createRequire(
  new URL("../../package.json", import.meta.url),
)("@electric-sql/pglite");

import { triageItems } from "../db/schema.js";
import { factoryMigrations } from "../plugins/factory-migrations.js";
import type { WorkflowHost } from "../workflow/adapter.js";
import { SCHEDULE_STARTER, type StepRecord } from "../workflow/contract.js";
import { runTick } from "../workflow/engine/run-tick.js";
import {
  chain,
  endWith,
  normalizedItem,
  sourceResult,
  startedByHand,
} from "../workflow/testing/engine-fixtures.js";
import { makeHost, seedWorkflow } from "../workflow/testing/make-host.js";
import { createItemsHost } from "./items.js";

// A provider query that remembers its items in the inbox, run through the real
// engine and the real items host over a real database: the rows the End needs
// have to be there, and a dry run must not leave any.

type PGliteClient = Awaited<ReturnType<typeof PGlite.create>>;

const OWNER = "owner@example.test";

let sharedClient: PGliteClient | undefined;

async function emptyClient(): Promise<PGliteClient> {
  if (!sharedClient) {
    sharedClient = await PGlite.create("memory://");
    for (const migration of factoryMigrations) {
      if (typeof migration.sql === "string") {
        await sharedClient.exec(migration.sql);
      }
    }
  }
  await sharedClient.exec("TRUNCATE factory_items");
  return sharedClient;
}

afterAll(async () => {
  await sharedClient?.close();
  sharedClient = undefined;
});

let db: ReturnType<typeof drizzle>;

beforeEach(async () => {
  db = drizzle(await emptyClient());
});

const leads = () => [
  normalizedItem("lead-1", {
    kind: "lead",
    provider: "hubspot",
    title: "Ada at Example",
    text: "Asked for a demo.",
    payload: { vid: 1 },
  }),
  normalizedItem("lead-2", {
    kind: "lead",
    provider: "hubspot",
    title: "Lin at Example",
  }),
];

async function setup(
  options: {
    source?: Record<string, unknown>;
    end?: Record<string, unknown>;
  } = {},
) {
  const test = makeHost();
  const { id } = await seedWorkflow(test, chain([], options));
  const host: WorkflowHost = {
    ...test.host,
    items: createItemsHost({
      scope: test.scope,
      ownerEmail: OWNER,
      getDatabase: () => db,
      clock: () => test.clock.now(),
    }),
  };
  const tick = (mode: "live" | "dry" = "live") =>
    runTick({
      host,
      scope: test.scope,
      workflowId: id,
      tickKey: `tick-${test.clock.now().getTime()}-${mode}`,
      mode,
      ...(mode === "live"
        ? { triggerKind: "schedule" as const, startedBy: SCHEDULE_STARTER }
        : startedByHand(mode)),
      ...(mode === "live"
        ? { scheduledFor: test.clock.now().toISOString() }
        : {}),
    });
  return { test, id, tick };
}

async function rows() {
  return db.select().from(triageItems).orderBy(triageItems.id);
}

function ran(result: Awaited<ReturnType<typeof runTick>>) {
  if (result.kind !== "ran") {
    throw new Error(`Expected the tick to run, got ${result.kind}`);
  }
  return result;
}

const stepOf = (steps: StepRecord[], nodeId: string) => {
  const step = steps.find((entry) => entry.nodeId === nodeId);
  if (!step) throw new Error(`No step for ${nodeId}`);
  return step;
};

describe("a provider query that remembers its items in the inbox", () => {
  it("gives each item a row, and the End resolves it", async () => {
    const { test, tick } = await setup();
    test.operations.script("test.items", sourceResult(leads()));

    const result = ran(await tick());

    expect(result.run.status).toBe("succeeded");
    expect(result.run.counts).toMatchObject({
      taken: 2,
      done: 2,
      itemFailures: 0,
    });
    const stored = await rows();
    expect(stored.map((row) => [row.id, row.source, row.status])).toEqual([
      ["lead-1", "hubspot", "resolved"],
      ["lead-2", "hubspot", "resolved"],
    ]);
    expect(stored[0]).toMatchObject({
      title: "Ada at Example",
      summary: "Asked for a demo.",
      orgId: "org-1",
      factoryId: "factory-1",
      ownerEmail: OWNER,
    });
    expect(JSON.parse(stored[0].payloadJson)).toEqual({ vid: 1 });
    expect(stepOf(result.steps, "src").fields).toMatchObject({
      rows: { inserted: 2, updated: 0, unchanged: 0, skipped: 0 },
    });
  });

  it("does not duplicate a row, or run an item again, when the provider offers it on a later tick", async () => {
    const { test, tick } = await setup();
    test.operations.always("test.items", sourceResult(leads()));

    await tick();
    test.clock.advance(5 * 60_000);
    const second = ran(await tick());

    expect(await db.select({ n: count() }).from(triageItems)).toEqual([
      { n: 2 },
    ]);
    expect((await rows()).map((row) => row.status)).toEqual([
      "resolved",
      "resolved",
    ]);
    expect(second.run.counts).toMatchObject({
      taken: 0,
      done: 0,
      itemFailures: 0,
    });
    expect(stepOf(second.steps, "src").fields).toMatchObject({
      taken: 0,
      alreadyHandled: 2,
      rows: { inserted: 0, unchanged: 2 },
    });
  });

  it("does not run an item a person dismissed, and keeps its status", async () => {
    const { test, tick } = await setup({ end: endWith("released") });
    test.operations.always("test.items", sourceResult(leads()));
    await tick();
    await db
      .update(triageItems)
      .set({ status: "dismissed" })
      .where(eq(triageItems.id, "lead-1"));
    test.clock.advance(5 * 60_000);

    const second = ran(await tick());

    // lead-1 was dismissed, lead-2 was released and is still in its queue.
    expect(stepOf(second.steps, "src").ports.out.itemIds).toEqual(["lead-2"]);
    expect(stepOf(second.steps, "src").fields).toMatchObject({
      alreadyHandled: 1,
    });
    expect((await rows()).map((row) => [row.id, row.status])).toEqual([
      ["lead-1", "dismissed"],
      ["lead-2", "received"],
    ]);
  });

  it("runs a released item again, since release puts it back in its queue", async () => {
    const { test, tick } = await setup({ end: endWith("released") });
    test.operations.always("test.items", sourceResult(leads()));

    await tick();
    test.clock.advance(5 * 60_000);
    const second = ran(await tick());

    expect((await rows()).map((row) => row.status)).toEqual([
      "received",
      "received",
    ]);
    expect(second.run.counts).toMatchObject({ taken: 2, released: 2 });
    expect(stepOf(second.steps, "src").fields).toMatchObject({
      alreadyHandled: 0,
    });
  });

  it("runs an item a person reopened, and leaves one handed to a person alone", async () => {
    const { test, tick } = await setup({ end: endWith("needsManual") });
    test.operations.always("test.items", sourceResult(leads()));
    await tick();
    await db
      .update(triageItems)
      .set({ status: "received" })
      .where(eq(triageItems.id, "lead-2"));
    test.clock.advance(5 * 60_000);

    const second = ran(await tick());

    expect(stepOf(second.steps, "src").ports.out.itemIds).toEqual(["lead-2"]);
    expect(stepOf(second.steps, "src").fields).toMatchObject({
      alreadyHandled: 1,
    });
    expect((await rows()).map((row) => [row.id, row.status])).toEqual([
      ["lead-1", "needs_manual"],
      ["lead-2", "needs_manual"],
    ]);
  });

  it("writes no row in a dry run, and says what it would have done", async () => {
    const { test, tick } = await setup();
    test.operations.script("test.items", sourceResult(leads()));

    const result = ran(await tick("dry"));

    expect(await rows()).toEqual([]);
    expect(result.run.status).toBe("succeeded");
    expect(result.run.counts).toMatchObject({ done: 2, itemFailures: 0 });
    expect(stepOf(result.steps, "src").fields).toMatchObject({
      rowsHeld: "not a live run",
      alreadyHandled: 0,
    });
    expect(stepOf(result.steps, "done").fields).toMatchObject({
      wouldSetStatus: "resolved",
    });
  });

  it("reports in a dry run which items it would leave out, and still writes nothing", async () => {
    const { test, tick } = await setup();
    test.operations.script("test.items", sourceResult(leads()));
    await tick();
    const before = await rows();
    test.clock.advance(5 * 60_000);
    test.operations.script(
      "test.items",
      sourceResult([
        ...leads(),
        normalizedItem("lead-3", { provider: "hubspot" }),
      ]),
    );

    const dry = ran(await tick("dry"));

    expect(stepOf(dry.steps, "src").ports.out.itemIds).toEqual(["lead-3"]);
    expect(stepOf(dry.steps, "src").fields).toMatchObject({
      alreadyHandled: 2,
      rowsHeld: "not a live run",
    });
    expect(await rows()).toEqual(before);
  });

  it("fails the source with item_conflict, and takes nothing, when a row of another factory holds the id", async () => {
    const { test, id, tick } = await setup();
    await db.insert(triageItems).values({
      id: "lead-1",
      source: "hubspot",
      externalId: "lead-1",
      title: "Theirs",
      status: "received",
      coverage: "complete",
      dedupeKey: "lead-1",
      metadataJson: "{}",
      createdAt: "2026-10-18T10:00:00.000Z",
      updatedAt: "2026-10-18T10:00:00.000Z",
      ownerEmail: OWNER,
      orgId: "org-1",
      factoryId: "factory-2",
    });
    test.operations.script("test.items", sourceResult(leads()));

    const result = ran(await tick());

    expect(result.run.status).toBe("failed");
    expect(stepOf(result.steps, "src")).toMatchObject({
      status: "failed",
      error: { code: "item_conflict" },
    });
    expect(result.run.counts).toMatchObject({ taken: 0, done: 0 });
    expect(await rows()).toHaveLength(1);
    expect(await test.store.getItemState(test.scope, id, "lead-2")).toBeNull();
  });
});
