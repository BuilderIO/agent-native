import { beforeEach, describe, expect, it, vi } from "vitest";

const mockRows = vi.hoisted(() => vi.fn());
const mockDb = vi.hoisted(() => ({
  select: vi.fn(() => ({
    from: vi.fn(() => ({ where: mockRows })),
  })),
}));

vi.mock("@agent-native/core", () => ({
  defineAction: (options: unknown) => options,
}));

vi.mock("@agent-native/core/sharing", () => ({
  assertAccess: vi.fn(async () => undefined),
}));

vi.mock("drizzle-orm", () => ({
  desc: vi.fn(),
  eq: vi.fn((column: unknown, value: unknown) => ({ column, value })),
}));

vi.mock("../server/db/index.js", () => ({
  getDb: () => mockDb,
  schema: { recordingViewers: { recordingId: "recordingId" } },
}));

import listViewers from "./list-viewers";

describe("list-viewers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("does not expose invalid completion percentages from legacy rows", async () => {
    mockRows.mockResolvedValue([
      {
        id: "viewer-1",
        viewerEmail: "viewer@example.com",
        viewerName: "Viewer",
        totalWatchMs: 12_000,
        completedPct: 258,
        countedView: true,
        ctaClicked: false,
        firstViewedAt: "2026-07-17T00:00:00.000Z",
        lastViewedAt: "2026-07-17T00:01:00.000Z",
      },
    ]);

    await expect(
      listViewers.run({ recordingId: "recording-1", limit: 12 }),
    ).resolves.toEqual({
      viewers: [
        expect.objectContaining({
          id: "viewer-1",
          completedPct: 100,
        }),
      ],
    });
  });
});
