import { describe, expect, it } from "vitest";

import { readDesignEditorSource } from "./design-editor/read-design-editor-source";

// oracle: none — this checks the editor's toolbar wiring, not measured Figma behavior.
// The hooks have no render harness, so the gates inside them are pinned as text.
describe("DesignEditor floating toolbar wiring", () => {
  const editorSource = readDesignEditorSource();

  it("mounts the toolbar in Interact as well, where it narrows to Move and Agent", () => {
    const mount = editorSource.slice(
      editorSource.indexOf(
        "{!hostOwnsChrome &&\n          designBottomToolbarMode",
      ),
      editorSource.indexOf("<DesignBottomToolbar"),
    );
    expect(mount).toContain('designBottomToolbarMode === "editor"');
    expect(mount).not.toContain("responsiveInteractActive");
    expect(editorSource).toContain("onInteractMove={handleInteractMoveTool}");
  });

  it("wires the Agent button and menu to the agent commands", () => {
    expect(editorSource).toContain("onAgentTool={handleAgentTool}");
    expect(editorSource).toContain("onAgentSkill={handleAgentSkill}");
    expect(editorSource).toContain("runActivateAgentTool({");
    expect(editorSource).toContain("runSendAgentSkill(skill, {");
  });

  it("keeps the Comment tool out of every entry point while it is hidden", () => {
    // `C`, `Shift+C`, the viewer's pin button, the canvas menu item.
    expect(editorSource).toContain(
      "SHOW_DESIGN_COMMENT_TOOL && canCommentDesign\n        ? handlePinToolToggle\n        : undefined",
    );
    expect(editorSource).toContain(
      "onToggleComments: SHOW_DESIGN_COMMENT_TOOL\n      ? handleToggleComments\n      : undefined",
    );
    expect(editorSource).toContain(
      "SHOW_DESIGN_COMMENT_TOOL &&\n                    !hostOwnsChrome &&\n                    canCommentDesign",
    );
    expect(editorSource).toContain(
      "hiddenActions={SHOW_DESIGN_COMMENT_TOOL ? undefined : COMMENT_ACTIONS}",
    );
    expect(editorSource).toContain("commentEnabled: SHOW_DESIGN_COMMENT_TOOL");
  });

  it("has no inspector tab to jump to when a pin is toggled or a review thread is focused", () => {
    expect(editorSource).toContain(
      "if (!SHOW_DESIGN_COMMENT_TOOL || !canCommentDesign) return;",
    );
    expect(editorSource).not.toContain("setActiveInspectorTab");
  });

  it("hands the canvas Move behavior under the Agent tool", () => {
    expect(editorSource).toContain("activeTool: toCanvasTool(activeTool)");
  });
});
