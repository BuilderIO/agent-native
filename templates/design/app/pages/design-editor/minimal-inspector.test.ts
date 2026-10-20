import { describe, expect, it } from "vitest";

import {
  DOCKED_RIGHT_INSPECTOR_CLASSNAME,
  FLOATING_RIGHT_INSPECTOR_CLASSNAME,
  hasMinimalInspectorSelection,
  isRightInspectorVisible,
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

describe("isRightInspectorVisible", () => {
  const docked = {
    hostOwnsChrome: false,
    isMobileViewport: false,
    uiHidden: false,
    initialGenerationChromeLimited: false,
    responsiveInteractActive: false,
    minimalUi: false,
    minimalInspectorHasSelection: false,
    topBarVisible: true,
    mode: "edit" as const,
    canEdit: true,
  };

  it("shows in Design for someone who can edit", () => {
    expect(isRightInspectorVisible(docked)).toBe(true);
  });

  it("is hidden in Interact", () => {
    expect(
      isRightInspectorVisible({
        ...docked,
        mode: "interact",
        responsiveInteractActive: true,
      }),
    ).toBe(false);
    expect(isRightInspectorVisible({ ...docked, mode: "interact" })).toBe(
      false,
    );
  });

  it("is hidden in Annotate rather than left as an empty column", () => {
    expect(isRightInspectorVisible({ ...docked, mode: "annotate" })).toBe(
      false,
    );
  });

  it("is hidden for someone who cannot edit: Code and Comments tabs no longer give them one", () => {
    expect(isRightInspectorVisible({ ...docked, canEdit: false })).toBe(false);
  });

  it("keeps the rail outside Design where the top bar is absent, because it carries the share controls", () => {
    const withoutTopBar = { ...docked, topBarVisible: false };
    expect(
      isRightInspectorVisible({ ...withoutTopBar, mode: "annotate" }),
    ).toBe(true);
    expect(isRightInspectorVisible({ ...withoutTopBar, canEdit: false })).toBe(
      true,
    );
  });

  it("stays hidden when the host owns the chrome, on a phone, and with the UI hidden", () => {
    expect(isRightInspectorVisible({ ...docked, hostOwnsChrome: true })).toBe(
      false,
    );
    expect(isRightInspectorVisible({ ...docked, isMobileViewport: true })).toBe(
      false,
    );
    expect(isRightInspectorVisible({ ...docked, uiHidden: true })).toBe(false);
    expect(
      isRightInspectorVisible({
        ...docked,
        initialGenerationChromeLimited: true,
      }),
    ).toBe(false);
  });

  it("opens in minimal UI only for a selection", () => {
    expect(isRightInspectorVisible({ ...docked, minimalUi: true })).toBe(false);
    expect(
      isRightInspectorVisible({
        ...docked,
        minimalUi: true,
        minimalInspectorHasSelection: true,
      }),
    ).toBe(true);
  });

  it("keeps the floating minimal-UI inspector on a phone, where only the docked rail hands off to the sheet", () => {
    expect(
      isRightInspectorVisible({
        ...docked,
        isMobileViewport: true,
        minimalUi: true,
        minimalInspectorHasSelection: true,
      }),
    ).toBe(true);
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
  });

  it("renders the floating inspector card class in minimal mode", () => {
    expect(editorSource).toContain("rightInspectorPanelClassName");
    expect(editorSource).toContain("rightInspectorPanelClassName(minimalUi)");
  });
});
