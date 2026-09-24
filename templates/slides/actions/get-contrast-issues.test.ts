import { beforeEach, describe, expect, it, vi } from "vitest";

const mockResolveAccess = vi.fn();
const mockParseBuilderDesignSystemProxyReference = vi.fn();

vi.mock("@agent-native/core/action", () => ({
  defineAction: (action: unknown) => action,
}));

vi.mock("@agent-native/core/server", () => ({
  parseBuilderDesignSystemProxyReference: (
    ...args: Parameters<typeof mockParseBuilderDesignSystemProxyReference>
  ) => mockParseBuilderDesignSystemProxyReference(...args),
}));

vi.mock("@agent-native/core/sharing", () => ({
  resolveAccess: (...args: Parameters<typeof mockResolveAccess>) =>
    mockResolveAccess(...args),
}));

import action from "./get-contrast-issues.js";

const lowContrastSlide = {
  id: "slide-a",
  content:
    '<div class="fmd-slide" style="background: #ffffff;"><p style="color: #f0f0f0; font-size: 16px;">Hard to read</p></div>',
};
const passingSlide = {
  id: "slide-b",
  content:
    '<div class="fmd-slide" style="background: #ffffff;"><p style="color: #000000; font-size: 16px;">Readable</p></div>',
};

function deckAccess(overrides: Record<string, unknown> = {}) {
  return {
    resource: {
      id: "deck-1",
      designSystemId: null,
      data: JSON.stringify({
        slides: [lowContrastSlide, passingSlide],
        ...overrides,
      }),
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockParseBuilderDesignSystemProxyReference.mockReturnValue(null);
});

describe("get-contrast-issues", () => {
  it("returns 404 when the deck cannot be read", async () => {
    mockResolveAccess.mockResolvedValueOnce(null);
    await expect(action.run({ deckId: "missing" })).rejects.toMatchObject({
      statusCode: 404,
    });
  });

  it("audits every slide, rolls up issues, and only claims a pass when none remain", async () => {
    mockResolveAccess.mockResolvedValueOnce(deckAccess());

    const mixed = await action.run({ deckId: "deck-1" });
    expect(mixed).toMatchObject({
      slideCount: 2,
      totalIssues: 1,
      totalUnresolvedElements: 0,
      canClaimDeckPassesContrast: false,
    });
    expect(mixed.slides[0].issues).toHaveLength(1);
    expect(mixed.slides[1].issues).toHaveLength(0);

    mockResolveAccess.mockResolvedValueOnce(
      deckAccess({ slides: [passingSlide] }),
    );
    const clean = await action.run({ deckId: "deck-1" });
    expect(clean.canClaimDeckPassesContrast).toBe(true);
  });

  it("scopes to one slide via slideId, and 404s for an unknown one", async () => {
    mockResolveAccess.mockResolvedValueOnce(deckAccess());
    const result = await action.run({ deckId: "deck-1", slideId: "slide-b" });
    expect(result.slideCount).toBe(1);
    expect(result.slides[0].slideId).toBe("slide-b");

    mockResolveAccess.mockResolvedValueOnce(deckAccess());
    await expect(
      action.run({ deckId: "deck-1", slideId: "does-not-exist" }),
    ).rejects.toMatchObject({ statusCode: 404 });
  });

  it("reads the linked design system's colors and applies them to the audit", async () => {
    mockResolveAccess
      .mockResolvedValueOnce(
        deckAccess({
          designSystemId: "ds-1",
          slides: [
            {
              id: "slide-a",
              content:
                '<div class="fmd-slide" style="--deck-ink: var(--ds-text, CanvasText); background: var(--deck-bg, Canvas);"><p style="color: var(--deck-ink, CanvasText); font-size: 16px;">Body</p></div>',
            },
          ],
        }),
      )
      .mockResolvedValueOnce({
        resource: {
          data: JSON.stringify({
            colors: { text: "#e5e5e5", background: "#ffffff" },
          }),
        },
      });

    const result = await action.run({ deckId: "deck-1" });

    expect(mockResolveAccess).toHaveBeenNthCalledWith(
      2,
      "design-system",
      "ds-1",
    );
    expect(result.designSystemColorsResolved).toBe("available");
    expect(result.slides[0].issues[0].foreground).toBe("#e5e5e5");
  });

  it("reports unavailable colors for a Builder-hosted design system instead of guessing", async () => {
    mockParseBuilderDesignSystemProxyReference.mockReturnValueOnce({
      source: "builder",
      builderDesignSystemId: "builder-ds-1",
      builderJobId: "job-1",
    });
    mockResolveAccess
      .mockResolvedValueOnce(deckAccess({ designSystemId: "ds-builder" }))
      .mockResolvedValueOnce({
        resource: { data: JSON.stringify({ source: "builder" }) },
      });

    const result = await action.run({ deckId: "deck-1" });

    expect(result.designSystemColorsResolved).toBe("unavailable");
    expect(result.designSystemWarning).toBeDefined();
  });

  it("surfaces a warning and no-root status for a slide missing the .fmd-slide wrapper", async () => {
    mockResolveAccess.mockResolvedValueOnce(
      deckAccess({ slides: [{ id: "slide-x", content: "<p>No wrapper</p>" }] }),
    );

    const result = await action.run({ deckId: "deck-1" });

    expect(result.slides[0].status).toBe("no-root");
    expect(result.canClaimDeckPassesContrast).toBe(false);
    expect(result.warning).toContain("slide-x");
  });
});
