import { beforeEach, describe, expect, it, vi } from "vitest";

const mockResolveAccess = vi.fn();

vi.mock("@agent-native/core/sharing", () => ({
  resolveAccess: (...args: unknown[]) => mockResolveAccess(...args),
}));

vi.mock("../server/db/index.js", () => ({}));

import action from "./get-deck";

beforeEach(() => {
  vi.clearAllMocks();
  mockResolveAccess.mockResolvedValue({
    resource: {
      id: "deck-1",
      title: "Quarterly Review",
      visibility: "private",
      designSystemId: null,
      createdAt: "2026-05-01T00:00:00.000Z",
      updatedAt: "2026-05-02T00:00:00.000Z",
      data: JSON.stringify({
        title: "Quarterly Review",
        slides: [
          {
            id: "slide-a",
            layout: "title",
            content: "<h1>Opening</h1>",
          },
          {
            id: "slide-b",
            layout: "content",
            content: "<p>Metrics</p>",
          },
        ],
      }),
    },
  });
});

describe("get-deck", () => {
  it("returns 1-based slideNumber fields before internal zero-based indexes", async () => {
    const result = (await action.run({ id: "deck-1" })) as any;

    expect(result.slideNumbering).toContain("1-based");
    expect(result.slides[0]).toMatchObject({
      slideNumber: 1,
      zeroBasedIndex: 0,
      id: "slide-a",
    });
    expect(result.slides[1]).toMatchObject({
      slideNumber: 2,
      zeroBasedIndex: 1,
      id: "slide-b",
    });
    expect(result.slides[0]).not.toHaveProperty("index");
  });

  it("uses the same numbering contract for compact output", async () => {
    const result = (await action.run({
      id: "deck-1",
      compact: "true",
    })) as any;

    expect(result.slideNumbering).toContain("Slide 1");
    expect(result.slides[0]).toMatchObject({
      slideNumber: 1,
      zeroBasedIndex: 0,
      textPreview: "Opening",
    });
    expect(result.slides[0]).not.toHaveProperty("index");
  });
});
