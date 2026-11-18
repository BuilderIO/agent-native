import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { readDesignEditorSource } from "./design-editor/read-design-editor-source";

// oracle-change: the Review panel audit gate was removed with the design review tools
describe("DesignEditor shell context changes", () => {
  const source = readDesignEditorSource();
  const handler = source.slice(
    source.indexOf('if (data.type === "design:init")'),
    source.indexOf("const clearRedoStacks = useCallback(() => {"),
  );

  it("discards pending edits when the host repoints the shell", () => {
    expect(handler).toContain("shellContextChanged(current, nextShellInput)");
    expect(handler.indexOf("shellContextChanged")).toBeLessThan(
      handler.indexOf("return nextShellInput;"),
    );
  });

  it("handles design:previewUrlChanged rather than serving a dead origin", () => {
    expect(handler).toContain('data.type === "design:previewUrlChanged"');
    const block = handler.slice(
      handler.indexOf('data.type === "design:previewUrlChanged"'),
    );
    expect(block).toContain("isBuilderPreviewUrl(nextPreviewUrl)");
    expect(block).toContain("builderPreviewOrigin(nextPreviewUrl)");
    expect(block).toContain("clearPendingLiveEditStateRef.current();");
  });

  it("resolves screens against the origin only", () => {
    expect(handler).toContain(
      "previewOrigin: builderPreviewOrigin(previewUrl),",
    );
  });
});
