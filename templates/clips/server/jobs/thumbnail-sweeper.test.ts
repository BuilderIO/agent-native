import { beforeEach, describe, expect, it, vi } from "vitest";

const mockEnsureRecordingThumbnail = vi.hoisted(() => vi.fn());
const mockRunWithRequestContext = vi.hoisted(() =>
  vi.fn((_context: unknown, fn: () => unknown) => fn()),
);
const mockRows = vi.hoisted(() => ({
  rows: [] as Array<{ id: string; ownerEmail: string; orgId: string | null }>,
}));
const mockLimit = vi.hoisted(() =>
  vi.fn(async (n: number) => mockRows.rows.slice(0, n)),
);
const mockWhere = vi.hoisted(() => vi.fn(() => ({ limit: mockLimit })));
const mockFrom = vi.hoisted(() => vi.fn(() => ({ where: mockWhere })));
const mockSelect = vi.hoisted(() => vi.fn(() => ({ from: mockFrom })));

vi.mock("@agent-native/core/server", () => ({
  runWithRequestContext: (context: unknown, fn: () => unknown) =>
    mockRunWithRequestContext(context, fn),
}));

vi.mock("drizzle-orm", () => ({
  and: vi.fn((...args: unknown[]) => ({ and: args })),
  eq: vi.fn((column: unknown, value: unknown) => ({ eq: [column, value] })),
  isNull: vi.fn((column: unknown) => ({ isNull: column })),
  lt: vi.fn((column: unknown, value: unknown) => ({ lt: [column, value] })),
  notInArray: vi.fn((column: unknown, values: unknown) => ({
    notInArray: [column, values],
  })),
  or: vi.fn((...args: unknown[]) => ({ or: args })),
}));

vi.mock("../db/index.js", () => ({
  getDb: () => ({ select: mockSelect }),
  schema: {
    recordings: {
      id: "recordings.id",
      ownerEmail: "recordings.ownerEmail",
      orgId: "recordings.orgId",
      status: "recordings.status",
      thumbnailUrl: "recordings.thumbnailUrl",
      thumbnailStatus: "recordings.thumbnailStatus",
      trashedAt: "recordings.trashedAt",
      updatedAt: "recordings.updatedAt",
    },
  },
}));

vi.mock("../lib/ensure-recording-thumbnail.js", () => ({
  ensureRecordingThumbnail: (...args: unknown[]) =>
    mockEnsureRecordingThumbnail(...args),
}));

import { runThumbnailSweepOnce } from "./thumbnail-sweeper";

describe("thumbnail sweeper", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockEnsureRecordingThumbnail.mockResolvedValue({
      status: "generated",
      changed: true,
    });
    mockRows.rows = [];
  });

  it("builds a WHERE clause that is NULL-tolerant and excludes terminal statuses", async () => {
    await runThumbnailSweepOnce();

    expect(mockWhere).toHaveBeenCalledWith({
      and: [
        { eq: ["recordings.status", "ready"] },
        { isNull: "recordings.thumbnailUrl" },
        { isNull: "recordings.trashedAt" },
        {
          or: [
            { isNull: "recordings.thumbnailStatus" },
            {
              notInArray: ["recordings.thumbnailStatus", ["none", "failed"]],
            },
          ],
        },
        { lt: ["recordings.updatedAt", expect.any(String)] },
      ],
    });
  });

  it("caps the sweep to the batch size", async () => {
    await runThumbnailSweepOnce();

    expect(mockLimit).toHaveBeenCalledWith(10);
  });

  it("recovers a NULL-status row and a pending row, each in its owner's context", async () => {
    mockRows.rows = [
      { id: "rec-null", ownerEmail: "null-owner@example.com", orgId: "org-1" },
      {
        id: "rec-pending",
        ownerEmail: "pending-owner@example.com",
        orgId: null,
      },
    ];

    await runThumbnailSweepOnce();

    expect(mockEnsureRecordingThumbnail).toHaveBeenCalledTimes(2);
    expect(mockEnsureRecordingThumbnail).toHaveBeenCalledWith({
      recordingId: "rec-null",
      ownerEmail: "null-owner@example.com",
    });
    expect(mockEnsureRecordingThumbnail).toHaveBeenCalledWith({
      recordingId: "rec-pending",
      ownerEmail: "pending-owner@example.com",
    });
    expect(mockRunWithRequestContext).toHaveBeenCalledWith(
      { userEmail: "null-owner@example.com", orgId: "org-1" },
      expect.any(Function),
    );
    expect(mockRunWithRequestContext).toHaveBeenCalledWith(
      { userEmail: "pending-owner@example.com", orgId: undefined },
      expect.any(Function),
    );
  });

  it("does not let one recording's failure stop the rest of the batch", async () => {
    mockRows.rows = [
      { id: "rec-fails", ownerEmail: "owner-a@example.com", orgId: null },
      { id: "rec-ok", ownerEmail: "owner-b@example.com", orgId: null },
    ];
    mockEnsureRecordingThumbnail
      .mockRejectedValueOnce(new Error("boom"))
      .mockResolvedValueOnce({ status: "generated", changed: true });

    await expect(runThumbnailSweepOnce()).resolves.toBeUndefined();

    expect(mockEnsureRecordingThumbnail).toHaveBeenCalledTimes(2);
  });
});
