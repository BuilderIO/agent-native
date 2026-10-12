import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  assertAccess: vi.fn(async () => undefined),
  compareAndSetAppState: vi.fn(async () => true),
  readAppState: vi.fn(async () => null as Record<string, unknown> | null),
  writeAppState: vi.fn(async () => undefined),
}));

vi.mock("@agent-native/core/action", () => ({
  defineAction: (options: unknown) => options,
}));
vi.mock("@agent-native/core/application-state", () => ({
  compareAndSetAppState: mocks.compareAndSetAppState,
  readAppState: mocks.readAppState,
  writeAppState: mocks.writeAppState,
}));
vi.mock("@agent-native/core/sharing", () => ({
  assertAccess: mocks.assertAccess,
}));

import consumeAiRequest from "./consume-ai-request";

const requestedAt = "2026-10-08T12:00:00.000Z";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.readAppState.mockResolvedValue(null);
  mocks.compareAndSetAppState.mockResolvedValue(true);
  mocks.writeAppState.mockResolvedValue(undefined);
});

describe("consume-ai-request", () => {
  it("clears only the exact queued request by compare-and-set", async () => {
    const queued = {
      kind: "remove-filler-words",
      recordingId: "rec_1",
      requestedAt,
    };
    mocks.readAppState.mockResolvedValue(queued);
    const args = consumeAiRequest.schema.parse({
      recordingId: "rec_1",
      kind: "remove-filler-words",
      requestedAt,
    });

    await expect(consumeAiRequest.run(args)).resolves.toMatchObject({
      consumed: true,
    });
    expect(mocks.assertAccess).toHaveBeenCalledWith(
      "recording",
      "rec_1",
      "editor",
    );
    expect(mocks.compareAndSetAppState).toHaveBeenCalledWith(
      "clips-ai-request-rec_1",
      queued,
      null,
    );
  });

  it("preserves a newer request in the same recording slot", async () => {
    mocks.readAppState.mockResolvedValue({
      kind: "remove-filler-words",
      recordingId: "rec_1",
      requestedAt: "2026-10-08T12:00:01.000Z",
    });
    const args = consumeAiRequest.schema.parse({
      recordingId: "rec_1",
      kind: "remove-filler-words",
      requestedAt,
    });

    await expect(consumeAiRequest.run(args)).resolves.toMatchObject({
      consumed: false,
    });
    expect(mocks.compareAndSetAppState).not.toHaveBeenCalled();
    expect(mocks.writeAppState).not.toHaveBeenCalled();
  });
});
