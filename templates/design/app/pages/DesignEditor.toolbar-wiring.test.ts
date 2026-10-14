import { describe, expect, it } from "vitest";

import { readDesignEditorSource } from "./design-editor/read-design-editor-source";

// oracle: none — this checks the editor's toolbar wiring, not measured Figma behavior.
// The hooks have no render harness, so the gates inside them are pinned as text.
describe("DesignEditor floating toolbar wiring", () => {
  const editorSource = readDesignEditorSource();

  it("mounts the toolbar in Interact as well, where it hides its tools and keeps only the mode switch a shell has no top bar for", () => {
    const mount = editorSource.slice(
      editorSource.indexOf(
        "{!hostOwnsChrome &&\n          designBottomToolbarMode",
      ),
      editorSource.indexOf("<DesignBottomToolbar"),
    );
    expect(mount).toContain('designBottomToolbarMode === "editor"');
    expect(mount).not.toContain("responsiveInteractActive");
  });

  it("wires the Comment button to the pin tool, the same toggle as C and the read-only banner", () => {
    expect(editorSource).toContain("onCommentPin={handlePinToolToggle}");
    expect(editorSource).toContain("onComment: handlePinToolToggle");
  });

  it("opens the Threads panel when a pin is toggled or a review thread is focused", () => {
    const pinToggle = editorSource.slice(
      editorSource.indexOf("const handlePinToolToggle"),
    );
    expect(pinToggle.slice(0, pinToggle.indexOf("}, ["))).toContain(
      'setActiveLeftPanel("threads")',
    );
    const threadSelect = editorSource.slice(
      editorSource.indexOf("const handleReviewThreadSelect"),
    );
    expect(threadSelect.slice(0, threadSelect.indexOf("}, ["))).toContain(
      'setActiveLeftPanel("threads")',
    );
    expect(editorSource).not.toContain("setActiveInspectorTab");
  });
});
