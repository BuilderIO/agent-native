import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  DOCKED_RIGHT_INSPECTOR_CLASSNAME,
  FLOATING_RIGHT_INSPECTOR_CLASSNAME,
  hasMinimalInspectorSelection,
  rightInspectorPanelClassName,
} from "./minimal-inspector";

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
    expect(rightInspectorPanelClassName(true)).toContain(
      "top-14 right-3 bottom-3",
    );
    expect(rightInspectorPanelClassName(true)).toContain("rounded-2xl");
    expect(rightInspectorPanelClassName(true)).toContain("shadow-xl");
    expect(rightInspectorPanelClassName(true)).not.toContain("inset-y-0");
  });
});

describe("DesignEditor minimal inspector wiring", () => {
  const editorSource = readFileSync(
    new URL("../DesignEditor.tsx", import.meta.url),
    "utf8",
  );

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
