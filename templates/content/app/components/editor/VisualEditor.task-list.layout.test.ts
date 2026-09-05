import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

describe("VisualEditor task list layout", () => {
  it("aligns the checkbox with the first line of multiline task text", () => {
    const css = readFileSync(
      new URL("../../global.css", import.meta.url),
      "utf8",
    );

    expect(css).toMatch(
      /\.notion-editor \.notion-task-list li label\s*\{[^}]*align-items: center;[^}]*align-self: start;[^}]*min-height: 1\.7em;/,
    );
  });
});
