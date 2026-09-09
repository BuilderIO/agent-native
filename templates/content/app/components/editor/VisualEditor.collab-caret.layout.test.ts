import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

describe("VisualEditor collaboration caret layout", () => {
  it("styles Tiptap v3 collaboration carets so remote cursor labels remain absolute badges instead of full-width blocks", () => {
    const css = readFileSync(
      new URL("../../global.css", import.meta.url),
      "utf8",
    );

    // Verify .collaboration-carets__caret is styled inline and relative
    expect(css).toMatch(
      /\.notion-editor \.collaboration-carets__caret[\s\S]*?display:\s*inline;[\s\S]*?position:\s*relative;/,
    );

    // Verify .collaboration-carets__label is positioned absolutely above the caret line
    expect(css).toMatch(
      /\.notion-editor \.collaboration-carets__label[\s\S]*?position:\s*absolute;[\s\S]*?top:\s*-1\.4em;[\s\S]*?display:\s*inline-block;/,
    );

    // Verify .collaboration-carets__selection is styled
    expect(css).toMatch(
      /\.notion-editor \.collaboration-carets__selection[\s\S]*?background-color:\s*currentColor\s*!important;/,
    );
  });
});
