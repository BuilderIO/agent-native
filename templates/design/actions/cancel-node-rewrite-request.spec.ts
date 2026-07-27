import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  assertAccess: vi.fn(),
  readAppState: vi.fn(),
  compareAndSetAppState: vi.fn(),
  compareAndSetManyAppState: vi.fn(),
}));

vi.mock("@agent-native/core", () => ({
  defineAction: (config: unknown) => config,
}));

vi.mock("@agent-native/core/application-state", () => ({
  readAppState: mocks.readAppState,
  compareAndSetAppState: mocks.compareAndSetAppState,
  compareAndSetManyAppState: mocks.compareAndSetManyAppState,
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
    mocks.compareAndSetManyAppState.mockResolvedValue(true);
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

  it("clears a pending request and its proposal in one transition", async () => {
    const proposal = {
      proposalId: "proposal_1",
      repromptId: "reprompt_1",
      designId: "design_1",
      fileId: "file_1",
      baseVersionHash: "hash_base",
      target: { nodeId: "hero" },
      resolvedTarget: { nodeId: "hero", selector: "[data-hero]" },
      variants: [{ html: "<section />", summary: "Updated" }],
    };
    mocks.readAppState
      .mockResolvedValueOnce(pending)
      .mockResolvedValueOnce(proposal);

    await expect(
      action.run({
        designId: "design_1",
        fileId: "file_1",
        repromptId: "reprompt_1",
      }),
    ).resolves.toMatchObject({
      cancelled: true,
      proposalCancelled: true,
      superseded: false,
    });
    expect(mocks.compareAndSetManyAppState).toHaveBeenCalledWith([
      expect.objectContaining({
        key: "design-reprompt-pending:design_1:file_1",
        nextValue: null,
      }),
      expect.objectContaining({
        key: "design-reprompt-proposal:design_1:file_1:reprompt_1",
        nextValue: null,
      }),
    ]);
    expect(mocks.compareAndSetAppState).not.toHaveBeenCalled();
  });
});
