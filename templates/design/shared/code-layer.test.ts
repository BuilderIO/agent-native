import { describe, expect, it } from "vitest";

import {
  applyVisualEdit,
  buildCodeLayerProjection,
  type EditIntent,
} from "./code-layer";

describe("code-layer projection", () => {
  it("projects HTML elements with stable selectors, source spans, layout, and capabilities", () => {
    const html = `
      <main id="shell" style="display: flex; gap: 16px">
        <section data-code-layer-id="hero" class="p-6 bg-white" style="width: 320px; color: #111">
          <h1 class="text-4xl">Hello <span>there</span></h1>
          <button data-testid="cta" class="px-4">Buy now</button>
        </section>
      </main>
    `;

    const projection = buildCodeLayerProjection(html, {
      source: { kind: "inline-html", filename: "index.html" },
    });

    const hero = projection.nodes.find(
      (node) => node.dataAttributes["data-code-layer-id"] === "hero",
    );
    expect(hero).toBeTruthy();
    expect(hero?.selector).toBe('[data-code-layer-id="hero"]');
    expect(hero?.tag).toBe("section");
    expect(hero?.classes).toEqual(["p-6", "bg-white"]);
    expect(hero?.style.width).toBe("320px");
    expect(hero?.textSnippet).toContain("Hello there");
    expect(hero?.source?.openStart).toBeGreaterThanOrEqual(0);
    expect(hero?.layout.parentDisplay).toBe("flex");
    expect(hero?.layout.parentGap).toBe("16px");
    expect(hero?.styleTokens).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ property: "width", value: "320px" }),
        expect.objectContaining({ property: "background", token: "bg-white" }),
      ]),
    );
    expect(hero?.capabilities.map((capability) => capability.kind)).toEqual([
      "style",
      "class",
      "text",
    ]);
  });
});

describe("applyVisualEdit", () => {
  it("applies safe inline style edits to a targeted node", () => {
    const html = `<div><button data-testid="cta" style="color: red">Buy</button></div>`;
    const intent: EditIntent = {
      kind: "style",
      target: { selector: '[data-testid="cta"]' },
      property: "background",
      value: "#fff",
    };

    const patch = applyVisualEdit(html, intent);

    expect(patch.result.status).toBe("applied");
    expect(patch.result.capability).toEqual(
      expect.objectContaining({ kind: "style", properties: ["background"] }),
    );
    expect(patch.content).toContain(`style="color: red; background: #fff"`);
    expect(patch.result.before?.style).toEqual({ color: "red" });
    expect(patch.result.after?.style).toEqual({
      color: "red",
      background: "#fff",
    });
  });

  it("applies class edits without duplicating class tokens", () => {
    const html = `<button id="cta" class="px-4">Buy</button>`;
    const patch = applyVisualEdit(html, {
      kind: "class",
      target: { selector: "#cta" },
      operation: "add",
      classNames: ["px-4", "bg-black"],
    });

    expect(patch.result.status).toBe("applied");
    expect(patch.content).toBe(
      `<button id="cta" class="px-4 bg-black">Buy</button>`,
    );
    expect(patch.result.after?.classes).toEqual(["px-4", "bg-black"]);
  });

  it("applies textContent edits only to leaf elements", () => {
    const html = `<div><button data-testid="cta">Buy now</button></div>`;
    const patch = applyVisualEdit(html, {
      kind: "textContent",
      target: { selector: '[data-testid="cta"]' },
      value: "Start <free>",
    });

    expect(patch.result.status).toBe("applied");
    expect(patch.content).toBe(
      `<div><button data-testid="cta">Start &lt;free&gt;</button></div>`,
    );
    expect(patch.result.after?.textSnippet).toBe("Start <free>");
  });

  it("returns needsAgent when a text edit would replace nested markup", () => {
    const html = `<section data-code-layer-id="hero">Hello <strong>there</strong></section>`;
    const patch = applyVisualEdit(html, {
      kind: "textContent",
      target: { selector: '[data-code-layer-id="hero"]' },
      value: "Hello world",
    });

    expect(patch.result.status).toBe("needsAgent");
    expect(patch.content).toBe(html);
  });

  it("returns conflict for ambiguous selectors", () => {
    const html = `<button>One</button><button>Two</button>`;
    const patch = applyVisualEdit(html, {
      kind: "style",
      target: { selector: "button" },
      property: "width",
      value: "200px",
    });

    expect(patch.result.status).toBe("conflict");
    expect(patch.content).toBe(html);
  });

  it("returns unsupported for unsafe or unsupported style edits", () => {
    const html = `<button id="cta">Buy</button>`;
    const patch = applyVisualEdit(html, {
      kind: "style",
      target: { selector: "#cta" },
      property: "background",
      value: "url(javascript:alert(1))",
    });

    expect(patch.result.status).toBe("unsupported");
    expect(patch.content).toBe(html);
  });
});
