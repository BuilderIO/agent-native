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
  roles: {} as Record<string, "viewer" | "editor" | "owner" | undefined>,
  tokenResult: { ok: false, reason: "malformed" } as {
    ok: boolean;
    reason?: string;
  },
  tokenCalls: [] as Array<[string, string]>,
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
    ) => {
      fakes.testAssertAccess(mocks.roles, id, minRole);
      return { role: mocks.roles[id] };
    },
  };
});

vi.mock("@agent-native/core/server", () => ({
  verifyShortLivedToken: (token: string, resourceId: string) => {
    mocks.tokenCalls.push([token, resourceId]);
    return mocks.tokenResult;
  },
}));

vi.mock("../server/db/index.js", async () => {
  const schema = await import("../server/db/schema.js");
  return { getDb: () => mocks.db, schema };
});

import action from "./list-recording-context";

let client: RecordingContextTestClient;

beforeAll(async () => {
  const opened = await openRecordingContextTestDb();
  client = opened.client;
  mocks.db = opened.db;
});

beforeEach(async () => {
  await resetRecordingContextTestDb(client);
  mocks.roles = { rec_1: "viewer" };
  mocks.tokenResult = { ok: false, reason: "malformed" };
  mocks.tokenCalls = [];
  await seedRecording(client, { id: "rec_1" });
});

afterAll(async () => {
  await client.close();
});

describe("list-recording-context", () => {
  it("lets a viewer list the active item and leaves out removed ones", async () => {
    await seedRecording(client, { id: "rec_2" });
    await seedContextItem(client, {
      id: "active",
      status: "ready",
      mediaRecordingId: "media_1",
    });
    await seedContextItem(client, {
      id: "old",
      recordingId: "rec_2",
      status: "removed",
    });
    mocks.roles = { rec_1: "viewer", rec_2: "viewer" };

    const { items } = await action.run({ recordingId: "rec_1" });
    expect(items.map((item) => item.id)).toEqual(["active"]);
    expect(items[0]).toMatchObject({
      recordingId: "rec_1",
      status: "ready",
      mediaRecordingId: "media_1",
    });

    const removedOnly = await action.run({ recordingId: "rec_2" });
    expect(removedOnly.items).toEqual([]);
  });

  it("returns owner-only device and error details to the owner", async () => {
    await seedRecording(client, { id: "rec_2" });
    mocks.roles = { rec_1: "owner", rec_2: "owner" };
    await seedContextItem(client, {
      id: "from_device",
      capturedDeviceId: "dev_a",
      error: "private export diagnostics",
    });
    await seedContextItem(client, {
      id: "from_web",
      recordingId: "rec_2",
    });

    const fromDevice = await action.run({ recordingId: "rec_1" });
    expect(fromDevice.items[0]).toMatchObject({
      id: "from_device",
      capturedDeviceId: "dev_a",
      error: "private export diagnostics",
      waitingForDevice: true,
    });

    const fromWeb = await action.run({ recordingId: "rec_2" });
    expect(fromWeb.items[0]).toMatchObject({
      id: "from_web",
      capturedDeviceId: null,
      waitingForDevice: false,
    });
  });

  it("returns only current playback fields and safe state to viewers", async () => {
    await seedContextItem(client, {
      id: "viewer_item",
      status: "pending",
      mediaRecordingId: "stale_media",
      pendingMediaRecordingId: "pending_media",
      capturedDeviceId: "private_device_id",
      error: "private export diagnostics",
    });

    const { items } = await action.run({ recordingId: "rec_1" });

    expect(items[0]).toEqual({
      id: "viewer_item",
      recordingId: "rec_1",
      kind: "screen_history",
      label: null,
      startedAt: "2026-10-01T11:59:30.000Z",
      endedAt: "2026-10-01T12:00:00.000Z",
      status: "pending",
      mediaRecordingId: null,
      waitingForDevice: true,
      processingClaimFresh: false,
    });
    expect(items[0]).not.toHaveProperty("error");
    expect(items[0]).not.toHaveProperty("capturedDeviceId");
    expect(items[0]).not.toHaveProperty("pendingMediaRecordingId");
  });

  it("marks only fresh processing claims as pollable to viewers", async () => {
    await seedRecording(client, { id: "rec_2" });
    mocks.roles = { rec_1: "viewer", rec_2: "viewer" };
    await seedContextItem(client, { id: "fresh", status: "processing" });
    await seedContextItem(client, {
      id: "stale",
      recordingId: "rec_2",
      status: "processing",
    });
    await client.query(
      "UPDATE recording_context_items SET updated_at = $2 WHERE id = $1",
      ["fresh", new Date(Date.now() - 60_000).toISOString()],
    );
    await client.query(
      "UPDATE recording_context_items SET updated_at = $2 WHERE id = $1",
      ["stale", new Date(Date.now() - 11 * 60_000).toISOString()],
    );

    const fresh = await action.run({ recordingId: "rec_1" });
    const stale = await action.run({ recordingId: "rec_2" });

    expect(fresh.items[0]).toMatchObject({
      id: "fresh",
      status: "processing",
      processingClaimFresh: true,
    });
    expect(stale.items[0]).toMatchObject({
      id: "stale",
      status: "processing",
      processingClaimFresh: false,
    });
    expect(fresh.items[0]).not.toHaveProperty("updatedAt");
    expect(stale.items[0]).not.toHaveProperty("updatedAt");
  });

  it("returns an empty list when the Clip has no context", async () => {
    await expect(action.run({ recordingId: "rec_1" })).resolves.toEqual({
      items: [],
    });
  });

  it("requires a password token before returning protected Clip context", async () => {
    await seedRecording(client, {
      id: "protected",
      visibility: "public",
      password: "encrypted-password",
      sharePasswordVersion: "initial",
    });
    await seedContextItem(client, {
      id: "protected_item",
      recordingId: "protected",
      mediaRecordingId: "media_private",
    });
    mocks.roles = { protected: "viewer" };

    await expect(
      action.run({ recordingId: "protected" }),
    ).rejects.toMatchObject({
      statusCode: 401,
      errorCode: "recording_password_required",
    });
    expect(mocks.tokenCalls).toEqual([]);

    await expect(
      action.run({ recordingId: "protected", accessToken: "invalid" }),
    ).rejects.toMatchObject({ statusCode: 401 });
    expect(mocks.tokenCalls).toEqual([["invalid", "protected"]]);
  });

  it("allows a password-unlocked viewer to list protected context", async () => {
    await seedRecording(client, {
      id: "protected",
      visibility: "public",
      password: "encrypted-password",
      sharePasswordVersion: "initial",
    });
    await seedContextItem(client, {
      id: "protected_item",
      recordingId: "protected",
      mediaRecordingId: "media_private",
    });
    mocks.roles = { protected: "viewer" };
    mocks.tokenResult = { ok: true };

    const { items } = await action.run({
      recordingId: "protected",
      accessToken: "valid-token",
    });

    expect(items.map((item) => item.id)).toEqual(["protected_item"]);
    expect(mocks.tokenCalls).toEqual([["valid-token", "protected"]]);
  });

  it("lets the owner list password-protected context without a viewer token", async () => {
    await seedRecording(client, {
      id: "protected",
      password: "encrypted-password",
      sharePasswordVersion: "initial",
    });
    await seedContextItem(client, {
      id: "protected_item",
      recordingId: "protected",
    });
    mocks.roles = { protected: "owner" };

    const { items } = await action.run({ recordingId: "protected" });

    expect(items.map((item) => item.id)).toEqual(["protected_item"]);
    expect(mocks.tokenCalls).toEqual([]);
  });

  it("returns 404 recording_not_found for a Clip that was permanently deleted", async () => {
    mocks.roles = {};

    await expect(
      action.run({ recordingId: "rec_deleted" }),
    ).rejects.toMatchObject({
      errorCode: "recording_not_found",
      statusCode: 404,
    });
  });

  it("refuses context for a Clip in Trash to viewers", async () => {
    await seedRecording(client, {
      id: "trashed",
      trashedAt: "2026-10-12T12:00:00.000Z",
    });
    mocks.roles = { trashed: "viewer" };

    await expect(action.run({ recordingId: "trashed" })).rejects.toMatchObject({
      statusCode: 404,
      errorCode: "recording_not_found",
    });
  });

  it("still lists context for a Clip in Trash to its owner", async () => {
    await seedRecording(client, {
      id: "trashed_owned",
      trashedAt: "2026-10-12T12:00:00.000Z",
    });
    await seedContextItem(client, {
      id: "item_trashed",
      recordingId: "trashed_owned",
    });
    mocks.roles = { trashed_owned: "owner" };

    const { items } = await action.run({ recordingId: "trashed_owned" });

    expect(items.map((item) => item.id)).toEqual(["item_trashed"]);
  });

  it("refuses context for an expired Clip for viewers", async () => {
    await seedRecording(client, {
      id: "expired",
      expiresAt: "2000-01-01T00:00:00.000Z",
    });
    mocks.roles = { expired: "viewer" };

    await expect(action.run({ recordingId: "expired" })).rejects.toMatchObject({
      statusCode: 410,
      errorCode: "recording_expired",
    });
  });

  it("refuses context while the Clip is held for redaction", async () => {
    await seedRecording(client, {
      id: "redacting",
      editsJson: "unreadable edits",
    });
    mocks.roles = { redacting: "viewer" };

    await expect(
      action.run({ recordingId: "redacting" }),
    ).rejects.toMatchObject({
      statusCode: 409,
      errorCode: "recording_redaction_pending",
    });
  });

  it("keeps 403 for an existing Clip with context that the caller cannot access", async () => {
    await seedRecording(client, {
      id: "rec_other",
      ownerEmail: "someone-else@example.com",
    });
    await seedContextItem(client, {
      id: "other_item",
      recordingId: "rec_other",
    });
    mocks.roles = {};

    const error = await action
      .run({ recordingId: "rec_other" })
      .catch((caught: unknown) => caught);
    expect(error).toMatchObject({ statusCode: 403 });
    expect(error).not.toMatchObject({ errorCode: "recording_not_found" });
  });
});
