import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const SOURCE_PATH = path.resolve(__dirname, "./FormBuilderPage.tsx");

// Tailwind's default spacing scale is 0.25rem (4px) per unit.
function tailwindSpacingToPx(token: string): number {
  return parseFloat(token) * 4;
}

describe("field row drag handle spacing", () => {
  const source = readFileSync(SOURCE_PATH, "utf-8");

  it("leaves a visible gap between the drag handle and the field input", () => {
    // The draggable row wrapper extends its hover/selection background past
    // the input via a negative margin, then pulls the input back in with
    // matching padding (e.g. "sm:-mx-4 sm:px-4"). That padding value is the
    // gutter the drag handle must fit inside.
    const paddingMatch = source.match(/sm:px-(\d+(?:\.\d+)?)\b/);
    expect(
      paddingMatch,
      "expected to find the row's sm:px-N padding class",
    ).not.toBeNull();
    const rowPaddingPx = tailwindSpacingToPx(paddingMatch![1]);

    // The drag handle is absolutely positioned inside that gutter with a
    // negative inset-inline-start offset and a fixed size.
    const handleMatch = source.match(
      /className="absolute -start-(\d+(?:\.\d+)?)\s[^"]*?\bsize-(\d+(?:\.\d+)?)\b[^"]*?"\s*\n\s*aria-label=\{t\("builder\.dragToReorder"\)\}/,
    );
    expect(
      handleMatch,
      "expected to find the drag handle's absolute -start-N / size-N classes",
    ).not.toBeNull();
    const [, offsetToken, sizeToken] = handleMatch!;
    const offsetPx = tailwindSpacingToPx(offsetToken);
    const sizePx = tailwindSpacingToPx(sizeToken);

    // How far the handle's right edge sits past the row's own left border.
    const handleRightEdgePx = sizePx - offsetPx;

    // The input starts at the row's left border plus the row's padding. The
    // handle's right edge must land before that, with a visible gap -
    // otherwise the grip icon crosses the input's left border, which is the
    // bug this test guards against.
    const minimumGapPx = 4;
    expect(handleRightEdgePx).toBeLessThanOrEqual(rowPaddingPx - minimumGapPx);
  });
});
