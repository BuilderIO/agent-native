import { beforeEach, describe, expect, it, vi } from "vitest";

const mockWriteAppState = vi.hoisted(() => vi.fn(async () => undefined));
const mockAssertAccess = vi.hoisted(() => vi.fn(async () => undefined));

vi.mock("@agent-native/core", () => ({
  defineAction: (options: unknown) => options,
}));
vi.mock("@agent-native/core/application-state", () => ({
  writeAppState: mockWriteAppState,
}));
vi.mock("@agent-native/core/sharing", () => ({
  assertAccess: mockAssertAccess,
}));

import action from "./update-ai-request-status";

describe("update-ai-request-status", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("writes a scoped completion status for queued silence removal", async () => {
    const args = action.schema.parse({
      recordingId: "rec_123",
      kind: "remove-silences",
      status: "completed",
      message: "Removed 2 silent ranges.",
    });

    await expect(action.run(args)).resolves.toMatchObject({
      recordingId: "rec_123",
      status: "completed",
    });
    expect(mockAssertAccess).toHaveBeenCalledWith(
      "recording",
      "rec_123",
      "editor",
    );
    expect(mockWriteAppState).toHaveBeenCalledWith(
      "clips-ai-request-status-rec_123",
      expect.objectContaining({
        kind: "remove-silences",
        status: "completed",
        message: "Removed 2 silent ranges.",
      }),
    );
  });
});
