import { beforeEach, describe, expect, it, vi } from "vitest";

const resolveAccess = vi.hoisted(() => vi.fn());
vi.mock("@agent-native/core/sharing", () => ({ resolveAccess }));
vi.mock("@agent-native/core/tracking", () => ({ track: vi.fn() }));

import { readGeneratedDeckSlideCount } from "./generation-completion";

beforeEach(() => {
  resolveAccess.mockReset();
});

describe("readGeneratedDeckSlideCount", () => {
  it("counts the slides of a readable deck", async () => {
    resolveAccess.mockResolvedValue({
      resource: {
        data: JSON.stringify({ slides: [{ id: "a" }, { id: "b" }] }),
      },
    });
    await expect(readGeneratedDeckSlideCount("deck-1")).resolves.toBe(2);
  });

  it("reports a deleted or unshared deck as absent", async () => {
    resolveAccess.mockResolvedValue(null);
    await expect(readGeneratedDeckSlideCount("deck-1")).resolves.toBeNull();
  });

  it("rejects when the deck cannot be read, so it is not mistaken for a gone deck", async () => {
    resolveAccess.mockRejectedValue(new Error("database unavailable"));
    await expect(readGeneratedDeckSlideCount("deck-1")).rejects.toThrow(
      "database unavailable",
    );
  });
});
