import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  assertAccess: vi.fn(),
  readAppState: vi.fn(),
  compareAndSetAppState: vi.fn(),
}));

vi.mock("@agent-native/core", () => ({
  defineAction: (config: unknown) => config,
}));

vi.mock("@agent-native/core/application-state", () => ({
  readAppState: mocks.readAppState,
  compareAndSetAppState: mocks.compareAndSetAppState,
}));

vi.mock("@agent-native/core/sharing", () => ({
  assertAccess: mocks.assertAccess,
}));

import action from "./cancel-node-rewrite-request.js";

const pending = {
  repromptId: "reprompt_1",
  designId: "design_1",
  fileId: "file_1",
  target: { nodeId: "hero" },
  baseVersionHash: "hash_base",
  instruction: "Make it darker",
  createdAt: "2026-07-16T00:00:00.000Z",
};

describe("cancel-node-rewrite-request", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.compareAndSetAppState.mockResolvedValue(true);
  });

  it("does not cancel a newer request", async () => {
    mocks.readAppState.mockResolvedValue({
      ...pending,
      repromptId: "reprompt_2",
    });

    await expect(
      action.run({
        designId: "design_1",
        fileId: "file_1",
        repromptId: "reprompt_1",
      }),
    ).resolves.toEqual({ cancelled: false, superseded: true });
    expect(mocks.compareAndSetAppState).not.toHaveBeenCalled();
  });

  it("atomically cancels only the matching pending request", async () => {
    mocks.readAppState
      .mockResolvedValueOnce(pending)
      .mockResolvedValueOnce(null);

    await expect(
      action.run({
        designId: "design_1",
        fileId: "file_1",
        repromptId: "reprompt_1",
      }),
    ).resolves.toMatchObject({ cancelled: true, superseded: false });
    expect(mocks.compareAndSetAppState).toHaveBeenCalledWith(
      "design-reprompt-pending:design_1:file_1",
      pending,
      null,
    );
  });
});
