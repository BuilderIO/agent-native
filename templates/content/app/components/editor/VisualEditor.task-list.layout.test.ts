import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

describe("VisualEditor task list layout", () => {
  it("aligns the checkbox with the first line of multiline task text", () => {
    const css = readFileSync(
      new URL("../../global.css", import.meta.url),
      "utf8",
    );

    expect(css).toMatch(
      /\.content-editor \.content-task-list li label\s*\{[^}]*align-items: center;[^}]*align-self: start;[^}]*min-height: 1\.7em;/,
    );
  });

  it("preserves Tiptap table column widths so resize handles can apply them", () => {
    const css = readFileSync(
      new URL("../../global.css", import.meta.url),
      "utf8",
    );

    expect(css).not.toMatch(
      /\.content-editor table colgroup[^}]*display:\s*none\s*!important/,
    );
    expect(css).not.toMatch(
      /\.content-editor table col\s*\{[^}]*width:\s*auto/,
    );
  });
});
