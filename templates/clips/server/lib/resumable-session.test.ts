import { beforeEach, describe, expect, it, vi } from "vitest";

const mockCompareAndSetAppState = vi.hoisted(() => vi.fn());

vi.mock("@agent-native/core/application-state", () => ({
  compareAndSetAppState: (...args: unknown[]) =>
    mockCompareAndSetAppState(...args),
  deleteAppState: vi.fn(),
  readAppState: vi.fn(),
  writeAppState: vi.fn(),
}));

import { compareAndSetResumableSession } from "./resumable-session";

describe("compareAndSetResumableSession", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCompareAndSetAppState.mockResolvedValue(true);
  });

  it("fences settlement to the exact recording generation and session snapshot", async () => {
    const expected = {
      providerId: "s3",
      sessionId: "session-a",
      meta: { uploadId: "upload-a" },
      bytesUploaded: 100,
      lastCommittedIndex: 2,
    };
    const next = {
      ...expected,
      meta: { ...expected.meta, completedPart: 3 },
      bytesUploaded: 125,
      lastCommittedIndex: 3,
    };

    await expect(
      compareAndSetResumableSession(
        "recording-a",
        expected,
        next,
        "generation-a",
      ),
    ).resolves.toBe(true);
    expect(mockCompareAndSetAppState).toHaveBeenCalledWith(
      "resumable-session-recording-a-generation-a",
      expected,
      next,
    );
  });
});
