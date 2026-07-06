import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { runWithRequestContext } from "@agent-native/core/server";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const TEST_DB_PATH = join(
  tmpdir(),
  `delivery-sync-${process.pid}-${Date.now()}.sqlite`,
);

const OWNER = "sync-owner@example.com";

let syncSourceAction: typeof import("./sync-source.js").default;
let listSourceCursorsAction: typeof import("./list-source-cursors.js").default;
let listWorkItemsAction: typeof import("../../delivery-workbench/actions/list-work-items.js").default;
let syncDb: typeof import("../server/db/index.js");
let workbenchDb: typeof import("../../delivery-workbench/server/db/index.js");
let syncLib: typeof import("../server/lib/sync.js");

beforeAll(async () => {
  process.env.DATABASE_URL = `file:${TEST_DB_PATH}`;
  workbenchDb = await import("../../delivery-workbench/server/db/index.js");
  syncDb = await import("../server/db/index.js");
  syncLib = await import("../server/lib/sync.js");
  const workbenchPlugin = (
    await import("../../delivery-workbench/server/plugins/db.js")
  ).default;
  const syncPlugin = (await import("../server/plugins/db.js")).default;
  await workbenchPlugin(undefined as any);
  await syncPlugin(undefined as any);
  syncSourceAction = (await import("./sync-source.js")).default;
  listSourceCursorsAction = (await import("./list-source-cursors.js")).default;
  listWorkItemsAction = (
    await import("../../delivery-workbench/actions/list-work-items.js")
  ).default;
}, 60000);

afterAll(() => {
  for (const suffix of ["", "-shm", "-wal"]) {
    rmSync(`${TEST_DB_PATH}${suffix}`, { force: true });
  }
});

async function asOwner<T>(fn: () => T | Promise<T>) {
  return runWithRequestContext({ userEmail: OWNER }, fn);
}

describe("delivery sync source action", () => {
  it("updates provider cursor and ingests normalized work items", async () => {
    const result = await asOwner(() =>
      syncSourceAction.run({
        provider: "demo-provider",
        cursorKey: "tickets",
        cursorStart: "cursor-a",
        cursorEnd: "cursor-b",
        items: [
          {
            sourceId: "upstream-1",
            title: "Imported provider ticket",
            priority: "high",
            rawRef: "archive://demo-provider/upstream-1",
          },
        ],
      }),
    );
    const cursors = await asOwner(() =>
      listSourceCursorsAction.run({ provider: "demo-provider" }),
    );
    const workItems = await asOwner(() =>
      listWorkItemsAction.run({ provider: "demo-provider" }),
    );

    expect(result.ingest.createdCount).toBe(1);
    expect(result.rawArchiveCount).toBe(1);
    expect(cursors).toHaveLength(1);
    expect(cursors[0]).toMatchObject({
      provider: "demo-provider",
      cursorKey: "tickets",
      cursorValue: "cursor-b",
      lastSyncStatus: "succeeded",
    });
    expect(workItems).toHaveLength(1);
    expect(workItems[0]).toMatchObject({
      provider: "demo-provider",
      sourceId: "upstream-1",
      title: "Imported provider ticket",
    });
  });

  it("uses a non-null owner scope key for cursor uniqueness", async () => {
    await asOwner(() =>
      syncSourceAction.run({
        provider: "cursor-provider",
        cursorKey: "tickets",
        cursorEnd: "cursor-1",
      }),
    );
    await asOwner(() =>
      syncSourceAction.run({
        provider: "cursor-provider",
        cursorKey: "tickets",
        cursorEnd: "cursor-2",
      }),
    );

    const cursors = await asOwner(() =>
      listSourceCursorsAction.run({ provider: "cursor-provider" }),
    );
    const db = syncDb.getDb();
    const rows = await db
      .select()
      .from(syncDb.schema.sourceCursors)
      .where(
        and(
          eq(syncDb.schema.sourceCursors.provider, "cursor-provider"),
          eq(syncDb.schema.sourceCursors.cursorKey, "tickets"),
        ),
      );

    expect(cursors).toHaveLength(1);
    expect(cursors[0]).toMatchObject({
      provider: "cursor-provider",
      cursorKey: "tickets",
      cursorValue: "cursor-2",
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].scopeKey).toBe("user:sync-owner@example.com:solo");

    await expect(
      db.insert(syncDb.schema.sourceCursors).values({
        id: "cursor_duplicate_scope_key",
        scopeKey: rows[0].scopeKey,
        provider: "cursor-provider",
        cursorKey: "tickets",
        cursorValue: "duplicate",
        updatedAt: new Date().toISOString(),
        ownerEmail: OWNER,
        orgId: null,
      }),
    ).rejects.toThrow(/unique|constraint/i);
  });

  it("rolls back workbench ingest rows when sync fails after ingest", async () => {
    await expect(
      asOwner(() =>
        syncLib.syncSourceWithHooks(
          {
            provider: "atomic-provider",
            cursorKey: "tickets",
            cursorStart: "cursor-a",
            cursorEnd: "cursor-b",
            items: [
              {
                sourceId: "atomic-upstream-1",
                title: "Atomic provider ticket",
                rawRef: "archive://atomic-provider/atomic-upstream-1",
              },
            ],
          },
          {
            afterIngest: () => {
              throw new Error("simulated cursor failure");
            },
          },
        ),
      ),
    ).rejects.toThrow("simulated cursor failure");

    const workItems = await asOwner(() =>
      listWorkItemsAction.run({ provider: "atomic-provider" }),
    );
    const cursors = await asOwner(() =>
      listSourceCursorsAction.run({ provider: "atomic-provider" }),
    );
    const workbench = workbenchDb.getDb();
    const sync = syncDb.getDb();
    const ingestRuns = await workbench
      .select()
      .from(workbenchDb.schema.ingestRuns)
      .where(eq(workbenchDb.schema.ingestRuns.provider, "atomic-provider"));
    const snapshots = await workbench
      .select()
      .from(workbenchDb.schema.sourceSnapshots)
      .where(
        eq(workbenchDb.schema.sourceSnapshots.provider, "atomic-provider"),
      );
    const archives = await sync
      .select()
      .from(syncDb.schema.rawArchives)
      .where(eq(syncDb.schema.rawArchives.provider, "atomic-provider"));

    expect(workItems).toEqual([]);
    expect(cursors).toEqual([]);
    expect(ingestRuns).toHaveLength(0);
    expect(snapshots).toHaveLength(0);
    expect(archives).toHaveLength(0);
  });
});
