import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  assertAccess: vi.fn(),
  putPrivateBlob: vi.fn(),
  deleteAppActivityBlob: vi.fn(),
  writeAppState: vi.fn(),
  existingRows: [] as Array<{ blobJson: string | null }>,
  updatedValues: undefined as Record<string, unknown> | undefined,
}));

vi.mock("@agent-native/core/action", () => ({
  defineAction: (definition: unknown) => definition,
  fail: (message: string, options: { errorCode: string }) => {
    throw Object.assign(new Error(message), options);
  },
}));
vi.mock("@agent-native/core/application-state", () => ({
  writeAppState: mocks.writeAppState,
}));
vi.mock("@agent-native/core/private-blob", () => ({
  putPrivateBlob: mocks.putPrivateBlob,
}));
vi.mock("@agent-native/core/sharing", () => ({
  assertAccess: mocks.assertAccess,
}));
vi.mock("drizzle-orm", () => ({
  eq: (left: unknown, right: unknown) => ({ left, right }),
}));
vi.mock("../server/lib/app-activity.js", () => ({
  APP_ACTIVITY_BLOB_PURPOSE: "clips-app-activity",
  deleteAppActivityBlob: mocks.deleteAppActivityBlob,
}));
vi.mock("../server/db/index.js", () => ({
  getDb: () => ({
    select: () => ({
      from: () => ({
        where: () => ({ limit: () => Promise.resolve(mocks.existingRows) }),
      }),
    }),
    update: () => ({
      set: (values: Record<string, unknown>) => ({
        where: () => {
          mocks.updatedValues = values;
          return Promise.resolve(undefined);
        },
      }),
    }),
  }),
  schema: {
    recordingBrowserDiagnostics: {
      recordingId: "recording_id",
      appActivityBlobJson: "app_activity_blob_json",
    },
  },
}));

const { default: saveRecordingAppActivity } =
  await import("./save-recording-app-activity.js");
const action = saveRecordingAppActivity as any;

function payload(overrides: Record<string, unknown> = {}) {
  return {
    recordingId: "rec-1",
    app: "design",
    build: "dev",
    coverage: [{ fromElapsedMs: -30_000, toElapsedMs: 4_000 }],
    dropped: 0,
    events: [
      {
        timestampMs: 1_000,
        elapsedMs: -2_000,
        type: "action",
        name: "list-folders",
        ok: false,
        status: 403,
        errorCode: "forbidden_scope",
        data: { apiKey: "sk-live-123", note: "token=abc123" },
      },
      { timestampMs: 2_000, elapsedMs: 1_000, type: "state", name: "nav" },
    ],
    watched: { inspector: { state: "focus" } },
    pending: [],
    ...overrides,
  };
}

function storedBlob() {
  const [{ data }] = mocks.putPrivateBlob.mock.calls.at(-1)!;
  return JSON.parse(new TextDecoder().decode(data));
}

describe("save-recording-app-activity", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.existingRows = [{ blobJson: null }];
    mocks.updatedValues = undefined;
    mocks.assertAccess.mockResolvedValue({
      resource: { ownerEmail: "owner@example.com" },
    });
    mocks.putPrivateBlob.mockResolvedValue({
      id: "blob-1",
      provider: "test",
      opaque: true,
      encrypted: true,
    });
  });

  it("requires editor access to the recording", async () => {
    mocks.assertAccess.mockRejectedValueOnce(new Error("Forbidden"));
    await expect(action.run(action.schema.parse(payload()))).rejects.toThrow(
      "Forbidden",
    );
    expect(mocks.assertAccess).toHaveBeenCalledWith(
      "recording",
      "rec-1",
      "editor",
    );
    expect(mocks.putPrivateBlob).not.toHaveBeenCalled();
  });

  it("stores the redacted events as a private blob and only a summary on the row", async () => {
    const result = await action.run(action.schema.parse(payload()));

    const blob = storedBlob();
    expect(blob.events[0].data).toEqual({
      apiKey: "<redacted>",
      note: "token=<redacted>",
    });
    expect(mocks.putPrivateBlob.mock.calls[0][0]).toMatchObject({
      mimeType: "application/json",
      ownerEmail: "owner@example.com",
      metadata: { purpose: "clips-app-activity", recordingId: "rec-1" },
    });
    expect(
      JSON.parse(mocks.updatedValues!.appActivityBlobJson as string),
    ).toEqual({
      id: "blob-1",
      provider: "test",
      opaque: true,
      encrypted: true,
    });
    const summary = JSON.parse(
      mocks.updatedValues!.appActivitySummaryJson as string,
    );
    expect(summary).toMatchObject({
      app: "design",
      eventCount: 2,
      failureCount: 1,
      failures: [
        {
          elapsedMs: -2_000,
          name: "list-folders",
          status: 403,
          errorCode: "forbidden_scope",
        },
      ],
    });
    expect(summary.failures[0]).not.toHaveProperty("data");
    expect(result).toMatchObject({ status: "saved", summary });
  });

  it("does not count calls the app cancelled as failures", async () => {
    await action.run(
      action.schema.parse(
        payload({
          events: [
            {
              timestampMs: 1_000,
              elapsedMs: -2_000,
              type: "action",
              name: "list-designs",
              ok: false,
              errorCode: "cancelled",
            },
          ],
        }),
      ),
    );

    const summary = JSON.parse(
      mocks.updatedValues!.appActivitySummaryJson as string,
    );
    expect(summary).toMatchObject({ eventCount: 1, failureCount: 0 });
  });

  it("drops malformed events and counts them instead of storing them", async () => {
    await action.run(
      action.schema.parse(
        payload({
          dropped: 2,
          events: [
            ...payload().events,
            { timestampMs: 1, elapsedMs: -40_000, type: "action" },
            { timestampMs: 1, elapsedMs: 0, type: "unknown" },
          ],
        }),
      ),
    );
    const blob = storedBlob();
    expect(blob.events).toHaveLength(2);
    expect(blob.dropped).toBe(4);
  });

  it("rejects payloads over the event cap before touching storage", () => {
    const events = Array.from({ length: 2_001 }, (_, index) => ({
      timestampMs: index,
      elapsedMs: index,
      type: "log",
    }));
    expect(action.schema.safeParse(payload({ events })).success).toBe(false);
  });

  it("keeps the stored blob under 1 MB", async () => {
    const events = Array.from({ length: 2_000 }, (_, index) => ({
      timestampMs: index,
      elapsedMs: index,
      type: "log",
      data: {
        a: "a".repeat(190),
        b: "b".repeat(190),
        c: "c".repeat(190),
        d: "d".repeat(190),
      },
    }));
    await action.run(action.schema.parse(payload({ events })));
    const [{ data }] = mocks.putPrivateBlob.mock.calls[0];
    expect(data.byteLength).toBeLessThanOrEqual(1_000_000);
    expect(storedBlob().dropped).toBeGreaterThan(0);
  });

  it("refuses when the recording has no diagnostics row to attach to", async () => {
    mocks.existingRows = [];
    await expect(
      action.run(action.schema.parse(payload())),
    ).rejects.toMatchObject({ errorCode: "diagnostics_missing" });
    expect(mocks.putPrivateBlob).not.toHaveBeenCalled();
  });

  it("fails with a typed error when no storage is connected", async () => {
    mocks.putPrivateBlob.mockResolvedValueOnce(null);
    await expect(
      action.run(action.schema.parse(payload())),
    ).rejects.toMatchObject({ errorCode: "storage_not_configured" });
    expect(mocks.updatedValues).toBeUndefined();
  });

  it("deletes the blob it replaces after saving the new one", async () => {
    mocks.existingRows = [{ blobJson: '{"id":"old"}' }];
    await action.run(action.schema.parse(payload()));
    expect(mocks.deleteAppActivityBlob).toHaveBeenCalledWith(
      '{"id":"old"}',
      "rec-1",
    );
  });

  it("reports a replaced blob it could not delete", async () => {
    mocks.existingRows = [{ blobJson: '{"id":"old"}' }];
    mocks.deleteAppActivityBlob.mockResolvedValueOnce({
      deleted: false,
      error: "provider unavailable",
    });

    const result = await action.run(action.schema.parse(payload()));

    expect(result).toMatchObject({
      status: "saved",
      replacedBlobCleanup: { deleted: false, error: "provider unavailable" },
    });
  });
});
