import { describe, expect, it } from "vitest";

import type { PlanContent } from "../shared/plan-content.js";
import { sanitizeCustomHtml, serializePlanContent } from "./plan-content.js";


function storePrototypeScreen(html: string): string {
  return serializePlanContent({
    version: 2,
    prototype: { screens: [{ id: "s1", html }] },
    blocks: [],
  } as unknown as PlanContent);
}

describe("stored prototype screen sanitization — binding XSS (CRITICAL)", () => {
  it("strips a :onclick binding before it is stored", () => {
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
