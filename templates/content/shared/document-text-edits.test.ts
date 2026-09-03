import { describe, expect, it } from "vitest";

import { applyDocumentTextEdits } from "./document-text-edits.js";

describe("applyDocumentTextEdits", () => {
  it("applies bounded edits without rebuilding surrounding MDX", () => {
    const source = [
      "# Original publishing workflow",
      "",
      "| Step | Owner |",
      "| --- | --- |",
      "| Draft | Alice |",
      "",
      "<Aside>Keep this component.</Aside>",
    ].join("\n");

    const result = applyDocumentTextEdits(source, [
      { find: "Original publishing workflow", replace: "Publishing workflow" },
    ]);

    expect(result.changeCount).toBe(1);
    expect(result.content).toBe(
      source.replace("Original publishing workflow", "Publishing workflow"),
    );
  });
});
