import { describe, expect, it } from "vitest";

import {
  applyVisualEdit,
  buildCodeLayerProjection,
  buildCodeLayerTree,
  ensureCodeLayerNodeIdsInHtml,
  removeCodeLayerNodeFromHtml,
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
    expect(hero?.layerName).toBe("Hero");
    expect(hero?.layerNameSource).toBe("semantic");
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

  it("keeps deep repeated tree paths distinct", () => {
    const html = `
      <main>
        <div><div><div><div><div><button>First</button></div></div></div></div></div>
        <div><div><div><div><div><button>Second</button></div></div></div></div></div>
      </main>
    `;

    const projection = buildCodeLayerProjection(html);
    const buttonPaths = projection.nodes
      .filter((node) => node.tag === "button")
      .map((node) => node.path);

    expect(buttonPaths).toHaveLength(2);
    expect(new Set(buttonPaths).size).toBe(2);
    expect(buttonPaths[0]).not.toBe(buttonPaths[1]);
  });

  it("classifies inline flex and inline grid layout containers", () => {
    const html = `
      <main class="inline-flex" style="gap: 16px">
        <section class="inline-grid">
          <button>Buy now</button>
        </section>
      </main>
    `;

    const projection = buildCodeLayerProjection(html);
    const main = projection.nodes.find((node) => node.tag === "main");
    const section = projection.nodes.find((node) => node.tag === "section");
    const button = projection.nodes.find((node) => node.tag === "button");

    expect(main?.layout.display).toBe("inline-flex");
    expect(section?.layout.display).toBe("inline-grid");
    expect(section?.layout.parentDisplay).toBe("inline-flex");
    expect(section?.layout.parentGap).toBe("16px");
    expect(button?.layout.parentDisplay).toBe("inline-grid");
  });

  it("uses explicit DOM layer-name attributes before readable fallbacks", () => {
    const html = `
      <main data-layer-name="Fallback main">
        <section data-agent-native-layer-name="Marketing hero" data-layer-name="Hero">
          <h1>Launch faster</h1>
          <button aria-label="Primary CTA">Start</button>
        </section>
      </main>
    `;

    const projection = buildCodeLayerProjection(html);
    const section = projection.nodes.find((node) => node.tag === "section");
    const button = projection.nodes.find((node) => node.tag === "button");

    expect(section?.layerName).toBe("Marketing hero");
    expect(section?.layerNameSource).toBe("attribute");
    expect(section?.layerNameAttribute).toBe("data-agent-native-layer-name");
    expect(button?.layerName).toBe("Primary CTA");
    expect(button?.layerNameSource).toBe("semantic");
  });

  it("builds a design-editor DOM layer tree from projection parentage", () => {
    const html = `
      <main data-agent-native-layer-name="Page">
        <section data-layer-name="Hero">
          <h1>Launch faster</h1>
        </section>
      </main>
    `;

    const tree = buildCodeLayerTree(buildCodeLayerProjection(html));

    expect(tree).toHaveLength(1);
    expect(tree[0]).toEqual(
      expect.objectContaining({
        name: "Page",
        detail: "<main>",
        type: "group",
      }),
    );
    expect(tree[0]?.children[0]).toEqual(
      expect.objectContaining({
        name: "Hero",
        detail: "<section>",
      }),
    );
    expect(tree[0]?.children[0]?.children[0]).toEqual(
      expect.objectContaining({
        name: "Launch faster",
        type: "text",
      }),
    );
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

  it("applies inspector style properties through the deterministic path", () => {
    let html = `<section data-layer-name="Card" style="width: 240px">Hello</section>`;
    const edits = [
      { property: "fontSize", cssProperty: "font-size", value: "24px" },
      { property: "borderRadius", cssProperty: "border-radius", value: "12px" },
      { property: "opacity", cssProperty: "opacity", value: "0.64" },
      {
        property: "boxShadow",
        cssProperty: "box-shadow",
        value: "0 8px 24px rgba(0, 0, 0, 0.16)",
      },
      {
        property: "borderColor",
        cssProperty: "border-color",
        value: "#334155",
      },
      { property: "borderWidth", cssProperty: "border-width", value: "2px" },
      { property: "borderStyle", cssProperty: "border-style", value: "solid" },
      { property: "overflow", cssProperty: "overflow", value: "hidden" },
      { property: "flexWrap", cssProperty: "flex-wrap", value: "wrap" },
      { property: "rotate", cssProperty: "rotate", value: "15deg" },
      { property: "scale", cssProperty: "scale", value: "-1 1" },
      { property: "left", cssProperty: "left", value: "32px" },
    ] as const;

    for (const { property, cssProperty, value } of edits) {
      const patch = applyVisualEdit(html, {
        kind: "style",
        target: { selector: '[data-layer-name="Card"]' },
        property,
        value,
      });

      expect(patch.result.status).toBe("applied");
      expect(patch.result.changed).toBe(true);
      expect(patch.result.capability).toEqual(
        expect.objectContaining({ kind: "style", properties: [cssProperty] }),
      );
      expect(patch.result.after?.style[cssProperty]).toBe(value);
      html = patch.content;
    }

    expect(html).toContain("font-size: 24px");
    expect(html).toContain("border-radius: 12px");
    expect(html).toContain("opacity: 0.64");
    expect(html).toContain("box-shadow: 0 8px 24px rgba(0, 0, 0, 0.16)");
    expect(html).toContain("border-color: #334155");
    expect(html).toContain("border-width: 2px");
    expect(html).toContain("border-style: solid");
    expect(html).toContain("overflow: hidden");
    expect(html).toContain("flex-wrap: wrap");
    expect(html).toContain("rotate: 15deg");
    expect(html).toContain("scale: -1 1");
    expect(html).toContain("left: 32px");
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

  it("preserves safe inline markup for text edits that target styled runs", () => {
    const html = `<p data-code-layer-id="headline">Build <span style="color: red">fast</span></p>`;
    const patch = applyVisualEdit(html, {
      kind: "textContent",
      target: { selector: '[data-code-layer-id="headline"]' },
      value: "Build faster",
      html: `Build <span style="color: red">faster</span>`,
    });

    expect(patch.result.status).toBe("applied");
    expect(patch.content).toContain(
      `Build <span style="color: red">faster</span>`,
    );
  });

  it("stamps stable node ids and removes nodes by source span", () => {
    const html = `<main><section><button>Buy</button></section></main>`;
    const stamped = ensureCodeLayerNodeIdsInHtml(html);

    expect(stamped.changed).toBe(true);
    expect(stamped.content).toContain("data-agent-native-node-id");

    const projection = buildCodeLayerProjection(stamped.content);
    const button = projection.nodes.find((node) => node.tag === "button");
    expect(button).toBeTruthy();

    const removed = removeCodeLayerNodeFromHtml(stamped.content, button!);
    expect(removed).not.toContain("<button");
    expect(removed).toContain("<section");
  });

  it("does not stamp HTML-looking strings inside script content", () => {
    const script = "const tpl = `<div><span>ghost</span></div>`;";
    const html = `<!doctype html><html><head><script>${script}</script></head><body><main><section>real</section></main></body></html>`;

    const projection = buildCodeLayerProjection(html);
    expect(projection.nodes.some((node) => node.textSnippet === "ghost")).toBe(
      false,
    );

    const stamped = ensureCodeLayerNodeIdsInHtml(html);
    const scriptMatch = stamped.content.match(/<script>([\s\S]*?)<\/script>/);
    expect(scriptMatch?.[1]).toBe(script);
    expect(stamped.content).toContain(`<section data-agent-native-node-id=`);
  });

  it("does not stamp HTML-looking text inside style content", () => {
    const style = `.icon { background-image: url("data:image/svg+xml,<svg viewBox='0 0 1 1'><path d='M0 0h1v1H0z'/></svg>"); }`;
    const html = `<!doctype html><html><head><style>${style}</style></head><body><main><section>real</section></main></body></html>`;

    const projection = buildCodeLayerProjection(html);
    expect(projection.nodes.some((node) => node.tag === "svg")).toBe(false);
    expect(projection.nodes.some((node) => node.tag === "path")).toBe(false);

    const stamped = ensureCodeLayerNodeIdsInHtml(html);
    const styleMatch = stamped.content.match(/<style>([\s\S]*?)<\/style>/);
    expect(styleMatch?.[1]).toBe(style);
    expect(stamped.content).toContain(`<section data-agent-native-node-id=`);
  });

  it("preserves authored markup except injected node ids", () => {
    const html = `<html><head><style>.x::after{content:"<button>"}</style></head><body class="page"><main data-label="1 > 0"><section x-data="{ open: true }"><button aria-label="Buy > now">Buy</button></section></main><script>const tpl = \`<div class="card">Hi</div>\`;</script><template><div class="ghost">Ghost</div></template></body></html>`;
    const stamped = ensureCodeLayerNodeIdsInHtml(html);

    const stripped = stamped.content.replace(
      /\sdata-agent-native-node-id="[^"]*"/g,
      "",
    );

    expect(stamped.changed).toBe(true);
    expect(stripped).toBe(html);
    expect(
      stamped.content.match(/<style>[\s\S]*?<\/style>/)?.[0],
    ).not.toContain("data-agent-native-node-id");
    expect(
      stamped.content.match(/<script>[\s\S]*?<\/script>/)?.[0],
    ).not.toContain("data-agent-native-node-id");
    expect(
      stamped.content.match(/<template>[\s\S]*?<\/template>/)?.[0],
    ).not.toContain("data-agent-native-node-id");
  });

  it("repairs duplicate stable node ids and uses them before duplicate HTML ids", () => {
    const html = `<main><section id="card" data-agent-native-node-id="dup"><button id="cta" data-agent-native-node-id="dup">A</button></section><section id="card" data-agent-native-node-id="dup"><button id="cta" data-agent-native-node-id="dup">B</button></section></main>`;
    const stamped = ensureCodeLayerNodeIdsInHtml(html, {
      source: { kind: "inline-html", filename: "index.html" },
    });

    expect(stamped.changed).toBe(true);
    const ids = Array.from(
      stamped.content.matchAll(/data-agent-native-node-id="([^"]+)"/g),
      (match) => match[1],
    );
    expect(new Set(ids).size).toBe(ids.length);

    const projection = buildCodeLayerProjection(stamped.content, {
      source: { kind: "inline-html", filename: "index.html" },
    });
    const sectionIds = projection.nodes
      .filter((node) => node.tag === "section")
      .map((node) => node.id);
    const buttonIds = projection.nodes
      .filter((node) => node.tag === "button")
      .map((node) => node.id);

    expect(new Set(sectionIds).size).toBe(2);
    expect(new Set(buttonIds).size).toBe(2);
    expect(
      projection.nodes
        .filter((node) => node.tag === "button")
        .every((node) =>
          node.selector.startsWith('[data-agent-native-node-id="'),
        ),
    ).toBe(true);
  });

  it("removes duplicate stable node id attributes from the same open tag", () => {
    const html = `<main><button data-agent-native-node-id="cta" data-agent-native-node-id="cta-copy">Buy</button></main>`;
    const stamped = ensureCodeLayerNodeIdsInHtml(html);

    expect(stamped.changed).toBe(true);
    const buttonOpenTag = stamped.content.match(/<button[^>]+>/)?.[0] ?? "";
    expect(
      buttonOpenTag.match(/data-agent-native-node-id=/g) ?? [],
    ).toHaveLength(1);
  });

  it("resolves deterministic edits from raw bridge source ids", () => {
    const html = `<main><button data-agent-native-node-id="cta-node">Buy</button></main>`;
    const patch = applyVisualEdit(html, {
      kind: "style",
      target: { nodeId: "cta-node" },
      property: "color",
      value: "#111",
    });

    expect(patch.result.status).toBe("applied");
    expect(patch.content).toBe(
      `<main><button data-agent-native-node-id="cta-node" style="color: #111">Buy</button></main>`,
    );
  });

  it("reorders and reparents nodes with deterministic moveNode edits", () => {
    const html = `<main><div id="a">A</div><div id="b">B</div><section id="c"></section></main>`;
    const reordered = applyVisualEdit(html, {
      kind: "moveNode",
      target: { selector: "#b" },
      anchor: { selector: "#a" },
      placement: "before",
    });

    expect(reordered.result.status).toBe("applied");
    expect(reordered.content).toBe(
      `<main><div id="b">B</div><div id="a">A</div><section id="c"></section></main>`,
    );

    const reparented = applyVisualEdit(reordered.content, {
      kind: "moveNode",
      target: { selector: "#b" },
      anchor: { selector: "#c" },
      placement: "inside",
    });

    expect(reparented.result.status).toBe("applied");
    expect(reparented.content).toBe(
      `<main><div id="a">A</div><section id="c"><div id="b">B</div></section></main>`,
    );
  });

  it("moves nodes from raw bridge source ids instead of fragile selectors", () => {
    const html = `<main><div data-agent-native-node-id="a">A</div><div data-agent-native-node-id="b">B</div></main>`;
    const patch = applyVisualEdit(html, {
      kind: "moveNode",
      target: { nodeId: "b" },
      anchor: { nodeId: "a" },
      placement: "before",
    });

    expect(patch.result.status).toBe("applied");
    expect(patch.content).toBe(
      `<main><div data-agent-native-node-id="b">B</div><div data-agent-native-node-id="a">A</div></main>`,
    );
  });

  it("keeps valid HTML when moving nodes with greater-than characters in attributes", () => {
    const html = `<main><div data-agent-native-node-id="a" data-label="1 > 0">A</div><div data-agent-native-node-id="b">B</div></main>`;
    const patch = applyVisualEdit(html, {
      kind: "moveNode",
      target: { nodeId: "a" },
      anchor: { nodeId: "b" },
      placement: "after",
    });

    expect(patch.result.status).toBe("applied");
    expect(patch.content).toBe(
      `<main><div data-agent-native-node-id="b">B</div><div data-agent-native-node-id="a" data-label="1 > 0">A</div></main>`,
    );
  });

  it("moves nodes by bridge-style DOM selector paths across parents", () => {
    const html = `<main class="shell"><section data-layer-name="Hero"><button>First</button><button class="secondary">Second</button></section><aside data-layer-name="Drop"></aside></main>`;
    const patch = applyVisualEdit(html, {
      kind: "moveNode",
      target: {
        selector: `section[data-layer-name="Hero"] > button.secondary:nth-of-type(2)`,
      },
      anchor: { selector: `aside[data-layer-name="Drop"]` },
      placement: "inside",
    });

    expect(patch.result.status).toBe("applied");
    expect(patch.content).toBe(
      `<main class="shell"><section data-layer-name="Hero"><button>First</button></section><aside data-layer-name="Drop"><button class="secondary">Second</button></aside></main>`,
    );
  });

  it("does not collapse full bridge selector paths to ambiguous leaf selectors", () => {
    const html = `<main><section data-layer-name="First"><button class="secondary">First</button></section><section data-layer-name="Second"><button class="secondary">Second</button></section></main>`;
    const patch = applyVisualEdit(html, {
      kind: "style",
      target: {
        selector: `section[data-layer-name="Second"] > button.secondary`,
      },
      property: "color",
      value: "#111",
    });

    expect(patch.result.status).toBe("applied");
    expect(patch.content).toBe(
      `<main><section data-layer-name="First"><button class="secondary">First</button></section><section data-layer-name="Second"><button class="secondary" style="color: #111">Second</button></section></main>`,
    );
  });

  it("applies edits through deep repeated tree paths", () => {
    const html = `<main><div><div><div><div><div><button>First</button></div></div></div></div></div><div><div><div><div><div><button>Second</button></div></div></div></div></div></main>`;
    const projection = buildCodeLayerProjection(html);
    const secondButton = projection.nodes.find(
      (node) => node.tag === "button" && node.textSnippet === "Second",
    );

    const patch = applyVisualEdit(html, {
      kind: "style",
      target: { selector: secondButton?.selector ?? "" },
      property: "color",
      value: "#111",
    });

    expect(patch.result.status).toBe("applied");
    expect(patch.content).toContain(
      `<button style="color: #111">Second</button>`,
    );
    expect(patch.content).toContain(`<button>First</button>`);
  });

  it("rejects moving a node into itself or its descendant", () => {
    const html = `<main id="parent"><section id="child"><p>Text</p></section></main>`;
    const patch = applyVisualEdit(html, {
      kind: "moveNode",
      target: { selector: "#parent" },
      anchor: { selector: "#child" },
      placement: "inside",
    });

    expect(patch.result.status).toBe("conflict");
    expect(patch.content).toBe(html);
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
