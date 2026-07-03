import { describe, expect, it } from "vitest";

import {
  applyVisualEdit,
  buildCodeLayerProjection,
  buildCodeLayerTree,
  ensureCodeLayerNodeIdsInHtml,
  moveNodeBetweenDocuments,
  removeCodeLayerNodeFromHtml,
  stripEditorOnlyAttributes,
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
      "responsive-class",
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

  it("marks component instance nodes with componentInstance metadata", () => {
    const html = `
      <section class="flex gap-4">
        <div
          data-agent-native-component="HeroCard"
          data-agent-native-prop-variant="primary"
          data-agent-native-prop-size="lg"
          data-agent-native-node-id="hero-card-1"
          x-data="{ open: false }"
        >Card content</div>
        <div class="plain">No component</div>
      </section>
    `;

    const projection = buildCodeLayerProjection(html);
    const cardNode = projection.nodes.find(
      (node) =>
        node.dataAttributes["data-agent-native-component"] === "HeroCard",
    );
    const plainNode = projection.nodes.find((node) =>
      node.classes.includes("plain"),
    );

    expect(cardNode).toBeTruthy();
    expect(cardNode?.componentInstance).toBeDefined();
    expect(cardNode?.componentInstance?.name).toBe("HeroCard");
    expect(cardNode?.componentInstance?.nodeId).toBe(cardNode?.id);
    expect(cardNode?.componentInstance?.selector).toBe(cardNode?.selector);
    expect(cardNode?.componentInstance?.alpineData).toBe("{ open: false }");
    expect(cardNode?.componentInstance?.props).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "variant", value: "primary" }),
        expect.objectContaining({ name: "size", value: "lg" }),
      ]),
    );

    // Plain nodes must not have componentInstance.
    expect(plainNode?.componentInstance).toBeUndefined();
  });

  it("classifies component-annotated nodes as 'component' in the layer tree", () => {
    const html = `
      <main>
        <div data-agent-native-component="NavBar">Nav</div>
        <div class="content">Content</div>
      </main>
    `;

    const tree = buildCodeLayerTree(buildCodeLayerProjection(html));
    const mainNode = tree[0];
    expect(mainNode).toBeTruthy();
    // The NavBar-annotated div must use the component name and classification.
    const componentChild = mainNode?.children.find(
      (child) => child.type === "component",
    );
    expect(componentChild).toBeTruthy();
    expect(componentChild?.name).toBe("NavBar");
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

  it("classifies canvas primitives by their data-an-primitive kind marker", () => {
    // Canvas primitives (drawn shapes / board objects) are <div>s, which would
    // otherwise classify as "element" (code glyph). The kind marker makes a
    // rectangle render with a rectangle icon, text with a text icon, etc.
    const html = `
      <div data-agent-native-node-id="r1" data-an-primitive="rectangle" style="position:absolute;width:80px;height:40px;background:#2563eb"></div>
      <div data-agent-native-node-id="t1" data-an-primitive="text" style="position:absolute">Label</div>
      <div data-agent-native-node-id="f1" data-an-primitive="frame" style="position:absolute;width:120px;height:80px"></div>
      <div data-agent-native-node-id="e1" data-an-primitive="ellipse" style="position:absolute;width:60px;height:60px;border-radius:50%;background:#2563eb"></div>
    `;
    const tree = buildCodeLayerTree(buildCodeLayerProjection(html));
    expect(tree.map((node) => node.type)).toEqual([
      "shape",
      "text",
      "frame",
      "ellipse",
    ]);
  });

  it("classifies SVG-based vector primitives by their data-an-primitive kind marker", () => {
    // Pen-tool vectors, lines, arrows, polygons, and stars are <svg>s. Without
    // a distinct type they would fall through to "shape" and show a rectangle
    // glyph. The kind marker gives each its own vector/line/arrow/polygon/star
    // classification.
    const html = `
      <svg data-agent-native-node-id="p1" data-an-primitive="path" style="position:absolute"><path d="M 0 0 L 10 10"/></svg>
      <svg data-agent-native-node-id="l1" data-an-primitive="line" style="position:absolute"><path d="M 0 5 L 100 5"/></svg>
      <svg data-agent-native-node-id="a1" data-an-primitive="arrow" style="position:absolute"><path d="M 0 5 L 100 5" marker-end="url(#a)"/></svg>
      <svg data-agent-native-node-id="g1" data-an-primitive="polygon" style="position:absolute"><polygon points="0,0 10,0 5,10"/></svg>
      <svg data-agent-native-node-id="s1" data-an-primitive="star" style="position:absolute"><polygon points="0,0 2,2 4,0"/></svg>
    `;
    const tree = buildCodeLayerTree(buildCodeLayerProjection(html));
    expect(tree.map((node) => node.type)).toEqual([
      "vector",
      "line",
      "arrow",
      "polygon",
      "star",
    ]);
    // Each SVG primitive is a single leaf layer: its internal geometry
    // (<path>/<polygon>) must not be projected as a child layer.
    expect(tree.map((node) => node.children.length)).toEqual([0, 0, 0, 0, 0]);
  });

  it("does not project inline-SVG internals as child layers", () => {
    const html = `
      <div data-agent-native-node-id="logo" style="position:absolute">
        <svg viewBox="0 0 24 24"><g><path d="M0 0h24v24H0z"/><circle cx="12" cy="12" r="6"/></g></svg>
      </div>
    `;
    const tree = buildCodeLayerTree(buildCodeLayerProjection(html));
    const container = tree[0];
    const svg = container?.children.find((child) => child.tag === "svg");
    expect(svg).toBeTruthy();
    expect(svg?.children).toEqual([]);
  });

  it("classifies rectangle/rect data-an-primitive as a generic shape", () => {
    const html = `
      <div data-agent-native-node-id="r1" data-an-primitive="rectangle" style="position:absolute;width:80px;height:40px;background:#2563eb"></div>
      <div data-agent-native-node-id="r2" data-an-primitive="rect" style="position:absolute;width:80px;height:40px;background:#2563eb"></div>
    `;
    const tree = buildCodeLayerTree(buildCodeLayerProjection(html));
    expect(tree.map((node) => node.type)).toEqual(["shape", "shape"]);
  });

  it("classifies circle and oval data-an-primitive variants as ellipse", () => {
    const html = `
      <div data-agent-native-node-id="c1" data-an-primitive="circle" style="position:absolute;width:40px;height:40px;border-radius:50%"></div>
      <div data-agent-native-node-id="o1" data-an-primitive="oval" style="position:absolute;width:80px;height:50px;border-radius:50%"></div>
    `;
    const tree = buildCodeLayerTree(buildCodeLayerProjection(html));
    expect(tree.map((node) => node.type)).toEqual(["ellipse", "ellipse"]);
  });

  it("deduplicates malformed duplicate root ids in the layer tree", () => {
    const html = `
      <section data-agent-native-node-id="dup-root">First</section>
      <section data-agent-native-node-id="dup-root">Second</section>
    `;

    const projection = buildCodeLayerProjection(html);
    const tree = buildCodeLayerTree(projection);

    expect(projection.rootNodeIds).toHaveLength(2);
    expect(new Set(projection.rootNodeIds).size).toBe(1);
    expect(tree).toHaveLength(1);
    expect(new Set(tree.map((node) => node.id)).size).toBe(tree.length);
  });

  it("omits repeated document shell wrappers from layer tree roots", () => {
    const html = `
      <!doctype html>
      <html data-agent-native-node-id="doc">
        <head><title>Home</title></head>
        <body data-agent-native-node-id="body">
          <main data-agent-native-layer-name="Home">
            <h1>Welcome</h1>
          </main>
        </body>
      </html>
      <!doctype html>
      <html data-agent-native-node-id="doc">
        <body data-agent-native-node-id="body">
          <main data-agent-native-layer-name="Checkout">
            <h1>Checkout</h1>
          </main>
        </body>
      </html>
    `;

    const projection = buildCodeLayerProjection(html);
    const tree = buildCodeLayerTree(projection);

    expect(projection.nodes.filter((node) => node.tag === "html")).toHaveLength(
      2,
    );
    expect(tree.map((node) => ({ tag: node.tag, name: node.name }))).toEqual([
      { tag: "main", name: "Home" },
      { tag: "main", name: "Checkout" },
    ]);
    expect(JSON.stringify(tree)).not.toContain('"tag":"html"');
    expect(JSON.stringify(tree)).not.toContain('"tag":"body"');
  });

  it("omits empty unnamed document shell rows from the layer tree", () => {
    const html = `<!doctype html><html><head></head><body></body></html>`;
    const tree = buildCodeLayerTree(buildCodeLayerProjection(html));

    expect(tree).toEqual([]);
  });

  it("keeps explicitly named document shell rows in the layer tree", () => {
    const html = `
      <!doctype html>
      <html data-agent-native-layer-name="Document">
        <body data-agent-native-layer-name="Body">
          <main data-agent-native-layer-name="Home">
            <h1>Welcome</h1>
          </main>
        </body>
      </html>
    `;

    const tree = buildCodeLayerTree(buildCodeLayerProjection(html));

    expect(tree.map((node) => ({ tag: node.tag, name: node.name }))).toEqual([
      { tag: "html", name: "Document" },
    ]);
    expect(
      tree[0]?.children.map((node) => ({ tag: node.tag, name: node.name })),
    ).toEqual([{ tag: "body", name: "Body" }]);
    expect(
      tree[0]?.children[0]?.children.map((node) => ({
        tag: node.tag,
        name: node.name,
      })),
    ).toEqual([{ tag: "main", name: "Home" }]);
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

  it("applies edits from runtime body-rooted selectors against fragment HTML", () => {
    const html = `<div>One</div><div>Two</div><div>Three</div><div>Four</div>`;
    const patch = applyVisualEdit(html, {
      kind: "style",
      target: {
        selector: `body[data-agent-native-node-id="an-runtime"] > div:nth-of-type(4)`,
      },
      property: "color",
      value: "#111",
    });

    expect(patch.result.status).toBe("applied");
    expect(patch.content).toBe(
      `<div>One</div><div>Two</div><div>Three</div><div style="color: #111">Four</div>`,
    );
  });

  it("applies edits from runtime html/body-rooted selectors against fragment HTML", () => {
    const html = `<main><section><button>One</button></section><section><button>Two</button></section></main>`;
    const patch = applyVisualEdit(html, {
      kind: "style",
      target: {
        selector: `html[data-agent-native-node-id="an-doc"] > body[data-agent-native-node-id="an-body"] > main > section:nth-of-type(2) > button`,
      },
      property: "color",
      value: "#111",
    });

    expect(patch.result.status).toBe("applied");
    expect(patch.content).toBe(
      `<main><section><button>One</button></section><section><button style="color: #111">Two</button></section></main>`,
    );
  });

  it("resolves a drifted positional selector via the unique class match", () => {
    // The runtime DOM had `div.target` as the 2nd child after reordering, but
    // in the stored source it is the 3rd child, so strict `:nth-of-type(2)` no
    // longer matches. Resolution should fall back to the unique class match.
    const html = `<section class="list"><div class="row">A</div><div class="row">B</div><div class="target">C</div></section>`;
    const patch = applyVisualEdit(html, {
      kind: "style",
      target: { selector: `section.list > div.target:nth-of-type(2)` },
      property: "color",
      value: "#111",
    });

    expect(patch.result.status).toBe("applied");
    expect(patch.content).toBe(
      `<section class="list"><div class="row">A</div><div class="row">B</div><div class="target" style="color: #111">C</div></section>`,
    );
  });

  it("keeps strict positional resolution when the DOM order is intact", () => {
    // Regression guard: when the positional selector is still valid, the strict
    // pass must win and edit exactly the addressed node, not loosen to the
    // whole set of same-tag siblings.
    const html = `<div>One</div><div>Two</div><div>Three</div><div>Four</div>`;
    const patch = applyVisualEdit(html, {
      kind: "style",
      target: {
        selector: `body[data-agent-native-node-id="an-runtime"] > div:nth-of-type(2)`,
      },
      property: "color",
      value: "#111",
    });

    expect(patch.result.status).toBe("applied");
    expect(patch.content).toBe(
      `<div>One</div><div style="color: #111">Two</div><div>Three</div><div>Four</div>`,
    );
  });

  it("reports an actionable conflict when a drifted positional selector is ambiguous", () => {
    // No source div carries the runtime position, and dropping the position
    // leaves several identical candidates. Surface a clear, actionable conflict
    // instead of silently editing the wrong node.
    const html = `<div>One</div><div>Two</div><div>Three</div>`;
    const patch = applyVisualEdit(html, {
      kind: "style",
      target: {
        selector: `body[data-agent-native-node-id="an-runtime"] > div:nth-of-type(9)`,
      },
      property: "color",
      value: "#111",
    });

    expect(patch.result.status).toBe("conflict");
    expect(patch.result.message).toContain("after ignoring positional");
    expect(patch.content).toBe(html);
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

describe("wrapNodes", () => {
  it("wraps sibling nodes in a new div wrapper at first target position", () => {
    const html = `<main><div data-agent-native-node-id="a">A</div><div data-agent-native-node-id="b">B</div><div data-agent-native-node-id="c">C</div></main>`;
    const patch = applyVisualEdit(html, {
      kind: "wrapNodes",
      targetIds: ["a", "b"],
    });

    expect(patch.result.status).toBe("applied");
    expect(patch.result.changed).toBe(true);
    expect(patch.result.wrapperNodeId).toBeTruthy();
    // Wrapper should contain both targets
    expect(patch.content).toContain(
      `data-agent-native-node-id="${patch.result.wrapperNodeId}"`,
    );
    expect(patch.content).toContain(`data-agent-native-layer-name="Group"`);
    expect(patch.content).toContain(`data-agent-native-node-id="a"`);
    expect(patch.content).toContain(`data-agent-native-node-id="b"`);
    // Wrapper should appear before c
    const wrapperIdx = patch.content.indexOf(
      `data-agent-native-layer-name="Group"`,
    );
    const cIdx = patch.content.indexOf(`data-agent-native-node-id="c"`);
    expect(wrapperIdx).toBeLessThan(cIdx);
    // c is still a direct child of main, not inside the wrapper
    expect(patch.content).toMatch(/<\/div><div data-agent-native-node-id="c">/);
  });

  it("adds autoLayout styles to wrapper and strips absolute positioning from wrapped children", () => {
    const html = `<main><div data-agent-native-node-id="x" style="position: absolute; left: 10px; top: 20px">X</div><div data-agent-native-node-id="y" style="position: absolute; right: 5px">Y</div></main>`;
    const patch = applyVisualEdit(html, {
      kind: "wrapNodes",
      targetIds: ["x", "y"],
      autoLayout: true,
    });

    expect(patch.result.status).toBe("applied");
    expect(patch.content).toContain("display: flex");
    expect(patch.content).toContain("flex-direction: column");
    expect(patch.content).toContain("gap: 8px");
    // Absolute positioning should be stripped from children
    expect(patch.content).not.toContain("position: absolute");
    expect(patch.content).not.toContain("left: 10px");
    expect(patch.content).not.toContain("top: 20px");
    expect(patch.content).not.toContain("right: 5px");
  });

  it("returns unsupported when targets don't share a parent", () => {
    const html = `<main><section><div data-agent-native-node-id="a">A</div></section><div data-agent-native-node-id="b">B</div></main>`;
    const patch = applyVisualEdit(html, {
      kind: "wrapNodes",
      targetIds: ["a", "b"],
    });

    expect(patch.result.status).toBe("unsupported");
    expect(patch.content).toBe(html);
  });

  it("groups non-contiguous same-parent siblings by moving them adjacent to the topmost member first (L6)", () => {
    const html = `<main><div data-agent-native-node-id="a">A</div><div data-agent-native-node-id="b">B</div><div data-agent-native-node-id="c">C</div></main>`;
    const patch = applyVisualEdit(html, {
      kind: "wrapNodes",
      targetIds: ["a", "c"],
    });

    expect(patch.result.status).toBe("applied");
    expect(patch.result.changed).toBe(true);
    expect(patch.result.wrapperNodeId).toBeTruthy();
    // Both non-adjacent targets end up inside the wrapper, adjacent to each other.
    expect(patch.content).toContain(`data-agent-native-node-id="a"`);
    expect(patch.content).toContain(`data-agent-native-node-id="c"`);
    const wrapperIdx = patch.content.indexOf(
      `data-agent-native-node-id="${patch.result.wrapperNodeId}"`,
    );
    const aIdx = patch.content.indexOf(`data-agent-native-node-id="a"`);
    const cIdx = patch.content.indexOf(`data-agent-native-node-id="c"`);
    const bIdx = patch.content.indexOf(`data-agent-native-node-id="b"`);
    expect(wrapperIdx).toBeLessThan(aIdx);
    expect(aIdx).toBeLessThan(cIdx);
    // b (not selected) is left behind in the original parent, outside the wrapper.
    expect(bIdx).toBeGreaterThan(
      patch.content.indexOf("</div>", cIdx) /* end of wrapper's C child */,
    );
  });

  it("returns conflict when a target node id is not found", () => {
    const html = `<main><div data-agent-native-node-id="a">A</div></main>`;
    const patch = applyVisualEdit(html, {
      kind: "wrapNodes",
      targetIds: ["a", "does-not-exist"],
    });

    expect(patch.result.status).toBe("conflict");
    expect(patch.content).toBe(html);
  });

  it("L6: gives a distinct message when targets don't share a parent (not the generic move-failed message)", () => {
    const html = `<main><section><div data-agent-native-node-id="a">A</div></section><div data-agent-native-node-id="b">B</div></main>`;
    const patch = applyVisualEdit(html, {
      kind: "wrapNodes",
      targetIds: ["a", "b"],
    });

    expect(patch.result.status).toBe("unsupported");
    expect(patch.result.message).toMatch(/same parent/i);
  });

  it("L6: gives a distinct message for an empty selection", () => {
    const html = `<main><div data-agent-native-node-id="a">A</div></main>`;
    const patch = applyVisualEdit(html, {
      kind: "wrapNodes",
      targetIds: [],
    });

    expect(patch.result.status).toBe("unsupported");
    expect(patch.result.message).toMatch(/select at least one/i);
  });

  it("L7: names sequential groups Group, Group 2, Group 3 instead of repeating 'Group'", () => {
    const html = `<main><div data-agent-native-node-id="a">A</div><div data-agent-native-node-id="b">B</div><div data-agent-native-node-id="c">C</div><div data-agent-native-node-id="d">D</div></main>`;
    const first = applyVisualEdit(html, {
      kind: "wrapNodes",
      targetIds: ["a", "b"],
    });
    expect(first.result.status).toBe("applied");
    expect(first.content).toContain(`data-agent-native-layer-name="Group"`);

    const second = applyVisualEdit(first.content, {
      kind: "wrapNodes",
      targetIds: ["c", "d"],
    });
    expect(second.result.status).toBe("applied");
    expect(second.content).toContain(`data-agent-native-layer-name="Group 2"`);
  });

  it("L7: computes union bounds for a wrapper when all children are absolutely positioned", () => {
    const html =
      `<main>` +
      `<div data-agent-native-node-id="a" style="position: absolute; left: 10px; top: 20px; width: 100px; height: 50px">A</div>` +
      `<div data-agent-native-node-id="b" style="position: absolute; left: 150px; top: 40px; width: 80px; height: 60px">B</div>` +
      `</main>`;
    const patch = applyVisualEdit(html, {
      kind: "wrapNodes",
      targetIds: ["a", "b"],
    });

    expect(patch.result.status).toBe("applied");
    // Union: left=10, top=20, right=max(110,230)=230, bottom=max(70,100)=100
    expect(patch.content).toContain("position: absolute");
    expect(patch.content).toContain("left: 10px");
    expect(patch.content).toContain("top: 20px");
    expect(patch.content).toContain("width: 220px");
    expect(patch.content).toContain("height: 80px");
    // Children are rebased relative to the new wrapper origin (10, 20):
    // a: left 10-10=0, top 20-20=0; b: left 150-10=140, top 40-20=20.
    expect(patch.content).toContain("left: 0px");
    expect(patch.content).toContain("top: 0px");
    expect(patch.content).toContain("left: 140px");
    expect(patch.content).toContain("top: 20px");
  });

  it("L7: falls back to a flow wrapper (no geometry) when children are not all absolutely positioned", () => {
    const html = `<main><div data-agent-native-node-id="a" style="position: absolute; left: 10px; top: 20px; width: 100px; height: 50px">A</div><div data-agent-native-node-id="b">B</div></main>`;
    const patch = applyVisualEdit(html, {
      kind: "wrapNodes",
      targetIds: ["a", "b"],
    });

    expect(patch.result.status).toBe("applied");
    expect(patch.content).toContain(`data-agent-native-layer-name="Group"`);
    // No union-bounds style block should have been added to the wrapper div itself.
    const wrapperOpenTagMatch = patch.content.match(
      new RegExp(
        `<div data-agent-native-node-id="${patch.result.wrapperNodeId}"[^>]*>`,
      ),
    );
    expect(wrapperOpenTagMatch?.[0]).not.toContain("position: absolute");
  });
});

describe("unwrap", () => {
  it("replaces a wrapper with its children at the wrapper's parent position", () => {
    const html = `<main><div data-agent-native-node-id="wrapper"><span data-agent-native-node-id="a">A</span><span data-agent-native-node-id="b">B</span></div><p>after</p></main>`;
    const patch = applyVisualEdit(html, {
      kind: "unwrap",
      targetId: "wrapper",
    });

    expect(patch.result.status).toBe("applied");
    expect(patch.content).not.toContain(`data-agent-native-node-id="wrapper"`);
    expect(patch.content).toContain(`data-agent-native-node-id="a"`);
    expect(patch.content).toContain(`data-agent-native-node-id="b"`);
    expect(patch.content).toContain("<p>after</p>");
    // Children appear before <p>after</p>
    const aIdx = patch.content.indexOf(`data-agent-native-node-id="a"`);
    const pIdx = patch.content.indexOf("<p>after</p>");
    expect(aIdx).toBeLessThan(pIdx);
  });

  it("round-trips through wrapNodes: wrapping then unwrapping returns equivalent content", () => {
    const original = `<main><div data-agent-native-node-id="a">A</div><div data-agent-native-node-id="b">B</div></main>`;
    const wrapped = applyVisualEdit(original, {
      kind: "wrapNodes",
      targetIds: ["a", "b"],
    });
    expect(wrapped.result.status).toBe("applied");
    const wrapperId = wrapped.result.wrapperNodeId!;

    const unwrapped = applyVisualEdit(wrapped.content, {
      kind: "unwrap",
      targetId: wrapperId,
    });
    expect(unwrapped.result.status).toBe("applied");
    // After round-trip, both original nodes are direct children of <main> again.
    expect(unwrapped.content).toContain(`data-agent-native-node-id="a"`);
    expect(unwrapped.content).toContain(`data-agent-native-node-id="b"`);
    expect(unwrapped.content).not.toContain(
      `data-agent-native-node-id="${wrapperId}"`,
    );
  });

  it("returns conflict when the targetId is not found", () => {
    const html = `<main><div data-agent-native-node-id="a">A</div></main>`;
    const patch = applyVisualEdit(html, {
      kind: "unwrap",
      targetId: "not-here",
    });

    expect(patch.result.status).toBe("conflict");
    expect(patch.content).toBe(html);
  });

  it("L3: returns unsupported for a leaf element with no element children (safety gate)", () => {
    const html = `<main><p data-agent-native-node-id="leaf">Just some text, no child elements</p></main>`;
    const patch = applyVisualEdit(html, {
      kind: "unwrap",
      targetId: "leaf",
    });

    expect(patch.result.status).toBe("unsupported");
    expect(patch.content).toBe(html);
    // The leaf element must be left completely untouched — not spliced away.
    expect(patch.content).toContain(`data-agent-native-node-id="leaf"`);
    expect(patch.content).toContain("Just some text, no child elements");
  });

  it("L3: returns unsupported for an empty/void element", () => {
    const html = `<main><img data-agent-native-node-id="img" src="x.png" /></main>`;
    const patch = applyVisualEdit(html, {
      kind: "unwrap",
      targetId: "img",
    });

    expect(patch.result.status).toBe("unsupported");
    expect(patch.content).toBe(html);
  });

  it("L3: still unwraps a container whose only child is a text-bearing leaf element", () => {
    const html = `<main><div data-agent-native-node-id="wrapper"><p data-agent-native-node-id="child">Hello</p></div></main>`;
    const patch = applyVisualEdit(html, {
      kind: "unwrap",
      targetId: "wrapper",
    });

    expect(patch.result.status).toBe("applied");
    expect(patch.content).not.toContain(`data-agent-native-node-id="wrapper"`);
    expect(patch.content).toContain(`data-agent-native-node-id="child"`);
    expect(patch.content).toContain("Hello");
  });

  it("L3: rebases absolutely-positioned children by the wrapper's own offset on unwrap", () => {
    const html =
      `<main>` +
      `<div data-agent-native-node-id="wrapper" style="position: absolute; left: 50px; top: 30px">` +
      `<div data-agent-native-node-id="child" style="position: absolute; left: 10px; top: 5px; width: 20px; height: 20px">Child</div>` +
      `</div>` +
      `</main>`;
    const patch = applyVisualEdit(html, {
      kind: "unwrap",
      targetId: "wrapper",
    });

    expect(patch.result.status).toBe("applied");
    expect(patch.content).not.toContain(`data-agent-native-node-id="wrapper"`);
    expect(patch.content).toContain(`data-agent-native-node-id="child"`);
    // Child's absolute offset must be rebased by the wrapper's own former
    // offset (50, 30) so it keeps the same absolute screen position once
    // spliced directly into <main>: 10+50=60, 5+30=35.
    expect(patch.content).toContain("left: 60px");
    expect(patch.content).toContain("top: 35px");
  });

  it("L3: does not rebase children when the wrapper itself is not absolutely positioned", () => {
    const html =
      `<main>` +
      `<div data-agent-native-node-id="wrapper">` +
      `<div data-agent-native-node-id="child" style="position: absolute; left: 10px; top: 5px">Child</div>` +
      `</div>` +
      `</main>`;
    const patch = applyVisualEdit(html, {
      kind: "unwrap",
      targetId: "wrapper",
    });

    expect(patch.result.status).toBe("applied");
    expect(patch.content).toContain("left: 10px");
    expect(patch.content).toContain("top: 5px");
  });
});

describe("autoLayout", () => {
  it("enables auto-layout on a container with display:flex + direction + gap", () => {
    const html = `<div data-agent-native-node-id="box"><span>A</span><span>B</span></div>`;
    const patch = applyVisualEdit(html, {
      kind: "autoLayout",
      targetId: "box",
      enabled: true,
      direction: "row",
      gap: "16px",
    });

    expect(patch.result.status).toBe("applied");
    expect(patch.content).toContain("display: flex");
    expect(patch.content).toContain("flex-direction: row");
    expect(patch.content).toContain("gap: 16px");
  });

  it("uses column and 8px defaults when direction and gap are omitted", () => {
    const html = `<div data-agent-native-node-id="box"><span>A</span></div>`;
    const patch = applyVisualEdit(html, {
      kind: "autoLayout",
      targetId: "box",
      enabled: true,
    });

    expect(patch.result.status).toBe("applied");
    expect(patch.content).toContain("flex-direction: column");
    expect(patch.content).toContain("gap: 8px");
  });

  it("strips absolute positioning from direct children when enabling", () => {
    const html = `<div data-agent-native-node-id="container"><div data-agent-native-node-id="child" style="position: absolute; left: 0; top: 0; right: 0; bottom: 0">Child</div></div>`;
    const patch = applyVisualEdit(html, {
      kind: "autoLayout",
      targetId: "container",
      enabled: true,
    });

    expect(patch.result.status).toBe("applied");
    // Container is now flex
    expect(patch.content).toContain("display: flex");
    // Child's absolute positioning is stripped
    expect(patch.content).not.toContain("position: absolute");
    expect(patch.content).not.toContain("left: 0");
    expect(patch.content).not.toContain("top: 0");
    expect(patch.content).not.toContain("right: 0");
    expect(patch.content).not.toContain("bottom: 0");
  });

  it("disables auto-layout by setting display:block", () => {
    const html = `<div data-agent-native-node-id="box" style="display: flex; flex-direction: column; gap: 8px"><span>A</span></div>`;
    const patch = applyVisualEdit(html, {
      kind: "autoLayout",
      targetId: "box",
      enabled: false,
    });

    expect(patch.result.status).toBe("applied");
    expect(patch.content).toContain("display: block");
  });

  it("returns conflict when targetId is not found", () => {
    const html = `<div data-agent-native-node-id="box">A</div>`;
    const patch = applyVisualEdit(html, {
      kind: "autoLayout",
      targetId: "missing",
      enabled: true,
    });

    expect(patch.result.status).toBe("conflict");
    expect(patch.content).toBe(html);
  });
});

describe("moveNodeBetweenDocuments", () => {
  it("removes the node from sourceHtml and inserts it into destHtml body", () => {
    const sourceHtml = `<body><div data-agent-native-node-id="keep">Keep</div><div data-agent-native-node-id="move-me">Move</div></body>`;
    const destHtml = `<body><div data-agent-native-node-id="anchor">Anchor</div></body>`;

    const result = moveNodeBetweenDocuments(sourceHtml, destHtml, {
      nodeId: "move-me",
    });

    expect(result.status).toBe("applied");
    // Node is gone from source
    expect(result.sourceHtml).not.toContain(
      `data-agent-native-node-id="move-me"`,
    );
    expect(result.sourceHtml).toContain(`data-agent-native-node-id="keep"`);
    // Node landed in dest
    expect(result.destHtml).toContain(`data-agent-native-node-id="move-me"`);
    expect(result.destHtml).toContain("Move");
  });

  it("inserts before anchor when placement is before", () => {
    const sourceHtml = `<body><div data-agent-native-node-id="node">Node</div></body>`;
    const destHtml = `<body><div data-agent-native-node-id="anchor">Anchor</div></body>`;

    const result = moveNodeBetweenDocuments(sourceHtml, destHtml, {
      nodeId: "node",
      anchorNodeId: "anchor",
      placement: "before",
    });

    expect(result.status).toBe("applied");
    const nodeIdx = result.destHtml.indexOf(`data-agent-native-node-id="node"`);
    const anchorIdx = result.destHtml.indexOf(
      `data-agent-native-node-id="anchor"`,
    );
    expect(nodeIdx).toBeLessThan(anchorIdx);
  });

  it("inserts after anchor when placement is after", () => {
    const sourceHtml = `<body><div data-agent-native-node-id="node">Node</div></body>`;
    const destHtml = `<body><div data-agent-native-node-id="anchor">Anchor</div></body>`;

    const result = moveNodeBetweenDocuments(sourceHtml, destHtml, {
      nodeId: "node",
      anchorNodeId: "anchor",
      placement: "after",
    });

    expect(result.status).toBe("applied");
    const anchorIdx = result.destHtml.indexOf(
      `data-agent-native-node-id="anchor"`,
    );
    const nodeIdx = result.destHtml.indexOf(`data-agent-native-node-id="node"`);
    expect(anchorIdx).toBeLessThan(nodeIdx);
  });

  it("re-stamps colliding node ids in the moved subtree to be unique in dest", () => {
    const sourceHtml = `<body><div data-agent-native-node-id="dup"><span data-agent-native-node-id="child-dup">Child</span></div></body>`;
    const destHtml = `<body><div data-agent-native-node-id="dup">Existing dup in dest</div></body>`;

    const result = moveNodeBetweenDocuments(sourceHtml, destHtml, {
      nodeId: "dup",
    });

    expect(result.status).toBe("applied");
    // Collect all ids in destHtml
    const allIds = Array.from(
      result.destHtml.matchAll(/data-agent-native-node-id="([^"]+)"/g),
      (m) => m[1],
    );
    // All ids must be unique
    expect(new Set(allIds).size).toBe(allIds.length);
    // The original "dup" from dest must still be present
    expect(allIds).toContain("dup");
  });

  it("returns unsupported when the node is not found in sourceHtml", () => {
    const result = moveNodeBetweenDocuments(
      `<body><div data-agent-native-node-id="a">A</div></body>`,
      `<body></body>`,
      { nodeId: "does-not-exist" },
    );

    expect(result.status).toBe("unsupported");
    expect(result.message).toContain("does-not-exist");
  });

  it("returns unsupported when anchor is not found in destHtml", () => {
    const result = moveNodeBetweenDocuments(
      `<body><div data-agent-native-node-id="node">Node</div></body>`,
      `<body><div data-agent-native-node-id="existing">X</div></body>`,
      { nodeId: "node", anchorNodeId: "not-here" },
    );

    expect(result.status).toBe("unsupported");
    expect(result.message).toContain("not-here");
  });

  it("re-stamps ALL colliding ids in a deeply-nested moved subtree", () => {
    const sourceHtml = `<body><div data-agent-native-node-id="root"><div data-agent-native-node-id="l1"><span data-agent-native-node-id="l3">Deep</span></div></div></body>`;
    const destHtml = `<body><div data-agent-native-node-id="l1">Existing l1</div><span data-agent-native-node-id="l3">Existing l3</span></body>`;

    const result = moveNodeBetweenDocuments(sourceHtml, destHtml, {
      nodeId: "root",
    });

    expect(result.status).toBe("applied");
    const allIds = Array.from(
      result.destHtml.matchAll(/data-agent-native-node-id="([^"]+)"/g),
      (m) => m[1],
    );
    expect(new Set(allIds).size).toBe(allIds.length);
    // Original ids preserved
    expect(allIds).toContain("l1");
    expect(allIds).toContain("l3");
    // No duplicate l1 or l3
    expect(allIds.filter((id) => id === "l1")).toHaveLength(1);
    expect(allIds.filter((id) => id === "l3")).toHaveLength(1);
    // Moved content is present
    expect(result.destHtml).toContain("Deep");
  });
});

describe("autoLayout (regression)", () => {
  it("applies flex styles when target is resolved by projection hash, not data-agent-native-node-id", () => {
    // Regression: setContainerStyle previously searched only by data-agent-native-node-id,
    // silently returning without applying any styles when the node had no such attribute.
    // Now it uses any stable identifier (data-code-layer-id, data-layer-id, HTML id, etc.).
    const html = `<div id="my-box"><span style="position: absolute; left: 5px">X</span></div>`;
    const projection = buildCodeLayerProjection(html);
    const box = projection.nodes.find((n) => n.tag === "div");

    expect(box?.dataAttributes["data-agent-native-node-id"]).toBeUndefined();

    const patch = applyVisualEdit(html, {
      kind: "autoLayout",
      targetId: box!.id,
      enabled: true,
    });

    expect(patch.result.status).toBe("applied");
    expect(patch.content).toContain("display: flex");
    expect(patch.content).toContain("flex-direction: column");
    expect(patch.content).toContain("gap: 8px");
    // Child absolute positioning is stripped
    expect(patch.content).not.toContain("position: absolute");
    expect(patch.content).not.toContain("left: 5px");
  });

  it("strips absolute positioning from multiple direct children when targeting by HTML id", () => {
    const html = `<div id="container"><div style="position: absolute; left: 0; top: 0">A</div><div style="position: absolute; left: 100px; top: 0">B</div></div>`;
    const projection = buildCodeLayerProjection(html);
    const container = projection.nodes.find(
      (n) => n.tag === "div" && !n.parentId,
    );
    expect(container).toBeTruthy();

    const patch = applyVisualEdit(html, {
      kind: "autoLayout",
      targetId: container!.id,
      enabled: true,
      direction: "row",
      gap: "16px",
    });

    expect(patch.result.status).toBe("applied");
    expect(patch.content).toContain("display: flex");
    expect(patch.content).toContain("flex-direction: row");
    expect(patch.content).toContain("gap: 16px");
    expect(patch.content).not.toContain("position: absolute");
    expect(patch.content).not.toContain("left: 0");
    expect(patch.content).not.toContain("left: 100px");
  });

  it("wrapNodes with autoLayout correctly strips each child's own positioning only", () => {
    // Each wrapped child's own absolute positioning is stripped; grandchild positioning is untouched.
    const html = `<main><div data-agent-native-node-id="a" style="position: absolute; left: 10px"><span style="position: absolute; top: 3px">GC</span></div><div data-agent-native-node-id="b" style="position: absolute; right: 5px">B</div></main>`;
    const patch = applyVisualEdit(html, {
      kind: "wrapNodes",
      targetIds: ["a", "b"],
      autoLayout: true,
    });

    expect(patch.result.status).toBe("applied");
    expect(patch.content).not.toContain("left: 10px");
    expect(patch.content).not.toContain("right: 5px");
    // Grandchild positioning is NOT touched by wrapNodes autoLayout (only direct-child strip)
    expect(patch.content).toContain("top: 3px");
  });

  it("applies all three flex styles when element has no stable data attributes and no HTML id", () => {
    // Regression: previously only the first style property (display:flex) was applied because
    // re-parsing after each individual mutation could not re-locate the target element when
    // it carried no data-agent-native-node-id, data-code-layer-id, or HTML id.  All three
    // setContainerStyle calls after the first returned silently with no-op.
    const html = `<div class="container"><span style="position: absolute; left: 5px">X</span></div>`;
    const projection = buildCodeLayerProjection(html);
    const box = projection.nodes.find((n) => n.tag === "div");

    expect(box?.dataAttributes["data-agent-native-node-id"]).toBeUndefined();
    expect(box?.attributes["id"]).toBeUndefined();

    const patch = applyVisualEdit(html, {
      kind: "autoLayout",
      targetId: box!.id,
      enabled: true,
      direction: "row",
      gap: "12px",
    });

    expect(patch.result.status).toBe("applied");
    expect(patch.content).toContain("display: flex");
    expect(patch.content).toContain("flex-direction: row");
    expect(patch.content).toContain("gap: 12px");
    // Child absolute positioning is also stripped
    expect(patch.content).not.toContain("position: absolute");
    expect(patch.content).not.toContain("left: 5px");
  });
});

describe("stripEditorOnlyAttributes", () => {
  it("removes data-agent-native-node-id from simple elements", () => {
    const html = `<div data-agent-native-node-id="an-abc123" class="foo">hello</div>`;
    const result = stripEditorOnlyAttributes(html);
    expect(result).not.toContain("data-agent-native-node-id");
    expect(result).toContain('class="foo"');
    expect(result).toContain("hello");
  });

  it("removes data-agent-native-node-id with single-quoted value", () => {
    const html = `<span data-agent-native-node-id='an-xyz' style="color:red">text</span>`;
    const result = stripEditorOnlyAttributes(html);
    expect(result).not.toContain("data-agent-native-node-id");
    expect(result).toContain('style="color:red"');
  });

  it("strips the attribute from multiple elements", () => {
    const html = [
      `<div data-agent-native-node-id="an-1" id="a">`,
      `  <p data-agent-native-node-id="an-2" class="text-sm">content</p>`,
      `</div>`,
    ].join("\n");
    const result = stripEditorOnlyAttributes(html);
    expect(result).not.toContain("data-agent-native-node-id");
    expect(result).toContain('id="a"');
    expect(result).toContain('class="text-sm"');
  });

  it("preserves data-agent-native-layer-name (developer-authored, not editor-only)", () => {
    const html = `<div data-agent-native-node-id="an-abc" data-agent-native-layer-name="Card">body</div>`;
    const result = stripEditorOnlyAttributes(html);
    expect(result).not.toContain("data-agent-native-node-id");
    expect(result).toContain('data-agent-native-layer-name="Card"');
  });

  it("is idempotent on already-clean source", () => {
    const html = `<section class="p-4"><h1>Title</h1></section>`;
    expect(stripEditorOnlyAttributes(html)).toBe(html);
  });

  it("handles empty string input", () => {
    expect(stripEditorOnlyAttributes("")).toBe("");
  });

  it("does not corrupt adjacent attributes when removing the stamp", () => {
    const html = `<button data-agent-native-node-id="an-z" type="button" class="btn">Click</button>`;
    const result = stripEditorOnlyAttributes(html);
    expect(result).toBe(`<button type="button" class="btn">Click</button>`);
  });
});
