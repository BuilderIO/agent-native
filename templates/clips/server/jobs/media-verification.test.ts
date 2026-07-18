import { beforeEach, describe, expect, it, vi } from "vitest";

const mockExecute = vi.hoisted(() => vi.fn());
const mockFinalizeRun = vi.hoisted(() => vi.fn());
const mockRunWithRequestContext = vi.hoisted(() =>
  vi.fn((_context: unknown, fn: () => unknown) => fn()),
);

vi.mock("@agent-native/core/db", () => ({
  getDbExec: () => ({ execute: mockExecute }),
}));

vi.mock("@agent-native/core/server", () => ({
  runWithRequestContext: (context: unknown, fn: () => unknown) =>
    mockRunWithRequestContext(context, fn),
}));

vi.mock("../../actions/finalize-recording.js", () => ({
  default: { run: (...args: unknown[]) => mockFinalizeRun(...args) },
}));

import { runMediaVerificationSweepOnce } from "./media-verification";

describe("media verification recovery sweep", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFinalizeRun.mockResolvedValue({ status: "processing" });
  });

  it("re-drives an overdue durable verification in its owner context", async () => {
    mockExecute.mockResolvedValue({
      rows: [
        {
          session_id: "fallback@example.com",
          key: "recording-upload-rec-1",
          value: JSON.stringify({
            recordingId: "rec-1",
            ownerEmail: "owner@example.com",
            orgId: "org-1",
            status: "processing",
            pendingMediaVerification: true,
            mediaVerificationAttempt: 2,
            mediaVerificationNextAttemptAt: new Date(
              Date.now() - 60_000,
            ).toISOString(),
          }),
        },
      ],
    });

    await runMediaVerificationSweepOnce();

    expect(mockRunWithRequestContext).toHaveBeenCalledWith(
      { userEmail: "owner@example.com", orgId: "org-1" },
      expect.any(Function),
    );
    expect(mockFinalizeRun).toHaveBeenCalledWith({
      id: "rec-1",
      mediaVerificationRetryAttempt: 3,
    });
  });

  it("leaves a newly dispatched verification alone", async () => {
    mockExecute.mockResolvedValue({
      rows: [
        {
          session_id: "owner@example.com",
          key: "recording-upload-rec-2",
          value: JSON.stringify({
            recordingId: "rec-2",
            status: "processing",
            pendingMediaVerification: true,
            mediaVerificationAttempt: 1,
            mediaVerificationNextAttemptAt: new Date(
              Date.now() + 5_000,
            ).toISOString(),
          }),
        },
      ],
    });

    await runMediaVerificationSweepOnce();

    expect(mockFinalizeRun).not.toHaveBeenCalled();
  });
});
