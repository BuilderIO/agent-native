import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const editorSource = readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), "SlideEditor.tsx"),
  "utf8",
);
const pageSource = readFileSync(
  path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    "../../pages/DeckEditor.tsx",
  ),
  "utf8",
);

describe("editor side panels", () => {
  it("keeps comments as the only parent-owned side panel", () => {
    expect(pageSource).toContain('type EditorSidePanel = "comments" | null');
    expect(pageSource).toContain(
      'const commentsOpen = sidePanel === "comments"',
    );
  });

  it("has no style dock left to open", () => {
    expect(editorSource).not.toContain("stylePanelOpen");
    expect(editorSource).not.toContain("SlideStyleInspector");
    expect(editorSource).not.toContain('data-slide-style-dock="true"');
  });

  it("clears generic animation targets when the active slide changes", () => {
    expect(pageSource).toContain(`useEffect(() => {
    setAnimationTargets(NO_ANIMATION_TARGETS);
  }, [activeSlideId]);`);
    const toggleAnimationsStart = pageSource.indexOf(
      "const toggleAnimations = useCallback(() => {",
    );
    const toggleLayersStart = pageSource.indexOf(
      "const toggleLayers = useCallback",
      toggleAnimationsStart,
    );
    const toggleAnimationsSource = pageSource.slice(
      toggleAnimationsStart,
      toggleLayersStart,
    );
    expect(toggleAnimationsSource).toContain("setLayersOpen(false);");
    expect(toggleAnimationsSource).toContain(
      "setAnimationTargets(NO_ANIMATION_TARGETS);",
    );
    expect(toggleAnimationsSource).toContain(
      "setAnimationsOpen((open) => !open);",
    );
  });

  it("rounds the canvas right edge only for the right-side Transitions panel", () => {
    expect(editorSource).toContain('animationsOpen ? "rounded-r-lg" : ""');
  });

  it("mounts Layers below the Slides thumbnails", () => {
    expect(editorSource).toContain(
      "createPortal(layersPanel, layersPanelSlot)",
    );
    expect(pageSource).toContain('data-layers-panel-host="true"');
    expect(pageSource).toContain("layersPanelSlot={layersPanelSlot}");
    const workspaceStart = pageSource.indexOf(
      'className="deck-editor-workspace relative flex',
    );
    const layersHost = pageSource.indexOf(
      'data-layers-panel-host="true"',
      workspaceStart,
    );
    const workspaceEnd = pageSource.indexOf(
      "\n      </div>\n\n      {/* Hidden upload input */}",
      workspaceStart,
    );
    const railStart = pageSource.indexOf("<EditorSidebar", workspaceStart);
    const canvasStart = pageSource.indexOf("<SlideEditor", workspaceStart);
    expect(layersHost).toBeGreaterThan(railStart);
    expect(layersHost).toBeLessThan(canvasStart);
    expect(layersHost).toBeLessThan(workspaceEnd);
  });

  it("uses the same element context menu from every layer row", () => {
    expect(editorSource).toContain(
      "contextMenuContent={readOnly ? undefined : slideElementContextMenuContent}",
    );
    expect(editorSource).toContain(
      "onContextMenuLayer={readOnly ? undefined : handleLayerContextMenu}",
    );
    expect(editorSource).toContain("{slideElementContextMenuContent}");
    expect(editorSource).toContain("<ContextMenuSub>");
    expect(editorSource).toContain('t("styleInspector.order")');
    expect(editorSource).toContain('handleArrangeSelected("front")');
    expect(editorSource).toContain('handleArrangeSelected("forward")');
    expect(editorSource).toContain('handleArrangeSelected("backward")');
    expect(editorSource).toContain('handleArrangeSelected("back")');
  });
});

describe("slide context toolbar", () => {
  const mountIndex = editorSource.indexOf("<SlideContextToolbar");

  it("is the only styling surface, on every editable slide", () => {
    expect(mountIndex).toBeGreaterThan(-1);
    expect(editorSource).not.toContain("!readOnly && !slide.excalidrawData");
  });

  it("keeps the toolbar alive while text is being edited", () => {
    expect(editorSource).toContain('data-slide-inline-edit-surface="true"');
  });

  it("renders into the shell's full-width slot so it spans the slide rail", () => {
    expect(editorSource).toContain(
      "createPortal(contextToolbar, contextToolbarSlot)",
    );
    expect(pageSource).toContain("ref={setContextToolbarSlot}");
    expect(pageSource).toContain("contextToolbarSlot={contextToolbarSlot}");
  });

  it("leads with the selection-independent action cluster", () => {
    expect(pageSource).toContain("contextToolbarLeading={");
    expect(pageSource).toContain("<EditorActionCluster");
  });

  it("keeps the rich text selection alive while the toolbar is pressed", () => {
    const wrapper = editorSource.slice(
      Math.max(0, mountIndex - 300),
      mountIndex,
    );
    expect(wrapper).toContain(
      "onPointerDownCapture={preserveRichTextSelection}",
    );
  });

  it("cancels native image dragging on the editable canvas, but not text being edited", () => {
    expect(editorSource).toContain("onDragStart={handleSlideDragStart}");
    const start = editorSource.indexOf("const handleSlideDragStart");
    const handler = editorSource.slice(start, start + 500);
    expect(handler).toContain(
      "textSessionRef.current?.text.element.contains(event.target)",
    );
    expect(handler).toContain("event.preventDefault()");
  });

  it("keeps the comment target mounted for Excalidraw slides", () => {
    expect(editorSource).toContain(
      'data-main-slide-canvas="true"\n              data-slide-canvas-focus="true"',
    );
    expect(editorSource).toContain(
      '<div className="slide-content relative h-full">',
    );
    expect(editorSource).toContain(
      "canvasSelector=\"[data-main-slide-canvas='true']\"",
    );
  });
});
