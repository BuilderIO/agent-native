import { createRequire } from "node:module";

import { drizzle } from "drizzle-orm/pglite";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const { PGlite } = createRequire(
  new URL("../../package.json", import.meta.url),
)("@electric-sql/pglite");

import { factoryMigrations } from "../plugins/factory-migrations.js";
import type { WorkflowScope, WorkflowStore } from "../workflow/adapter.js";
import { buildGraph } from "../workflow/story-graphs.fixture.js";
import { createInMemoryWorkflowStore } from "../workflow/testing/in-memory-store.js";
import {
  WorkflowRunFailure,
  createSampleItemLoader,
  resolveManualRun,
} from "./run-requests.js";

const SCOPE: WorkflowScope = { orgId: "org-1", factoryId: "factory-1" };
const CLICKER = "teammate@example.test";

const graph = buildGraph({
  nodes: [
    ["start", "trigger", { schedule: { every: "15m" } }],
    ["finish", "end", { outcome: "done" }],
  ],
  edges: [["start", "out", "finish"]],
});

describe("resolveManualRun", () => {
  let store: WorkflowStore;
  let now: number;
  let workflowId: string;
  let loadSampleItems: ReturnType<typeof vi.fn>;
  let log: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    now = Date.parse("2026-10-19T12:00:00.000Z");
    store = createInMemoryWorkflowStore({ clock: () => new Date(now) });
    workflowId = (
      await store.createWorkflow(SCOPE, {
        name: "Digest",
        graph,
        ownerEmail: CLICKER,
      })
    ).id;
    loadSampleItems = vi.fn(async (_scope, ids: string[]) =>
      ids.map((id) => ({ id, item: { title: id } })),
    );
    log = vi.fn();
  });

  const resolve = (historyId = "history-1") =>
    resolveManualRun({
      store,
      scope: SCOPE,
      workflowId,
      historyId,
      loadSampleItems: loadSampleItems as never,
      log: log as never,
    });

  it("is a plain Run now when nobody asked for anything", async () => {
    expect(await resolve()).toEqual({ kind: "plain" });
    expect(loadSampleItems).not.toHaveBeenCalled();
  });

  it("hands over the oldest request with what it pinned, as the mode's trigger kind and the person who clicked", async () => {
    const first = await store.createRunRequest(SCOPE, {
      workflowId,
      mode: "test",
      testNodeId: "finish",
      sampleItemIds: ["item-1"],
      requestedBy: CLICKER,
    });
    now += 1000;
    await store.createRunRequest(SCOPE, {
      workflowId,
      mode: "live",
      requestedBy: "other@example.test",
    });

    const manual = await resolve();

    expect(manual).toMatchObject({
      kind: "request",
      mode: "test",
      triggerKind: "test",
      startedBy: CLICKER,
      testNodeId: "finish",
      sampleItems: [{ id: "item-1", item: { title: "item-1" } }],
    });
    expect(manual.kind === "request" && manual.request.id).toBe(first.id);
    expect(loadSampleItems).toHaveBeenCalledWith(SCOPE, ["item-1"]);
    expect(await resolve("history-2")).toMatchObject({
      kind: "request",
      mode: "live",
      triggerKind: "manual",
      startedBy: "other@example.test",
      sampleItems: [],
    });
  });

  it("logs each request that expired and runs the fresh one", async () => {
    const stale = await store.createRunRequest(SCOPE, {
      workflowId,
      mode: "live",
      requestedBy: CLICKER,
    });
    now += 11 * 60_000;
    await store.createRunRequest(SCOPE, {
      workflowId,
      mode: "dry",
      requestedBy: CLICKER,
    });

    expect(await resolve()).toMatchObject({ kind: "request", mode: "dry" });
    expect(log).toHaveBeenCalledTimes(1);
    expect(log).toHaveBeenCalledWith(
      expect.stringMatching(
        new RegExp(
          `run_request_expired: live request ${stale.id} by ${CLICKER} .* more than 10 minutes`,
        ),
      ),
    );
  });

  it("refuses, rather than run live, when the only request waited too long", async () => {
    const stale = await store.createRunRequest(SCOPE, {
      workflowId,
      mode: "dry",
      requestedBy: CLICKER,
    });
    now += 10 * 60_000 + 1;

    const failure = await resolve().then(
      () => undefined,
      (error: unknown) => error as WorkflowRunFailure,
    );

    expect(failure).toBeInstanceOf(WorkflowRunFailure);
    expect(failure).toMatchObject({
      errorCode: "run_request_expired",
      details: { requestIds: [stale.id] },
    });
    // Reported once: the next manual tick, with nothing waiting, is a plain run.
    expect(await resolve("history-2")).toEqual({ kind: "plain" });
  });
});

describe("the sample item loader", () => {
  let client: Awaited<ReturnType<typeof PGlite.create>>;

  afterAll(async () => {
    await client?.close();
  });

  async function loader() {
    if (!client) {
      client = await PGlite.create("memory://");
      for (const migration of factoryMigrations) {
        if (typeof migration.sql === "string") await client.exec(migration.sql);
      }
    }
    await client.exec("TRUNCATE factory_items");
    const db = drizzle(client);
    return createSampleItemLoader(() => db);
  }

  async function insertItem(
    id: string,
    overrides: Record<string, string | null> = {},
  ) {
    const row = {
      source: "slack",
      org_id: SCOPE.orgId,
      factory_id: SCOPE.factoryId,
      metadata_json: "{}",
      channel_id: "C0SUPPORT",
      thread_ts: "1760000000.000100",
      ...overrides,
    };
    await client.query(
      `INSERT INTO factory_items
         (id, source, external_id, title, coverage, dedupe_key, metadata_json,
          channel_id, thread_ts, created_at, updated_at, owner_email, org_id, factory_id)
       VALUES ($1, $2, $1, $3, 'complete', $1, $4, $5, $6,
               '2026-10-19T11:00:00.000Z', '2026-10-19T11:00:00.000Z', 'owner@example.test', $7, $8)`,
      [
        id,
        row.source,
        `Title of ${id}`,
        row.metadata_json,
        row.channel_id,
        row.thread_ts,
        row.org_id,
        row.factory_id,
      ],
    );
  }

  it("reads the pinned items as the engine sees them, in the order they were pinned", async () => {
    const load = await loader();
    await insertItem("item-a");
    await insertItem("item-b");

    const samples = await load(SCOPE, ["item-b", "item-a"]);

    expect(samples.map((sample) => sample.id)).toEqual(["item-b", "item-a"]);
    expect(samples[0]?.item).toMatchObject({
      id: "item-b",
      title: "Title of item-b",
      provider: "slack",
      thread: { channelId: "C0SUPPORT", threadTs: "1760000000.000100" },
    });
  });

  it("reads nothing for nothing pinned", async () => {
    const load = await loader();
    expect(await load(SCOPE, [])).toEqual([]);
  });

  it("fails on an item that is not there, or sits in another factory", async () => {
    const load = await loader();
    await insertItem("item-a");
    await insertItem("item-elsewhere", { factory_id: "factory-2" });

    for (const missing of ["nope", "item-elsewhere"]) {
      await expect(load(SCOPE, ["item-a", missing])).rejects.toMatchObject({
        errorCode: "sample_item_not_found",
        details: { itemId: missing },
      });
    }
  });

  it("fails, with the reason, on an item whose stored data cannot be read", async () => {
    const load = await loader();
    await insertItem("item-bad", { metadata_json: "{not json" });

    await expect(load(SCOPE, ["item-bad"])).rejects.toMatchObject({
      errorCode: "sample_item_unreadable",
      details: { itemId: "item-bad" },
    });
  });
});
