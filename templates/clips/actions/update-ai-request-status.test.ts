import { beforeEach, describe, expect, it, vi } from "vitest";

const mockWriteAppState = vi.hoisted(() => vi.fn(async () => undefined));
const mockReadAppState = vi.hoisted(() => vi.fn(async () => null));
const mockAssertAccess = vi.hoisted(() => vi.fn(async () => undefined));

vi.mock("@agent-native/core", () => ({
  defineAction: (options: unknown) => options,
}));
vi.mock("@agent-native/core/application-state", () => ({
  readAppState: mockReadAppState,
  writeAppState: mockWriteAppState,
}));
vi.mock("@agent-native/core/sharing", () => ({
  assertAccess: mockAssertAccess,
}));

import action from "./update-ai-request-status";

describe("update-ai-request-status", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockReadAppState.mockResolvedValue(null);
  });

  it("writes a scoped completion status for queued silence removal", async () => {
    mockReadAppState.mockResolvedValue({
      kind: "remove-silences",
      status: "working",
      requestedAt: "2026-09-04T12:00:00.000Z",
    });
    const args = action.schema.parse({
      recordingId: "rec_123",
      kind: "remove-silences",
      requestedAt: "2026-09-04T12:00:00.000Z",
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

  it("supports filler-word progress and preserves the request timestamp", async () => {
    mockReadAppState.mockResolvedValue({
      kind: "remove-filler-words",
      status: "queued",
      requestedAt: "2026-09-04T12:00:00.000Z",
    });
    const args = action.schema.parse({
      recordingId: "rec_123",
      kind: "remove-filler-words",
      requestedAt: "2026-09-04T12:00:00.000Z",
      status: "working",
    });

    await action.run(args);

    expect(mockWriteAppState).toHaveBeenCalledWith(
      "clips-ai-request-status-rec_123",
      expect.objectContaining({
        kind: "remove-filler-words",
        status: "working",
        requestedAt: "2026-09-04T12:00:00.000Z",
      }),
    );
  });

  it("rejects a stale update for a different active request", async () => {
    mockReadAppState.mockResolvedValue({
      kind: "remove-silences",
      status: "working",
      requestedAt: "2026-09-04T12:00:00.000Z",
    });
    const args = action.schema.parse({
      recordingId: "rec_123",
      kind: "remove-filler-words",
      requestedAt: "2026-09-04T12:00:00.000Z",
      status: "completed",
    });

    await expect(action.run(args)).rejects.toThrow(
      "remove-silences is the active request",
    );
    expect(mockWriteAppState).not.toHaveBeenCalled();
  });

  it("rejects an update from an older run of the same request kind", async () => {
    mockReadAppState.mockResolvedValue({
      kind: "remove-silences",
      status: "working",
      requestedAt: "2026-09-04T12:01:00.000Z",
    });
    const args = action.schema.parse({
      recordingId: "rec_123",
      kind: "remove-silences",
      requestedAt: "2026-09-04T12:00:00.000Z",
      status: "completed",
    });

    await expect(action.run(args)).rejects.toThrow("stale");
    expect(mockWriteAppState).not.toHaveBeenCalled();
  });

  it("does not regress a terminal request back to working", async () => {
    mockReadAppState.mockResolvedValue({
      kind: "remove-filler-words",
      status: "completed",
      requestedAt: "2026-09-04T12:00:00.000Z",
    });
    const args = action.schema.parse({
      recordingId: "rec_123",
      kind: "remove-filler-words",
      requestedAt: "2026-09-04T12:00:00.000Z",
      status: "working",
    });

    await expect(action.run(args)).rejects.toThrow("already completed");
    expect(mockWriteAppState).not.toHaveBeenCalled();
  });
});
