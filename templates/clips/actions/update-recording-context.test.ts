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
  traceItemWrites,
  type RecordingContextTestClient,
} from "../server/lib/recording-context-test-db.js";
import { SCREEN_HISTORY_FOOTAGE_SOURCE_APP_NAME } from "../server/lib/recording-context.js";

const mocks = vi.hoisted(() => {
  // "trash" is pushed by the trash fake and "update" by the item-row write, in
  // the order they happen.
  const events: string[] = [];
  return {
    db: undefined as unknown,
    events,
    roles: {} as Record<string, "viewer" | "editor" | "owner" | undefined>,
    trash: vi.fn(async (args: { id: string }) => {
      events.push("trash");
      return { id: args.id };
    }),
  };
});

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

vi.mock("../server/lib/recordings.js", async () => {
  const { sql } = await import("drizzle-orm");
  return {
    getCurrentOwnerEmail: () => "owner@example.com",
    ownerEmailMatches: (column: unknown, email: string) =>
      sql`lower(${column as never}) = ${email}`,
  };
});

vi.mock("./trash-recording.js", () => ({
  default: { run: (args: { id: string }) => mocks.trash(args) },
}));

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
  mocks.db = traceItemWrites(opened.db, mocks.events);
});

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(NOW));
  await resetRecordingContextTestDb(client);
  mocks.trash.mockClear();
  mocks.events.length = 0;
  mocks.roles = { rec_1: "owner", media_1: "owner" };
  await seedRecording(client, { id: "rec_1" });
  await seedRecording(client, {
    id: "media_1",
    sourceAppName: SCREEN_HISTORY_FOOTAGE_SOURCE_APP_NAME,
  });
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

async function seedFootage(id: string) {
  await seedRecording(client, {
    id,
    sourceAppName: SCREEN_HISTORY_FOOTAGE_SOURCE_APP_NAME,
  });
  mocks.roles = { ...mocks.roles, [id]: "owner" };
}

describe("update-recording-context", () => {
  it("claims a pending item as processing", async () => {
    await seedContextItem(client, { id: "item", status: "pending" });

    await expect(
      action.run({ id: "item", status: "processing" }),
    ).resolves.toMatchObject({ id: "item", status: "processing", error: null });
    expect(await statusOf("item")).toBe("processing");
  });

  it("reserves the footage a claim names", async () => {
    await seedContextItem(client, { id: "item", status: "pending" });

    await expect(
      action.run({
        id: "item",
        status: "processing",
        mediaRecordingId: "media_1",
      }),
    ).resolves.toMatchObject({
      status: "processing",
      pendingMediaRecordingId: "media_1",
    });
  });

  it("stores the private footage recording on ready, from processing", async () => {
    await seedContextItem(client, { id: "item", status: "pending" });
    await action.run({
      id: "item",
      status: "processing",
      mediaRecordingId: "media_1",
    });

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
      pendingMediaRecordingId: null,
      durationMs: 30_000,
      width: 1280,
      height: 720,
      error: null,
    });
  });

  it("clears stored dimensions when a ready update omits them", async () => {
    await seedContextItem(client, {
      id: "item",
      status: "processing",
      pendingMediaRecordingId: "media_1",
    });
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

  it("records the error on failed and releases the reservation", async () => {
    await seedContextItem(client, {
      id: "item",
      status: "processing",
      pendingMediaRecordingId: "media_1",
    });

    await expect(
      action.run({ id: "item", status: "failed", error: "Export timed out." }),
    ).resolves.toMatchObject({
      status: "failed",
      error: "Export timed out.",
      pendingMediaRecordingId: null,
    });
    expect(await readContextItemRow(client, "item")).toMatchObject({
      media_recording_id: null,
      pending_media_recording_id: null,
    });
    expect(mocks.trash.mock.calls).toEqual([[{ id: "media_1" }]]);
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
    await seedContextItem(client, {
      id: "item",
      status: "processing",
      pendingMediaRecordingId: "media_1",
    });
    // What set-recording-context-window does while an export is running: it
    // returns the item to pending and releases the reservation.
    await client.query(
      `UPDATE recording_context_items SET status = 'pending', pending_media_recording_id = NULL WHERE id = 'item'`,
    );

    await expect(
      action.run({
        id: "item",
        status: "ready",
        mediaRecordingId: "media_1",
        durationMs: 30_000,
      }),
    ).rejects.toMatchObject({
      errorCode: "recording_context_invalid_transition",
      statusCode: 409,
    });
    expect(await statusOf("item")).toBe("pending");
  });

  it("requires mediaRecordingId and durationMs for ready", async () => {
    await seedContextItem(client, {
      id: "item",
      status: "processing",
      pendingMediaRecordingId: "media_1",
    });

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
    expect(await statusOf("item")).toBe("pending");
  });

  it("rejects footage the caller cannot access as the owner", async () => {
    await seedContextItem(client, { id: "item", status: "processing" });
    await seedRecording(client, {
      id: "media_other",
      ownerEmail: "other@example.com",
      sourceAppName: SCREEN_HISTORY_FOOTAGE_SOURCE_APP_NAME,
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
    await seedContextItem(client, { id: "item", status: "pending" });
    await seedRecording(client, {
      id: "media_org",
      visibility: "org",
      sourceAppName: SCREEN_HISTORY_FOOTAGE_SOURCE_APP_NAME,
    });
    mocks.roles = { rec_1: "owner", media_org: "owner" };

    await expect(
      action.run({
        id: "item",
        status: "processing",
        mediaRecordingId: "media_org",
      }),
    ).rejects.toMatchObject({ statusCode: 400 });
    expect(await statusOf("item")).toBe("pending");
  });

  it("rejects a private recording that is not Rewind footage", async () => {
    await seedContextItem(client, { id: "item", status: "pending" });
    // An ordinary Clip: private, owned, but not made by the Rewind export.
    await seedRecording(client, { id: "media_plain" });
    mocks.roles = { rec_1: "owner", media_plain: "owner" };

    await expect(
      action.run({
        id: "item",
        status: "processing",
        mediaRecordingId: "media_plain",
      }),
    ).rejects.toMatchObject({ statusCode: 400 });
    expect(await readContextItemRow(client, "item")).toMatchObject({
      status: "pending",
      pending_media_recording_id: null,
    });
  });

  it("rejects the Clip itself as its own footage", async () => {
    await seedContextItem(client, { id: "item", status: "pending" });

    await expect(
      action.run({
        id: "item",
        status: "processing",
        mediaRecordingId: "rec_1",
      }),
    ).rejects.toMatchObject({ statusCode: 400 });
    expect(await statusOf("item")).toBe("pending");
  });

  it("refuses a ready whose footage is not the reserved footage", async () => {
    await seedContextItem(client, {
      id: "item",
      status: "processing",
      pendingMediaRecordingId: "media_1",
    });
    await seedFootage("media_2");

    await expect(
      action.run({
        id: "item",
        status: "ready",
        mediaRecordingId: "media_2",
        durationMs: 30_000,
      }),
    ).rejects.toMatchObject({
      errorCode: "recording_context_footage_mismatch",
      statusCode: 409,
    });
    expect(await readContextItemRow(client, "item")).toMatchObject({
      status: "processing",
      media_recording_id: null,
      pending_media_recording_id: "media_1",
    });
  });

  it("refuses a stale worker's ready after another claim replaced its footage", async () => {
    await seedContextItem(client, {
      id: "item",
      status: "processing",
      pendingMediaRecordingId: "media_1",
    });
    await setUpdatedAt("item", STALE_CLAIM);
    await seedFootage("media_2");

    // A second worker re-claims the stale item with its own footage.
    await expect(
      action.run({
        id: "item",
        status: "processing",
        mediaRecordingId: "media_2",
      }),
    ).resolves.toMatchObject({
      status: "processing",
      pendingMediaRecordingId: "media_2",
    });

    // The first worker finishes late with the footage it made.
    await expect(
      action.run({
        id: "item",
        status: "ready",
        mediaRecordingId: "media_1",
        durationMs: 30_000,
      }),
    ).rejects.toMatchObject({
      errorCode: "recording_context_footage_mismatch",
      statusCode: 409,
    });
    expect(await readContextItemRow(client, "item")).toMatchObject({
      status: "processing",
      media_recording_id: null,
      pending_media_recording_id: "media_2",
    });
    // Only the replaced reservation was trashed; the refused ready trashed nothing.
    expect(mocks.trash.mock.calls).toEqual([[{ id: "media_1" }]]);

    // The current claim's worker lands its footage.
    await expect(
      action.run({
        id: "item",
        status: "ready",
        mediaRecordingId: "media_2",
        durationMs: 30_000,
      }),
    ).resolves.toMatchObject({
      status: "ready",
      mediaRecordingId: "media_2",
      pendingMediaRecordingId: null,
    });
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
    await seedContextItem(client, {
      id: "item",
      status: "processing",
      pendingMediaRecordingId: "media_1",
    });
    await setUpdatedAt("item", STALE_CLAIM);

    await expect(
      action.run({
        id: "item",
        status: "processing",
        mediaRecordingId: "media_1",
      }),
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

  it("trashes the footage a stale claim displaces when it reserves other footage", async () => {
    await seedContextItem(client, {
      id: "item",
      status: "processing",
      pendingMediaRecordingId: "media_1",
    });
    await setUpdatedAt("item", STALE_CLAIM);
    await seedFootage("media_2");

    await action.run({
      id: "item",
      status: "processing",
      mediaRecordingId: "media_2",
    });

    expect(mocks.trash.mock.calls).toEqual([[{ id: "media_1" }]]);
    expect(await readContextItemRow(client, "item")).toMatchObject({
      status: "processing",
      pending_media_recording_id: "media_2",
    });
  });

  it("trashes the displaced footage when a stale claim names none", async () => {
    await seedContextItem(client, {
      id: "item",
      status: "processing",
      pendingMediaRecordingId: "media_1",
    });
    await setUpdatedAt("item", STALE_CLAIM);

    await action.run({ id: "item", status: "processing" });

    expect(mocks.trash.mock.calls).toEqual([[{ id: "media_1" }]]);
    expect(await readContextItemRow(client, "item")).toMatchObject({
      pending_media_recording_id: null,
    });
  });

  it("keeps the footage when a stale claim reserves the same footage again", async () => {
    await seedContextItem(client, {
      id: "item",
      status: "processing",
      pendingMediaRecordingId: "media_1",
    });
    await setUpdatedAt("item", STALE_CLAIM);

    await action.run({
      id: "item",
      status: "processing",
      mediaRecordingId: "media_1",
    });

    expect(mocks.trash).not.toHaveBeenCalled();
  });

  it("trashes nothing when a transition is rejected", async () => {
    await seedContextItem(client, {
      id: "item",
      status: "processing",
      pendingMediaRecordingId: "media_1",
    });
    await seedFootage("media_2");

    // The claim is fresh, so a second claim is turned away.
    await expect(
      action.run({
        id: "item",
        status: "processing",
        mediaRecordingId: "media_2",
      }),
    ).rejects.toMatchObject({
      errorCode: "recording_context_invalid_transition",
      statusCode: 409,
    });
    // A ready for footage other than the reserved footage is refused too.
    await expect(
      action.run({
        id: "item",
        status: "ready",
        mediaRecordingId: "media_2",
        durationMs: 30_000,
      }),
    ).rejects.toMatchObject({
      errorCode: "recording_context_footage_mismatch",
      statusCode: 409,
    });

    expect(mocks.trash).not.toHaveBeenCalled();
    expect(await readContextItemRow(client, "item")).toMatchObject({
      status: "processing",
      pending_media_recording_id: "media_1",
    });
  });

  it("never trashes the footage a ready update makes the item's media", async () => {
    await seedContextItem(client, {
      id: "item",
      status: "processing",
      pendingMediaRecordingId: "media_1",
    });

    await action.run({
      id: "item",
      status: "ready",
      mediaRecordingId: "media_1",
      durationMs: 30_000,
    });

    expect(mocks.trash).not.toHaveBeenCalled();
    expect(await readContextItemRow(client, "item")).toMatchObject({
      status: "ready",
      media_recording_id: "media_1",
    });
  });

  it("keeps footage the item still references when a failure releases the same footage", async () => {
    // A re-export reserved the footage the item already shows as its media.
    await seedContextItem(client, {
      id: "item",
      status: "processing",
      mediaRecordingId: "media_1",
      pendingMediaRecordingId: "media_1",
    });

    await action.run({
      id: "item",
      status: "failed",
      error: "Export timed out.",
    });

    expect(mocks.trash).not.toHaveBeenCalled();
    expect(await readContextItemRow(client, "item")).toMatchObject({
      status: "failed",
      media_recording_id: "media_1",
      pending_media_recording_id: null,
    });
  });

  it("keeps footage that another live item references", async () => {
    await seedContextItem(client, {
      id: "other",
      recordingId: "rec_2",
      status: "ready",
      mediaRecordingId: "media_1",
    });
    await seedContextItem(client, {
      id: "item",
      status: "processing",
      pendingMediaRecordingId: "media_1",
    });

    await action.run({
      id: "item",
      status: "failed",
      error: "Export timed out.",
    });

    expect(mocks.trash).not.toHaveBeenCalled();
  });

  it("releases a reservation whose footage is already gone without a trash", async () => {
    await seedContextItem(client, {
      id: "item",
      status: "processing",
      pendingMediaRecordingId: "media_deleted",
    });

    await expect(
      action.run({ id: "item", status: "failed", error: "Export timed out." }),
    ).resolves.toMatchObject({
      status: "failed",
      pendingMediaRecordingId: null,
    });
    expect(mocks.trash).not.toHaveBeenCalled();
  });

  it("trashes a failed transition's reservation before clearing it", async () => {
    await seedContextItem(client, {
      id: "item",
      status: "processing",
      pendingMediaRecordingId: "media_1",
    });

    await action.run({
      id: "item",
      status: "failed",
      error: "Export timed out.",
    });

    expect(mocks.events).toEqual(["trash", "update"]);
    expect(mocks.trash.mock.calls).toEqual([[{ id: "media_1" }]]);
    expect(await readContextItemRow(client, "item")).toMatchObject({
      status: "failed",
      pending_media_recording_id: null,
    });
  });

  it("keeps a failed transition's reservation and throws when its trash fails", async () => {
    await seedContextItem(client, {
      id: "item",
      status: "processing",
      pendingMediaRecordingId: "media_1",
    });
    await setUpdatedAt("item", FRESH_CLAIM);
    mocks.trash.mockRejectedValueOnce(new Error("trash unavailable"));

    await expect(
      action.run({ id: "item", status: "failed", error: "Export timed out." }),
    ).rejects.toThrow("trash unavailable");
    expect(mocks.events).not.toContain("update");
    expect(await readContextItemRow(client, "item")).toMatchObject({
      status: "processing",
      error: null,
      pending_media_recording_id: "media_1",
      updated_at: FRESH_CLAIM,
    });
  });

  it("trashes a replaced reservation before the claim commits", async () => {
    await seedContextItem(client, {
      id: "item",
      status: "processing",
      pendingMediaRecordingId: "media_1",
    });
    await setUpdatedAt("item", STALE_CLAIM);
    await seedFootage("media_2");

    await action.run({
      id: "item",
      status: "processing",
      mediaRecordingId: "media_2",
    });

    expect(mocks.events).toEqual(["trash", "update"]);
    expect(mocks.trash.mock.calls).toEqual([[{ id: "media_1" }]]);
    expect(await readContextItemRow(client, "item")).toMatchObject({
      status: "processing",
      pending_media_recording_id: "media_2",
    });
  });

  it("keeps the replaced reservation and throws when its trash fails", async () => {
    await seedContextItem(client, {
      id: "item",
      status: "processing",
      pendingMediaRecordingId: "media_1",
    });
    await setUpdatedAt("item", STALE_CLAIM);
    await seedFootage("media_2");
    mocks.trash.mockRejectedValueOnce(new Error("trash unavailable"));

    await expect(
      action.run({
        id: "item",
        status: "processing",
        mediaRecordingId: "media_2",
      }),
    ).rejects.toThrow("trash unavailable");
    expect(mocks.events).not.toContain("update");
    expect(await readContextItemRow(client, "item")).toMatchObject({
      status: "processing",
      pending_media_recording_id: "media_1",
      updated_at: STALE_CLAIM,
    });

    // The stale claim is still there to be replaced, so a retry can finish it.
    await expect(
      action.run({
        id: "item",
        status: "processing",
        mediaRecordingId: "media_2",
      }),
    ).resolves.toMatchObject({ pendingMediaRecordingId: "media_2" });
    expect(mocks.trash.mock.calls).toEqual([
      [{ id: "media_1" }],
      [{ id: "media_1" }],
    ]);
  });

  it("refuses to trash a replaced reservation that a ready item references", async () => {
    await seedContextItem(client, {
      id: "other",
      recordingId: "rec_2",
      status: "ready",
      mediaRecordingId: "media_1",
    });
    await seedContextItem(client, {
      id: "item",
      status: "processing",
      pendingMediaRecordingId: "media_1",
    });
    await setUpdatedAt("item", STALE_CLAIM);
    await seedFootage("media_2");

    await action.run({
      id: "item",
      status: "processing",
      mediaRecordingId: "media_2",
    });

    expect(mocks.trash).not.toHaveBeenCalled();
    expect(await readContextItemRow(client, "item")).toMatchObject({
      pending_media_recording_id: "media_2",
    });
  });

  it("accepts only processing, ready, or failed as a worker status", () => {
    for (const status of ["pending", "removed"]) {
      expect(inputSchema.safeParse({ id: "item", status }).success).toBe(false);
    }
  });
});
