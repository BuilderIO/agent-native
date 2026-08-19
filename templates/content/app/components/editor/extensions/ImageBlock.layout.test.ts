import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

describe("image block layout", () => {
  it("fills the editor width by default without changing every media block", () => {
    const css = readFileSync(
      new URL("../../../global.css", import.meta.url),
      "utf8",
    );

    expect(css).toMatch(
      /\.notion-editor \.node-image \.media-block\s*\{\s*width: 100%;\s*\}/,
    );
    expect(css).toMatch(
      /\.notion-editor \.node-image \.media-block__content\s*\{\s*width: 100%;\s*\}/,
    );
    const sharedMediaBlock = css.match(
      /(?:^|\n)\.media-block\s*\{[^}]*\}/,
    )?.[0];
    expect(sharedMediaBlock).toBeDefined();
    expect(sharedMediaBlock).not.toMatch(/(?:^|\n)\s*width:\s*100%;/);
  });
});
