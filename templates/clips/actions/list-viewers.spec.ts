import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  assertAccess: vi.fn(),
  getDb: vi.fn(),
}));

const tables = vi.hoisted(() => ({
  recordingViewers: { recordingId: "recording_viewers.recording_id" },
}));

vi.mock("@agent-native/core", () => ({
  defineAction: (definition: unknown) => definition,
}));

vi.mock("@agent-native/core/sharing", () => ({
  assertAccess: (...args: unknown[]) => mocks.assertAccess(...args),
}));

vi.mock("drizzle-orm", () => ({
  eq: (left: unknown, right: unknown) => ({ type: "eq", left, right }),
}));

vi.mock("../server/db/index.js", () => ({
  getDb: (...args: unknown[]) => mocks.getDb(...args),
  schema: tables,
}));

import listViewers from "./list-viewers.js";

function createDb(rows: unknown[]) {
  const builder = {
    from: () => builder,
    where: () => Promise.resolve(rows),
  };
  return { select: () => builder };
}

describe("list-viewers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.assertAccess.mockResolvedValue(undefined);
  });

  it("hides the anon: dedup key stored in viewer_name", async () => {
    mocks.getDb.mockReturnValue(
      createDb([
        {
          id: "viewer-anon",
          viewerEmail: null,
          viewerName: "anon:session-abc123",
          totalWatchMs: 9000,
          completedPct: 40,
          countedView: true,
          ctaClicked: false,
          firstViewedAt: "2026-07-01T00:00:00.000Z",
          lastViewedAt: "2026-07-01T00:01:00.000Z",
        },
        {
          id: "viewer-named",
          viewerEmail: "viewer@example.com",
          viewerName: "Ada Lovelace",
          totalWatchMs: 12_000,
          completedPct: 90,
          countedView: true,
          ctaClicked: true,
          firstViewedAt: "2026-07-01T00:00:00.000Z",
          lastViewedAt: "2026-07-01T00:02:00.000Z",
        },
      ]),
    );

    const { viewers } = await (listViewers as any).run({
      recordingId: "rec-1",
      limit: 12,
    });

    expect(viewers.map((v: any) => v.viewerName)).toEqual([
      "Ada Lovelace",
      null,
    ]);
    expect(JSON.stringify(viewers)).not.toContain("anon:");
    expect(mocks.assertAccess).toHaveBeenCalledWith(
      "recording",
      "rec-1",
      "editor",
    );
  });
});
