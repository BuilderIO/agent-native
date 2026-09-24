import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ read: vi.fn(), list: vi.fn() }));
vi.mock("./get-deck-reference-context.js", () => ({
  default: { run: mocks.read },
}));
vi.mock("./list-decks.js", () => ({ default: { run: mocks.list } }));

import action from "./read-composer-source.js";

describe("read-composer-source", () => {
  beforeEach(() => vi.clearAllMocks());

  it("preserves source pagination and searches titles", async () => {
    mocks.list.mockResolvedValue({
      decks: [{ id: "example-deck", title: "Example" }],
      nextCursor: "next",
    });
    expect(
      await action.run({
        source: "slides",
        operation: "list",
        page: 1,
        cursor: "previous",
        search: "Example",
      }),
    ).toEqual({
      items: [{ id: "example-deck", title: "Example" }],
      hasMore: true,
      nextCursor: "next",
    });
    expect(mocks.list).toHaveBeenCalledWith(
      { limit: 30, cursor: "previous", search: "Example" },
      undefined,
    );
  });

  it("returns a layout reference without importing or replacing slides", async () => {
    mocks.read.mockResolvedValue({
      id: "example-deck",
      title: "Example",
      agentContext: "Layout only; no factual reuse.",
    });
    expect(
      await action.run({
        source: "slides",
        operation: "read",
        id: "example-deck",
        page: 1,
      }),
    ).toEqual({
      id: "example-deck",
      title: "Example",
      context: "Layout only; no factual reuse.",
    });
  });

  it("preserves inaccessible source failures", async () => {
    mocks.read.mockRejectedValue(new Error("Deck not found"));
    await expect(
      action.run({
        source: "slides",
        operation: "read",
        id: "missing",
        page: 1,
      }),
    ).rejects.toThrow("Deck not found");
  });

  it("does not expose cross-app reads without enabling sharing", async () => {
    await expect(
      action.run({ source: "design", operation: "list", page: 1 }),
    ).rejects.toThrow("Cross-app reference sharing is not enabled");
  });
});
