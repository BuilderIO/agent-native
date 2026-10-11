import { describe, expect, it } from "vitest";

import {
  DOCKED_RIGHT_INSPECTOR_CLASSNAME,
  FLOATING_RIGHT_INSPECTOR_CLASSNAME,
  hasMinimalInspectorSelection,
  rightInspectorCanvasInset,
  rightInspectorPanelClassName,
} from "./minimal-inspector";
import { readDesignEditorSource } from "./read-design-editor-source";

describe("rightInspectorCanvasInset", () => {
  it("reserves the panel width for a visible docked inspector", () => {
    expect(
      rightInspectorCanvasInset({
        visible: true,
        width: 240,
        minimalUi: false,
      }),
    ).toBe(240);
  });

  it("reserves nothing when the inspector is hidden", () => {
    expect(
      rightInspectorCanvasInset({
        visible: false,
        width: 240,
        minimalUi: false,
      }),
    ).toBe(0);
  });

  it("reserves nothing when minimal UI floats the inspector over the canvas, so a selection never refits the screen", () => {
    expect(
      rightInspectorCanvasInset({
        visible: true,
        width: 240,
        minimalUi: true,
      }),
    ).toBe(0);
  });
});

describe("hasMinimalInspectorSelection", () => {
  it("is false when nothing is selected", () => {
    expect(
      hasMinimalInspectorSelection({
        selectedElement: null,
        selectedLayerIds: [],
        selectedScreenGeometry: null,
      }),
    ).toBe(false);
  });

  it("is true for an element selection", () => {
    expect(
      hasMinimalInspectorSelection({
        selectedElement: { selector: "#hero" },
        selectedLayerIds: [],
        selectedScreenGeometry: null,
      }),
    ).toBe(true);
  });

  it("is true for layer ids without an element info payload", () => {
    expect(
      hasMinimalInspectorSelection({
        selectedElement: null,
        selectedLayerIds: ["layer-1"],
        selectedScreenGeometry: null,
      }),
    ).toBe(true);
  });

  it("is true for a selected screen/frame", () => {
    expect(
      hasMinimalInspectorSelection({
        selectedElement: null,
        selectedLayerIds: [],
        selectedScreenGeometry: { id: "screen-1", width: 1440, height: 900 },
      }),
    ).toBe(true);
  });
});

describe("rightInspectorPanelClassName", () => {
  it("uses the docked rail outside minimal mode", () => {
    expect(rightInspectorPanelClassName(false)).toBe(
      DOCKED_RIGHT_INSPECTOR_CLASSNAME,
    );
    expect(rightInspectorPanelClassName(false)).toContain("inset-y-0 right-0");
    expect(rightInspectorPanelClassName(false)).not.toContain("rounded-2xl");
  });

  it("uses the floating inset card in minimal mode", () => {
    expect(rightInspectorPanelClassName(true)).toBe(
      FLOATING_RIGHT_INSPECTOR_CLASSNAME,
    );
    expect(rightInspectorPanelClassName(true)).toContain("top-3 right-3");
    expect(rightInspectorPanelClassName(true)).toContain("rounded-2xl");
    expect(rightInspectorPanelClassName(true)).toContain("shadow-xl");
    expect(rightInspectorPanelClassName(true)).not.toContain("inset-y-0");
  });

  it("shows the floating card at every width instead of handing off to a drawer", () => {
    const classes = rightInspectorPanelClassName(true).split(" ");
    expect(classes).not.toContain("hidden");
    expect(classes.some((name) => name.endsWith(":flex"))).toBe(false);
    expect(classes).toContain("flex");
    expect(classes).toContain("max-w-[calc(100%-1.5rem)]");
  });
});

describe("DesignEditor minimal inspector wiring", () => {
  const editorSource = readDesignEditorSource();

  it("hides the manual right-sidebar toggle in minimal mode", () => {
    expect(editorSource).not.toContain('data-design-minimal-toggle="right"');
    expect(editorSource).not.toContain("minimalRightSidebarToggle");
    expect(editorSource).not.toContain("handleToggleMinimalRightSidebar");
    expect(editorSource).not.toContain("minimalRightSidebarOpen");
  });

  it("opens the inspector from selection in minimal mode", () => {
    expect(editorSource).toContain("hasMinimalInspectorSelection");
    expect(editorSource).toContain("minimalInspectorHasSelection");
    expect(editorSource).toContain(
      "(!minimalUi || minimalInspectorHasSelection)",
    );
  });

  it("renders the floating inspector card class in minimal mode", () => {
    expect(editorSource).toContain("rightInspectorPanelClassName");
    expect(editorSource).toContain("rightInspectorPanelClassName(minimalUi)");
  });
});
