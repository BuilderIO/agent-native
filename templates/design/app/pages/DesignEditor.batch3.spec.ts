// @vitest-environment happy-dom

/**
 * DesignEditor.batch3.spec.ts
 *
 * STEVE TEST BATCH 3 regression coverage for the items owned by this pass:
 *
 * - Item 2 (text defaults): isDesignEditorDarkTheme reads the app's actual
 *   resolved theme (next-themes' `dark` class on <html>, which drives the
 *   canvas/board background) instead of relying on the class being absent
 *   meaning "light". CANVAS_TEXT_DEFAULT_FONT_FAMILY pins the exact stack so
 *   a future edit can't silently drop the Inter-first fallback chain.
 * - Item 5 (edit-flash): shouldReplacePreviewAfterVisualStyleCommit's
 *   contract is unchanged by the breakpoint-scope guard added at its call
 *   site in commitVisualStyles (runtimeStyleApplied is now forced false for
 *   breakpoint-scoped commits so a live inline-style patch never overrides
 *   the persisted `@media`/class result) — pin the pure boolean truth table
 *   here since the call-site gating itself lives inside a large useCallback
 *   that isn't unit-testable in isolation.
 */

import { describe, expect, it, afterEach } from "vitest";

import {
  isDesignEditorDarkTheme,
  defaultCanvasTextColor,
  CANVAS_TEXT_DEFAULT_FONT_FAMILY,
  shouldReplacePreviewAfterVisualStyleCommit,
} from "./DesignEditor";

describe("isDesignEditorDarkTheme (item 2 — canvas-drawn text defaults)", () => {
  afterEach(() => {
    document.documentElement.classList.remove("dark");
  });

  it("returns false when the app is not in dark mode", () => {
    document.documentElement.classList.remove("dark");
    expect(isDesignEditorDarkTheme()).toBe(false);
  });

  it("returns true when next-themes has applied the dark class", () => {
    document.documentElement.classList.add("dark");
    expect(isDesignEditorDarkTheme()).toBe(true);
  });
});

describe("defaultCanvasTextColor (board text readability)", () => {
  afterEach(() => {
    document.documentElement.classList.remove("dark");
  });

  it("defaults BOARD text to white regardless of the editor chrome theme", () => {
    // The board surface is always dark (BOARD_SURFACE_BACKGROUND), so the
    // white-text default must NOT be gated on isDesignEditorDarkTheme() —
    // with the editor in light mode (no `dark` class), board text used to
    // fall back to `currentColor` → black-on-dark, i.e. invisible.
    document.documentElement.classList.remove("dark");
    expect(defaultCanvasTextColor(true)).toBe("#ffffff");
    document.documentElement.classList.add("dark");
    expect(defaultCanvasTextColor(true)).toBe("#ffffff");
  });

  it("keeps SCREEN text on currentColor so it inherits the screen's own theme", () => {
    document.documentElement.classList.remove("dark");
    expect(defaultCanvasTextColor(false)).toBe("currentColor");
    document.documentElement.classList.add("dark");
    expect(defaultCanvasTextColor(false)).toBe("currentColor");
  });
});

describe("CANVAS_TEXT_DEFAULT_FONT_FAMILY (item 2)", () => {
  it("leads with Inter and keeps a real system-font fallback chain", () => {
    expect(CANVAS_TEXT_DEFAULT_FONT_FAMILY.startsWith('"Inter"')).toBe(true);
    expect(CANVAS_TEXT_DEFAULT_FONT_FAMILY).toContain("sans-serif");
  });
});

describe("shouldReplacePreviewAfterVisualStyleCommit (item 5 — edit-flash)", () => {
  it("attempts the full-content preview replace when neither runtime path applied", () => {
    // This is exactly the breakpoint-scoped case after the item-5 fix:
    // runtimeStyleApplied is forced false at the call site whenever a
    // breakpoint is active, since sendStyleChange can only patch inline
    // styles and would otherwise out-rank the persisted `@media` rule.
    expect(
      shouldReplacePreviewAfterVisualStyleCommit({
        runtimeApplied: undefined,
        runtimeStyleApplied: false,
      }),
    ).toBe(true);
  });

  it("skips the full-content replace when the cheap runtime style patch already applied", () => {
    // Base-scope (no active breakpoint) EditPanel commits: sendStyleChange
    // already patched the live element's inline style, which IS the
    // persisted result for a base edit, so no further preview replace is
    // needed (and none should be attempted — that's the zero-reload path).
    expect(
      shouldReplacePreviewAfterVisualStyleCommit({
        runtimeApplied: undefined,
        runtimeStyleApplied: true,
      }),
    ).toBe(false);
  });

  it("skips the full-content replace when the caller already applied it at the DOM level", () => {
    expect(
      shouldReplacePreviewAfterVisualStyleCommit({
        runtimeApplied: true,
        runtimeStyleApplied: false,
      }),
    ).toBe(false);
  });

  it("skips when both runtime paths report already-applied", () => {
    expect(
      shouldReplacePreviewAfterVisualStyleCommit({
        runtimeApplied: true,
        runtimeStyleApplied: true,
      }),
    ).toBe(false);
  });
});
