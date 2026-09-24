import { describe, expect, it } from "vitest";

import { trashPreviewBlocks } from "./trash-preview-content";

describe("trashPreviewBlocks", () => {
  it("preserves readable blocks without mounting an editor", () => {
    expect(trashPreviewBlocks("# Title\n\nParagraph\nline two\n\n")).toEqual([
      "# Title",
      "Paragraph\nline two",
    ]);
  });
});
