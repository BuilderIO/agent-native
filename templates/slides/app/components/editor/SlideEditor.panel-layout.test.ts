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
});

describe("slide context toolbar", () => {
  const mountIndex = editorSource.indexOf("<SlideContextToolbar");

  it("is the only styling surface, on every editable slide", () => {
    expect(mountIndex).toBeGreaterThan(-1);
    // Excalidraw slides included: they have no selectable content, but
    // SlideRenderer still paints slide.background behind the drawing, and this
    // row is now the only place that background can be edited.
    expect(editorSource).not.toContain("!readOnly && !slide.excalidrawData");
  });

  it("keeps the toolbar alive while text is being edited", () => {
    // Without the marker the click-outside handler exits the edit and drops
    // the saved range, so partial-text formatting would hit the whole object.
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
    // Without this guard on the wrapper, applying a style to a partial text
    // selection silently no-ops: focus leaves the contentEditable before the
    // patch resolves the range.
    const wrapper = editorSource.slice(
      Math.max(0, mountIndex - 300),
      mountIndex,
    );
    expect(wrapper).toContain(
      "onPointerDownCapture={preserveRichTextSelection}",
    );
  });
});
