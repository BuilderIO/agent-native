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
  it("bounds a full-deck read so a stalled lookup can return a tool error", () => {
    expect(action.timeoutMs).toBe(60_000);
  });

  it("returns 1-based slideNumber fields before internal zero-based indexes", async () => {
    const result = (await action.run(
      { id: "deck-1" },
      { caller: "cli" },
    )) as any;

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

  it("defaults agent calls to compact output so full slide HTML is not retransmitted", async () => {
    const result = (await action.run(
      { id: "deck-1" },
      { caller: "tool" },
    )) as any;

    expect(result.slides[0]).toMatchObject({
      id: "slide-a",
      textPreview: "Opening",
    });
    expect(result.slides[0]).not.toHaveProperty("content");
  });

  it("lets agent calls opt into full slide HTML", async () => {
    const result = (await action.run(
      { id: "deck-1", compact: "false" },
      { caller: "tool" },
    )) as any;

    expect(result.slides[0]).toMatchObject({
      id: "slide-a",
      content: "<h1>Opening</h1>",
    });
  });

  it("returns only the requested slide with full HTML for targeted agent reads", async () => {
    const result = (await action.run(
      { id: "deck-1", slideId: "slide-b" },
      { caller: "tool" },
    )) as any;

    expect(result).toMatchObject({
      slideCount: 2,
      selectedSlideId: "slide-b",
    });
    expect(result.slides).toHaveLength(1);
    expect(result.slides[0]).toMatchObject({
      id: "slide-b",
      slideNumber: 2,
      zeroBasedIndex: 1,
      content: "<p>Metrics</p>",
    });
  });

  it("supports compact summaries for a single requested slide", async () => {
    const result = (await action.run(
      { id: "deck-1", slideId: "slide-b", compact: "true" },
      { caller: "tool" },
    )) as any;

    expect(result).toMatchObject({ selectedSlideId: "slide-b" });
    expect(result.slides).toHaveLength(1);
    expect(result.slides[0]).toMatchObject({
      id: "slide-b",
      slideNumber: 2,
      zeroBasedIndex: 1,
      textPreview: "Metrics",
    });
    expect(result.slides[0]).not.toHaveProperty("content");
  });

  it("reports resolved animation targets in compact reads", async () => {
    mockResolveAccess.mockResolvedValue({
      resource: {
        id: "deck-1",
        title: "Animated",
        visibility: "private",
        designSystemId: null,
        data: JSON.stringify({
          title: "Animated",
          slides: [
            {
              id: "slide-a",
              content:
                '<div class="fmd-slide"><h1>Opening</h1><p>Details</p></div>',
              animations: [
                {
                  id: "opening",
                  elementIndex: 0,
                  elementPath: [0],
                  type: "fade",
                },
              ],
            },
          ],
        }),
      },
    });

    const result = (await action.run(
      { id: "deck-1", compact: "true" },
      { caller: "tool" },
    )) as any;

    expect(result.slides[0].animations.steps[0]).toMatchObject({
      targetPreview: "Opening",
      resolvedPath: "0",
      targetValid: true,
      targetIssue: null,
    });
  });

  it("returns a not-found error for an unknown requested slide", async () => {
    await expect(
      action.run(
        { id: "deck-1", slideId: "missing-slide" },
        { caller: "tool" },
      ),
    ).rejects.toMatchObject({ statusCode: 404 });
  });

  it("keeps full slide HTML for frontend callers", async () => {
    const result = (await action.run(
      { id: "deck-1" },
      { caller: "frontend" },
    )) as any;

    expect(result.slides[0]).toMatchObject({
      id: "slide-a",
      content: "<h1>Opening</h1>",
    });
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
