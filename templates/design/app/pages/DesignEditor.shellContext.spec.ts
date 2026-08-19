import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

/**
 * The host can repoint the shell mid-session — a re-provisioned container, a
 * branch switch, a different project. Pending edits describe elements in the
 * app that was there before, so handing them to the new branch's agent would
 * apply them to the wrong source.
 */
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
    // Validated like the initial one: the origin still arrives from the parent.
    expect(block).toContain("isBuilderPreviewUrl(nextPreviewUrl)");
    expect(block).toContain("builderPreviewOrigin(nextPreviewUrl)");
    expect(block).toContain("clearPendingLiveEditStateRef.current();");
  });

  it("resolves screens against the origin only", () => {
    // `interactiveFrameUrl` carries the previewed route, and resolving against
    // it nested every screen under that path.
    expect(handler).toContain(
      "previewOrigin: builderPreviewOrigin(previewUrl),",
    );
  });
});
