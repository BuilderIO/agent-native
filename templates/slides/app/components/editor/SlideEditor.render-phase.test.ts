import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

/**
 * Exiting inline edit used to flush `onUpdateSlide` (and mutate the edited
 * DOM node) from inside a `setEditingEl` updater. Updaters run in the render
 * phase, so the flush updated DeckProvider while SlideEditor was rendering:
 * "Cannot update a component (DeckProvider) while rendering a different
 * component (SlideEditor)". `editingElRef` exists so exit paths can read the
 * edited element outside render; these assertions are what stop the updater
 * shape from coming back.
 */
const source = readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), "SlideEditor.tsx"),
  "utf8",
);

describe("SlideEditor render-phase safety", () => {
  it("never passes an updater function to setEditingEl", () => {
    const updaterCalls = source.match(
      /setEditingEl\(\s*(?:\(|function\b|[A-Za-z_$][\w$]*\s*=>)/g,
    );
    expect(updaterCalls).toBeNull();
  });

  it("never flushes onUpdateSlide from inside a setState updater", () => {
    const offenders = [
      ...source.matchAll(
        /set[A-Z][\w$]*\(\s*(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>/g,
      ),
    ].filter((match) => {
      const body = source.slice(match.index, match.index + 600);
      return body.includes("onUpdateSlideRef");
    });
    expect(offenders.map((m) => m[0])).toEqual([]);
  });

  it("flushes an active inline draft before browser teardown", () => {
    expect(source).toContain("flushPendingSaves");
    expect(source).toContain(
      'window.addEventListener("beforeunload", flushInlineEditDraft',
    );
    expect(source).toContain(
      'window.addEventListener("pagehide", flushInlineEditDraft',
    );
    expect(source).toContain(
      'document.addEventListener("visibilitychange", flushWhenHidden',
    );
  });

  it("keeps the live draft ref across lifecycle flushes", () => {
    const start = source.indexOf("const flushInlineEditDraft");
    const end = source.indexOf("const flushWhenHidden", start);
    const flushBody = source.slice(start, end);
    expect(flushBody).toContain("flushPendingSaves();");
    expect(flushBody).not.toContain("inlineEditDraftRef.current = null");
    expect(flushBody).not.toContain("onUpdateSlideRef.current");
  });

  it("selects persisted text boxes on plain click while keeping double-click editing", () => {
    const clickStart = source.indexOf("// For editable text");
    const clickEnd = source.indexOf("// Non-text elements", clickStart);
    const clickBody = source.slice(clickStart, clickEnd);
    expect(clickBody).toContain("includeTextBoxes: false");
    expect(source).toContain(
      "const block = findSmartBlock(target, slideContent);",
    );
  });

  it("records arrange selection before replacing the live slide DOM", () => {
    const start = source.indexOf("const handleArrangeSelected");
    const end = source.indexOf("const handleToggleList", start);
    const arrangeBody = source.slice(start, end);

    expect(arrangeBody.indexOf("selectElementForStyling")).toBeLessThan(
      arrangeBody.indexOf("onUpdateSlideRef.current"),
    );
  });

  it("keeps portaled context-menu presses from clearing canvas selection", () => {
    const start = source.indexOf("const handleCanvasBackgroundPointerDown");
    const end = source.indexOf("const handleSlideContextMenu", start);
    const pointerDownBody = source.slice(start, end);

    expect(pointerDownBody).toContain(
      'target?.closest("[data-radix-menu-content]")',
    );
    expect(pointerDownBody.indexOf("data-radix-menu-content")).toBeLessThan(
      pointerDownBody.indexOf("clearCanvasSelection"),
    );
  });

  it("claims Delete before the deck-level slide shortcut when an object is selected", () => {
    const selectionStart = source.indexOf("const slideElementSelected =");
    const selectionEnd = source.indexOf(
      "// Flow objects are promoted",
      selectionStart,
    );
    expect(source.slice(selectionStart, selectionEnd)).toContain(
      "!!selectedElementSelector",
    );

    const deleteStart = source.indexOf(
      "// Delete/Backspace removes the selected slide content",
    );
    const deleteEnd = source.indexOf(
      "/**\n   * Find the nearest meaningful element",
      deleteStart,
    );
    const deleteBody = source.slice(deleteStart, deleteEnd);
    expect(deleteBody).toContain(
      'window.addEventListener("keydown", onKey, true)',
    );
    expect(deleteBody).toContain("e.stopPropagation()");
  });

  it("leaves Delete with a focused thumbnail", () => {
    const deleteStart = source.indexOf(
      "// Delete/Backspace removes the selected slide content",
    );
    const deleteEnd = source.indexOf(
      "/**\n   * Find the nearest meaningful element",
      deleteStart,
    );

    expect(source.slice(deleteStart, deleteEnd)).toContain(
      'active.closest("[data-slide-thumbnail-id]")',
    );
  });

  it("ends native text editing before entering a multi-selection", () => {
    const start = source.indexOf("const applyMultiSelection");
    const end = source.indexOf("const clearMultiSelection", start);
    const multiSelectionBody = source.slice(start, end);

    expect(multiSelectionBody).toContain(
      "if (ids.size > 0 && editingElRef.current) exitInlineEdit();",
    );
    expect(source).toContain("window.getSelection()?.removeAllRanges();");
  });

  it("lets additive canvas selection leave an active text edit", () => {
    const start = source.indexOf("const handleSlidePointerDown");
    const end = source.indexOf(
      "// Keep these listeners stable while React re-renders the marquee overlay.",
      start,
    );
    const pointerDownBody = source.slice(start, end);

    expect(pointerDownBody).toContain("const additive =");
    expect(pointerDownBody).toContain("const targetIsEditingBlock =");
    expect(pointerDownBody).toContain("exitInlineEdit();");
  });

  it("pastes plain clipboard text as a selected text box outside text editing", () => {
    const pasteStart = source.indexOf("const pastePlainTextAsTextBox");
    const pasteEnd = source.indexOf("const placeShapeAt", pasteStart);
    const pasteBody = source.slice(pasteStart, pasteEnd);

    expect(pasteBody).toContain('getData("text/plain")');
    expect(pasteBody).toContain("placeTextBoxAt(");
    expect(pasteBody).toContain("selectElementForStyling(box, selector)");
    expect(pasteBody).toContain(
      'window.addEventListener("paste", onPaste, true)',
    );
    expect(pasteBody).toContain("text,\n        false,");
    expect(pasteBody).toContain(
      "const renderedHeight = Math.max(height, box.offsetHeight)",
    );
    expect(pasteBody).toContain(
      "if (y > renderedMaxY) box.style.top = `${renderedMaxY}px`",
    );
    expect(pasteBody).toContain("box.style.maxHeight = `${slideHeight}px`");
    expect(pasteBody).toContain('box.style.overflowY = "auto"');
    expect(source).toContain('box.style.overflowWrap = "anywhere"');
  });

  it("lets HTML-only native paste beat a stale object clipboard", () => {
    const pasteStart = source.indexOf(
      "// The native paste event is authoritative",
    );
    const pasteEnd = source.indexOf(
      "// Appearance clipboard shortcuts",
      pasteStart,
    );
    const pasteBody = source.slice(pasteStart, pasteEnd);

    expect(pasteBody).toContain('type.startsWith("text/")');
    expect(pasteBody).toContain("e.clipboardData?.getData(type)?.length");
    expect(pasteBody).toContain("if (hasNativeText) return;");
  });

  it("uses the native layer marker instead of a timer to arbitrate paste", () => {
    expect(source).toContain("writeSlideObjectClipboard");
    expect(source).toContain("readSlideObjectClipboardId");
    expect(source).not.toContain("objectPasteFallbackRef");
    const pasteStart = source.indexOf("const onPaste = (e: ClipboardEvent)");
    const pasteEnd = source.indexOf(
      "// Appearance clipboard shortcuts",
      pasteStart,
    );
    const pasteBody = source.slice(pasteStart, pasteEnd);
    expect(pasteBody.indexOf("nativeClipboardId")).toBeLessThan(
      pasteBody.indexOf("const hasNativeText"),
    );
    expect(pasteBody).toContain(
      'clipboard.nativeClipboardMode === "text-only"',
    );
    expect(pasteBody).toContain('e.clipboardData?.getData("text/plain") ?? ""');
  });

  it("re-measures portaled selection chrome after the editor layout moves", () => {
    const start = source.indexOf("const refreshMultiSelectionRects");
    const end = source.indexOf("// Keep cached rects fresh", start);
    const layoutBody = source.slice(start, end);

    expect(layoutBody).toContain("useLayoutEffect(() => {");
    expect(layoutBody).toContain(
      'scrollContainer.closest(".deck-editor-workspace")',
    );
    expect(layoutBody).toContain("new ResizeObserver(update)");
    expect(layoutBody).toContain("new MutationObserver(update)");
    expect(layoutBody).toContain("invalidateSelectionOverlayMeasurement();");
  });
});
