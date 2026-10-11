import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import type { ZodType } from "zod";

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

  it("leaves excluded items out so they do not hold up the batch", async () => {
    for (let index = 0; index < 26; index += 1) {
      const recordingId = `rec_skip_${index}`;
      await seedRecording(client, { id: recordingId });
      await seedContextItem(client, {
        id: `skip_${index}`,
        recordingId,
        createdAt: `2026-10-01T12:${String(index).padStart(2, "0")}:00.000Z`,
      });
    }
    const excludeIds = Array.from(
      { length: 25 },
      (_, index) => `skip_${index}`,
    );

    const { items } = await action.run({ excludeIds });

    expect(items.map((item) => item.id)).toEqual(["skip_25"]);
  });

  it("accepts at most 100 excluded ids", () => {
    const schema = (action as unknown as { schema: ZodType }).schema;
    const ids = (count: number) =>
      Array.from({ length: count }, (_, index) => `id_${index}`);
    expect(schema.safeParse({ excludeIds: ids(100) }).success).toBe(true);
    expect(schema.safeParse({ excludeIds: ids(101) }).success).toBe(false);
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

  describe("device scoping", () => {
    // Four items on four Clips: one with no device (a web or legacy request),
    // two captured by dev_a and dev_b, and a stale claim captured by dev_b.
    async function seedDeviceQueue() {
      for (const recordingId of [
        "rec_unowned",
        "rec_mine",
        "rec_theirs",
        "rec_theirs_stale",
      ]) {
        await seedRecording(client, { id: recordingId });
      }
      await seedContextItem(client, {
        id: "unowned",
        recordingId: "rec_unowned",
        createdAt: "2026-10-01T12:01:00.000Z",
      });
      await seedContextItem(client, {
        id: "mine",
        recordingId: "rec_mine",
        capturedDeviceId: "dev_a",
        createdAt: "2026-10-01T12:02:00.000Z",
      });
      await seedContextItem(client, {
        id: "theirs",
        recordingId: "rec_theirs",
        capturedDeviceId: "dev_b",
        createdAt: "2026-10-01T12:03:00.000Z",
      });
      await seedContextItem(client, {
        id: "theirs_stale",
        recordingId: "rec_theirs_stale",
        status: "processing",
        capturedDeviceId: "dev_b",
        createdAt: "2026-10-01T12:00:00.000Z",
      });
      await setUpdatedAt("theirs_stale", STALE_CLAIM);
    }

    it("gives a device its own items and the unowned ones, not another device's", async () => {
      await seedDeviceQueue();

      const { items } = await action.run({ deviceId: "dev_a" });

      expect(items.map((item) => item.id)).toEqual(["unowned", "mine"]);
      expect(items[1]).toMatchObject({ capturedDeviceId: "dev_a" });
    });

    it("gives a device that captured nothing only the unowned items", async () => {
      await seedDeviceQueue();

      const { items } = await action.run({ deviceId: "dev_c" });

      expect(items.map((item) => item.id)).toEqual(["unowned"]);
    });

    it("lists every device's items when no deviceId is sent, as before", async () => {
      await seedDeviceQueue();

      const { items } = await action.run({});

      expect(items.map((item) => item.id)).toEqual([
        "theirs_stale",
        "unowned",
        "mine",
        "theirs",
      ]);
    });

    it("applies excludeIds on top of the device filter", async () => {
      await seedDeviceQueue();

      const { items } = await action.run({
        deviceId: "dev_a",
        excludeIds: ["unowned"],
      });

      expect(items.map((item) => item.id)).toEqual(["mine"]);
    });

    it("accepts a deviceId of 1 to 200 characters", () => {
      const schema = (action as unknown as { schema: ZodType }).schema;
      expect(schema.safeParse({ deviceId: "d" }).success).toBe(true);
      expect(schema.safeParse({ deviceId: "d".repeat(200) }).success).toBe(
        true,
      );
      expect(schema.safeParse({ deviceId: "" }).success).toBe(false);
      expect(schema.safeParse({ deviceId: "d".repeat(201) }).success).toBe(
        false,
      );
    });
  });
});
