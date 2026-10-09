import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import {
  openRecordingContextTestDb,
  resetRecordingContextTestDb,
  seedContextItem,
  seedRecording,
  type RecordingContextTestClient,
} from "../server/lib/recording-context-test-db.js";

const mocks = vi.hoisted(() => ({
  db: undefined as unknown,
  email: "owner@example.com",
}));

vi.mock("@agent-native/core/action", () => ({
  defineAction: (options: unknown) => options,
}));

vi.mock("../server/db/index.js", async () => {
  const schema = await import("../server/db/schema.js");
  return { getDb: () => mocks.db, schema };
});

vi.mock("../server/lib/recordings.js", async () => {
  const { sql } = await import("drizzle-orm");
  return {
    getCurrentOwnerEmail: () => mocks.email,
    ownerEmailMatches: (column: unknown, email: string) =>
      sql`lower(${column as never}) = ${email}`,
  };
});

import action from "./list-pending-recording-context";

let client: RecordingContextTestClient;

// The clock is pinned so the harness's default timestamps (12:00:01) are fresh
// claims. Stale claims are set explicitly with setUpdatedAt. The cutoff is
// NOW minus 10 minutes, 11:55:00.
const NOW = "2026-10-01T12:05:00.000Z";
const FRESH_CLAIM = "2026-10-01T12:04:00.000Z";
const CUTOFF_CLAIM = "2026-10-01T11:55:00.000Z";
const STALE_CLAIM = "2026-10-01T11:50:00.000Z";

beforeAll(async () => {
  const opened = await openRecordingContextTestDb();
  client = opened.client;
  mocks.db = opened.db;
});

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(NOW));
  await resetRecordingContextTestDb(client);
  mocks.email = "owner@example.com";
});

afterAll(async () => {
  vi.useRealTimers();
  await client.close();
});

async function setUpdatedAt(id: string, updatedAt: string) {
  await client.query(
    `UPDATE recording_context_items SET updated_at = $1 WHERE id = $2`,
    [updatedAt, id],
  );
}

describe("list-pending-recording-context", () => {
  it("returns pending items on Clips the signed-in user owns, not fresh processing claims", async () => {
    await seedRecording(client, { id: "rec_pending" });
    await seedRecording(client, { id: "rec_processing" });
    await seedRecording(client, { id: "rec_ready" });
    await seedRecording(client, { id: "rec_failed" });
    await seedRecording(client, { id: "rec_removed" });
    await seedRecording(client, {
      id: "rec_other",
      ownerEmail: "someone-else@example.com",
    });
    await seedContextItem(client, {
      id: "pending",
      recordingId: "rec_pending",
    });
    await seedContextItem(client, {
      id: "processing",
      recordingId: "rec_processing",
      status: "processing",
    });
    await seedContextItem(client, {
      id: "ready",
      recordingId: "rec_ready",
      status: "ready",
      mediaRecordingId: "media_1",
    });
    await seedContextItem(client, {
      id: "failed",
      recordingId: "rec_failed",
      status: "failed",
    });
    await seedContextItem(client, {
      id: "removed",
      recordingId: "rec_removed",
      status: "removed",
    });
    await seedContextItem(client, {
      id: "other_owner_pending",
      recordingId: "rec_other",
    });

    const { items } = await action.run({});

    expect(items.map((item) => item.id)).toEqual(["pending"]);
    expect(items[0]).toMatchObject({
      recordingId: "rec_pending",
      status: "pending",
      requestedSeconds: 30,
    });
  });

  it("returns the oldest pending items first", async () => {
    await seedRecording(client, { id: "rec_new" });
    await seedRecording(client, { id: "rec_old" });
    await seedContextItem(client, {
      id: "new",
      recordingId: "rec_new",
      createdAt: "2026-10-01T12:05:00.000Z",
    });
    await seedContextItem(client, {
      id: "old",
      recordingId: "rec_old",
      createdAt: "2026-10-01T12:01:00.000Z",
    });

    const { items } = await action.run({});

    expect(items.map((item) => item.id)).toEqual(["old", "new"]);
  });

  it("caps one poll at 25 items so a long offline backlog drains in batches", async () => {
    for (let index = 0; index < 30; index += 1) {
      const recordingId = `rec_batch_${index}`;
      await seedRecording(client, { id: recordingId });
      await seedContextItem(client, {
        id: `batch_${index}`,
        recordingId,
        createdAt: `2026-10-01T12:${String(index).padStart(2, "0")}:00.000Z`,
      });
    }

    const { items } = await action.run({});

    expect(items).toHaveLength(25);
    expect(items[0]?.id).toBe("batch_0");
  });

  it("returns an empty list when nothing is pending", async () => {
    await expect(action.run({})).resolves.toEqual({ items: [] });
  });

  it("does not list a processing claim updated inside the stale window", async () => {
    await seedRecording(client, { id: "rec_fresh" });
    await seedRecording(client, { id: "rec_at_cutoff" });
    await seedContextItem(client, {
      id: "fresh",
      recordingId: "rec_fresh",
      status: "processing",
    });
    await seedContextItem(client, {
      id: "at_cutoff",
      recordingId: "rec_at_cutoff",
      status: "processing",
    });
    await setUpdatedAt("fresh", FRESH_CLAIM);
    // Stale means strictly older than the cutoff.
    await setUpdatedAt("at_cutoff", CUTOFF_CLAIM);

    await expect(action.run({})).resolves.toEqual({ items: [] });
  });

  it("lists a processing claim older than the stale window in the same oldest-first queue", async () => {
    await seedRecording(client, { id: "rec_stale" });
    await seedRecording(client, { id: "rec_pending" });
    await seedRecording(client, {
      id: "rec_stale_other",
      ownerEmail: "someone-else@example.com",
    });
    await seedContextItem(client, {
      id: "stale",
      recordingId: "rec_stale",
      status: "processing",
      createdAt: "2026-10-01T11:00:00.000Z",
    });
    await seedContextItem(client, {
      id: "pending",
      recordingId: "rec_pending",
    });
    await seedContextItem(client, {
      id: "stale_other_owner",
      recordingId: "rec_stale_other",
      status: "processing",
      createdAt: "2026-10-01T11:00:00.000Z",
    });
    await setUpdatedAt("stale", STALE_CLAIM);
    await setUpdatedAt("stale_other_owner", STALE_CLAIM);

    const { items } = await action.run({});

    expect(items.map((item) => item.id)).toEqual(["stale", "pending"]);
    expect(items[0]).toMatchObject({
      recordingId: "rec_stale",
      status: "processing",
    });
  });
});
