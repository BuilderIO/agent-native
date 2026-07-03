/**
 * apply-motion-edit.spec.ts
 *
 * Unit tests for the helpers extracted from apply-motion-edit.ts.
 *
 * Issue 1 regression: assertSafeCssProperty rejects malicious track.property.
 * Issue 3 regression: motion values/easing reject CSS injection payloads.
 * Issue 2 regression: motion_timeline row is persisted BEFORE HTML content so
 *   a failure in the HTML write step cannot leave design content mutated with
 *   no corresponding row.
 *
 * Note: The action itself requires a live DB + collab runtime. These tests
 * cover the pure helper functions and the ordering contract expressed in the
 * action source code — checked via static inspection of the compiled module.
 */

import { describe, expect, it } from "vitest";

import {
  assertSafeMotionCssProperty,
  assertSafeMotionCssToken,
} from "../shared/motion-compiler.js";
import {
  canPatchManagedMotionCss,
  motionTrackKey,
  resolveMotionTimelineInsertOwnership,
} from "./apply-motion-edit.js";

describe("assertSafeCssProperty (Issue 1 — CSS injection via track.property)", () => {
  it("FAILS before fix: injection payload containing colon is accepted — MUST throw after fix", () => {
    // This is the canonical injection vector: the property string breaks out of
    //   `${property}: ${value};`
    // inside the @keyframes block, producing:
    //   color:red} body{display:none: 0%;
    expect(() =>
      assertSafeMotionCssProperty(
        "color:red} body{display:none",
        "track.property",
      ),
    ).toThrow();
  });

  it("rejects property with semicolon", () => {
    expect(() =>
      assertSafeMotionCssProperty("opacity;x", "track.property"),
    ).toThrow();
  });

  it("rejects property with curly braces", () => {
    expect(() =>
      assertSafeMotionCssProperty("a{b}c", "track.property"),
    ).toThrow();
  });

  it("rejects property with whitespace", () => {
    expect(() =>
      assertSafeMotionCssProperty("opacity transform", "track.property"),
    ).toThrow();
  });

  it("rejects property with angle bracket / style-tag breakout", () => {
    expect(() =>
      assertSafeMotionCssProperty("x</style>", "track.property"),
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
      expect(() =>
        assertSafeMotionCssProperty(p, "track.property"),
      ).not.toThrow();
    }
  });
});

describe("assertSafeMotionCssToken (Issue 3 — CSS injection via values/easing)", () => {
  it("accepts common motion values and easing tokens", () => {
    for (const value of [
      "0",
      "1",
      "translateY(8px)",
      "scale(1.05)",
      "cubic-bezier(0.4, 0, 0.2, 1)",
      "steps(4, end)",
    ]) {
      expect(() =>
        assertSafeMotionCssToken(value, "motion value"),
      ).not.toThrow();
    }
  });

  it("rejects semicolons, braces, comments, url(), angle brackets, and control chars", () => {
    for (const value of [
      "0; body { display: none }",
      "0 } body { display: none",
      "/* hidden */ 0",
      "url(javascript:alert(1))",
      "</style><script>alert(1)</script>",
      "ease\nbody { display: none }",
    ]) {
      expect(() => assertSafeMotionCssToken(value, "motion value")).toThrow(
        /not allowed in motion CSS values/,
      );
    }
  });
});

describe("resolveMotionTimelineInsertOwnership", () => {
  it("uses the request user when an authenticated editor creates a timeline", () => {
    expect(
      resolveMotionTimelineInsertOwnership({
        requestUserEmail: "editor@example.com",
        requestOrgId: "org-editor",
        designOwnerEmail: "owner@example.com",
        designOrgId: "org-owner",
      }),
    ).toEqual({ ownerEmail: "editor@example.com", orgId: "org-editor" });
  });

  it("falls back to the authorized design owner for local/public editor sessions", () => {
    expect(
      resolveMotionTimelineInsertOwnership({
        requestUserEmail: undefined,
        requestOrgId: undefined,
        designOwnerEmail: "local@localhost",
        designOrgId: null,
      }),
    ).toEqual({ ownerEmail: "local@localhost", orgId: null });
  });

  it("still rejects inserts when neither the request nor design has an owner", () => {
    expect(() =>
      resolveMotionTimelineInsertOwnership({
        requestUserEmail: "",
        designOwnerEmail: "",
      }),
    ).toThrow("no authenticated user");
  });
});

describe("canPatchManagedMotionCss", () => {
  it("allows inline HTML documents to receive the managed motion style block", () => {
    expect(
      canPatchManagedMotionCss(
        "<!DOCTYPE html><html><head></head><body /></html>",
      ),
    ).toBe(true);
    expect(
      canPatchManagedMotionCss('<section data-agent-native-node-id="a" />'),
    ).toBe(true);
  });

  it("does not treat URL-backed localhost screen content as patchable HTML", () => {
    expect(canPatchManagedMotionCss("http://localhost:3000/")).toBe(false);
    expect(canPatchManagedMotionCss("https://localhost:5173/docs")).toBe(false);
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

  it("does not re-apply list access filtering after assertAccess authorizes the design", () => {
    const actionPath = path.resolve(
      path.dirname(fileURLToPath(import.meta.url)),
      "apply-motion-edit.ts",
    );
    const src = readFileSync(actionPath, "utf8");

    expect(src).toContain('assertAccess("design", designId, "editor")');
    expect(src).not.toContain(
      "accessFilter(schema.designs, schema.designShares)",
    );
  });

  it("has an additive migration for legacy motion_timeline ownership columns", () => {
    const migrationPath = path.resolve(
      path.dirname(fileURLToPath(import.meta.url)),
      "../server/plugins/db.ts",
    );
    const src = readFileSync(migrationPath, "utf8");

    expect(src).toContain("version: 17");
    expect(src).toContain(
      "ALTER TABLE motion_timeline ADD COLUMN IF NOT EXISTS owner_email",
    );
    expect(src).toContain(
      "ALTER TABLE motion_timeline ADD COLUMN IF NOT EXISTS org_id",
    );
    expect(src).toContain(
      "ALTER TABLE motion_timeline ADD COLUMN IF NOT EXISTS visibility",
    );
  });
});

// ─── Issue 6: duplicate-track key separator must not be a literal NUL ─────────
//
// The duplicate (targetNodeId, property) guard joins the two fields with a
// separator. Previously that separator was a literal NUL (\0) embedded in the
// source, which made tooling (grep, editors, diff) treat the file as binary.
// motionTrackKey now uses the ASCII Unit Separator (\x1f), an escape in source
// so the file stays plain text, while still being a delimiter that cannot
// appear in a CSS-safe nodeId or property.

describe("motionTrackKey (Issue 6 — NUL separator made the file binary)", () => {
  it("does not contain a literal NUL byte", () => {
    expect(motionTrackKey("node-1", "opacity")).not.toContain("\0");
  });

  it("uses the ASCII Unit Separator (\\x1f) as the field delimiter", () => {
    expect(motionTrackKey("node-1", "opacity")).toBe("node-1\x1fopacity");
  });

  it("distinguishes distinct (nodeId, property) pairs", () => {
    const a = motionTrackKey("node-1", "opacity");
    const b = motionTrackKey("node-1", "transform");
    const c = motionTrackKey("node-2", "opacity");
    expect(a).not.toBe(b);
    expect(a).not.toBe(c);
    expect(b).not.toBe(c);
  });

  it("returns the same key for the same pair (duplicate detection works)", () => {
    expect(motionTrackKey("node-9", "color")).toBe(
      motionTrackKey("node-9", "color"),
    );
  });

  it("cannot be forged by a nodeId/property boundary shift", () => {
    // Without a delimiter, ("ab","c") and ("a","bc") would collide. The
    // separator keeps them distinct.
    expect(motionTrackKey("ab", "c")).not.toBe(motionTrackKey("a", "bc"));
  });

  it("the action source file contains no literal NUL byte", () => {
    const actionPath = path.resolve(
      path.dirname(fileURLToPath(import.meta.url)),
      "apply-motion-edit.ts",
    );
    const src = readFileSync(actionPath, "utf8");
    expect(src.includes("\0")).toBe(false);
  });
});
