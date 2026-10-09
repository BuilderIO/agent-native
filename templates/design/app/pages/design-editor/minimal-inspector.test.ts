import { describe, expect, it } from "vitest";

import {
  DOCKED_RIGHT_INSPECTOR_CLASSNAME,
  FLOATING_RIGHT_INSPECTOR_CLASSNAME,
  hasMinimalInspectorSelection,
  isRightInspectorVisible,
  rightInspectorCanvasInset,
  rightInspectorPanelClassName,
  shouldAutoOpenMobileInspector,
  shouldShowWidgetZoomFallback,
} from "./minimal-inspector";
import { readDesignEditorSource } from "./read-design-editor-source";

describe("rightInspectorCanvasInset", () => {
  it("reserves the panel width for a visible inspector", () => {
    expect(
      rightInspectorCanvasInset({
        visible: true,
        width: 240,
        widgetEmbed: false,
      }),
    ).toBe(240);
  });

  it("reserves nothing when the inspector is hidden", () => {
    expect(
      rightInspectorCanvasInset({
        visible: false,
        width: 240,
        widgetEmbed: false,
      }),
    ).toBe(0);
  });

  it("reserves nothing in a widget, so a wide pane keeps its full width when something is selected", () => {
    expect(
      rightInspectorCanvasInset({
        visible: true,
        width: 240,
        widgetEmbed: true,
      }),
    ).toBe(0);
  });

  it("reserves nothing when minimal UI floats the inspector over the canvas", () => {
    expect(
      rightInspectorCanvasInset({
        visible: true,
        width: 240,
        widgetEmbed: false,
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

describe("shouldAutoOpenMobileInspector", () => {
  it("opens the overlay when a selected element needs its style panel", () => {
    expect(
      shouldAutoOpenMobileInspector({
        minimalUi: true,
        isMobileViewport: true,
        hasSelection: true,
      }),
    ).toBe(true);
  });

  it("does not open before selection or outside minimal mobile mode", () => {
    expect(
      shouldAutoOpenMobileInspector({
        minimalUi: true,
        isMobileViewport: true,
        hasSelection: false,
      }),
    ).toBe(false);
    expect(
      shouldAutoOpenMobileInspector({
        minimalUi: true,
        isMobileViewport: false,
        hasSelection: true,
      }),
    ).toBe(false);
  });
});

describe("shouldShowWidgetZoomFallback", () => {
  const widgetDefaults = {
    widgetEmbed: true,
    minimalUi: true,
    topBarVisible: true,
    topBarZoomVisible: true,
    rightSidebarVisible: false,
    uiHidden: false,
  };

  it("keeps zoom available while widget top-bar controls are temporarily hidden", () => {
    expect(
      shouldShowWidgetZoomFallback({
        ...widgetDefaults,
        topBarZoomVisible: false,
      }),
    ).toBe(true);
  });

  it("does not duplicate zoom when the top-bar control is visible", () => {
    expect(shouldShowWidgetZoomFallback(widgetDefaults)).toBe(false);
  });

  it("does not show a second control over an open inspector", () => {
    expect(
      shouldShowWidgetZoomFallback({
        ...widgetDefaults,
        topBarZoomVisible: false,
        rightSidebarVisible: true,
      }),
    ).toBe(false);
  });

  it("does not add a widget fallback to the regular editor", () => {
    expect(
      shouldShowWidgetZoomFallback({
        ...widgetDefaults,
        widgetEmbed: false,
        topBarZoomVisible: false,
      }),
    ).toBe(false);
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
      "top-3 right-3 bottom-3",
    );
    expect(rightInspectorPanelClassName(true)).toContain("rounded-2xl");
    expect(rightInspectorPanelClassName(true)).toContain("shadow-xl");
    expect(rightInspectorPanelClassName(true)).not.toContain("inset-y-0");
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

  it("renders the widget title in one place when minimal UI is disabled", () => {
    expect(editorSource).toContain(
      "widgetEmbed && minimalUi ? projectTitleControl : undefined",
    );
    expect(editorSource).toContain("projectTitleControl,");
  });
});
