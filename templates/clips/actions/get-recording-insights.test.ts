import { beforeEach, describe, expect, it, vi } from "vitest";

const mockViewerRows = vi.hoisted(() => vi.fn());
const mockEventRows = vi.hoisted(() => vi.fn());
const mockRecordingRows = vi.hoisted(() => vi.fn());
const tables = vi.hoisted(() => ({
  recordingViewers: { recordingId: "recordingViewers.recordingId" },
  recordingEvents: { recordingId: "recordingEvents.recordingId" },
  recordings: { id: "recordings.id", durationMs: "recordings.durationMs" },
}));
const mockDb = vi.hoisted(() => ({
  select: vi.fn((projection?: Record<string, unknown>) => {
    let table: unknown;
    const builder = {
      from: vi.fn((nextTable: unknown) => {
        table = nextTable;
        return builder;
      }),
      where: vi.fn(() => {
        if (table === tables.recordingViewers) return mockViewerRows();
        if (table === tables.recordingEvents) return mockEventRows();
        return builder;
      }),
      limit: vi.fn(() => mockRecordingRows()),
    };
    void projection;
    return builder;
  }),
}));

vi.mock("@agent-native/core", () => ({
  defineAction: (options: unknown) => options,
}));

vi.mock("@agent-native/core/sharing", () => ({
  assertAccess: vi.fn(async () => undefined),
}));

vi.mock("drizzle-orm", () => ({
  eq: vi.fn((column: unknown, value: unknown) => ({ column, value })),
}));

vi.mock("../server/db/index.js", () => ({
  getDb: () => mockDb,
  schema: tables,
}));

import getRecordingInsights from "./get-recording-insights";

describe("get-recording-insights", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockViewerRows.mockResolvedValue([
      {
        id: "viewer-1",
        viewerEmail: "viewer@example.com",
        viewerName: "Viewer",
        totalWatchMs: 12_000,
        completedPct: 258,
        countedView: true,
      },
    ]);
    mockEventRows.mockResolvedValue([]);
    mockRecordingRows.mockResolvedValue([{ durationMs: 10_000 }]);
  });

  it("keeps completion metrics within the percentage range", async () => {
    const result = await getRecordingInsights.run({
      recordingId: "recording-1",
    });

    expect(result).toMatchObject({
      views: 1,
      uniqueViewers: 1,
      completionRate: 100,
      topViewers: [expect.objectContaining({ completedPct: 100 })],
    });
    expect(result.dropOff.at(-1)).toEqual({ bucket: 99, watching: 1 });
  });
});
