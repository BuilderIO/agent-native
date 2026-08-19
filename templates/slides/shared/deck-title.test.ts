import { describe, expect, it } from "vitest";

import {
  assertHumanReadableDeckTitle,
  deriveDeckTitleFromSlideContent,
  isOpaqueDeckTitle,
  repairGeneratedDeckTitle,
  resolveImportedDeckTitle,
} from "./deck-title";

describe("deck title safeguards", () => {
  it("recognizes opaque generated ids without rejecting normal titles", () => {
    expect(isOpaqueDeckTitle("H3sVsnns-TEVUOpz9w")).toBe(true);
    expect(isOpaqueDeckTitle("Agent-Native Strategy")).toBe(false);
    expect(isOpaqueDeckTitle("Q4 Pipeline Review")).toBe(false);
  });

  it("derives the title from the largest styled text on the title slide", () => {
    const content = `<div class="fmd-slide">
      <div style="font-size: 16px;">BUILDER / STRATEGY</div>
      <div style="font-size: 54px; font-weight: 900;">Agent-Native <span>Strategy</span></div>
      <div style="font-size: 16px;">Date</div>
    </div>`;

    expect(deriveDeckTitleFromSlideContent(content)).toBe(
      "Agent-Native Strategy",
    );
  });

  it("finds a styled title inside a styled slide wrapper", () => {
    const content =
      '<div class="fmd-slide" style="padding: 80px 110px;"><div style="font-size: 54px;">Agent-Native Strategy</div></div>';

    expect(deriveDeckTitleFromSlideContent(content)).toBe(
      "Agent-Native Strategy",
    );
  });

  it("repairs a generated title from slide content or keeps a good existing title", () => {
    expect(
      repairGeneratedDeckTitle(
        "H3sVsnns-TEVUOpz9w",
        "<h1>Agent-Native Strategy</h1>",
      ),
    ).toBe("Agent-Native Strategy");
    expect(
      repairGeneratedDeckTitle(
        "Untitled Deck",
        "<div>No heading</div>",
        "Q4 Review",
      ),
    ).toBe("Q4 Review");
  });

  it("prefers slide content over imported filename placeholders", () => {
    expect(
      resolveImportedDeckTitle(
        "Untitled scene",
        '<div style="font-size: 54px;">Agent-Native Strategy</div>',
      ),
    ).toBe("Agent-Native Strategy");
    expect(resolveImportedDeckTitle("Untitled scene", "<div></div>")).toBe(
      "Imported File",
    );
    expect(
      resolveImportedDeckTitle(
        "Quarterly Business Review",
        "<h1>Executive summary</h1>",
      ),
    ).toBe("Quarterly Business Review");
  });

  it("fails loudly when an opaque title cannot be recovered", () => {
    expect(() => assertHumanReadableDeckTitle("H3sVsnns-TEVUOpz9w")).toThrow(
      /human-readable title/,
    );
  });
});
