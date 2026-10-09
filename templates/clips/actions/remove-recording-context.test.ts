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
  type RecordingContextTestClient,
} from "../server/lib/recording-context-test-db.js";

const mocks = vi.hoisted(() => ({
  db: undefined as unknown,
  roles: {} as Record<string, "viewer" | "editor" | "owner" | undefined>,
  trash: vi.fn(async (args: { id: string }) => ({ id: args.id })),
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
  return {
    getCurrentOwnerEmail: () => "owner@example.com",
    ownerEmailMatches: (column: unknown, email: string) =>
      sql`lower(${column as never}) = ${email}`,
  };
});

vi.mock("./trash-recording.js", () => ({
  default: { run: (args: { id: string }) => mocks.trash(args) },
}));

import action from "./remove-recording-context";

let client: RecordingContextTestClient;

beforeAll(async () => {
  const opened = await openRecordingContextTestDb();
  client = opened.client;
  mocks.db = opened.db;
});

beforeEach(async () => {
  await resetRecordingContextTestDb(client);
  mocks.roles = { rec_1: "owner" };
  mocks.trash.mockClear();
  mocks.trash.mockImplementation(async (args) => ({ id: args.id }));
  await seedRecording(client, { id: "rec_1" });
  await seedRecording(client, { id: "media_1" });
  await seedContextItem(client, {
    id: "item",
    status: "ready",
    mediaRecordingId: "media_1",
  });
});

afterAll(async () => {
  await client.close();
});

describe("remove-recording-context", () => {
  it("trashes the footage recording and marks the item removed", async () => {
    const removed = await action.run({ id: "item" });

    expect(mocks.trash).toHaveBeenCalledOnce();
    expect(mocks.trash).toHaveBeenCalledWith({ id: "media_1" });
    expect(removed).toMatchObject({ id: "item", status: "removed" });
    expect(await readContextItemRow(client, "item")).toMatchObject({
      status: "removed",
    });
  });

  it("removes an item that has no footage without trashing anything", async () => {
    await client.query(
      `UPDATE recording_context_items SET media_recording_id = NULL WHERE id = 'item'`,
    );

    const removed = await action.run({ id: "item" });

    expect(mocks.trash).not.toHaveBeenCalled();
    expect(removed.status).toBe("removed");
  });

  it("returns an already removed item unchanged and does not trash again", async () => {
    await client.query(
      `UPDATE recording_context_items SET status = 'removed' WHERE id = 'item'`,
    );

    const again = await action.run({ id: "item" });

    expect(again.status).toBe("removed");
    expect(mocks.trash).not.toHaveBeenCalled();
  });

  it("skips trashing footage that retention already deleted", async () => {
    await seedRecording(client, { id: "rec_2" });
    mocks.roles = { rec_1: "owner", rec_2: "owner" };
    await seedContextItem(client, {
      id: "gone",
      recordingId: "rec_2",
      status: "ready",
      mediaRecordingId: "media_deleted",
    });

    const removed = await action.run({ id: "gone" });

    expect(mocks.trash).not.toHaveBeenCalled();
    expect(removed.status).toBe("removed");
  });

  it("keeps the item active when trashing the footage fails, so a retry can finish", async () => {
    mocks.trash.mockRejectedValueOnce(new Error("trash unavailable"));

    await expect(action.run({ id: "item" })).rejects.toThrow(
      "trash unavailable",
    );
    expect(await readContextItemRow(client, "item")).toMatchObject({
      status: "ready",
    });

    const retried = await action.run({ id: "item" });
    expect(retried.status).toBe("removed");
  });

  it("refuses a viewer and leaves the item and its footage alone", async () => {
    mocks.roles = { rec_1: "viewer" };

    await expect(action.run({ id: "item" })).rejects.toMatchObject({
      statusCode: 403,
    });
    expect(mocks.trash).not.toHaveBeenCalled();
    expect(await readContextItemRow(client, "item")).toMatchObject({
      status: "ready",
    });
  });

  it("returns not found for an unknown item", async () => {
    await expect(action.run({ id: "missing" })).rejects.toMatchObject({
      errorCode: "recording_context_not_found",
      statusCode: 404,
    });
  });
});
