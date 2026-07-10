import { describe, expect, it, vi } from "vitest";

import { commitStylePatch, resolveSpacingSideValue } from "./field-primitives";
import {
  normalizeLengthValue,
  propInputKeyRequiresBlurGuard,
} from "./panel-primitives";

describe("normalizeLengthValue", () => {
  it("appends the default unit to a bare integer", () => {
    expect(normalizeLengthValue("32", "px")).toBe("32px");
  });

  it("appends the default unit to a bare decimal with a leading digit", () => {
    expect(normalizeLengthValue("32.5", "px")).toBe("32.5px");
  });

  it("appends the default unit to a leading-decimal value with no integer part", () => {
    // Regression: "0.5" was accepted but the numerically identical ".5" was
    // rejected (and the field silently reverted instead of committing
    // ".5px") because the old regex required a digit before the dot.
    expect(normalizeLengthValue(".5", "px")).toBe(".5px");
    expect(normalizeLengthValue("-.5", "px")).toBe("-.5px");
  });

  it("passes through a value that already carries a unit", () => {
    expect(normalizeLengthValue("32px", "px")).toBe("32px");
  });

  it("passes through valid CSS keywords", () => {
    expect(normalizeLengthValue("auto", "px")).toBe("auto");
  });

  it("reverts (returns null) for empty input", () => {
    expect(normalizeLengthValue("   ", "px")).toBeNull();
  });

  it("reverts (returns null) for garbage input", () => {
    // This template's vitest environment has no DOM, so `CSS.supports` is
    // normally unavailable and normalizeLengthValue intentionally falls back
    // to accepting the raw value (see its own comment). Stub a minimal
    // CSS.supports so this test exercises the real browser revert path.
    const originalCss = (globalThis as { CSS?: unknown }).CSS;
    (globalThis as { CSS?: unknown }).CSS = { supports: () => false };
    try {
      expect(normalizeLengthValue("abc", "px")).toBeNull();
    } finally {
      (globalThis as { CSS?: unknown }).CSS = originalCss;
    }
  });

  it("accepts the raw value when CSS.supports is unavailable (SSR/test fallback)", () => {
    expect(normalizeLengthValue("abc", "px")).toBe("abc");
  });
});

describe("propInputKeyRequiresBlurGuard", () => {
  it("requires the blur guard for Enter", () => {
    // Regression: Enter previously didn't arm skipNextBlurCommitRef, so the
    // blur triggered by Enter's own `.blur()` call re-ran commit() a second
    // time in the same tick and double-invoked onChange with the identical
    // value.
    expect(propInputKeyRequiresBlurGuard("Enter")).toBe(true);
  });

  it("requires the blur guard for Escape", () => {
    expect(propInputKeyRequiresBlurGuard("Escape")).toBe(true);
  });

  it("does not require the blur guard for any other key", () => {
    expect(propInputKeyRequiresBlurGuard("Tab")).toBe(false);
    expect(propInputKeyRequiresBlurGuard("a")).toBe(false);
    expect(propInputKeyRequiresBlurGuard("ArrowLeft")).toBe(false);
  });
});

describe("resolveSpacingSideValue", () => {
  it("preserves one decimal place instead of flooring to a whole pixel", () => {
    // Regression: DesignSpacingControl's setSide used Math.round, silently
    // discarding the 0.5px precision the four per-side ScrubInput fields
    // advertise via precision={1} (every other ScrubInput commit site in
    // this panel — position X/Y, stroke weight, font size — uses
    // roundToOneDecimal instead of Math.round).
    expect(resolveSpacingSideValue(12.5)).toBe("12.5px");
  });

  it("rounds beyond one decimal place", () => {
    expect(resolveSpacingSideValue(12.34)).toBe("12.3px");
    expect(resolveSpacingSideValue(12.36)).toBe("12.4px");
  });

  it("formats a whole number without a trailing decimal", () => {
    expect(resolveSpacingSideValue(12)).toBe("12px");
  });

  it("never emits a signed-zero pixel value", () => {
    expect(resolveSpacingSideValue(-0.04)).toBe("0px");
  });
});

describe("commitStylePatch", () => {
  it("uses one batch callback and forwards gesture metadata", () => {
    const single = vi.fn();
    const batch = vi.fn();
    const meta = { phase: "commit" as const };

    commitStylePatch(
      { position: "absolute", left: "24px" },
      single,
      batch,
      meta,
    );

    expect(batch).toHaveBeenCalledOnce();
    expect(batch).toHaveBeenCalledWith(
      { position: "absolute", left: "24px" },
      meta,
    );
    expect(single).not.toHaveBeenCalled();
  });
});
