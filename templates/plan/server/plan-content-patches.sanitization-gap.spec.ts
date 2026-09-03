import { describe, expect, it } from "vitest";

import {
  applyPlanContentPatches,
  planContentSchema,
  type PlanContent,
} from "../shared/plan-content.js";
import { sanitizeCustomHtml, serializePlanContent } from "./plan-content.js";

/**
 * The patch ops `patch-wireframe-html` and `update-custom-html` claim (in code
 * comments) that the result is "re-sanitized" so "a patch can never smuggle
 * active content in." That claim rests on the zod `noFullHtmlDocument` refine,
 * whose regex is NARROWER than the runtime `sanitizeCustomHtml` allowlist.
 *
 * These tests pin the parity gap: payloads the runtime sanitizer strips but the
 * patch-validation refine lets through. In the live `update-visual-plan` flow
 * these are still cleaned because the action separately calls
 * `serializePlanContent` (which sanitizes). But `applyPlanContentPatches` on its
 * own — the surface these tests exercise — does NOT self-sanitize, contradicting
 * the inline comment.
 *
 * Tests named "GAP:" are EXPECTED-TO-FAIL pins of bugs (they assert the safe
 * behavior the comment promises). Tests named "PARITY:" assert the sanitizer's
 * own gaps directly.
 */

const wireframeHtml = (html: string): PlanContent =>
  planContentSchema.parse({
    version: 2,
    blocks: [
      { id: "wf1", type: "wireframe", data: { surface: "browser", html } },
    ],
  });

const customHtml = (html: string): PlanContent =>
  planContentSchema.parse({
    version: 2,
    blocks: [{ id: "ch", type: "custom-html", data: { html } }],
  });

describe("patch sanitization parity gap (re-sanitize claim)", () => {
  it("GAP: patch-wireframe-html does NOT reject a vbscript: href that the runtime sanitizer strips", () => {
    // The runtime sanitizer turns `<a href="vbscript:...">x</a>` into `<a>x</a>`.
    // The patch refine only screens javascript:/data:text/html:, so vbscript:
    // survives the patch. This SHOULD throw (comment: "can never smuggle active
    // content in"); it does not. FAILING pins the bug.
    expect(() =>
      applyPlanContentPatches(wireframeHtml("<div>x</div>"), [
        {
          op: "patch-wireframe-html",
          blockId: "wf1",
          edits: [{ find: "x", replace: '<a href="vbscript:msgbox(1)">y</a>' }],
        },
      ]),
    ).toThrow();
  });

  it("GAP: patch-wireframe-html does NOT reject a <portal> element the runtime sanitizer deletes", () => {
    expect(() =>
      applyPlanContentPatches(wireframeHtml("<div>x</div>"), [
        {
          op: "patch-wireframe-html",
          blockId: "wf1",
          edits: [{ find: "x", replace: '<portal src="//evil"></portal>' }],
        },
      ]),
    ).toThrow();
  });

  it("GAP: update-custom-html does NOT reject a vbscript: href the runtime sanitizer strips", () => {
    expect(() =>
      applyPlanContentPatches(customHtml("<div>ok</div>"), [
        {
          op: "update-custom-html",
          blockId: "ch",
          html: '<a href="vbscript:msgbox(1)">go</a>',
        },
      ]),
    ).toThrow();
  });

  it("GAP: update-custom-html does NOT reject a <frameset> the runtime sanitizer deletes", () => {
    expect(() =>
      applyPlanContentPatches(customHtml("<div>ok</div>"), [
        {
          op: "update-custom-html",
          blockId: "ch",
          html: "<frameset><frame></frameset>",
        },
      ]),
    ).toThrow();
  });
});

describe("runtime sanitizer own gaps (sanitizeCustomHtml)", () => {
  it("PARITY: tab-obfuscated 'java\\tscript:' href survives the runtime sanitizer", () => {
    // Browsers strip whitespace inside the scheme, so `java<TAB>script:` can
    // execute. The sanitizer only matches the literal `javascript:`. SHOULD be
    // neutralized; it is not. FAILING pins the bug.
    const dirty = '<a href="java\tscript:alert(1)">x</a>';
    const clean = sanitizeCustomHtml(dirty);
    expect(clean).not.toMatch(/java\s*script:/i);
  });

  it("PARITY: CSS expression() in an inline style survives the runtime sanitizer", () => {
    const dirty = '<div style="width:expression(alert(1))">x</div>';
    const clean = sanitizeCustomHtml(dirty);
    expect(clean).not.toMatch(/expression\s*\(/i);
  });

  it("PARITY: data:image/svg+xml href (script-capable svg) survives the runtime sanitizer", () => {
    const dirty = '<a href="data:image/svg+xml;base64,PHN2Zz4=">x</a>';
    const clean = sanitizeCustomHtml(dirty);
    expect(clean).not.toMatch(/data:image\/svg\+xml/i);
  });
});

describe("END-TO-END: obfuscated payloads survive the only stored-content sanitization layer", () => {
  it("E2E GAP: a tab-obfuscated java\\tscript: href persists through serializePlanContent into the stored JSON", () => {
    // serializePlanContent is the sole sanitization layer for the value that
    // update-visual-plan persists. The obfuscated scheme is not caught by the
    // schema refine NOR by sanitizeCustomHtml, so it lands in stored content.
    // SHOULD be neutralized; it is not. FAILING pins the bug.
    const stored = serializePlanContent({
      version: 2,
      blocks: [
        {
          id: "ch",
          type: "custom-html",
          data: { html: '<a href="java\tscript:alert(1)">x</a>' },
        },
      ],
    } as unknown as PlanContent);
    // JSON.stringify escapes the tab as the two characters backslash-t, so the
    // surviving obfuscated scheme appears verbatim in the stored JSON string.
    expect(stored).not.toContain("java\\tscript:");
  });

  it("E2E GAP: a CSS expression() inline style persists through serializePlanContent into the stored JSON", () => {
    const stored = serializePlanContent({
      version: 2,
      blocks: [
        {
          id: "ch",
          type: "custom-html",
          data: { html: '<div style="width:expression(alert(1))">x</div>' },
        },
      ],
    } as unknown as PlanContent);
    expect(stored).not.toMatch(/expression\s*\(/i);
  });
});
