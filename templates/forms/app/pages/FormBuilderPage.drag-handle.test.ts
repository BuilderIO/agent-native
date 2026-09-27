import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const SOURCE_PATH = path.resolve(__dirname, "./FormBuilderPage.tsx");

function tailwindSpacingToPx(token: string): number {
  return parseFloat(token) * 4;
}

describe("field row drag handle spacing", () => {
  const source = readFileSync(SOURCE_PATH, "utf-8");

  it("leaves a visible gap between the drag handle and the field input", () => {
    const paddingMatch = source.match(/sm:px-(\d+(?:\.\d+)?)\b/);
    expect(
      paddingMatch,
      "expected to find the row's sm:px-N padding class",
    ).not.toBeNull();
    const rowPaddingPx = tailwindSpacingToPx(paddingMatch![1]);

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

    const handleRightEdgePx = sizePx - offsetPx;

    const minimumGapPx = 4;
    expect(handleRightEdgePx).toBeLessThanOrEqual(rowPaddingPx - minimumGapPx);
  });
});
