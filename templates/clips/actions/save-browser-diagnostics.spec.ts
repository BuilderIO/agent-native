import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  assertAccess: vi.fn(),
  writeAppState: vi.fn(),
  insertedValues: undefined as Record<string, unknown> | undefined,
}));

vi.mock("@agent-native/core/action", () => ({
  defineAction: (definition: unknown) => definition,
}));
vi.mock("@agent-native/core/application-state", () => ({
  writeAppState: mocks.writeAppState,
}));
vi.mock("@agent-native/core/sharing", () => ({
  assertAccess: mocks.assertAccess,
}));
vi.mock("drizzle-orm", () => ({
  eq: (left: unknown, right: unknown) => ({ type: "eq", left, right }),
}));
vi.mock("../server/lib/recordings.js", () => ({
  nanoid: () => "session-1",
}));
vi.mock("../server/db/index.js", () => ({
  getDb: () => ({
    select: () => ({
      from: () => ({
        where: () => ({ limit: () => Promise.resolve([]) }),
      }),
    }),
    insert: () => ({
      values: (values: Record<string, unknown>) => {
        mocks.insertedValues = values;
        return Promise.resolve(undefined);
      },
    }),
  }),
  schema: {
    recordingBrowserDiagnostics: { recordingId: "recording_id" },
  },
}));

const { default: saveBrowserDiagnostics } =
  await import("./save-browser-diagnostics.js");

describe("save-browser-diagnostics", () => {
  beforeEach(() => {
    mocks.insertedValues = undefined;
    mocks.assertAccess.mockReset();
    mocks.assertAccess.mockResolvedValue({
      resource: {
        ownerEmail: "owner@example.com",
        organizationId: null,
        orgId: null,
      },
    });
    mocks.writeAppState.mockReset();
  });

  it("accepts a network entry with status 0 (an opaque response) instead of rejecting the whole payload", () => {
    const result = (saveBrowserDiagnostics as any).schema.safeParse({
      recordingId: "rec-1",
      networkRequests: [
        {
          timestampMs: 0,
          elapsedMs: 0,
          type: "fetch",
          method: "GET",
          url: "https://example.com/opaque",
          status: 0,
          durationMs: 12,
        },
      ],
    });
    expect(result.success).toBe(true);
  });

  it("still rejects a status outside the valid HTTP range", () => {
    const result = (saveBrowserDiagnostics as any).schema.safeParse({
      recordingId: "rec-1",
      networkRequests: [
        {
          timestampMs: 0,
          elapsedMs: 0,
          type: "fetch",
          method: "GET",
          url: "https://example.com/bad",
          status: 700,
          durationMs: 12,
        },
      ],
    });
    expect(result.success).toBe(false);
  });

  it("drops an opaque-response status of 0 instead of storing a meaningless value", async () => {
    const result = await (saveBrowserDiagnostics as any).run({
      recordingId: "rec-1",
      source: "browser-recorder",
      phase: "recording",
      consoleLogs: [],
      interactionEvents: [],
      networkRequests: [
        {
          timestampMs: 0,
          elapsedMs: 0,
          type: "fetch",
          method: "GET",
          url: "https://example.com/opaque",
          status: 0,
          durationMs: 12,
        },
        {
          timestampMs: 1,
          elapsedMs: 1,
          type: "fetch",
          method: "GET",
          url: "https://example.com/ok",
          status: 200,
          durationMs: 8,
        },
      ],
    });

    expect(result.status).toBe("saved");
    const stored = JSON.parse(
      mocks.insertedValues!.networkRequestsJson as string,
    );
    expect(stored).toHaveLength(2);
    expect(stored[0].status).toBeUndefined();
    expect(stored[1].status).toBe(200);
  });
});
