import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const txSelectChain = { from: vi.fn(), where: vi.fn() };
  txSelectChain.from.mockReturnValue(txSelectChain);
  txSelectChain.where.mockReturnValue(txSelectChain);

  const txUpdateChain = { set: vi.fn(), where: vi.fn() };
  txUpdateChain.set.mockReturnValue(txUpdateChain);

  const tx = {
    select: vi.fn(() => txSelectChain),
    update: vi.fn(() => txUpdateChain),
  };

  const db = {
    transaction: vi.fn(async (callback: (tx: unknown) => unknown) =>
      callback(tx),
    ),
  };

  return {
    db,
    tx,
    txSelectChain,
    txUpdateChain,
    assertAccess: vi.fn(),
    completeText: vi.fn(),
    eq: vi.fn((left: unknown, right: unknown) => ({ left, right })),
  };
});

vi.mock("@agent-native/core/sharing", () => ({
  assertAccess: mocks.assertAccess,
}));

vi.mock("@agent-native/core/server", () => ({
  completeText: mocks.completeText,
}));

vi.mock("drizzle-orm", () => ({
  eq: mocks.eq,
}));

vi.mock("../server/db/index.js", () => ({
  getDb: () => mocks.db,
  schema: {
    designs: {
      id: "designs.id",
      title: "designs.title",
    },
  },
}));

import action from "./generate-design-title.js";

describe("generate-design-title", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.txSelectChain.where.mockResolvedValue([
      { title: "A clean analytics dashboard with a…" },
    ]);
  });

  it("checks editor access before generating", async () => {
    mocks.completeText.mockResolvedValue({ text: "Sales Dashboard" });

    await action.run({
      designId: "design_1",
      prompt: "A clean analytics dashboard with a sidebar and charts",
      previousTitle: "A clean analytics dashboard with a…",
    });

    expect(mocks.assertAccess).toHaveBeenCalledWith(
      "design",
      "design_1",
      "editor",
    );
  });

  it("sanitizes the model output and saves it when the placeholder is unchanged", async () => {
    mocks.completeText.mockResolvedValue({ text: '"sales dashboard."' });

    const result = await action.run({
      designId: "design_1",
      prompt: "A clean analytics dashboard with a sidebar and charts",
      previousTitle: "A clean analytics dashboard with a…",
    });

    expect(result).toEqual({ updated: true, title: "Sales Dashboard" });
    expect(mocks.tx.update).toHaveBeenCalled();
    expect(mocks.txUpdateChain.set).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Sales Dashboard" }),
    );
  });

  it("does not overwrite a title the user already changed", async () => {
    mocks.txSelectChain.where.mockResolvedValue([
      { title: "My Custom Renamed Design" },
    ]);
    mocks.completeText.mockResolvedValue({ text: "Sales Dashboard" });

    const result = await action.run({
      designId: "design_1",
      prompt: "A clean analytics dashboard with a sidebar and charts",
      previousTitle: "A clean analytics dashboard with a…",
    });

    expect(result).toEqual({ updated: false, reason: "title-changed" });
    expect(mocks.tx.update).not.toHaveBeenCalled();
  });

  it("returns not-found when the design no longer exists", async () => {
    mocks.txSelectChain.where.mockResolvedValue([]);
    mocks.completeText.mockResolvedValue({ text: "Sales Dashboard" });

    const result = await action.run({
      designId: "design_1",
      prompt: "A clean analytics dashboard with a sidebar and charts",
      previousTitle: "A clean analytics dashboard with a…",
    });

    expect(result).toEqual({ updated: false, reason: "not-found" });
  });

  it("falls back gracefully when the model call fails", async () => {
    mocks.completeText.mockRejectedValue(new Error("engine unavailable"));

    const result = await action.run({
      designId: "design_1",
      prompt: "A clean analytics dashboard with a sidebar and charts",
      previousTitle: "A clean analytics dashboard with a…",
    });

    expect(result).toEqual({ updated: false, reason: "generation-failed" });
    expect(mocks.tx.update).not.toHaveBeenCalled();
  });

  it("discards results that sanitize to nothing", async () => {
    mocks.completeText.mockResolvedValue({ text: '""' });

    const result = await action.run({
      designId: "design_1",
      prompt: "A clean analytics dashboard with a sidebar and charts",
      previousTitle: "A clean analytics dashboard with a…",
    });

    expect(result).toEqual({ updated: false, reason: "empty-result" });
  });

  it("skips generation for an empty prompt", async () => {
    const result = await action.run({
      designId: "design_1",
      prompt: "   ",
      previousTitle: "Untitled Design",
    });

    expect(result).toEqual({ updated: false, reason: "empty-prompt" });
    expect(mocks.completeText).not.toHaveBeenCalled();
  });
});
