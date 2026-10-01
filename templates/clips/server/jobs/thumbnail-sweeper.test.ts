import { beforeEach, describe, expect, it, vi } from "vitest";

const mockEnsureRecordingThumbnail = vi.hoisted(() => vi.fn());
const mockMarkThumbnailFailed = vi.hoisted(() => vi.fn());
const mockCountAttempt = vi.hoisted(() => vi.fn());
const mockClaimLease = vi.hoisted(() => vi.fn());
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
  markThumbnailFailed: (...args: unknown[]) => mockMarkThumbnailFailed(...args),
  isRetryableRecordingThumbnailStatus: (status: string) =>
    status.startsWith("skipped-") &&
    status !== "skipped-no-media" &&
    status !== "skipped-not-ready" &&
    status !== "skipped-loom-embed",
}));

vi.mock("../lib/recording-leases.js", () => ({
  claimLease: (...args: unknown[]) => mockClaimLease(...args),
  countAttempt: (...args: unknown[]) => mockCountAttempt(...args),
}));

import registerThumbnailSweeperJob, {
  runThumbnailSweepOnce,
} from "./thumbnail-sweeper";

describe("thumbnail sweeper", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockEnsureRecordingThumbnail.mockResolvedValue({
      status: "generated",
      changed: true,
    });
    mockMarkThumbnailFailed.mockResolvedValue(undefined);
    mockCountAttempt.mockResolvedValue(1);
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

  it("sweeps only on the instance that wins the cluster-wide sweep lease", async () => {
    vi.useFakeTimers();
    process.env.RUN_BACKGROUND_JOBS = "1";
    vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      mockClaimLease
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ key: "thumbnail-sweeper", token: "t" });
      registerThumbnailSweeperJob();

      await vi.advanceTimersByTimeAsync(5 * 60 * 1000);
      expect(mockClaimLease).toHaveBeenCalledWith(
        "thumbnail-sweeper",
        expect.any(Number),
      );
      expect(mockSelect).not.toHaveBeenCalled();

      await vi.advanceTimersByTimeAsync(5 * 60 * 1000);
      expect(mockSelect).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
      delete process.env.RUN_BACKGROUND_JOBS;
    }
  });

  describe("unrecoverable recordings", () => {
    const row = { id: "zzqa-1", ownerEmail: "qa@example.com", orgId: null };

    it("counts a retryable failure and keeps the recording eligible until the cap", async () => {
      mockRows.rows = [row];
      mockEnsureRecordingThumbnail.mockResolvedValue({
        status: "skipped-media-fetch",
        changed: false,
      });
      mockCountAttempt.mockResolvedValue(4);

      await runThumbnailSweepOnce();

      expect(mockCountAttempt).toHaveBeenCalledWith(
        "thumbnail-sweeper-attempts:zzqa-1",
      );
      expect(mockMarkThumbnailFailed).not.toHaveBeenCalled();
    });

    it("marks the recording failed on the fifth failed attempt so the sweep stops retrying it", async () => {
      mockRows.rows = [row];
      mockEnsureRecordingThumbnail.mockResolvedValue({
        status: "skipped-frame-extraction",
        changed: false,
      });
      mockCountAttempt.mockResolvedValue(5);

      await runThumbnailSweepOnce();

      expect(mockMarkThumbnailFailed).toHaveBeenCalledWith(
        "zzqa-1",
        expect.stringContaining("gave up after 5 attempts"),
      );
    });

    it("never gives up on recordings because of a storage or network outage", async () => {
      mockRows.rows = [
        row,
        { id: "rec-upload", ownerEmail: "a@example.com", orgId: null },
        { id: "rec-fetch-5xx", ownerEmail: "a@example.com", orgId: null },
        { id: "rec-race", ownerEmail: "a@example.com", orgId: null },
      ];
      const outcomes: Record<string, () => Promise<unknown>> = {
        "zzqa-1": async () => {
          throw new Error("connection terminated");
        },
        "rec-upload": async () => ({
          status: "skipped-upload-failed",
          changed: false,
        }),
        "rec-fetch-5xx": async () => ({
          status: "skipped-media-fetch",
          changed: false,
          transient: true,
        }),
        "rec-race": async () => ({ status: "skipped-race", changed: false }),
      };
      mockEnsureRecordingThumbnail.mockImplementation(
        ({ recordingId }: { recordingId: string }) => outcomes[recordingId]!(),
      );
      // Already at the cap: one counted attempt here would mark it failed.
      mockCountAttempt.mockResolvedValue(5);

      // Six sweeps is half an hour of outage.
      for (let sweep = 0; sweep < 6; sweep += 1) await runThumbnailSweepOnce();

      expect(mockCountAttempt).not.toHaveBeenCalled();
      expect(mockMarkThumbnailFailed).not.toHaveBeenCalled();
    });

    it("does not count a recovered recording or one another producer is working on", async () => {
      mockRows.rows = [
        row,
        { id: "busy", ownerEmail: "qa@example.com", orgId: null },
      ];
      mockEnsureRecordingThumbnail
        .mockResolvedValueOnce({ status: "generated", changed: true })
        .mockResolvedValueOnce({ status: "skipped-lease", changed: false });

      await runThumbnailSweepOnce();

      expect(mockCountAttempt).not.toHaveBeenCalled();
      expect(mockMarkThumbnailFailed).not.toHaveBeenCalled();
    });
  });
});
