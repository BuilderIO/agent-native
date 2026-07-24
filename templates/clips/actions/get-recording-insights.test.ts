import { beforeEach, describe, expect, it, vi } from "vitest";

const mockViewerRows = vi.hoisted(() => vi.fn());
const mockEventRows = vi.hoisted(() => vi.fn());
const mockViewLogRows = vi.hoisted(() => vi.fn());
const mockRecordingRows = vi.hoisted(() => vi.fn());
const tables = vi.hoisted(() => ({
  recordingViewers: { recordingId: "recordingViewers.recordingId" },
  recordingViews: { recordingId: "recordingViews.recordingId" },
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
        if (table === tables.recordingViews) return mockViewLogRows();
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
  count: vi.fn(() => ({ kind: "count" })),
  eq: vi.fn((column: unknown, value: unknown) => ({ column, value })),
}));

vi.mock("../server/db/index.js", () => ({
  getDb: () => mockDb,
  schema: tables,
}));

import getRecordingInsights from "./get-recording-insights";

function countedViewer(id: string, viewerEmail: string) {
  return {
    id,
    viewerEmail,
    viewerName: "Viewer",
    totalWatchMs: 12_000,
    completedPct: 100,
    countedView: true,
  };
}

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
    mockViewLogRows.mockResolvedValue([{ value: 1 }]);
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

  it("counts repeat sessions from one viewer as multiple views", async () => {
    mockViewLogRows.mockResolvedValue([{ value: 4 }]);

    const result = await getRecordingInsights.run({
      recordingId: "recording-1",
    });

    expect(result.views).toBe(4);
    expect(result.uniqueViewers).toBe(1);
  });

  it("falls back to counted viewers when the view log is empty", async () => {
    mockViewerRows.mockResolvedValue([
      countedViewer("viewer-1", "a@example.com"),
      countedViewer("viewer-2", "b@example.com"),
      countedViewer("viewer-3", "c@example.com"),
    ]);
    mockViewLogRows.mockResolvedValue([{ value: 0 }]);

    const result = await getRecordingInsights.run({
      recordingId: "recording-1",
    });

    expect(result.views).toBe(3);
    expect(result.uniqueViewers).toBe(3);
  });

  it("never reports fewer views than unique viewers", async () => {
    mockViewerRows.mockResolvedValue([
      countedViewer("viewer-1", "a@example.com"),
      countedViewer("viewer-2", "b@example.com"),
    ]);
    mockViewLogRows.mockResolvedValue([{ value: 1 }]);

    const result = await getRecordingInsights.run({
      recordingId: "recording-1",
    });

    expect(result.views).toBeGreaterThanOrEqual(result.uniqueViewers);
    expect(result.views).toBe(2);
  });

  it("divides CTA conversion by counted viewers, not repeat views", async () => {
    mockViewerRows.mockResolvedValue([
      countedViewer("viewer-1", "a@example.com"),
      countedViewer("viewer-2", "b@example.com"),
    ]);
    mockViewLogRows.mockResolvedValue([{ value: 8 }]);
    mockEventRows.mockResolvedValue([{ kind: "cta-click" }]);

    const result = await getRecordingInsights.run({
      recordingId: "recording-1",
    });

    expect(result.views).toBe(8);
    expect(result.ctaConversionRate).toBe(50);
  });

  it("ignores viewers who never met the counting threshold", async () => {
    mockViewerRows.mockResolvedValue([
      countedViewer("viewer-1", "a@example.com"),
      { ...countedViewer("viewer-2", "b@example.com"), countedView: false },
    ]);
    mockViewLogRows.mockResolvedValue([{ value: 0 }]);

    const result = await getRecordingInsights.run({
      recordingId: "recording-1",
    });

    expect(result.views).toBe(1);
    expect(result.uniqueViewers).toBe(1);
  });
});
