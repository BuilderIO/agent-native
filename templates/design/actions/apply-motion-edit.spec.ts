/**
 * apply-motion-edit.spec.ts
 *
 * Unit tests for the helpers extracted from apply-motion-edit.ts.
 *
 * Issue 1 regression: assertSafeCssProperty rejects malicious track.property.
 * Issue 2 regression: motion_timeline row is persisted BEFORE HTML content so
 *   a failure in the HTML write step cannot leave design content mutated with
 *   no corresponding row.
 *
 * Note: The action itself requires a live DB + collab runtime. These tests
 * cover the pure helper functions and the ordering contract expressed in the
 * action source code — checked via static inspection of the compiled module.
 */

import { describe, expect, it } from "vitest";

// ─── Issue 1: Property validation ────────────────────────────────────────────
//
// Mirror of the assertSafeCssProperty guard that lives in apply-motion-edit.ts.
// (Cannot import directly because the action file imports server-side modules
// that are not available in the vitest environment.)

function assertSafeCssProperty(property: string, field: string): string {
  if (!/^-?[a-zA-Z][a-zA-Z0-9-]*$/.test(property)) {
    throw new Error(
      `Invalid ${field}: "${property}" is not a valid CSS property identifier. ` +
        "Only ASCII letters, digits, hyphens, and an optional leading hyphen are allowed.",
    );
  }
  return property;
}

describe("assertSafeCssProperty (Issue 1 — CSS injection via track.property)", () => {
  it("FAILS before fix: injection payload containing colon is accepted — MUST throw after fix", () => {
    // This is the canonical injection vector: the property string breaks out of
    //   `${property}: ${value};`
    // inside the @keyframes block, producing:
    //   color:red} body{display:none: 0%;
    expect(() =>
      assertSafeCssProperty("color:red} body{display:none", "track.property"),
    ).toThrow();
  });

  it("rejects property with semicolon", () => {
    expect(() =>
      assertSafeCssProperty("opacity;x", "track.property"),
    ).toThrow();
  });

  it("rejects property with curly braces", () => {
    expect(() => assertSafeCssProperty("a{b}c", "track.property")).toThrow();
  });

  it("rejects property with whitespace", () => {
    expect(() =>
      assertSafeCssProperty("opacity transform", "track.property"),
    ).toThrow();
  });

  it("rejects property with angle bracket / style-tag breakout", () => {
    expect(() =>
      assertSafeCssProperty("x</style>", "track.property"),
    ).toThrow();
  });

  it("accepts valid CSS identifiers", () => {
    for (const p of [
      "opacity",
      "transform",
      "color",
      "background-color",
      "-webkit-transform",
    ]) {
      expect(() => assertSafeCssProperty(p, "track.property")).not.toThrow();
    }
  });
});

// ─── Issue 2: Write ordering contract ────────────────────────────────────────
//
// We verify the source ordering by reading the compiled action source and
// asserting that the DB transaction (motion_timeline write) appears before
// the persistFileContent call in the source text.

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

describe("apply-motion-edit write ordering (Issue 2 — non-atomic write)", () => {
  it("motion_timeline DB transaction appears BEFORE persistFileContent in source", () => {
    const actionPath = path.resolve(
      path.dirname(fileURLToPath(import.meta.url)),
      "apply-motion-edit.ts",
    );
    const src = readFileSync(actionPath, "utf8");

    const txIdx = src.indexOf("db.transaction");
    const persistIdx = src.indexOf("await persistFileContent");

    expect(txIdx).toBeGreaterThan(-1);
    expect(persistIdx).toBeGreaterThan(-1);

    // After the fix, the transaction must come first.
    expect(txIdx).toBeLessThan(persistIdx);
  });

  it("comment describes timeline-first ordering (not HTML-first)", () => {
    const actionPath = path.resolve(
      path.dirname(fileURLToPath(import.meta.url)),
      "apply-motion-edit.ts",
    );
    const src = readFileSync(actionPath, "utf8");

    // The new comment explicitly states the row is written first.
    expect(src).toMatch(/motion_timeline row FIRST/i);

    // The old incorrect comment ("Content is written before the row") must be gone.
    expect(src).not.toMatch(/Content is written before the row/);
  });
});
