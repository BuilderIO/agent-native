import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

describe("DesignEditor shell context changes", () => {
  const source = readFileSync("app/pages/DesignEditor.tsx", "utf8");
  const handler = source.slice(
    source.indexOf('if (data.type === "design:init")'),
    source.indexOf("const focusDesignInspectorForSelection"),
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

  it("does not expose the persisted audit action in the Builder shell", () => {
    const review = source.slice(
      source.indexOf("const resolvedReviewPanelProps"),
      source.indexOf("const dispatchReviewFeedbackToAgent"),
    );
    expect(review).toContain(
      "if (!designReviewPanelEnabled || !id || !activeFile || shellMode)",
    );
    expect(review).toContain("onRunAudit: handleRunDesignAudit");
  });
});
