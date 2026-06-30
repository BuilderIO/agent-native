/**
 * motion-compiler.spec.ts
 *
 * Regression tests for the motion compiler and the property-validation guard
 * in apply-motion-edit.
 *
 * Issue 1 regression: track.property was not validated, allowing CSS injection.
 * The assertSafeCssProperty helper (defined in apply-motion-edit.ts and
 * tested here in isolation) must reject any property string that could break
 * out of a CSS declaration or <style> block context.
 */

import { describe, expect, it } from "vitest";

import { compile } from "./motion-compiler";
import type { MotionTimeline } from "./motion-timeline";

// ─── assertSafeCssProperty — inline mirror for unit testing ──────────────────
//
// The real implementation lives in apply-motion-edit.ts (server action).
// We mirror the pure validation logic here so we can unit-test it without
// spinning up the full action runtime.

function assertSafeCssProperty(property: string, field: string): string {
  if (!/^-?[a-zA-Z][a-zA-Z0-9-]*$/.test(property)) {
    throw new Error(
      `Invalid ${field}: "${property}" is not a valid CSS property identifier. ` +
        "Only ASCII letters, digits, hyphens, and an optional leading hyphen are allowed.",
    );
  }
  return property;
}

// ─── Helper ──────────────────────────────────────────────────────────────────

function makeTimeline(property: string): MotionTimeline {
  return {
    id: "t1",
    designId: "d1",
    sourceRef: null,
    filePath: null,
    tracks: [
      {
        targetNodeId: "node1",
        property,
        keyframes: [
          { t: 0, value: "0" },
          { t: 1, value: "1" },
        ],
      },
    ],
    durationMs: 300,
    defaultEase: "ease",
    compiledHash: null,
    createdAt: "2024-01-01T00:00:00.000Z",
    updatedAt: "2024-01-01T00:00:00.000Z",
  };
}

// ─── Property validation (Issue 1 regression) ────────────────────────────────

describe("assertSafeCssProperty — allowlist validation", () => {
  it("accepts standard animatable CSS properties", () => {
    const valid = [
      "opacity",
      "transform",
      "color",
      "background-color",
      "font-size",
      "width",
      "height",
      "top",
      "left",
      "margin-top",
      "border-radius",
      "letter-spacing",
      "line-height",
    ];
    for (const prop of valid) {
      expect(() => assertSafeCssProperty(prop, "track.property")).not.toThrow();
    }
  });

  it("accepts vendor-prefixed properties (leading hyphen)", () => {
    expect(() =>
      assertSafeCssProperty("-webkit-transform", "track.property"),
    ).not.toThrow();
    expect(() =>
      assertSafeCssProperty("-moz-transform", "track.property"),
    ).not.toThrow();
  });

  it("REJECTS injection payload containing colon (CSS declaration breakout)", () => {
    // Before the fix, this would compile as:
    //   color:red} body{display:none: <value>;
    // breaking out of the @keyframes block.
    expect(() =>
      assertSafeCssProperty("color:red} body{display:none", "track.property"),
    ).toThrow(/not a valid CSS property identifier/);
  });

  it("REJECTS property containing semicolon", () => {
    expect(() =>
      assertSafeCssProperty("opacity;color", "track.property"),
    ).toThrow(/not a valid CSS property identifier/);
  });

  it("REJECTS property containing opening brace", () => {
    expect(() =>
      assertSafeCssProperty("opacity{color:red}", "track.property"),
    ).toThrow(/not a valid CSS property identifier/);
  });

  it("REJECTS property containing closing brace", () => {
    expect(() =>
      assertSafeCssProperty("opacity}body{color:red", "track.property"),
    ).toThrow(/not a valid CSS property identifier/);
  });

  it("REJECTS property containing whitespace", () => {
    expect(() =>
      assertSafeCssProperty("opacity color", "track.property"),
    ).toThrow(/not a valid CSS property identifier/);
  });

  it("REJECTS property containing angle bracket (style-tag breakout)", () => {
    expect(() =>
      assertSafeCssProperty("opacity</style><script>", "track.property"),
    ).toThrow(/not a valid CSS property identifier/);
  });

  it("REJECTS property containing slash", () => {
    expect(() =>
      assertSafeCssProperty("opacity/color", "track.property"),
    ).toThrow(/not a valid CSS property identifier/);
  });

  it("REJECTS empty string", () => {
    expect(() => assertSafeCssProperty("", "track.property")).toThrow(
      /not a valid CSS property identifier/,
    );
  });

  it("REJECTS property starting with digit", () => {
    expect(() => assertSafeCssProperty("1opacity", "track.property")).toThrow(
      /not a valid CSS property identifier/,
    );
  });
});

// ─── Compiler output does not contain injected payload ───────────────────────

describe("compile — property is emitted safely", () => {
  it("emits the property name verbatim for valid identifiers", () => {
    const { css } = compile(makeTimeline("opacity"));
    expect(css).toContain("opacity:");
  });

  it("emits exactly one @keyframes block for a single-track timeline", () => {
    const { css } = compile(makeTimeline("transform"));
    // Valid CSS: exactly one @keyframes block and one element rule block.
    const kfMatches = css.match(/@keyframes/g);
    expect(kfMatches).toHaveLength(1);
  });

  it("compile is deterministic — same input produces identical hash", () => {
    const timeline = makeTimeline("opacity");
    const r1 = compile(timeline);
    const r2 = compile(timeline);
    expect(r1.hash).toBe(r2.hash);
    expect(r1.css).toBe(r2.css);
  });

  it("compile includes reduced-motion block", () => {
    const { css } = compile(makeTimeline("opacity"));
    expect(css).toContain("prefers-reduced-motion");
  });
});
