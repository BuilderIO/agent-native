import { describe, expect, it } from "vitest";

import type { PlanContent } from "../shared/plan-content.js";
import { sanitizeCustomHtml, serializePlanContent } from "./plan-content.js";

/**
 * ADVERSARIAL — stored-content layer accepts prototype screens carrying
 * Alpine-style attribute bindings that the runtime later weaponizes.
 *
 * `serializePlanContent` (via `sanitizeCustomHtml` + the schema's
 * `unsafeCustomHtmlPattern` refine) is the ONLY sanitization the published
 * prototype html passes through before it is stored and served to a reviewer.
 * It strips literal `on*=` handlers and `javascript:`/`vbscript:` URL literals,
 * but it does NOT strip `:onclick` / `x-bind:on*` / `:href` bindings:
 *
 *   - `on*=` is only matched after `^` or whitespace, so `:onclick=` (preceded
 *     by `:`) slips past.
 *   - binding VALUES are bare state paths (e.g. `payload`) with no scheme
 *     literal, so the URL/scheme guards never fire.
 *
 * The client `prototype-runtime` then materializes these bindings into real,
 * executable `onclick`/`onmouseover` attributes (see
 * `prototype-runtime.xss.spec.ts`). These tests pin that the dangerous binding
 * SURVIVES the stored-content sanitizer — the upstream half of the CRITICAL
 * stored-XSS chain. They assert the SECURE behavior and FAIL today.
 */

function storePrototypeScreen(html: string): string {
  return serializePlanContent({
    version: 2,
    prototype: { screens: [{ id: "s1", html }] },
    blocks: [],
  } as unknown as PlanContent);
}

describe("stored prototype screen sanitization — binding XSS (CRITICAL)", () => {
  it("strips a :onclick binding before it is stored", () => {
    // No `javascript:` literal anywhere — the handler is a state path, so every
    // scheme/URL guard is bypassed and the binding stores verbatim.
    const stored = storePrototypeScreen(
      `<div x-data='{ "p": "1" }'><button :onclick="p">Go</button></div>`,
    );
    expect(stored).not.toContain(":onclick");
  });

  it("strips an x-bind:on* event binding before it is stored", () => {
    const stored = storePrototypeScreen(
      `<div x-data='{ "p": "1" }'><span x-bind:onmouseover="p">x</span></div>`,
    );
    expect(stored.toLowerCase()).not.toContain("x-bind:onmouseover");
  });

  it("sanitizeCustomHtml removes :on* event bindings from a fragment", () => {
    // Direct unit assertion on the shared sanitizer: an event-handler binding is
    // just as dangerous as a literal on*= handler once the runtime mounts it.
    const clean = sanitizeCustomHtml(`<button :onclick="payload">Go</button>`);
    expect(clean).not.toContain(":onclick");
  });

  it("sanitizeCustomHtml removes x-bind:on* event bindings from a fragment", () => {
    const clean = sanitizeCustomHtml(
      `<span x-bind:onmouseover="payload">x</span>`,
    );
    expect(clean.toLowerCase()).not.toContain("x-bind:onmouseover");
  });
});
