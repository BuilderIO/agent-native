import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const deckEditorSource = readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), "DeckEditor.tsx"),
  "utf8",
);
const editorSidebarSource = readFileSync(
  path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    "../components/editor/EditorSidebar.tsx",
  ),
  "utf8",
);
const actionClusterSource = readFileSync(
  path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    "../components/editor/EditorActionCluster.tsx",
  ),
  "utf8",
);

describe("DeckEditor keyboard shortcuts", () => {
  it("defers and prefetches the Add Slide composer from user intent", () => {
    expect(editorSidebarSource).not.toContain(
      'from "@/components/editor/AddSlidePopover"',
    );
    expect(editorSidebarSource).toContain("<DeferredAddSlidePopover");
    expect(editorSidebarSource).toContain("<LazyChunkErrorBoundary");
    expect(actionClusterSource).toContain(
      "onPointerEnter={preloadAddSlidePopover}",
    );
    expect(actionClusterSource).toContain("onFocus={preloadAddSlidePopover}");
    expect(deckEditorSource).toContain("preloadAddSlidePopover();");
  });

  it("inserts a same-layout slide from the active slide with Control+M", () => {
    const shortcutStart = deckEditorSource.indexOf(
      "const handleNewSlideShortcut",
    );
    const shortcutEnd = deckEditorSource.indexOf(
      'document.addEventListener("keydown", handleNewSlideShortcut)',
      shortcutStart,
    );
    const shortcutBody = deckEditorSource.slice(shortcutStart, shortcutEnd);

    expect(shortcutStart).toBeGreaterThanOrEqual(0);
    expect(shortcutEnd).toBeGreaterThan(shortcutStart);
    expect(shortcutBody).toContain("shouldCreateSlideWithShortcut(event");
    expect(shortcutBody).toContain(
      "const slide =\n        deck.slides.find((s) => s.id === activeSlideId) ?? deck.slides[0];",
    );
    expect(shortcutBody).toContain(
      'insertSlideAfterActive(slide?.layout ?? "content")',
    );
  });

  it("keeps the blank-slide action separate from same-layout insertion", () => {
    expect(deckEditorSource).toContain(
      'const handleAddEmptySlide = () => insertSlideAfterActive("blank");',
    );
  });

  it("opens the shared draft for Google's no-selection comment shortcut", () => {
    const shortcutStart = deckEditorSource.indexOf(
      "const handleCommentShortcut",
    );
    const shortcutEnd = deckEditorSource.indexOf(
      'document.addEventListener("keydown", handleCommentShortcut)',
      shortcutStart,
    );
    const shortcutBody = deckEditorSource.slice(shortcutStart, shortcutEnd);

    expect(shortcutBody).toContain(
      "const googleCommentShortcut = isGoogleSlidesCommentShortcut(event);",
    );
    expect(shortcutBody).toContain("setPinMode(false);");
    expect(shortcutBody).toContain('openCommentComposer("");');
    expect(shortcutBody).toContain("setPinMode(true);");
  });
});
