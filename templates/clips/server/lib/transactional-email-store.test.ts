import { createClient, type Client } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let db: ReturnType<typeof drizzle>;
let sqlite: Client;

vi.mock("../db/index.js", async () => {
  const schema = await import("../db/schema.js");
  return { getDb: () => db, schema };
});

import { createTransactionalEmailStore } from "./transactional-email-store";

const firstViewPayload = {
  type: "first-view" as const,
  recipient: "viewer@example.com",
  recordingIds: ["recording-1"],
  shareId: "share-1",
  requestedBy: "owner@example.com",
};

async function createTables() {
  await sqlite.execute(`CREATE TABLE clips_transactional_email_jobs (
    logical_key TEXT PRIMARY KEY, type TEXT NOT NULL, state TEXT NOT NULL,
    recipient TEXT NOT NULL, recording_ids_json TEXT NOT NULL, share_id TEXT,
    requested_by TEXT, month TEXT, generated_summary TEXT, attempts INTEGER NOT NULL,
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL, ai_dispatched_at TEXT,
    ai_claimed_by TEXT, ready_at TEXT, sending_at TEXT, sent_at TEXT,
    cancelled_at TEXT, failed_at TEXT, last_error TEXT, lease_until TEXT,
    lease_token TEXT
  )`);
  await sqlite.execute(`CREATE TABLE clips_transactional_email_configs (
    id TEXT PRIMARY KEY, config_json TEXT NOT NULL
  )`);
}

beforeEach(async () => {
  sqlite = createClient({ url: ":memory:" });
  db = drizzle(sqlite);
  await createTables();
});

afterEach(async () => {
  await sqlite.close();
});

describe("transactional email store", () => {
  it("uses SQL uniqueness to make enqueue idempotent", async () => {
    const store = createTransactionalEmailStore();
    const results = await Promise.all([
      store.enqueue("first-view:share-1", firstViewPayload),
      store.enqueue("first-view:share-1", firstViewPayload),
    ]);

    expect(results.filter((result) => result.created)).toHaveLength(1);
    expect(results[0].job).toEqual(results[1].job);
    expect(await store.listJobs()).toHaveLength(1);
  });

  it("validates payloads before persisting a job", async () => {
    const store = createTransactionalEmailStore();
    await expect(
      store.enqueue("two-clips:owner", {
        type: "two-clips",
        recipient: "owner@example.com",
        recordingIds: ["recording-1"],
      }),
    ).rejects.toThrow();
    expect(await store.listJobs()).toEqual([]);
  });

  it("lists only requested job states", async () => {
    const store = createTransactionalEmailStore();
    await store.enqueue("first-view:pending", firstViewPayload);
    await store.enqueue(
      "first-view:awaiting-ai",
      firstViewPayload,
      "awaiting_ai",
    );

    await expect(store.listJobs(["pending"])).resolves.toMatchObject([
      { logicalKey: "first-view:pending", state: "pending" },
    ]);
  });

  it("claims AI work once and enforces valid transitions", async () => {
    const store = createTransactionalEmailStore();
    await store.enqueue("first-view:share-1", firstViewPayload, "awaiting_ai");

    await expect(
      store.transition("first-view:share-1", ["awaiting_ai"], "sent"),
    ).rejects.toThrow("Invalid transactional email transition");
    const [firstClaim, secondClaim] = await Promise.all([
      store.claimNextAwaitingAi(),
      store.claimNextAwaitingAi(),
    ]);
    expect([firstClaim, secondClaim].filter(Boolean)).toHaveLength(1);
  });

  it("preserves claimant fencing and reclaims only stale AI dispatches", async () => {
    let currentTime = new Date("2026-08-01T12:00:00.000Z");
    const store = createTransactionalEmailStore({ now: () => currentTime });
    const logicalKey = "two-clips:recipient@example.com";
    await store.enqueue(
      logicalKey,
      {
        type: "two-clips",
        recipient: "recipient@example.com",
        recordingIds: ["recording-1", "recording-2"],
        requestedBy: "sender@example.com",
      },
      "awaiting_ai",
    );
    await store.claimAwaitingAi(logicalKey, "first@example.com");

    await expect(
      store.completeClaimedAi(logicalKey, "other@example.com", "One sentence."),
    ).resolves.toBeNull();
    currentTime = new Date("2026-08-01T12:30:00.000Z");
    await expect(
      store.reclaimStaleAiDispatch(
        logicalKey,
        "second@example.com",
        new Date("2026-08-01T12:00:00.000Z"),
      ),
    ).resolves.toMatchObject({
      state: "ai_dispatched",
      aiClaimedBy: "second@example.com",
    });
  });

  it("fences stale sending leases", async () => {
    let currentTime = new Date("2026-08-01T12:00:00.000Z");
    const store = createTransactionalEmailStore({ now: () => currentTime });
    await store.enqueue("first-view:share-1", firstViewPayload);
    await store.transition("first-view:share-1", ["pending"], "ready");
    const firstLease = await store.acquireSendingLease(
      "first-view:share-1",
      60_000,
    );

    currentTime = new Date("2026-08-01T12:01:00.000Z");
    const reclaimed = await store.acquireSendingLease(
      "first-view:share-1",
      30_000,
    );
    expect(reclaimed).toMatchObject({ state: "sending", attempts: 2 });
    await expect(
      store.transitionSending(
        "first-view:share-1",
        firstLease!.leaseToken!,
        "sent",
      ),
    ).resolves.toBeNull();
    await expect(
      store.transitionSending(
        "first-view:share-1",
        reclaimed!.leaseToken!,
        "sent",
      ),
    ).resolves.toMatchObject({ state: "sent", leaseToken: null });
  });

  it("persists enabledAt and reconciliation cursors in SQL", async () => {
    const store = createTransactionalEmailStore({
      now: () => new Date("2026-08-02T10:00:00.000Z"),
    });
    await expect(store.ensureEnabledAt()).resolves.toEqual({
      enabledAt: "2026-08-02T10:00:00.000Z",
    });
    await expect(
      store.updateReconciliationCursor("reminderCursor", {
        createdAt: "2026-08-03T10:00:00.000Z",
        id: "share-100",
      }),
    ).resolves.toMatchObject({ reminderCursor: { id: "share-100" } });
  });

  it("preserves concurrent reconciliation cursor updates", async () => {
    const store = createTransactionalEmailStore();
    await store.ensureEnabledAt();

    await expect(
      Promise.all([
        store.updateReconciliationCursor("reminderCursor", {
          createdAt: "2026-08-03T10:00:00.000Z",
          id: "share-100",
        }),
        store.updateReconciliationCursor("firstViewCursor", {
          createdAt: "2026-08-03T10:00:00.000Z",
          id: "view-100",
        }),
      ]),
    ).resolves.toHaveLength(2);
    await expect(store.readConfig()).resolves.toMatchObject({
      reminderCursor: { id: "share-100" },
      firstViewCursor: { id: "view-100" },
    });
  });

  it("converges an unsent first-import job", async () => {
    const store = createTransactionalEmailStore();
    await store.enqueue("first-import:owner@example.com", {
      type: "first-import",
      recipient: "owner@example.com",
      recordingIds: ["recording-newer"],
      requestedBy: "owner@example.com",
    });
    await store.transition(
      "first-import:owner@example.com",
      ["pending"],
      "cancelled",
    );

    await expect(
      store.enqueueOrConvergeFirstImport(
        "owner@example.com",
        "recording-older",
        "owner@example.com",
      ),
    ).resolves.toMatchObject({
      created: false,
      job: { state: "pending", recordingIds: ["recording-older"] },
    });
  });

  it("does not overwrite a concurrently converged first-import job", async () => {
    const store = createTransactionalEmailStore();
    await store.enqueue("first-import:owner@example.com", {
      type: "first-import",
      recipient: "owner@example.com",
      recordingIds: ["recording-original"],
      requestedBy: "owner@example.com",
    });

    const results = await Promise.all([
      store.enqueueOrConvergeFirstImport(
        "owner@example.com",
        "recording-first",
        "owner@example.com",
      ),
      store.enqueueOrConvergeFirstImport(
        "owner@example.com",
        "recording-second",
        "owner@example.com",
      ),
    ]);
    expect(results[0].job).toEqual(results[1].job);
  });
});
