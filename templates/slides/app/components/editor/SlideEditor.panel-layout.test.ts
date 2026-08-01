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

  it("is the only styling surface, for editable non-Excalidraw slides", () => {
    expect(mountIndex).toBeGreaterThan(-1);
    expect(editorSource).toContain("!readOnly && !slide.excalidrawData");
  });

  it("renders into the shell's full-width slot so it spans the slide rail", () => {
    expect(editorSource).toContain(
      "createPortal(contextToolbar, contextToolbarSlot)",
    );
    expect(pageSource).toContain("ref={setContextToolbarSlot}");
    expect(pageSource).toContain("contextToolbarSlot={contextToolbarSlot}");
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
