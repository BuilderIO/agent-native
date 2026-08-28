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
});
