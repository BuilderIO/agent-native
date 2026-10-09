import { describe, expect, it } from "vitest";

import { readDesignEditorSource } from "./design-editor/read-design-editor-source";

// oracle: none — this checks the editor's lab wiring, not measured Figma behavior.
// The hooks have no render harness, so the gates inside them are pinned as text.
describe("DesignEditor Annotate lab wiring", () => {
  const editorSource = readDesignEditorSource();

  it("reads the lab once, from its definition, and shares it through the generation hook", () => {
    expect(editorSource.match(/useAnnotateLab\(\)/g)).toHaveLength(1);
  });

  it("only wires the Draw hotkey and handler while the lab is on", () => {
    expect(editorSource).toContain(
      'onDrawTool:\n      canEditDesign && annotateLab === "on" ? handleDrawTool : undefined',
    );
    const handler = editorSource.slice(
      editorSource.indexOf("const handleDrawTool = useCallback"),
      editorSource.indexOf("const handleBooleanSubtractSelection"),
    );
    expect(handler).toContain('annotateLab !== "on"');
    expect(handler).toContain("[activeFile, annotateLab, canEditDesign]");
  });

  it("mounts neither drawing overlay without the lab", () => {
    expect(editorSource).toContain(
      'viewMode === "overview" &&\n                drawMode &&\n                mode === "annotate" &&\n                annotateLab === "on"',
    );
    expect(editorSource).toContain(
      'drawMode={drawMode && annotateLab === "on"}',
    );
  });

  it("hands the lab to the top bar, the toolbar and the shortcuts dialog", () => {
    expect(editorSource).toContain("annotateLab,\n            })");
    expect(editorSource).toContain('annotateEnabled={annotateLab === "on"}');
    expect(editorSource).toContain('annotateEnabled: annotateLab === "on"');
  });
});
