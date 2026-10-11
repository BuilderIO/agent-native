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
  readContextItemRow,
  seedContextItem,
  seedRecording,
  traceItemWrites,
  type RecordingContextTestClient,
} from "../server/lib/recording-context-test-db.js";

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

import action from "./set-recording-context-window";

// The original window is 11:59:30 to 12:00:00 (30 s before a 12:00 start).
const ORIGINAL_START = "2026-10-01T11:59:30.000Z";
const ORIGINAL_END = "2026-10-01T12:00:00.000Z";

let client: RecordingContextTestClient;

beforeAll(async () => {
  const opened = await openRecordingContextTestDb();
  client = opened.client;
  mocks.db = traceItemWrites(opened.db, mocks.events);
});

beforeEach(async () => {
  await resetRecordingContextTestDb(client);
  mocks.trash.mockClear();
  mocks.events.length = 0;
  mocks.roles = { rec_1: "owner" };
  await seedRecording(client, { id: "rec_1" });
  await seedContextItem(client, {
    id: "item",
    status: "ready",
    mediaRecordingId: "media_1",
  });
});

afterAll(async () => {
  await client.close();
});

describe("set-recording-context-window", () => {
  it("narrows the window, rounds the requested length, and returns to pending", async () => {
    const trimmed = await action.run({
      id: "item",
      startedAt: "2026-10-01T11:59:40.000Z",
      endedAt: "2026-10-01T11:59:55.400Z",
    });

    expect(trimmed).toMatchObject({
      startedAt: "2026-10-01T11:59:40.000Z",
      endedAt: "2026-10-01T11:59:55.400Z",
      requestedSeconds: 15,
      originalStartedAt: ORIGINAL_START,
      originalEndedAt: ORIGINAL_END,
      status: "pending",
      error: null,
    });
    // The old footage stays linked until the desktop replaces it.
    expect(trimmed.mediaRecordingId).toBe("media_1");
  });

  it("accepts the original window exactly", async () => {
    await expect(
      action.run({
        id: "item",
        startedAt: ORIGINAL_START,
        endedAt: ORIGINAL_END,
      }),
    ).resolves.toMatchObject({ requestedSeconds: 30, status: "pending" });
  });

  it("stores the window in UTC even when the request gives an offset", async () => {
    const trimmed = await action.run({
      id: "item",
      startedAt: "2026-10-01T13:59:40.000+02:00",
      endedAt: "2026-10-01T13:59:55.000+02:00",
    });

    expect(trimmed).toMatchObject({
      startedAt: "2026-10-01T11:59:40.000Z",
      endedAt: "2026-10-01T11:59:55.000Z",
    });
  });

  it("rejects a window that starts before the original, leaving it unchanged", async () => {
    await expect(
      action.run({
        id: "item",
        startedAt: "2026-10-01T11:59:00.000Z",
        endedAt: "2026-10-01T11:59:55.000Z",
      }),
    ).rejects.toMatchObject({
      errorCode: "recording_context_invalid_window",
      statusCode: 400,
    });
    expect(await readContextItemRow(client, "item")).toMatchObject({
      status: "ready",
      started_at: ORIGINAL_START,
    });
  });

  it("rejects a window that ends after the recording started", async () => {
    await expect(
      action.run({
        id: "item",
        startedAt: "2026-10-01T11:59:40.000Z",
        endedAt: "2026-10-01T12:00:05.000Z",
      }),
    ).rejects.toMatchObject({ errorCode: "recording_context_invalid_window" });
  });

  it("rejects a window shorter than one second", async () => {
    await expect(
      action.run({
        id: "item",
        startedAt: "2026-10-01T11:59:40.000Z",
        endedAt: "2026-10-01T11:59:40.500Z",
      }),
    ).rejects.toMatchObject({ errorCode: "recording_context_invalid_window" });
  });

  it("accepts a trim during an export and resets the item to pending", async () => {
    await client.query(
      `UPDATE recording_context_items SET status = 'processing' WHERE id = 'item'`,
    );

    await expect(
      action.run({
        id: "item",
        startedAt: "2026-10-01T11:59:50.000Z",
        endedAt: ORIGINAL_END,
      }),
    ).resolves.toMatchObject({ status: "pending", requestedSeconds: 10 });
  });

  it("releases the footage reservation, so a late ready for that footage is refused", async () => {
    await client.query(
      `UPDATE recording_context_items SET status = 'processing', pending_media_recording_id = 'media_2' WHERE id = 'item'`,
    );

    await action.run({
      id: "item",
      startedAt: "2026-10-01T11:59:50.000Z",
      endedAt: ORIGINAL_END,
    });

    expect(await readContextItemRow(client, "item")).toMatchObject({
      status: "pending",
      media_recording_id: "media_1",
      pending_media_recording_id: null,
    });
  });

  it("refuses a removed item", async () => {
    await client.query(
      `UPDATE recording_context_items SET status = 'removed' WHERE id = 'item'`,
    );

    await expect(
      action.run({
        id: "item",
        startedAt: ORIGINAL_START,
        endedAt: ORIGINAL_END,
      }),
    ).rejects.toMatchObject({
      errorCode: "recording_context_removed",
      statusCode: 409,
    });
  });

  it("refuses a viewer and leaves the window unchanged", async () => {
    mocks.roles = { rec_1: "viewer" };

    await expect(
      action.run({
        id: "item",
        startedAt: "2026-10-01T11:59:40.000Z",
        endedAt: "2026-10-01T11:59:55.000Z",
      }),
    ).rejects.toMatchObject({ statusCode: 403 });
    expect(await readContextItemRow(client, "item")).toMatchObject({
      status: "ready",
      started_at: ORIGINAL_START,
    });
  });

  it("returns not found for an unknown item", async () => {
    await expect(
      action.run({
        id: "missing",
        startedAt: ORIGINAL_START,
        endedAt: ORIGINAL_END,
      }),
    ).rejects.toMatchObject({
      errorCode: "recording_context_not_found",
      statusCode: 404,
    });
  });

  it("trashes the footage a trim releases before clearing its reservation", async () => {
    await seedRecording(client, { id: "media_2" });
    await client.query(
      `UPDATE recording_context_items SET status = 'processing', pending_media_recording_id = 'media_2' WHERE id = 'item'`,
    );

    await action.run({
      id: "item",
      startedAt: "2026-10-01T11:59:50.000Z",
      endedAt: ORIGINAL_END,
    });

    expect(mocks.events).toEqual(["trash", "update"]);
    expect(mocks.trash.mock.calls).toEqual([[{ id: "media_2" }]]);
    expect(await readContextItemRow(client, "item")).toMatchObject({
      status: "pending",
      media_recording_id: "media_1",
      pending_media_recording_id: null,
    });
  });

  it("trashes nothing when a trim of a ready item leaves its footage in place", async () => {
    await action.run({
      id: "item",
      startedAt: "2026-10-01T11:59:40.000Z",
      endedAt: ORIGINAL_END,
    });

    expect(mocks.trash).not.toHaveBeenCalled();
  });

  it("keeps footage the item still references when the trim releases the same footage", async () => {
    // Real footage, so a trash that ignored the reference would reach it.
    await seedRecording(client, { id: "media_1" });
    await client.query(
      `UPDATE recording_context_items SET status = 'processing', pending_media_recording_id = 'media_1' WHERE id = 'item'`,
    );

    await action.run({
      id: "item",
      startedAt: "2026-10-01T11:59:50.000Z",
      endedAt: ORIGINAL_END,
    });

    expect(mocks.trash).not.toHaveBeenCalled();
    expect(await readContextItemRow(client, "item")).toMatchObject({
      media_recording_id: "media_1",
      pending_media_recording_id: null,
    });
  });

  it("trashes nothing when the trim is refused", async () => {
    await seedRecording(client, { id: "media_2" });
    await client.query(
      `UPDATE recording_context_items SET status = 'processing', pending_media_recording_id = 'media_2' WHERE id = 'item'`,
    );

    await expect(
      action.run({
        id: "item",
        startedAt: "2026-10-01T11:59:00.000Z",
        endedAt: ORIGINAL_END,
      }),
    ).rejects.toMatchObject({ errorCode: "recording_context_invalid_window" });
    expect(mocks.trash).not.toHaveBeenCalled();
    expect(await readContextItemRow(client, "item")).toMatchObject({
      status: "processing",
      pending_media_recording_id: "media_2",
    });
  });

  it("keeps the reservation and throws when trashing the footage a trim releases fails", async () => {
    await seedRecording(client, { id: "media_2" });
    await client.query(
      `UPDATE recording_context_items SET status = 'processing', pending_media_recording_id = 'media_2' WHERE id = 'item'`,
    );
    mocks.trash.mockRejectedValueOnce(new Error("trash unavailable"));

    await expect(
      action.run({
        id: "item",
        startedAt: "2026-10-01T11:59:50.000Z",
        endedAt: ORIGINAL_END,
      }),
    ).rejects.toThrow("trash unavailable");
    expect(mocks.events).not.toContain("update");
    expect(await readContextItemRow(client, "item")).toMatchObject({
      status: "processing",
      started_at: ORIGINAL_START,
      pending_media_recording_id: "media_2",
    });
  });

  it("keeps footage a ready item references when a trim releases it from a reservation", async () => {
    await seedRecording(client, { id: "rec_2" });
    await seedContextItem(client, {
      id: "other",
      recordingId: "rec_2",
      status: "ready",
      mediaRecordingId: "media_2",
    });
    await client.query(
      `UPDATE recording_context_items SET status = 'processing', pending_media_recording_id = 'media_2' WHERE id = 'item'`,
    );

    await action.run({
      id: "item",
      startedAt: "2026-10-01T11:59:50.000Z",
      endedAt: ORIGINAL_END,
    });

    expect(mocks.trash).not.toHaveBeenCalled();
    expect(await readContextItemRow(client, "item")).toMatchObject({
      status: "pending",
      pending_media_recording_id: null,
    });
  });

  describe("with the 5-minute original that request-recording-context stores", () => {
    // A 30 s request keeps the widest window as its original, so this is the shape real items have.
    const FIVE_MINUTE_START = "2026-10-01T11:55:00.000Z";

    beforeEach(async () => {
      await client.query(
        `UPDATE recording_context_items SET original_started_at = $1 WHERE id = 'item'`,
        [FIVE_MINUTE_START],
      );
    });

    it("accepts a trim beyond the requested 30 s when it stays inside the 5 minutes", async () => {
      await expect(
        action.run({
          id: "item",
          startedAt: "2026-10-01T11:56:00.000Z",
          endedAt: ORIGINAL_END,
        }),
      ).resolves.toMatchObject({
        startedAt: "2026-10-01T11:56:00.000Z",
        endedAt: ORIGINAL_END,
        requestedSeconds: 240,
        originalStartedAt: FIVE_MINUTE_START,
        originalEndedAt: ORIGINAL_END,
        status: "pending",
      });
    });

    it("accepts the full 5-minute original", async () => {
      await expect(
        action.run({
          id: "item",
          startedAt: FIVE_MINUTE_START,
          endedAt: ORIGINAL_END,
        }),
      ).resolves.toMatchObject({ requestedSeconds: 300, status: "pending" });
    });

    it("refuses a window that starts before the 5-minute original, leaving it unchanged", async () => {
      await expect(
        action.run({
          id: "item",
          startedAt: "2026-10-01T11:54:59.000Z",
          endedAt: ORIGINAL_END,
        }),
      ).rejects.toMatchObject({
        errorCode: "recording_context_invalid_window",
        statusCode: 400,
      });
      expect(await readContextItemRow(client, "item")).toMatchObject({
        status: "ready",
        started_at: ORIGINAL_START,
        requested_seconds: 30,
      });
    });
  });
});
