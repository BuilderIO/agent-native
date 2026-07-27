import { beforeEach, describe, expect, it, vi } from "vitest";

const mockExecute = vi.hoisted(() => vi.fn());
const mockFinalizeRun = vi.hoisted(() => vi.fn());
const mockRunWithRequestContext = vi.hoisted(() =>
  vi.fn((_context: unknown, fn: () => unknown) => fn()),
);
const mockOwnerEmailMatches = vi.hoisted(() => vi.fn());
const mockRecordingRows = vi.hoisted(() => ({
  rows: [] as Array<{ ownerEmail: string; orgId: string | null }>,
}));
const mockLimit = vi.hoisted(() => vi.fn(async () => mockRecordingRows.rows));
const mockWhere = vi.hoisted(() => vi.fn(() => ({ limit: mockLimit })));
const mockFrom = vi.hoisted(() => vi.fn(() => ({ where: mockWhere })));
const mockSelect = vi.hoisted(() => vi.fn(() => ({ from: mockFrom })));

vi.mock("@agent-native/core/db", () => ({
  getDbExec: () => ({ execute: mockExecute }),
}));

vi.mock("@agent-native/core/server", () => ({
  runWithRequestContext: (context: unknown, fn: () => unknown) =>
    mockRunWithRequestContext(context, fn),
}));

vi.mock("drizzle-orm", () => ({
  and: vi.fn((...args: unknown[]) => args),
  eq: vi.fn((column: unknown, value: unknown) => ({ column, value })),
  isNull: vi.fn((column: unknown) => ({ column, kind: "isNull" })),
}));

vi.mock("../db/index.js", () => ({
  getDb: () => ({ select: mockSelect }),
  schema: {
    recordings: {
      id: "recordings.id",
      ownerEmail: "recordings.ownerEmail",
      orgId: "recordings.orgId",
      status: "recordings.status",
      trashedAt: "recordings.trashedAt",
    },
  },
}));

vi.mock("../lib/recordings.js", () => ({
  ownerEmailMatches: (...args: unknown[]) => mockOwnerEmailMatches(...args),
}));

vi.mock("../../actions/finalize-recording.js", () => ({
  default: { run: (...args: unknown[]) => mockFinalizeRun(...args) },
}));

import { runMediaVerificationSweepOnce } from "./media-verification";

function marker(overrides: Record<string, unknown> = {}) {
  return JSON.stringify({
    recordingId: "rec-1",
    status: "pending",
    completedAttempts: 2,
    nextAttemptAt: new Date(Date.now() - 60_000).toISOString(),
    leaseUntil: null,
    updatedAt: new Date(Date.now() - 60_000).toISOString(),
    ...overrides,
  });
}

describe("media verification recovery sweep", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFinalizeRun.mockResolvedValue({ status: "processing" });
    mockOwnerEmailMatches.mockReturnValue("owner-match");
    mockRecordingRows.rows = [
      { ownerEmail: "owner@example.com", orgId: "org-1" },
    ];
  });

  it("re-drives an overdue marker using only SQL-backed ownership context", async () => {
    mockExecute.mockResolvedValue({
      rows: [
        {
          session_id: "owner@example.com",
          key: "recording-media-verification-rec-1",
          value: marker({
            ownerEmail: "spoofed@example.com",
            orgId: "spoofed-org",
          }),
        },
      ],
    });

    await runMediaVerificationSweepOnce();

    expect(mockOwnerEmailMatches).toHaveBeenCalledWith(
      "recordings.ownerEmail",
      "owner@example.com",
    );
    expect(mockRunWithRequestContext).toHaveBeenCalledWith(
      { userEmail: "owner@example.com", orgId: "org-1" },
      expect.any(Function),
    );
    expect(mockFinalizeRun).toHaveBeenCalledWith({
      id: "rec-1",
      mediaVerificationRetryAttempt: 3,
    });
  });

  it("does not invoke recovery when the session does not own the recording", async () => {
    mockRecordingRows.rows = [];
    mockExecute.mockResolvedValue({
      rows: [
        {
          session_id: "attacker@example.com",
          key: "recording-media-verification-rec-1",
          value: marker(),
        },
      ],
    });

    await runMediaVerificationSweepOnce();

    expect(mockFinalizeRun).not.toHaveBeenCalled();
  });

  it("leaves a newly dispatched verification alone", async () => {
    mockExecute.mockResolvedValue({
      rows: [
        {
          session_id: "owner@example.com",
          key: "recording-media-verification-rec-1",
          value: marker({
            completedAttempts: 1,
            nextAttemptAt: new Date(Date.now() + 5_000).toISOString(),
          }),
        },
      ],
    });

    await runMediaVerificationSweepOnce();

    expect(mockSelect).not.toHaveBeenCalled();
    expect(mockFinalizeRun).not.toHaveBeenCalled();
  });

  it("reclaims a worker lease after it expires", async () => {
    mockExecute.mockResolvedValue({
      rows: [
        {
          session_id: "owner@example.com",
          key: "recording-media-verification-rec-1",
          value: marker({
            status: "leased",
            leaseUntil: new Date(Date.now() - 1_000).toISOString(),
          }),
        },
      ],
    });

    await runMediaVerificationSweepOnce();

    expect(mockFinalizeRun).toHaveBeenCalledWith({
      id: "rec-1",
      mediaVerificationRetryAttempt: 3,
    });
  });

  it("rejects a marker whose key and payload identify different recordings", async () => {
    mockExecute.mockResolvedValue({
      rows: [
        {
          session_id: "owner@example.com",
          key: "recording-media-verification-rec-2",
          value: marker(),
        },
      ],
    });

    await runMediaVerificationSweepOnce();

    expect(mockSelect).not.toHaveBeenCalled();
    expect(mockFinalizeRun).not.toHaveBeenCalled();
  });
});
