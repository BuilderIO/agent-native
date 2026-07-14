import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

describe("DesignEditor Figma navigation shortcut wiring", () => {
  const editorSource = readFileSync("app/pages/DesignEditor.tsx", "utf8");
  const layersSource = readFileSync(
    "app/components/design/LayersPanel.tsx",
    "utf8",
  );

  it("routes Find through the real LayersPanel search control", () => {
    expect(editorSource).toContain(
      "onFind: initialGenerationChromeLimited ? undefined : handleFindLayers",
    );
    expect(editorSource).toContain("layersPanelRef.current?.focusSearch()");
    expect(layersSource).toContain("focusSearch: () => void");
    expect(layersSource).toContain(
      "useImperativeHandle(ref, () => ({ beginRename, focusSearch })",
    );
  });

  it("routes panel shortcuts through the same state as the visible rail", () => {
    expect(editorSource).toContain(
      'const handleShowLayersPanel = useCallback(() => {\n    setUiHidden(false);\n    setActiveLeftPanel("file");',
    );
    expect(editorSource).toContain(
      'const handleShowAssetsPanel = useCallback(() => {\n    setUiHidden(false);\n    setActiveLeftPanel("assets");',
    );
    expect(editorSource).toContain(
      "onShowLayersPanel: initialGenerationChromeLimited\n      ? undefined\n      : handleShowLayersPanel",
    );
    expect(editorSource).toContain(
      "onShowAssetsPanel: initialGenerationChromeLimited\n      ? undefined\n      : handleShowAssetsPanel",
    );
  });

  it("projects the active move-group sub-tool through the toolbar", () => {
    expect(editorSource).toContain("label: t(activeMoveGroupTool.labelKey)");
    expect(editorSource).toContain("onClick: handleActiveMoveGroupTool");
    expect(editorSource).toContain(
      "shortcut: MOVE_GROUP_TOOL_PRESENTATIONS.hand.shortcut",
    );
    expect(editorSource).toContain(
      "shortcut: MOVE_GROUP_TOOL_PRESENTATIONS.scale.shortcut",
    );
  });

  it("keeps support files out of the visual screen layer list and Cmd+A", () => {
    expect(editorSource).toContain(
      "new Set(overviewScreens.map((screen) => screen.id))",
    );
    expect(editorSource).toContain(
      ".filter((file) => visualScreenFileIds.has(file.id))",
    );
    expect(editorSource).toContain(
      "setOverviewSelectedScreenIds(overviewScreens.map((screen) => screen.id))",
    );
    expect(editorSource).not.toContain(
      "setOverviewSelectedScreenIds(files.map((file) => file.id))",
    );
  });
});
