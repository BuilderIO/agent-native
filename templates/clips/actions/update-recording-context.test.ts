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
  readContextItemRow,
  seedContextItem,
  seedRecording,
  type RecordingContextTestClient,
} from "../server/lib/recording-context-test-db.js";

const mocks = vi.hoisted(() => ({
  db: undefined as unknown,
  roles: {} as Record<string, "viewer" | "editor" | "owner" | undefined>,
}));

vi.mock("@agent-native/core/action", async () => {
  const fakes = await import("../server/lib/recording-context-test-db.js");
  return { defineAction: (options: unknown) => options, fail: fakes.testFail };
});

vi.mock("@agent-native/core/sharing", async () => {
  const fakes = await import("../server/lib/recording-context-test-db.js");
  return {
    assertAccess: (
      _type: string,
      id: string,
      minRole?: "viewer" | "editor" | "owner",
    ) => fakes.testAssertAccess(mocks.roles, id, minRole),
  };
});

vi.mock("../server/db/index.js", async () => {
  const schema = await import("../server/db/schema.js");
  return { getDb: () => mocks.db, schema };
});

import action from "./update-recording-context";

// The defineAction mock returns its options, so the zod input schema is reachable.
const inputSchema = (action as unknown as { schema: ZodType }).schema;

let client: RecordingContextTestClient;

// The clock is pinned so the harness's default timestamps (12:00:01) are fresh
// claims. Stale claims are set explicitly with setUpdatedAt. The cutoff is
// NOW minus 10 minutes, 11:55:00.
const NOW = "2026-10-01T12:05:00.000Z";
const FRESH_CLAIM = "2026-10-01T12:04:00.000Z";
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
  mocks.roles = { rec_1: "owner", media_1: "owner" };
  await seedRecording(client, { id: "rec_1" });
  await seedRecording(client, { id: "media_1" });
});

afterAll(async () => {
  vi.useRealTimers();
  await client.close();
});

async function statusOf(id: string) {
  return (await readContextItemRow(client, id))?.status;
}

async function setUpdatedAt(id: string, updatedAt: string) {
  await client.query(
    `UPDATE recording_context_items SET updated_at = $1 WHERE id = $2`,
    [updatedAt, id],
  );
}

describe("update-recording-context", () => {
  it("claims a pending item as processing", async () => {
    await seedContextItem(client, { id: "item", status: "pending" });

    await expect(
      action.run({ id: "item", status: "processing" }),
    ).resolves.toMatchObject({ id: "item", status: "processing", error: null });
    expect(await statusOf("item")).toBe("processing");
  });

  it("stores the private footage recording on ready, from processing", async () => {
    await seedContextItem(client, { id: "item", status: "processing" });

    await expect(
      action.run({
        id: "item",
        status: "ready",
        mediaRecordingId: "media_1",
        durationMs: 30_000,
        width: 1280,
        height: 720,
      }),
    ).resolves.toMatchObject({
      status: "ready",
      mediaRecordingId: "media_1",
      durationMs: 30_000,
      width: 1280,
      height: 720,
      error: null,
    });
  });

  it("clears stored dimensions when a ready update omits them", async () => {
    await seedContextItem(client, { id: "item", status: "processing" });
    await client.query(
      `UPDATE recording_context_items SET width = 640, height = 480 WHERE id = 'item'`,
    );

    const ready = await action.run({
      id: "item",
      status: "ready",
      mediaRecordingId: "media_1",
      durationMs: 30_000,
    });

    expect(ready).toMatchObject({ width: null, height: null });
  });

  it("records the error on failed, from processing", async () => {
    await seedContextItem(client, { id: "item", status: "processing" });

    await expect(
      action.run({ id: "item", status: "failed", error: "Export timed out." }),
    ).resolves.toMatchObject({ status: "failed", error: "Export timed out." });
    expect(await readContextItemRow(client, "item")).toMatchObject({
      media_recording_id: null,
    });
  });

  it("rejects every transition that does not start from the required state", async () => {
    const cases: Array<{
      from: string;
      update: Parameters<typeof action.run>[0];
    }> = [
      {
        from: "pending",
        update: {
          id: "item",
          status: "ready",
          mediaRecordingId: "media_1",
          durationMs: 1000,
        },
      },
      { from: "pending", update: { id: "item", status: "failed", error: "x" } },
      { from: "processing", update: { id: "item", status: "processing" } },
      { from: "ready", update: { id: "item", status: "processing" } },
      { from: "removed", update: { id: "item", status: "processing" } },
    ];
    for (const { from, update } of cases) {
      await client.query(`DELETE FROM recording_context_items`);
      await seedContextItem(client, { id: "item", status: from });

      await expect(action.run(update)).rejects.toMatchObject({
        errorCode: "recording_context_invalid_transition",
        statusCode: 409,
      });
      expect(await statusOf("item")).toBe(from);
    }
  });

  it("rejects a late worker result after the window was reset to pending", async () => {
    await seedContextItem(client, { id: "item", status: "processing" });
    // What set-recording-context-window does while an export is running.
    await client.query(
      `UPDATE recording_context_items SET status = 'pending' WHERE id = 'item'`,
    );

    await expect(
      action.run({
        id: "item",
        status: "ready",
        mediaRecordingId: "media_1",
        durationMs: 30_000,
      }),
    ).rejects.toMatchObject({ statusCode: 409 });
    expect(await statusOf("item")).toBe("pending");
  });

  it("requires mediaRecordingId and durationMs for ready", async () => {
    await seedContextItem(client, { id: "item", status: "processing" });

    await expect(
      action.run({ id: "item", status: "ready", durationMs: 30_000 }),
    ).rejects.toMatchObject({ statusCode: 400 });
    await expect(
      action.run({ id: "item", status: "ready", mediaRecordingId: "media_1" }),
    ).rejects.toMatchObject({ statusCode: 400 });
    expect(await statusOf("item")).toBe("processing");
  });

  it("requires an error for failed", async () => {
    await seedContextItem(client, { id: "item", status: "processing" });

    await expect(
      action.run({ id: "item", status: "failed" }),
    ).rejects.toMatchObject({ statusCode: 400 });
    expect(await statusOf("item")).toBe("processing");
  });

  it("rejects footage fields on a status that does not carry them", async () => {
    await seedContextItem(client, { id: "item", status: "pending" });

    await expect(
      action.run({ id: "item", status: "processing", durationMs: 30_000 }),
    ).rejects.toMatchObject({ statusCode: 400 });
    await expect(
      action.run({
        id: "item",
        status: "failed",
        error: "x",
        mediaRecordingId: "media_1",
      }),
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  it("rejects footage the caller cannot access as the owner", async () => {
    await seedContextItem(client, { id: "item", status: "processing" });
    await seedRecording(client, {
      id: "media_other",
      ownerEmail: "other@example.com",
    });
    mocks.roles = { rec_1: "owner" };

    await expect(
      action.run({
        id: "item",
        status: "ready",
        mediaRecordingId: "media_other",
        durationMs: 30_000,
      }),
    ).rejects.toMatchObject({ statusCode: 403 });
    expect(await statusOf("item")).toBe("processing");
  });

  it("rejects footage that is not a private recording", async () => {
    await seedContextItem(client, { id: "item", status: "processing" });
    await seedRecording(client, { id: "media_org", visibility: "org" });
    mocks.roles = { rec_1: "owner", media_org: "owner" };

    await expect(
      action.run({
        id: "item",
        status: "ready",
        mediaRecordingId: "media_org",
        durationMs: 30_000,
      }),
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  it("rejects the Clip itself as its own footage", async () => {
    await seedContextItem(client, { id: "item", status: "processing" });

    await expect(
      action.run({
        id: "item",
        status: "ready",
        mediaRecordingId: "rec_1",
        durationMs: 30_000,
      }),
    ).rejects.toMatchObject({ statusCode: 400 });
    expect(await statusOf("item")).toBe("processing");
  });

  it("requires owner access to the item's Clip", async () => {
    await seedContextItem(client, { id: "item", status: "pending" });
    mocks.roles = { rec_1: "viewer" };

    await expect(
      action.run({ id: "item", status: "processing" }),
    ).rejects.toMatchObject({ statusCode: 403 });
    expect(await statusOf("item")).toBe("pending");
  });

  it("returns not found for an unknown item", async () => {
    await expect(
      action.run({ id: "missing", status: "processing" }),
    ).rejects.toMatchObject({
      errorCode: "recording_context_not_found",
      statusCode: 404,
    });
  });

  it("re-claims a stale processing item, refreshes its claim, and lets the new worker finish", async () => {
    await seedContextItem(client, { id: "item", status: "processing" });
    await setUpdatedAt("item", STALE_CLAIM);

    await expect(
      action.run({ id: "item", status: "processing" }),
    ).resolves.toMatchObject({ id: "item", status: "processing", error: null });
    expect(await readContextItemRow(client, "item")).toMatchObject({
      updated_at: NOW,
    });

    // The refreshed claim is fresh, so a second worker is turned away.
    await expect(
      action.run({ id: "item", status: "processing" }),
    ).rejects.toMatchObject({
      errorCode: "recording_context_invalid_transition",
      statusCode: 409,
    });
    await expect(
      action.run({
        id: "item",
        status: "ready",
        mediaRecordingId: "media_1",
        durationMs: 30_000,
      }),
    ).resolves.toMatchObject({ status: "ready" });
  });

  it("does not re-claim a processing item whose claim is still inside the stale window", async () => {
    await seedContextItem(client, { id: "item", status: "processing" });
    await setUpdatedAt("item", FRESH_CLAIM);

    await expect(
      action.run({ id: "item", status: "processing" }),
    ).rejects.toMatchObject({
      errorCode: "recording_context_invalid_transition",
      statusCode: 409,
    });
    expect(await statusOf("item")).toBe("processing");
    expect(await readContextItemRow(client, "item")).toMatchObject({
      updated_at: FRESH_CLAIM,
    });
  });

  it("keeps ready and failed gated on processing, even when the item is stale", async () => {
    await seedContextItem(client, { id: "pending", status: "pending" });
    await setUpdatedAt("pending", STALE_CLAIM);

    await expect(
      action.run({
        id: "pending",
        status: "ready",
        mediaRecordingId: "media_1",
        durationMs: 30_000,
      }),
    ).rejects.toMatchObject({ statusCode: 409 });
    await expect(
      action.run({ id: "pending", status: "failed", error: "x" }),
    ).rejects.toMatchObject({ statusCode: 409 });
    expect(await statusOf("pending")).toBe("pending");
  });

  it("does not re-claim a stale ready or failed item", async () => {
    for (const status of ["ready", "failed"]) {
      await client.query(`DELETE FROM recording_context_items`);
      await seedContextItem(client, { id: "item", status });
      await setUpdatedAt("item", STALE_CLAIM);

      await expect(
        action.run({ id: "item", status: "processing" }),
      ).rejects.toMatchObject({
        errorCode: "recording_context_invalid_transition",
        statusCode: 409,
      });
      expect(await statusOf("item")).toBe(status);
    }
  });

  it("accepts only processing, ready, or failed as a worker status", () => {
    for (const status of ["pending", "removed"]) {
      expect(inputSchema.safeParse({ id: "item", status }).success).toBe(false);
    }
  });
});
