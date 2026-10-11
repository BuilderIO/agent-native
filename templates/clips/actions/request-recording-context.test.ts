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
  readContextItemRow,
  RECORDING_CREATED_AT,
  resetRecordingContextTestDb,
  seedContextItem,
  seedDirectShare,
  seedRecording,
  type RecordingContextTestClient,
} from "../server/lib/recording-context-test-db.js";

const mocks = vi.hoisted(() => ({
  db: undefined as unknown,
  roles: {} as Record<string, "viewer" | "editor" | "owner" | undefined>,
  email: "owner@example.com",
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

vi.mock("../server/lib/recordings.js", async () => {
  const { sql } = await import("drizzle-orm");
  let seq = 0;
  return {
    nanoid: () => `ctx_${(seq += 1)}`,
    getCurrentOwnerEmail: () => mocks.email,
    ownerEmailMatches: (column: unknown, email: string) =>
      sql`lower(${column as never}) = ${email}`,
  };
});

vi.mock("./trash-recording.js", () => ({
  default: { run: async (args: { id: string }) => ({ id: args.id }) },
}));

import { DIRECT_SHARE_REWIND_ERROR } from "./make-recording-private-for-rewind";
import action from "./request-recording-context";

const ENDED_AT = "2026-10-01T12:00:00.000Z";
const WINDOW_START = "2026-10-01T11:59:30.000Z";
// Five minutes before ENDED_AT: the widest window every request keeps as its original.
const ORIGINAL_START = "2026-10-01T11:55:00.000Z";

let client: RecordingContextTestClient;

async function countItems(recordingId: string, includeRemoved = false) {
  const result = await client.query(
    `SELECT id FROM recording_context_items WHERE recording_id = $1 ${
      includeRemoved ? "" : "AND status <> 'removed'"
    }`,
    [recordingId],
  );
  return result.rows.length;
}

async function visibilityOf(recordingId: string) {
  const result = await client.query(
    `SELECT visibility FROM recordings WHERE id = $1`,
    [recordingId],
  );
  return (result.rows[0] as { visibility: string }).visibility;
}

beforeAll(async () => {
  const opened = await openRecordingContextTestDb();
  client = opened.client;
  mocks.db = opened.db;
});

beforeEach(async () => {
  await resetRecordingContextTestDb(client);
  mocks.email = "owner@example.com";
  mocks.roles = { rec_1: "owner" };
  await seedRecording(client, { id: "rec_1", visibility: "private" });
});

afterAll(async () => {
  await client.close();
});

describe("request-recording-context", () => {
  it("creates a pending item for the window before the recording started", async () => {
    await expect(
      action.run({ recordingId: "rec_1", seconds: 30, endedAt: ENDED_AT }),
    ).resolves.toMatchObject({
      recordingId: "rec_1",
      kind: "screen_history",
      label: null,
      requestedSeconds: 30,
      originalStartedAt: ORIGINAL_START,
      originalEndedAt: ENDED_AT,
      startedAt: WINDOW_START,
      endedAt: ENDED_AT,
      status: "pending",
      mediaRecordingId: null,
    });
    expect(await countItems("rec_1")).toBe(1);
  });

  it("keeps a 300 s original window when a 30 s window is requested", async () => {
    const item = await action.run({
      recordingId: "rec_1",
      seconds: 30,
      endedAt: ENDED_AT,
    });

    expect(Date.parse(item.endedAt) - Date.parse(item.startedAt)).toBe(30_000);
    expect(
      Date.parse(item.originalEndedAt) - Date.parse(item.originalStartedAt),
    ).toBe(300_000);
  });

  it("uses the same window for original and current when 300 s is requested", async () => {
    const item = await action.run({
      recordingId: "rec_1",
      seconds: 300,
      endedAt: ENDED_AT,
    });

    expect(item).toMatchObject({
      requestedSeconds: 300,
      originalStartedAt: ORIGINAL_START,
      originalEndedAt: ENDED_AT,
      startedAt: ORIGINAL_START,
      endedAt: ENDED_AT,
    });
  });

  it("refuses a viewer, an editor, and a caller with no access", async () => {
    for (const role of ["viewer", "editor", undefined] as const) {
      mocks.roles = role ? { rec_1: role } : {};
      await expect(
        action.run({ recordingId: "rec_1", seconds: 30, endedAt: ENDED_AT }),
      ).rejects.toMatchObject({ statusCode: 403 });
    }
    expect(await countItems("rec_1")).toBe(0);
  });

  it("makes an unshared non-private Clip private before adding context", async () => {
    await seedRecording(client, { id: "rec_org", visibility: "org" });
    mocks.roles = { rec_org: "owner" };

    await action.run({
      recordingId: "rec_org",
      seconds: 30,
      endedAt: ENDED_AT,
    });

    expect(await visibilityOf("rec_org")).toBe("private");
    expect(await countItems("rec_org")).toBe(1);
  });

  it("refuses a non-private Clip that is still shared directly and leaves it unchanged", async () => {
    await seedRecording(client, { id: "rec_org", visibility: "org" });
    await seedDirectShare(client, "rec_org");
    mocks.roles = { rec_org: "owner" };

    await expect(
      action.run({ recordingId: "rec_org", seconds: 30, endedAt: ENDED_AT }),
    ).rejects.toThrow(DIRECT_SHARE_REWIND_ERROR);
    expect(await visibilityOf("rec_org")).toBe("org");
    expect(await countItems("rec_org")).toBe(0);
  });

  it("refuses a private Clip that is still shared directly", async () => {
    await seedDirectShare(client, "rec_1");

    await expect(
      action.run({ recordingId: "rec_1", seconds: 30, endedAt: ENDED_AT }),
    ).rejects.toThrow(DIRECT_SHARE_REWIND_ERROR);
    expect(await countItems("rec_1")).toBe(0);
  });

  it("returns the existing active item instead of creating another", async () => {
    const first = await action.run({
      recordingId: "rec_1",
      seconds: 30,
      endedAt: ENDED_AT,
    });
    const second = await action.run({
      recordingId: "rec_1",
      seconds: 300,
      endedAt: ENDED_AT,
    });

    expect(second.id).toBe(first.id);
    expect(second.requestedSeconds).toBe(30);
    expect(await countItems("rec_1", true)).toBe(1);
  });

  it("returns one item when two requests for the same Clip race", async () => {
    const [a, b] = await Promise.all([
      action.run({ recordingId: "rec_1", seconds: 30, endedAt: ENDED_AT }),
      action.run({ recordingId: "rec_1", seconds: 30, endedAt: ENDED_AT }),
    ]);

    expect(a.id).toBe(b.id);
    expect(await countItems("rec_1", true)).toBe(1);
  });

  it("creates a new item once the previous one was removed", async () => {
    await seedContextItem(client, { id: "old", status: "removed" });

    const created = await action.run({
      recordingId: "rec_1",
      seconds: 30,
      endedAt: ENDED_AT,
    });

    expect(created.id).not.toBe("old");
    expect(created.status).toBe("pending");
    expect(await countItems("rec_1")).toBe(1);
  });

  it("is enforced by the database: a second active item for one Clip is rejected", async () => {
    await seedContextItem(client, { id: "active_1" });

    await expect(seedContextItem(client, { id: "active_2" })).rejects.toThrow(
      /unique/i,
    );
    await expect(
      seedContextItem(client, { id: "active_3", status: "ready" }),
    ).rejects.toThrow(/unique/i);
  });

  it("refuses an endedAt far from the Clip's start, before it changes the Clip", async () => {
    await seedRecording(client, { id: "rec_org", visibility: "org" });
    mocks.roles = { rec_org: "owner" };

    await expect(
      action.run({
        recordingId: "rec_org",
        seconds: 30,
        endedAt: "2026-10-01T11:00:00.000Z",
      }),
    ).rejects.toMatchObject({
      errorCode: "recording_context_invalid_window",
      statusCode: 400,
    });
    expect(await visibilityOf("rec_org")).toBe("org");
    expect(await countItems("rec_org", true)).toBe(0);
  });

  it("accepts an endedAt 120 s either side of the Clip's start and refuses 121 s", async () => {
    const at = (ms: number) =>
      new Date(Date.parse(RECORDING_CREATED_AT) + ms).toISOString();

    for (const ms of [121_000, -121_000]) {
      await expect(
        action.run({ recordingId: "rec_1", seconds: 30, endedAt: at(ms) }),
      ).rejects.toMatchObject({
        errorCode: "recording_context_invalid_window",
        statusCode: 400,
      });
    }
    expect(await countItems("rec_1", true)).toBe(0);

    await expect(
      action.run({ recordingId: "rec_1", seconds: 30, endedAt: at(-120_000) }),
    ).resolves.toMatchObject({ endedAt: at(-120_000), status: "pending" });
  });

  it("removes the new item when a direct share lands after it was inserted", async () => {
    // Stands in for a grant that commits after the first share check: the
    // trigger writes a share the moment the item is inserted.
    await client.exec(`
      CREATE FUNCTION share_on_context_insert() RETURNS trigger AS $$
      BEGIN
        INSERT INTO recording_shares (id, resource_id) VALUES ('race_share', NEW.recording_id);
        RETURN NEW;
      END
      $$ LANGUAGE plpgsql;
      CREATE TRIGGER share_on_context_insert AFTER INSERT ON recording_context_items
        FOR EACH ROW EXECUTE FUNCTION share_on_context_insert();
    `);
    try {
      await expect(
        action.run({ recordingId: "rec_1", seconds: 30, endedAt: ENDED_AT }),
      ).rejects.toThrow(DIRECT_SHARE_REWIND_ERROR);
    } finally {
      await client.exec(`
        DROP TRIGGER share_on_context_insert ON recording_context_items;
        DROP FUNCTION share_on_context_insert();
      `);
    }

    expect(await countItems("rec_1")).toBe(0);
    expect(await countItems("rec_1", true)).toBe(1);
  });

  it("removes the new item and refuses when the Clip goes non-private after the insert", async () => {
    // Stands in for a visibility write that commits after the pre-insert gate:
    // the trigger makes the Clip org-visible the moment the item is inserted.
    await client.exec(`
      CREATE FUNCTION visibility_on_context_insert() RETURNS trigger AS $$
      BEGIN
        UPDATE recordings SET visibility = 'org' WHERE id = NEW.recording_id;
        RETURN NEW;
      END
      $$ LANGUAGE plpgsql;
      CREATE TRIGGER visibility_on_context_insert AFTER INSERT ON recording_context_items
        FOR EACH ROW EXECUTE FUNCTION visibility_on_context_insert();
    `);
    try {
      await expect(
        action.run({ recordingId: "rec_1", seconds: 30, endedAt: ENDED_AT }),
      ).rejects.toThrow(DIRECT_SHARE_REWIND_ERROR);
    } finally {
      await client.exec(`
        DROP TRIGGER visibility_on_context_insert ON recording_context_items;
        DROP FUNCTION visibility_on_context_insert();
      `);
    }

    expect(await visibilityOf("rec_1")).toBe("org");
    expect(await countItems("rec_1")).toBe(0);
    expect(await countItems("rec_1", true)).toBe(1);
  });

  it("keeps the item when a write after the insert leaves the Clip private", async () => {
    // Stands in for an unrelated recordings write that commits after the insert.
    await client.exec(`
      CREATE FUNCTION touch_on_context_insert() RETURNS trigger AS $$
      BEGIN
        UPDATE recordings SET updated_at = 'raced' WHERE id = NEW.recording_id;
        RETURN NEW;
      END
      $$ LANGUAGE plpgsql;
      CREATE TRIGGER touch_on_context_insert AFTER INSERT ON recording_context_items
        FOR EACH ROW EXECUTE FUNCTION touch_on_context_insert();
    `);
    try {
      await expect(
        action.run({ recordingId: "rec_1", seconds: 30, endedAt: ENDED_AT }),
      ).resolves.toMatchObject({ status: "pending" });
    } finally {
      await client.exec(`
        DROP TRIGGER touch_on_context_insert ON recording_context_items;
        DROP FUNCTION touch_on_context_insert();
      `);
    }

    expect(await visibilityOf("rec_1")).toBe("private");
    expect(await countItems("rec_1")).toBe(1);
  });

  it("stores the requesting device on the new item, and null when none is sent", async () => {
    mocks.roles = { rec_1: "owner", rec_web: "owner" };
    await seedRecording(client, { id: "rec_web" });

    const fromDevice = await action.run({
      recordingId: "rec_1",
      seconds: 30,
      endedAt: ENDED_AT,
      deviceId: "dev_a",
    });
    expect(fromDevice.capturedDeviceId).toBe("dev_a");
    expect(
      (await readContextItemRow(client, fromDevice.id))?.captured_device_id,
    ).toBe("dev_a");

    const fromWeb = await action.run({
      recordingId: "rec_web",
      seconds: 30,
      endedAt: ENDED_AT,
    });
    expect(fromWeb.capturedDeviceId).toBeNull();
    expect(
      (await readContextItemRow(client, fromWeb.id))?.captured_device_id,
    ).toBeNull();
  });

  it("bounds deviceId to 1 to 200 characters", () => {
    const schema = (action as unknown as { schema: ZodType }).schema;
    const base = { recordingId: "rec_1", seconds: 30, endedAt: ENDED_AT };
    expect(schema.safeParse({ ...base, deviceId: "d" }).success).toBe(true);
    expect(
      schema.safeParse({ ...base, deviceId: "d".repeat(200) }).success,
    ).toBe(true);
    expect(schema.safeParse({ ...base, deviceId: "" }).success).toBe(false);
    expect(
      schema.safeParse({ ...base, deviceId: "d".repeat(201) }).success,
    ).toBe(false);
  });

  it("validates seconds within 1 to 300 and an ISO end time", () => {
    // The defineAction mock returns its options, so the zod input schema is reachable.
    const schema = (action as unknown as { schema: ZodType }).schema;
    expect(
      schema.safeParse({ recordingId: "rec_1", seconds: 1, endedAt: ENDED_AT })
        .success,
    ).toBe(true);
    expect(
      schema.safeParse({
        recordingId: "rec_1",
        seconds: 300,
        endedAt: ENDED_AT,
      }).success,
    ).toBe(true);
    for (const seconds of [0, 301, 1.5]) {
      expect(
        schema.safeParse({ recordingId: "rec_1", seconds, endedAt: ENDED_AT })
          .success,
      ).toBe(false);
    }
    expect(
      schema.safeParse({
        recordingId: "rec_1",
        seconds: 30,
        endedAt: "yesterday",
      }).success,
    ).toBe(false);
  });
});
