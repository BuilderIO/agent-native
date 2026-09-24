import { describe, expect, it } from "vitest";

import {
  applyVisualEdit,
  buildCodeLayerProjection,
  buildCodeLayerTree,
  clearCodeLayerProjectionCache,
  ensureCodeLayerNodeIdsInHtml,
  findEnclosingTemplateClose,
  hasCanonicalCodeLayerNodeIds,
  moveNodeBetweenDocuments,
  removeCodeLayerNodeFromHtml,
  stripEditorOnlyAttributes,
  wrapBareTextLeavesInHtml,
  type EditIntent,
} from "./code-layer";

describe("code-layer projection cache", () => {
  const html = "<main><h1>Cached</h1></main>";

  it("returns the same projection for an unchanged document", () => {
    clearCodeLayerProjectionCache();
    const first = buildCodeLayerProjection(html);
    const second = buildCodeLayerProjection(html);
    expect(second).toBe(first);
  });

  it("re-projects when the document changes", () => {
    clearCodeLayerProjectionCache();
    const first = buildCodeLayerProjection(html);
    const changed = buildCodeLayerProjection("<main><h1>Edited</h1></main>");
    expect(changed).not.toBe(first);
    expect(
      changed.nodes.some((node) => node.textSnippet?.includes("Edited")),
    ).toBe(true);
  });

  it("keys on the source, not just the html", () => {
    clearCodeLayerProjectionCache();
    const inline = buildCodeLayerProjection(html, {
      source: { kind: "inline-html" },
    });
    const asFile = buildCodeLayerProjection(html, {
      source: { kind: "design-file", fileId: "file-1" },
    });
    expect(asFile).not.toBe(inline);
    expect(asFile.source.fileId).toBe("file-1");
    // A different file id must never reuse another file's projection.
    const otherFile = buildCodeLayerProjection(html, {
      source: { kind: "design-file", fileId: "file-2" },
    });
    expect(otherFile.source.fileId).toBe("file-2");
  });

  it("holds every screen of a large design", () => {
    clearCodeLayerProjectionCache();
    const screens = Array.from(
      { length: 300 },
      (_, i) => `<main><p>screen-${i}</p></main>`,
    );
    const first = screens.map((html) => buildCodeLayerProjection(html));
    screens.forEach((html, i) =>
      expect(buildCodeLayerProjection(html)).toBe(first[i]),
    );
  });

  it("evicts the least recently used document past the size bound", () => {
    clearCodeLayerProjectionCache();
    const first = buildCodeLayerProjection("<main><p>doc-0</p></main>");
    const large = `<main><p>${"x".repeat(16_000_000)}</p></main>`;
    const kept = buildCodeLayerProjection(large);
    expect(buildCodeLayerProjection(large)).toBe(kept);
    expect(buildCodeLayerProjection("<main><p>doc-0</p></main>")).not.toBe(
      first,
    );
  });

  it("keeps a re-read document alive instead of evicting it by insertion age", () => {
    clearCodeLayerProjectionCache();
    const kept = buildCodeLayerProjection("<main><p>keep</p></main>");
    for (let i = 1; i <= 20; i += 1) {
      buildCodeLayerProjection(`<main><p>filler-${i}</p></main>`);
      // Re-reading must refresh recency, or a hot document is evicted by the
      // cold ones streaming past it.
      expect(buildCodeLayerProjection("<main><p>keep</p></main>")).toBe(kept);
    }
  });

  // Every distinct source of the same (here empty) document is its own entry;
  // charging only document chars would let them grow without bound.
  it("evicts entries of one document by source", () => {
    clearCodeLayerProjectionCache();
    const project = (revision: number) =>
      buildCodeLayerProjection("", {
        source: {
          kind: "remote-url",
          url: "http://localhost:3000/",
          revision: `r${revision}`,
        },
      });
    const first = project(0);
    const kept = project(1);
    for (let i = 2; i <= 10_000; i += 1) {
      project(i);
      if (i % 1_000 === 0) expect(project(1)).toBe(kept);
    }
    expect(project(0)).not.toBe(first);
  });
});

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

  it("only aliases stable per-node id attributes in node.selectors, never shared kind/state flags", () => {
    // Regression: node.selectors previously included an attribute selector
    // for EVERY data-* attribute on an element, including non-unique ones
    // like data-an-primitive (shared by every rectangle/frame primitive) and
    // the boolean data-agent-native-hidden/-locked state flags. Design's
    // hidden/locked-layer propagation (codeLayerSelectorAliases in
    // app/pages/design-editor/code-layer-state.ts) treats every entry in
    // node.selectors as a selector that uniquely resolves to that one node,
    // then feeds it straight into the bridge's document-wide
    // `document.querySelectorAll(selector)` (applyHiddenSelectors /
    // isLayerInteractionBlocked). A generic `[data-an-primitive="frame"]`
    // alias there silently hid or blocked interaction on EVERY frame-kind
    // container in the whole screen just because ONE of them was hidden or
    // locked — breaking drag/drop and selection for unrelated siblings.
    const html = `
      <div data-agent-native-node-id="hidden-container" data-an-primitive="frame" data-agent-native-hidden="true"></div>
      <div data-agent-native-node-id="col-container" data-an-primitive="frame"></div>
    `;
    const projection = buildCodeLayerProjection(html);
    const hidden = projection.nodes.find(
      (node) =>
        node.dataAttributes["data-agent-native-node-id"] === "hidden-container",
    );
    const other = projection.nodes.find(
      (node) =>
        node.dataAttributes["data-agent-native-node-id"] === "col-container",
    );
    expect(hidden?.selectors).toContain(
      '[data-agent-native-node-id="hidden-container"]',
    );
    expect(hidden?.selectors).not.toContain('[data-an-primitive="frame"]');
    expect(hidden?.selectors).not.toContain(
      '[data-agent-native-hidden="true"]',
    );
    // The unrelated sibling's own selectors must never resolve back to the
    // hidden node's selector set either.
    expect(other?.selectors).not.toContain('[data-an-primitive="frame"]');
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

  it("keeps names from the legacy .fig layer-name attribute", () => {
    const projection = buildCodeLayerProjection(
      '<body><section data-agent-native-node-id="legacy" layer-name="Legacy hero"><h1>Fallback text</h1></section></body>',
    );
    const section = projection.nodes.find(
      (node) => node.dataAttributes["data-agent-native-node-id"] === "legacy",
    );

    expect(section).toMatchObject({
      layerName: "Legacy hero",
      layerNameSource: "attribute",
      layerNameAttribute: "layer-name",
    });
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
    expect(cardNode?.componentInstance?.instanceId).toBe("hero-card-1");
    expect(cardNode?.componentInstance?.nodeId).toBe("hero-card-1");
    expect(cardNode?.componentInstance?.nodeId).toBe(
      cardNode?.dataAttributes["data-agent-native-node-id"],
    );
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

  it("keeps explicit human layer names ahead of component identifiers", () => {
    const html = `
      <main>
        <div data-agent-native-node-id="main" data-agent-native-layer-name="Play button" data-agent-native-component="PlayButton" data-agent-native-component-id="cmp-play"></div>
        <div data-agent-native-node-id="default" data-agent-native-layer-name="Play button" data-agent-native-component="PlayButton" data-agent-native-component-ref="cmp-play"></div>
        <div data-agent-native-node-id="renamed" data-agent-native-layer-name="Play button instance" data-agent-native-component="PlayButton" data-agent-native-component-ref="cmp-play"></div>
      </main>
    `;

    const tree = buildCodeLayerTree(buildCodeLayerProjection(html));
    const componentNodes = tree[0]?.children ?? [];
    expect(componentNodes.map((node) => node.name)).toEqual([
      "Play button",
      "Play button",
      "Play button instance",
    ]);
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

  it("classifies explicit Cmd+G wrappers as groups without changing frame identity", () => {
    const html = `
      <div data-agent-native-node-id="group" data-agent-native-group="true" style="position:absolute">
        <div data-agent-native-node-id="child" data-an-primitive="rectangle" style="position:absolute;width:80px;height:40px;background:#2563eb"></div>
      </div>
      <div data-agent-native-node-id="frame" data-an-primitive="frame" style="position:absolute;width:120px;height:80px"></div>
    `;
    const tree = buildCodeLayerTree(buildCodeLayerProjection(html));

    expect(tree.map((node) => node.type)).toEqual(["group", "frame"]);
    expect(tree[0]?.children.map((node) => node.type)).toEqual(["shape"]);
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

  it("classifies an unmarked svg as a generic shape", () => {
    const html = `
      <div data-agent-native-node-id="icon" style="position:absolute;width:24px;height:24px">
        <svg data-agent-native-node-id="v1" data-agent-native-layer-name="Vector" viewBox="0 0 20 20" style="position:absolute"><path d="M0 0 L20 20"/></svg>
      </div>
    `;
    const tree = buildCodeLayerTree(buildCodeLayerProjection(html));
    expect(tree[0]?.children.map((node) => node.type)).toEqual(["shape"]);
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

  it("keeps malformed duplicate ids separate in the layer tree", () => {
    const html = `
      <section data-agent-native-node-id="dup-root">First</section>
      <section data-agent-native-node-id="dup-root">Second</section>
    `;

    const projection = buildCodeLayerProjection(html);
    const tree = buildCodeLayerTree(projection);

    expect(projection.rootNodeIds).toHaveLength(2);
    expect(new Set(projection.rootNodeIds).size).toBe(2);
    expect(tree).toHaveLength(2);
    expect(new Set(tree.map((node) => node.id)).size).toBe(2);
    expect(tree.map(({ id }) => id)).toEqual(projection.rootNodeIds);
    expect(projection.nodes.map(({ textSnippet }) => textSnippet)).toContain(
      "First",
    );
    expect(projection.nodes.map(({ textSnippet }) => textSnippet)).toContain(
      "Second",
    );
  });

  it("builds exact positional paths for duplicate authored ids", () => {
    const html =
      '<main><button id="shared">First</button><button id="shared">Second</button></main>';
    const projection = buildCodeLayerProjection(html);
    const first = projection.nodes.find(
      (node) => node.tag === "button" && node.textSnippet === "First",
    );
    const second = projection.nodes.find(
      (node) => node.tag === "button" && node.textSnippet === "Second",
    );

    expect(first?.path).toContain(":nth-of-type(1)");
    expect(second?.path).toContain(":nth-of-type(2)");
    expect(first?.path).not.toBe(second?.path);

    const patch = applyVisualEdit(html, {
      kind: "style",
      target: { selector: second?.path ?? "" },
      property: "color",
      value: "#111",
    });

    expect(patch.result.status).toBe("applied");
    expect(patch.content).toBe(
      '<main><button id="shared">First</button><button id="shared" style="color: #111">Second</button></main>',
    );
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

  it("omits a named document shell too, since a screen IS its body", () => {
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

    // The screen frame carries the document's fill, stroke and effects now, so
    // a shell row would only repeat the screen under a second name.
    expect(tree.map((node) => ({ tag: node.tag, name: node.name }))).toEqual([
      { tag: "main", name: "Home" },
    ]);
    expect(JSON.stringify(tree)).not.toContain('"tag":"html"');
    expect(JSON.stringify(tree)).not.toContain('"tag":"body"');
  });
});

describe("code layer projection of a drawn vector", () => {
  const html =
    `<body><svg data-agent-native-node-id="pen-1" data-an-primitive="path" ` +
    `style="position:absolute;left:10px;top:10px;background-color:#782323;border-width:1px">` +
    `<path d="M 0 0 L 80 60 Z" fill="rgb(218 218 218)" stroke="none" stroke-width="2"/></svg></body>`;

  function vectorNode() {
    const projection = buildCodeLayerProjection(html);
    const node = projection.nodes.find(
      (candidate) => candidate.dataAttributes["data-an-primitive"] === "path",
    );
    if (!node) throw new Error("vector node missing from projection");
    return node;
  }

  it("carries the shape child's paint on the addressable wrapper node", () => {
    // The child is skipped by hasSvgAncestor and has no node id, so a reader
    // that only sees the wrapper would report a shape with no fill at all.
    expect(vectorNode().style).toMatchObject({
      fill: "rgb(218 218 218)",
      stroke: "none",
      "stroke-width": "2",
    });
  });

  it("keeps data-an-primitive so a projection-only selection stays a vector", () => {
    expect(vectorNode().dataAttributes["data-an-primitive"]).toBe("path");
  });

  it("projects endpoint values and persists marker-start/marker-end edits", () => {
    const withEndpoints = html
      .replace(
        'style="position:absolute;left:10px;top:10px;background-color:#782323;border-width:1px"',
        'style="position:absolute;left:10px;top:10px;--an-vector-start-point:diamond;--an-vector-end-point:circle"',
      )
      .replace(
        '<path d="M 0 0 L 80 60 Z"',
        '<defs data-an-vector-endpoints="true"><marker id="pen-1-vector-marker-start"/></defs><path marker-start="url(#pen-1-vector-marker-start)" marker-end="url(#pen-1-vector-marker-end)" d="M 0 0 L 80 60 Z"',
      );
    const projected = buildCodeLayerProjection(withEndpoints).nodes.find(
      (node) => node.dataAttributes["data-agent-native-node-id"] === "pen-1",
    );
    expect(projected?.style).toMatchObject({
      "--an-vector-start-point": "diamond",
      "--an-vector-end-point": "circle",
    });

    const patch = applyVisualEdit(withEndpoints, {
      kind: "style",
      target: { nodeId: "pen-1" },
      property: "--an-vector-end-point",
      value: "triangle",
    });
    expect(patch.result.status).toBe("applied");
    expect(patch.content).toContain("--an-vector-end-point: triangle");
    expect(patch.content).toContain(
      'marker-end="url(#pen-1-vector-marker-end)"',
    );
    expect(patch.content).toContain('data-an-vector-endpoints="true"');
    expect(patch.content).toContain('d="M 0 0 L 10 5 L 0 10 z"');
  });

  it("supports none and round endpoint values without leaving stale markers", () => {
    const content =
      '<svg data-agent-native-node-id="line-1" data-an-primitive="line" style="--an-vector-end-point:triangle"><path marker-end="url(#line-1-vector-marker-end)" d="M 0 5 L 80 5"/></svg>';
    const none = applyVisualEdit(content, {
      kind: "style",
      target: { nodeId: "line-1" },
      property: "--an-vector-end-point",
      value: "none",
    });
    expect(none.result.status).toBe("applied");
    expect(none.content).not.toContain("marker-end=");

    const round = applyVisualEdit(none.content, {
      kind: "style",
      target: { nodeId: "line-1" },
      property: "--an-vector-start-point",
      value: "round",
    });
    expect(round.result.status).toBe("applied");
    expect(round.content).toContain(
      'marker-start="url(#line-1-vector-marker-start)"',
    );
    expect(round.content).toContain(
      '<circle cx="5" cy="5" r="4" fill="context-stroke"/>',
    );
  });

  it("removes endpoint styles through the structural marker rewrite", () => {
    const base =
      '<svg data-agent-native-node-id="line-1" data-an-primitive="line"><path d="M 0 5 L 80 5"/></svg>';
    const withEndpoints = applyVisualEdit(
      applyVisualEdit(base, {
        kind: "style",
        target: { nodeId: "line-1" },
        property: "--an-vector-start-point",
        value: "diamond",
      }).content,
      {
        kind: "style",
        target: { nodeId: "line-1" },
        property: "--an-vector-end-point",
        value: "circle",
      },
    );
    expect(withEndpoints.result.status).toBe("applied");

    const removed = applyVisualEdit(withEndpoints.content, {
      kind: "style",
      target: { nodeId: "line-1" },
      property: "--an-vector-end-point",
      operation: "remove",
    } as EditIntent);

    expect(removed.result.status).toBe("applied");
    expect(removed.content).toContain("--an-vector-end-point: none");
    expect(removed.content).not.toContain("marker-end=");
    expect(removed.content).not.toContain("line-1-vector-marker-end");
    expect(removed.content).toContain(
      'marker-start="url(#line-1-vector-marker-start)"',
    );
  });

  it("rejects responsive endpoint edits without mutating source or marker DOM", () => {
    const content =
      '<svg data-agent-native-node-id="line-1" data-an-primitive="line"><path d="M 0 5 L 80 5"/></svg>';
    const patch = applyVisualEdit(content, {
      kind: "breakpoint-style",
      target: { nodeId: "line-1" },
      maxWidthPx: 809,
      property: "--an-vector-end-point",
      value: "circle",
    } as EditIntent);

    expect(patch.result.status).toBe("unsupported");
    expect(patch.content).toBe(content);
    expect(patch.content).not.toContain("data-agent-native-breakpoints");
  });
});

describe("applyVisualEdit vector paint", () => {
  const html =
    `<body><svg data-agent-native-node-id="pen-1" data-an-primitive="path" ` +
    `style="position:absolute;left:10px;top:10px;width:80px;height:60px">` +
    `<path d="M 0 0 L 80 60 Z" fill="rgb(218 218 218)" stroke="none"/></svg></body>`;

  it("paints the shape child, not the svg bounding box", () => {
    const patch = applyVisualEdit(html, {
      kind: "style",
      target: { nodeId: "pen-1" },
      property: "fill",
      value: "#ff0000",
    });

    const path = patch.content.slice(patch.content.indexOf("<path"));

    expect(patch.result.status).toBe("applied");
    expect(path).toContain(`style="fill: #ff0000"`);
    expect(
      patch.content.slice(0, patch.content.indexOf("<path")),
    ).not.toContain("fill");
  });

  it("wins over the child's own fill presentation attribute", () => {
    const patch = applyVisualEdit(html, {
      kind: "style",
      target: { nodeId: "pen-1" },
      property: "stroke",
      value: "#0000ff",
    });
    const path = patch.content.slice(patch.content.indexOf("<path"));

    // A presentation attribute loses to any CSS declaration on the same
    // element, so the stale `stroke="none"` alongside it is inert.
    expect(path).toContain(`style="stroke: #0000ff"`);
    expect(path.indexOf(`stroke="none"`)).toBeGreaterThan(-1);
  });

  it("materializes vector linear gradients as SVG paint servers and reads them back", () => {
    const value =
      "linear-gradient(45deg, rgba(255, 0, 0, 0.5) 0%, #0000ff 100%)";
    const gradient = applyVisualEdit(html, {
      kind: "style",
      target: { nodeId: "pen-1" },
      property: "stroke",
      value,
    });

    expect(gradient.result.status).toBe("applied");
    expect(gradient.content).toContain('data-an-vector-stroke-gradient=""');
    expect(gradient.content).toContain(
      'style="stroke: url(#pen-1-stroke-gradient)"',
    );
    expect(gradient.content).toContain(
      'stop-color="rgb(255, 0, 0)" stop-opacity="0.5"',
    );
    expect(gradient.content).toContain(`--an-vector-stroke-gradient: ${value}`);
    expect(
      buildCodeLayerProjection(gradient.content).nodes.find(
        (node) => node.dataAttributes["data-agent-native-node-id"] === "pen-1",
      )?.style["--an-vector-stroke-gradient"],
    ).toBe(value);

    const updated = applyVisualEdit(gradient.content, {
      kind: "style",
      target: { nodeId: "pen-1" },
      property: "stroke",
      value: "radial-gradient(circle at center, #ff0000 0%, #0000ff 100%)",
    });
    expect(updated.result.status).toBe("applied");
    expect(updated.content).toContain("<radialGradient");
    expect(updated.content).toContain('cx="40" cy="30" r="50"');
    expect(updated.content).not.toContain("<linearGradient");

    const solid = applyVisualEdit(updated.content, {
      kind: "style",
      target: { nodeId: "pen-1" },
      property: "stroke",
      value: "#00ff00",
    });
    expect(solid.result.status).toBe("applied");
    expect(solid.content).not.toContain("data-an-vector-stroke-gradient");
    expect(solid.content).not.toContain("--an-vector-stroke-gradient");
    expect(solid.content).toContain('style="stroke: #00ff00"');
  });

  it("materializes vector fill gradients as SVG paint servers and clears them on solid paint", () => {
    const value = "linear-gradient(90deg, #ff0000 0%, #0000ff 100%)";
    const gradient = applyVisualEdit(html, {
      kind: "style",
      target: { nodeId: "pen-1" },
      property: "fill",
      value,
    });

    expect(gradient.result.status).toBe("applied");
    expect(gradient.content).toContain('data-an-vector-fill-gradient=""');
    expect(gradient.content).toContain(
      'style="fill: url(#pen-1-fill-gradient)"',
    );
    expect(gradient.content).toContain(`--an-vector-fill-gradient: ${value}`);
    expect(
      buildCodeLayerProjection(gradient.content).nodes.find(
        (node) => node.dataAttributes["data-agent-native-node-id"] === "pen-1",
      )?.style["--an-vector-fill-gradient"],
    ).toBe(value);
    expect(gradient.content).toContain('stroke="none"');
    expect(gradient.content).not.toContain("data-an-vector-stroke-gradient");

    const updated = applyVisualEdit(gradient.content, {
      kind: "style",
      target: { nodeId: "pen-1" },
      property: "fill",
      value: "radial-gradient(circle at center, #ff0000 0%, #0000ff 100%)",
    });
    expect(updated.result.status).toBe("applied");
    expect(updated.content).toContain("<radialGradient");
    expect(updated.content).not.toContain("<linearGradient");

    const solid = applyVisualEdit(updated.content, {
      kind: "style",
      target: { nodeId: "pen-1" },
      property: "fill",
      value: "#00ff00",
    });
    expect(solid.result.status).toBe("applied");
    expect(solid.content).not.toContain("data-an-vector-fill-gradient");
    expect(solid.content).not.toContain("--an-vector-fill-gradient");
    expect(solid.content).not.toContain('id="pen-1-fill-gradient"');
    expect(solid.content).toContain('style="fill: #00ff00"');
    expect(solid.content).toContain('stroke="none"');
  });

  it("reuses the fill defs container without disturbing stroke or sibling gradients", () => {
    const stroke = applyVisualEdit(html, {
      kind: "style",
      target: { nodeId: "pen-1" },
      property: "stroke",
      value: "linear-gradient(0deg, #111111 0%, #eeeeee 100%)",
    });
    const withFill = applyVisualEdit(stroke.content, {
      kind: "style",
      target: { nodeId: "pen-1" },
      property: "fill",
      value: "linear-gradient(90deg, #ff0000 0%, #0000ff 100%)",
    });

    expect(withFill.result.status).toBe("applied");
    expect(
      withFill.content.match(/data-an-vector-fill-gradient/g),
    ).toHaveLength(1);
    expect(withFill.content).toContain('data-an-vector-stroke-gradient=""');
    expect(withFill.content).toContain("stroke: url(#pen-1-stroke-gradient)");
    expect(withFill.content).toContain("fill: url(#pen-1-fill-gradient)");

    const multiShape =
      '<body><svg data-agent-native-node-id="pasted" data-an-primitive="pasted-svg" viewBox="0 0 100 60" style="width:100px;height:60px"><path data-agent-native-node-id="shape-a" d="M0 0h40v60z" fill="#aaa" /><path data-agent-native-node-id="shape-b" d="M60 0h40v60z" fill="#bbb" /></svg></body>';
    const firstFill = applyVisualEdit(multiShape, {
      kind: "style",
      target: { nodeId: "shape-a" },
      property: "fill",
      value: "linear-gradient(90deg, #ff0000 0%, #0000ff 100%)",
    });
    const secondFill = applyVisualEdit(firstFill.content, {
      kind: "style",
      target: { nodeId: "shape-b" },
      property: "fill",
      value: "radial-gradient(circle at center, #00ff00 0%, #ffffff 100%)",
    });
    expect(secondFill.result.status).toBe("applied");
    expect(
      secondFill.content.match(/<defs[^>]*data-an-vector-fill-gradient/g),
    ).toHaveLength(1);
    expect(secondFill.content).toContain("fill: url(#pasted-fill-gradient)");
    expect(secondFill.content).toContain("fill: url(#pasted-fill-gradient-2)");
    expect(secondFill.content).toContain("<linearGradient");
    expect(secondFill.content).toContain("<radialGradient");
  });

  it("clears fill gradient metadata when a pasted vector changes from one shape to several and back", () => {
    const oneShape =
      '<body><svg data-agent-native-node-id="pasted" data-an-primitive="pasted-svg" viewBox="0 0 100 60" style="width:100px;height:60px"><g><path data-agent-native-node-id="shape-a" d="M0 0h40v60z" fill="#aaa" /></g></svg></body>';
    const rootOwned = applyVisualEdit(oneShape, {
      kind: "style",
      target: { nodeId: "shape-a" },
      property: "fill",
      value: "linear-gradient(90deg, #ff0000 0%, #0000ff 100%)",
    });
    expect(rootOwned.result.status).toBe("applied");
    expect(rootOwned.content).toContain(
      "--an-vector-fill-gradient: linear-gradient(90deg, #ff0000 0%, #0000ff 100%)",
    );

    const nowMultiple = rootOwned.content.replace(
      "</g></svg>",
      '<path data-agent-native-node-id="shape-b" d="M60 0h40v60z" fill="#bbb" /></g></svg>',
    );
    const shapeOwned = applyVisualEdit(nowMultiple, {
      kind: "style",
      target: { nodeId: "shape-a" },
      property: "fill",
      value: "radial-gradient(circle at center, #ff0000 0%, #0000ff 100%)",
    });
    expect(shapeOwned.result.status).toBe("applied");
    expect(shapeOwned.content).not.toMatch(
      /<svg[^>]*--an-vector-fill-gradient:/,
    );
    expect(
      shapeOwned.content.match(/--an-vector-fill-gradient:/g),
    ).toHaveLength(1);

    const backToOne = shapeOwned.content.replace(
      /<path data-agent-native-node-id="shape-b"[^>]*\s*\/>/,
      "",
    );
    const solid = applyVisualEdit(backToOne, {
      kind: "style",
      target: { nodeId: "shape-a" },
      property: "fill",
      value: "#00ff00",
    });
    expect(solid.result.status).toBe("applied");
    expect(solid.content).not.toContain("--an-vector-fill-gradient");
    expect(solid.content).not.toContain("data-an-vector-fill-gradient");
  });

  it("preserves CSS corner direction and interpolates omitted stop positions", () => {
    const gradient = applyVisualEdit(html, {
      kind: "style",
      target: { nodeId: "pen-1" },
      property: "stroke",
      value:
        "linear-gradient(to top right, #000000 0%, #ff0000, #00ff00 80%, #0000ff, #ffffff 100%)",
    });

    expect(gradient.result.status).toBe("applied");
    expect(gradient.content).toContain('x1="0" y1="60" x2="80" y2="0"');
    expect(gradient.content).toContain('offset="40%"');
    expect(gradient.content).toContain('offset="80%"');
    expect(gradient.content).toContain('offset="90%"');
  });

  it("keeps an off-center radial gradient's farthest-corner geometry", () => {
    const gradient = applyVisualEdit(html, {
      kind: "style",
      target: { nodeId: "pen-1" },
      property: "stroke",
      value: "radial-gradient(circle at right top, #000000 0%, #ffffff 100%)",
    });

    expect(gradient.result.status).toBe("applied");
    expect(gradient.content).toContain('cx="80" cy="0" r="100"');
  });

  it("refuses unsupported Oklab stroke interpolation without changing source", () => {
    const result = applyVisualEdit(html, {
      kind: "style",
      target: { nodeId: "pen-1" },
      property: "stroke",
      value: "linear-gradient(45deg in oklab, red 0%, blue 100%)",
    });

    expect(result.result.status).toBe("unsupported");
    expect(result.content).toBe(html);
  });

  it("does not mistake diamond or angular picker gradients for radial strokes", () => {
    for (const value of [
      "radial-gradient(ellipse closest-side at center, red 0%, blue 100%)",
      "conic-gradient(from 90deg at center, red 0%, blue 100%)",
    ]) {
      const result = applyVisualEdit(html, {
        kind: "style",
        target: { nodeId: "pen-1" },
        property: "stroke",
        value,
      });
      expect(result.result.status).toBe("unsupported");
      expect(result.content).toBe(html);
    }
  });

  it("preserves vector opacity and authored SVG ids when adding a gradient", () => {
    const styled = html
      .replace("height:60px", "height:60px;opacity:0.7")
      .replace('stroke="none"/>', 'stroke="none" stroke-opacity="0.4"/>')
      .replace(
        "</body>",
        '<svg><defs><linearGradient id="pen-1-stroke-gradient"/></defs></svg></body>',
      );
    const result = applyVisualEdit(styled, {
      kind: "style",
      target: { nodeId: "pen-1" },
      property: "stroke",
      value: "linear-gradient(90deg, #ff0000 0%, #0000ff 100%)",
    });

    expect(result.result.status).toBe("applied");
    expect(result.content).toContain('id="pen-1-stroke-gradient-2"');
    expect(result.content).toContain('id="pen-1-stroke-gradient"');
    expect(result.content).toContain("opacity:0.7");
    expect(result.content).toContain('stroke-opacity="0.4"');
  });

  it("persists inside and outside vector strokes with logical weight", () => {
    const overflowHidden = html.replace(
      'style="position:absolute;',
      'style="overflow:hidden !important;position:absolute;',
    );
    const color = applyVisualEdit(overflowHidden, {
      kind: "style",
      target: { nodeId: "pen-1" },
      property: "stroke",
      value: "#0000ff",
    });
    const width = applyVisualEdit(color.content, {
      kind: "style",
      target: { nodeId: "pen-1" },
      property: "stroke-width",
      value: "3px",
    });
    const inside = applyVisualEdit(width.content, {
      kind: "style",
      target: { nodeId: "pen-1" },
      property: "--an-vector-stroke-position",
      value: "inside",
    });

    expect(inside.result.status).toBe("applied");
    expect(inside.content).toContain('data-an-vector-stroke-position="inside"');
    expect(inside.content).toContain('data-an-vector-stroke-overlay=""');
    expect(inside.content).toContain(
      "clip-path: url(#an-vector-stroke-pen-1-inside)",
    );
    expect(inside.content).toContain("stroke-width: 6px");
    const projected = buildCodeLayerProjection(inside.content).nodes.find(
      (node) => node.dataAttributes["data-agent-native-node-id"] === "pen-1",
    );
    expect(projected?.style).toMatchObject({
      stroke: "#0000ff",
      "stroke-width": "3px",
      "--an-vector-stroke-position": "inside",
      "--an-vector-stroke-can-align": "true",
    });

    const outside = applyVisualEdit(inside.content, {
      kind: "style",
      target: { nodeId: "pen-1" },
      property: "--an-vector-stroke-position",
      value: "outside",
    });
    expect(outside.result.status).toBe("applied");
    expect(outside.content).toContain(
      'data-an-vector-stroke-position="outside"',
    );
    expect(outside.content).toContain(
      "mask: url(#an-vector-stroke-pen-1-outside)",
    );
    expect(outside.content).toContain('mask-type="luminance"');
    expect(outside.content).toContain("overflow: visible !important");
    expect(outside.content).toContain(
      'data-an-vector-stroke-original-overflow="hidden"',
    );
    expect(outside.content).toContain(
      'data-an-vector-stroke-original-overflow-priority="important"',
    );
    expect(
      outside.content.match(/data-an-vector-stroke-overlay=""/g),
    ).toHaveLength(1);

    const center = applyVisualEdit(outside.content, {
      kind: "style",
      target: { nodeId: "pen-1" },
      property: "--an-vector-stroke-position",
      value: "center",
    });
    expect(center.result.status).toBe("applied");
    expect(center.content).toContain("overflow: hidden !important");
    expect(center.content).not.toContain(
      "data-an-vector-stroke-original-overflow=",
    );

    const resized = applyVisualEdit(outside.content, {
      kind: "style",
      target: { nodeId: "pen-1" },
      property: "stroke-width",
      value: "4px",
    });
    expect(resized.result.status).toBe("applied");
    expect(resized.content).toContain('data-an-vector-logical-width="4px"');
    expect(resized.content).toContain("stroke-width: 8px");
    expect(resized.content).toContain(
      'x="-16" y="-16" width="332" height="182"',
    );

    const mitered = applyVisualEdit(resized.content, {
      kind: "style",
      target: { nodeId: "pen-1" },
      property: "stroke-miterlimit",
      value: "10",
    });
    expect(mitered.result.status).toBe("applied");
    expect(mitered.content).toContain("stroke-miterlimit: 10");
    expect(mitered.content).toContain(
      'x="-40" y="-40" width="380" height="230"',
    );
  });

  it("rejects alignment for an open vector path", () => {
    const openPath = html.replace("L 80 60 Z", "L 80 60");
    const patch = applyVisualEdit(openPath, {
      kind: "style",
      target: { nodeId: "pen-1" },
      property: "--an-vector-stroke-position",
      value: "inside",
    });

    expect(patch.result.status).toBe("unsupported");
    expect(patch.content).toBe(openPath);
  });

  it("rejects an open path tagged as a polygon", () => {
    const content =
      '<svg data-agent-native-node-id="open-polygon" data-an-primitive="polygon" ' +
      'viewBox="0 0 100 80"><path d="M 0 0 L 80 60" fill="none" ' +
      'stroke="#000000" stroke-width="2"/></svg>';
    const patch = applyVisualEdit(content, {
      kind: "style",
      target: { nodeId: "open-polygon" },
      property: "--an-vector-stroke-position",
      value: "outside",
    });

    expect(patch.result.status).toBe("unsupported");
    expect(patch.content).toBe(content);
  });

  it("preserves dash offset and miter limit on the aligned stroke", () => {
    const patch = applyVisualEdit(html, {
      kind: "style",
      target: { nodeId: "pen-1" },
      property: "--an-vector-stroke-position",
      value: "outside",
      stroke: "#123456",
      strokeWidth: "3px",
      strokeDasharray: "8 2",
      strokeDashoffset: "-3px",
      strokeMiterlimit: "9",
    });
    const overlay = patch.content.match(
      /<use[^>]*data-an-vector-stroke-overlay=""[^>]*>/,
    )?.[0];

    expect(patch.result.status).toBe("applied");
    expect(overlay).toContain("stroke-dasharray: 8 2");
    expect(overlay).toContain("stroke-dashoffset: -3px");
    expect(overlay).toContain("stroke-miterlimit: 9");
  });

  it("preserves the vector shape opacity on the aligned stroke", () => {
    const patch = applyVisualEdit(html, {
      kind: "style",
      target: { nodeId: "pen-1" },
      property: "--an-vector-stroke-position",
      value: "outside",
      opacity: "0.5",
    });
    const overlay = patch.content.match(
      /<use[^>]*data-an-vector-stroke-overlay=""[^>]*>/,
    )?.[0];
    const node = buildCodeLayerProjection(patch.content).nodes.find(
      (candidate) =>
        candidate.dataAttributes["data-agent-native-node-id"] === "pen-1",
    );

    expect(patch.result.status).toBe("applied");
    expect(overlay).toContain("opacity: 0.5");
    expect(node?.style.vectorOpacity).toBe("0.5");
  });

  it("falls back to shape opacity when refreshing a legacy overlay", () => {
    const styledShape = html.replace(
      "<path d=",
      '<path style="opacity: 0.5" d=',
    );
    const outside = applyVisualEdit(styledShape, {
      kind: "style",
      target: { nodeId: "pen-1" },
      property: "--an-vector-stroke-position",
      value: "outside",
    });
    const legacyOverlay = outside.content.replace("opacity: 0.5; ", "");
    const refreshed = applyVisualEdit(legacyOverlay, {
      kind: "style",
      target: { nodeId: "pen-1" },
      property: "--an-vector-stroke-position",
      value: "center",
    });
    const overlay = refreshed.content.match(
      /<use[^>]*data-an-vector-stroke-overlay=""[^>]*>/,
    )?.[0];

    expect(outside.result.status).toBe("applied");
    expect(refreshed.result.status).toBe("applied");
    expect(overlay).toContain("opacity: 0.5");
  });

  it("restores an absent inline overflow after outside alignment", () => {
    const withCssOverflow =
      '<style>svg[data-agent-native-node-id="pen-1"]{overflow:hidden!important}</style>' +
      html;
    const outside = applyVisualEdit(withCssOverflow, {
      kind: "style",
      target: { nodeId: "pen-1" },
      property: "--an-vector-stroke-position",
      value: "outside",
    });
    const center = applyVisualEdit(outside.content, {
      kind: "style",
      target: { nodeId: "pen-1" },
      property: "--an-vector-stroke-position",
      value: "center",
    });
    const svg = center.content.match(/<svg\b[^>]*>/)?.[0];

    expect(outside.result.status).toBe("applied");
    expect(outside.content).toContain(
      'data-an-vector-stroke-original-overflow=""',
    );
    expect(outside.content).toContain("overflow: visible !important");
    expect(center.result.status).toBe("applied");
    expect(svg).not.toContain("overflow:");
    expect(center.content).not.toContain(
      "data-an-vector-stroke-original-overflow=",
    );
  });

  it("pads outside masks for the doubled stroke and acute miter joins", () => {
    const patch = applyVisualEdit(html, {
      kind: "style",
      target: { nodeId: "pen-1" },
      property: "--an-vector-stroke-position",
      value: "outside",
      strokeWidth: "3px",
      strokeMiterlimit: "9",
    });

    expect(patch.result.status).toBe("applied");
    expect(patch.content).toContain('x="-27" y="-27" width="354" height="204"');
  });

  it("uses computed transform on the geometry proxy without duplicating its transform attribute", () => {
    const transformed = html.replace(
      '<path d="M 0 0 L 80 60 Z"',
      '<path transform="translate(4 5)" d="M 0 0 L 80 60 Z"',
    );
    const patch = applyVisualEdit(transformed, {
      kind: "style",
      target: { nodeId: "pen-1" },
      property: "--an-vector-stroke-position",
      value: "outside",
      transform: "matrix(1, 0, 0, 1, 4, 5)",
      transformOrigin: "0px 0px",
      transformBox: "view-box",
    });
    const geometry = patch.content.match(
      /<path[^>]*data-an-vector-stroke-geometry=""[^>]*\/>/,
    )?.[0];

    expect(patch.result.status).toBe("applied");
    expect(geometry).not.toContain("transform=");
    expect(geometry).toContain(
      'style="transform: matrix(1, 0, 0, 1, 4, 5); transform-origin: 0px 0px; transform-box: view-box"',
    );
  });

  it.each([
    {
      kind: "rect",
      tag: "rect",
      geometry: 'x="4" y="6" width="80" height="30" rx="5" ry="7"',
    },
    {
      kind: "ellipse",
      tag: "ellipse",
      geometry: 'cx="40" cy="25" rx="32" ry="18"',
    },
    {
      kind: "circle",
      tag: "circle",
      geometry: 'cx="40" cy="25" r="18"',
    },
    {
      kind: "circle",
      tag: "ellipse",
      geometry: 'cx="40" cy="25" rx="18" ry="18"',
    },
    {
      kind: "ellipse",
      tag: "circle",
      geometry: 'cx="40" cy="25" r="18"',
    },
    {
      kind: "polygon",
      tag: "path",
      geometry: 'd="M 50 5 L 95 95 L 5 95 Z"',
    },
    {
      kind: "star",
      tag: "path",
      geometry: 'd="M 50 5 L 60 40 L 95 50 Z"',
    },
  ])(
    "aligns SVG $kind geometry and preserves its attributes",
    ({ kind, tag, geometry }) => {
      const content =
        `<svg data-agent-native-node-id="${kind}-1" data-an-primitive="${kind}" ` +
        `viewBox="0 0 100 80"><${tag} ${geometry} fill="none" ` +
        `stroke="#123456" stroke-width="2"/></svg>`;
      const patch = applyVisualEdit(content, {
        kind: "style",
        target: { nodeId: `${kind}-1` },
        property: "--an-vector-stroke-position",
        value: "outside",
      });
      const proxy = patch.content.match(
        new RegExp(`<${tag}[^>]*data-an-vector-stroke-geometry=""[^>]*/>`),
      )?.[0];

      expect(patch.result.status).toBe("applied");
      expect(proxy).toContain(geometry);
      expect(patch.content).toContain(
        'data-an-vector-stroke-position="outside"',
      );
      expect(
        buildCodeLayerProjection(patch.content).nodes.find(
          (node) =>
            node.dataAttributes["data-agent-native-node-id"] === `${kind}-1`,
        )?.style["--an-vector-stroke-can-align"],
      ).toBe("true");
    },
  );

  it("does not enable stroke alignment for canvas div primitives", () => {
    const content =
      '<div data-agent-native-node-id="rect-1" data-an-primitive="rectangle" ' +
      'style="width:80px;height:30px;border:1px solid #123456"></div>';
    const patch = applyVisualEdit(content, {
      kind: "style",
      target: { nodeId: "rect-1" },
      property: "--an-vector-stroke-position",
      value: "outside",
    });

    expect(patch.result.status).toBe("unsupported");
    expect(patch.content).toBe(content);
  });

  it("clears box paint the wrapper should never have carried", () => {
    const corrupted = html.replace(
      'style="position:absolute',
      'style="background-color:#782323;border-width:1px;position:absolute',
    );
    const patch = applyVisualEdit(corrupted, {
      kind: "style",
      target: { nodeId: "pen-1" },
      property: "fill",
      value: "#ff0000",
    });
    const wrapper = patch.content.slice(0, patch.content.indexOf("<path"));

    expect(wrapper).not.toContain("background-color");
    expect(wrapper).not.toContain("border-width");
    expect(wrapper).toMatch(/position:\s*absolute/);
  });

  it("leaves geometry edits on the svg wrapper", () => {
    const patch = applyVisualEdit(html, {
      kind: "style",
      target: { nodeId: "pen-1" },
      property: "left",
      value: "40px",
    });

    expect(patch.content).toContain("left: 40px");
    expect(patch.content).toContain(`<path d="M 0 0 L 80 60 Z"`);
    expect(patch.content.slice(patch.content.indexOf("<path"))).not.toContain(
      "left: 40px",
    );
  });
});

describe("applyVisualEdit CSS border gradients", () => {
  const html =
    '<body><div data-agent-native-node-id="css-rect-1" style="width:80px;height:60px;background:#fff;border-width:4px;border-style:solid;border-color:#111827"></div></body>';

  it("persists a linear border gradient and restores the original color on solid paint", () => {
    const value = "linear-gradient(90deg, #ff0000 0%, #0000ff 100%)";
    const gradient = applyVisualEdit(html, {
      kind: "style",
      target: { nodeId: "css-rect-1" },
      property: "border-color",
      value,
    });

    expect(gradient.result.status).toBe("applied");
    expect(gradient.content).toContain(`--an-css-border-gradient: ${value}`);
    expect(gradient.content).toContain("--an-css-border-solid-color: #111827");
    expect(gradient.content).toContain(
      "border-image-source: var(--an-css-border-gradient)",
    );
    expect(gradient.content).toContain("border-image-slice: 1");
    expect(gradient.content).toContain("border-color: transparent");
    expect(
      gradient.projection.nodes.find(
        (node) =>
          node.dataAttributes["data-agent-native-node-id"] === "css-rect-1",
      )?.style["--an-css-border-gradient"],
    ).toBe(value);
    expect(stripEditorOnlyAttributes(gradient.content)).toContain(
      "border-image-source: var(--an-css-border-gradient)",
    );

    const solid = applyVisualEdit(gradient.content, {
      kind: "style",
      target: { nodeId: "css-rect-1" },
      property: "border-color",
      value: "#00ff00",
    });
    expect(solid.result.status).toBe("applied");
    expect(solid.content).not.toContain("--an-css-border-gradient");
    expect(solid.content).not.toContain("--an-css-border-solid-color");
    expect(solid.content).not.toContain("border-image-source");
    expect(solid.content).toContain("border-color: #00ff00");
  });

  it.each([
    ["rounded corners", "border-radius:8px;"],
    ["dashed border", "border-style:dashed;"],
    ["per-side border", "border-left-color:#000;"],
  ])("rejects %s without changing source", (_label, unsupportedStyle) => {
    const source = `<body><div data-agent-native-node-id="css-rect-1" style="width:80px;height:60px;border-width:4px;border-style:solid;border-color:#111827;${unsupportedStyle}"></div></body>`;
    const result = applyVisualEdit(source, {
      kind: "style",
      target: { nodeId: "css-rect-1" },
      property: "border-color",
      value: "linear-gradient(90deg, #ff0000 0%, #0000ff 100%)",
    });
    expect(result.result.status).toBe("unsupported");
    expect(result.content).toBe(source);
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
      {
        property: "backgroundClip",
        cssProperty: "background-clip",
        value: "text",
      },
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
      {
        property: "-webkit-text-stroke-width",
        cssProperty: "-webkit-text-stroke-width",
        value: "2px",
      },
      {
        property: "-webkit-text-stroke-color",
        cssProperty: "-webkit-text-stroke-color",
        value: "#0f172a",
      },
      { property: "overflow", cssProperty: "overflow", value: "hidden" },
      { property: "display", cssProperty: "display", value: "-webkit-box" },
      {
        property: "webkitBoxOrient",
        cssProperty: "-webkit-box-orient",
        value: "vertical",
      },
      {
        property: "webkitLineClamp",
        cssProperty: "-webkit-line-clamp",
        value: "3",
      },
      {
        property: "--agent-native-truncate-original-display",
        cssProperty: "--agent-native-truncate-original-display",
        value: '"initial"',
      },
      {
        property: "--agent-native-truncate-original-overflow",
        cssProperty: "--agent-native-truncate-original-overflow",
        value: '"clip"',
      },
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
    // R94 — text glyph-outline stroke longhands must round-trip through the
    // same deterministic style-edit path border/outline use (see the
    // VisualStyleProperty allow-list in code-layer.ts).
    expect(html).toContain("-webkit-text-stroke-width: 2px");
    expect(html).toContain("-webkit-text-stroke-color: #0f172a");
    expect(html).toContain("overflow: hidden");
    expect(html).toContain("display: -webkit-box");
    expect(html).toContain("-webkit-box-orient: vertical");
    expect(html).toContain("-webkit-line-clamp: 3");
    expect(html).toContain(
      "--agent-native-truncate-original-display: &quot;initial&quot;",
    );
    expect(html).toContain(
      "--agent-native-truncate-original-overflow: &quot;clip&quot;",
    );
    expect(html).toContain("flex-wrap: wrap");
    expect(html).toContain("rotate: 15deg");
    expect(html).toContain("scale: -1 1");
    expect(html).toContain("left: 32px");
  });

  it("restores CSS-wide display values through the style boundary", () => {
    const html = `<div data-testid="text" style="display:-webkit-box"></div>`;
    for (const value of ["initial", "revert-layer"]) {
      const patch = applyVisualEdit(html, {
        kind: "style",
        target: { selector: '[data-testid="text"]' },
        property: "display",
        value,
      });

      expect(patch.result.status).toBe("applied");
      expect(patch.content).toContain(`display: ${value}`);
    }
  });

  it("aliases camelCase webkit text-stroke longhands to their -webkit- kebab forms", () => {
    // Regression: the edit panel's "Add layer" (text stroke) once emitted
    // camelCase webkitTextStrokeWidth/-Color. normalizeStyleProperty's generic
    // camel→kebab pass turns those into "webkit-text-stroke-*" (missing the
    // leading dash), which is NOT in the allow-list → status "unsupported" and
    // nothing persisted. STYLE_PROPERTY_ALIASES must map them explicitly.
    const html = `<h1 data-layer-name="Title">Hello</h1>`;

    const widthPatch = applyVisualEdit(html, {
      kind: "style",
      target: { selector: '[data-layer-name="Title"]' },
      property: "webkitTextStrokeWidth",
      value: "1px",
    });
    expect(widthPatch.result.status).toBe("applied");
    expect(widthPatch.result.capability).toEqual(
      expect.objectContaining({
        kind: "style",
        properties: ["-webkit-text-stroke-width"],
      }),
    );
    expect(widthPatch.content).toContain("-webkit-text-stroke-width: 1px");

    const colorPatch = applyVisualEdit(widthPatch.content, {
      kind: "style",
      target: { selector: '[data-layer-name="Title"]' },
      property: "webkitTextStrokeColor",
      value: "#0f172a",
    });
    expect(colorPatch.result.status).toBe("applied");
    expect(colorPatch.content).toContain("-webkit-text-stroke-color: #0f172a");
  });

  it("applies the kebab -webkit-text-stroke-width longhand directly (allow-list pin)", () => {
    const patch = applyVisualEdit(`<h1 data-layer-name="Title">Hello</h1>`, {
      kind: "style",
      target: { selector: '[data-layer-name="Title"]' },
      property: "-webkit-text-stroke-width",
      value: "1px",
    });
    expect(patch.result.status).toBe("applied");
    expect(patch.content).toContain("-webkit-text-stroke-width: 1px");
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

  it("rejects executable attribute URLs and style payloads", () => {
    const html = `<a id="link">Open</a>`;
    for (const value of ["javascript:alert(1)", "java&#x73;cript:alert(1)"]) {
      const patch = applyVisualEdit(html, {
        kind: "attribute",
        target: { selector: "#link" },
        name: "href",
        value,
      });
      expect(patch.result.status).toBe("unsupported");
      expect(patch.content).toBe(html);
    }

    const stylePatch = applyVisualEdit(html, {
      kind: "attribute",
      target: { selector: "#link" },
      name: "style",
      value: "background: url(javascript:alert(1))",
    });
    expect(stylePatch.result.status).toBe("unsupported");
    expect(stylePatch.content).toBe(html);
  });

  it("allows safe attribute values", () => {
    const patch = applyVisualEdit(`<a id="link">Open</a>`, {
      kind: "attribute",
      target: { selector: "#link" },
      name: "href",
      value: "https://example.com",
    });
    expect(patch.result.status).toBe("applied");
    expect(patch.content).toContain('href="https://example.com"');
  });

  it("rejects vbscript: attribute URLs", () => {
    const html = `<a id="link">Open</a>`;
    const patch = applyVisualEdit(html, {
      kind: "attribute",
      target: { selector: "#link" },
      name: "href",
      value: "vbscript:msgbox(1)",
    });
    expect(patch.result.status).toBe("unsupported");
    expect(patch.content).toBe(html);
  });

  it("rejects non-image data: attribute URLs", () => {
    const html = `<a id="link">Open</a>`;
    for (const value of [
      "data:text/html,<script>alert(1)</script>",
      "data:image/svg+xml,<svg onload=alert(1)>",
    ]) {
      const patch = applyVisualEdit(html, {
        kind: "attribute",
        target: { selector: "#link" },
        name: "href",
        value,
      });
      expect(patch.result.status).toBe("unsupported");
      expect(patch.content).toBe(html);
    }
  });

  it("allows safe data:image attribute URLs", () => {
    const patch = applyVisualEdit(`<img id="pic" />`, {
      kind: "attribute",
      target: { selector: "#pic" },
      name: "src",
      value: "data:image/png;base64,iVBORw0KGgo=",
    });
    expect(patch.result.status).toBe("applied");
  });

  it("rejects control-character and whitespace evasions of javascript:", () => {
    const html = `<a id="link">Open</a>`;
    for (const value of [
      "java\tscript:alert(1)",
      "java\nscript:alert(1)",
      " javascript:alert(1)",
      "\u0000javascript:alert(1)",
    ]) {
      const patch = applyVisualEdit(html, {
        kind: "attribute",
        target: { selector: "#link" },
        name: "href",
        value,
      });
      expect(patch.result.status, `value ${JSON.stringify(value)}`).toBe(
        "unsupported",
      );
      expect(patch.content).toBe(html);
    }
  });

  it("rejects on* event-handler attribute names outright, regardless of value", () => {
    const html = `<button id="btn">Click</button>`;
    const patch = applyVisualEdit(html, {
      kind: "attribute",
      target: { selector: "#btn" },
      name: "onclick",
      value: "alert(1)",
    });
    expect(patch.result.status).toBe("unsupported");
    expect(patch.content).toBe(html);
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

  it("detects canonical node ids exactly when stamping would change nothing", () => {
    const id = (value: string) => ` data-agent-native-node-id="${value}"`;
    const cases = [
      "",
      "<main><p>No ids</p></main>",
      `<main${id("a")}><p${id("b")}>Ids</p></main>`,
      `<main${id("a")}><p>One missing</p></main>`,
      `<main${id("a")}><p${id("a")}>Duplicate</p></main>`,
      `<main${id("a")}><p${id("b")}${id("c")}>Two attributes</p></main>`,
      `<main${id("a")}><p${id(" ")}>Blank</p></main>`,
      `<main${id("a")}><p data-agent-native-node-id>Boolean</p></main>`,
      `<main${id("a")}><p title="x data-agent-native-node-id=q"${id("b")}>In a value</p></main>`,
      `<main${id("a")}><svg${id("s")}><path d="M0 0"/></svg></main>`,
      `<main${id("a")}><template${id("t")}><i>Child</i></template></main>`,
      `<main${id("a")}><template><i${id("i")}>Child</i></template></main>`,
      `<html><head><title>T</title><style>p{}</style></head><body${id("b")}><script>if (a<b) x()</script><p${id("p")}>x</p></body></html>`,
      `<main${id("a")}><textarea${id("t")}><p>raw</p></textarea></main>`,
      `<ul${id("u")}><li${id("1")}>One<li${id("2")}>Two</ul>`,
      `<main${id("a")}><div${id("b")} data-x="a > b">Quoted</div></main>`,
      `<main${id("a")}><img${id("b")}/><br></main>`,
    ];
    for (const html of cases) {
      const stamped = ensureCodeLayerNodeIdsInHtml(html);
      expect(hasCanonicalCodeLayerNodeIds(html), html).toBe(!stamped.changed);
      expect(hasCanonicalCodeLayerNodeIds(stamped.content), html).toBe(
        !ensureCodeLayerNodeIdsInHtml(stamped.content).changed,
      );
    }
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
    expect(stamped.content).toContain(
      `<div class="ghost" data-agent-native-node-id=`,
    );
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

  it.each(["data-an-primitive", "data-agent-native-primitive"])(
    "keeps a reparented Frame with %s as the containing block for absolute descendants",
    (marker) => {
      const html =
        `<main>` +
        `<section id="workspace" style="display:flex;gap:12px"></section>` +
        `<div data-agent-native-node-id="frame" ${marker}="frame" ` +
        `class="!absolute !inset-0" ` +
        `style="position:absolute!important;inset:24px;left:24px;top:24px;right:24px;bottom:24px;background:#475569">` +
        `<button data-agent-native-node-id="badge" style="position:absolute;right:10px;bottom:13px">Play</button>` +
        `</div></main>`;

      const moved = applyVisualEdit(html, {
        kind: "moveNode",
        target: { nodeId: "frame" },
        anchor: { selector: "#workspace" },
        placement: "inside",
      });

      expect(moved.result.status).toBe("applied");
      const frameTag = moved.content.match(
        /<div[^>]*data-agent-native-node-id="frame"[^>]*>/,
      )?.[0];
      expect(frameTag).toBeTruthy();
      expect(frameTag).toMatch(/position:\s*relative\s*!important/i);
      for (const side of ["left", "top", "right", "bottom"]) {
        expect(frameTag).toMatch(
          new RegExp(`${side}:\\s*auto\\s*!important`, "i"),
        );
      }
      expect(frameTag).not.toMatch(/!absolute/);
      expect(frameTag).toContain("!inset-0");
      expect(moved.content).toContain(
        'data-agent-native-node-id="badge" style="position:absolute;right:10px;bottom:13px"',
      );
    },
  );

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
    expect(patch.content).toContain(`data-agent-native-group="true"`);
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

  it("deduplicates repeated target ids instead of duplicating/removing the same source span twice", () => {
    const html = `<main><div data-agent-native-node-id="a">A</div><div data-agent-native-node-id="b">B</div><p>After</p></main>`;
    const patch = applyVisualEdit(html, {
      kind: "wrapNodes",
      targetIds: ["a", "a", "b", "b"],
    });

    expect(patch.result.status).toBe("applied");
    expect(patch.content.match(/data-agent-native-node-id="a"/g)).toHaveLength(
      1,
    );
    expect(patch.content.match(/data-agent-native-node-id="b"/g)).toHaveLength(
      1,
    );
    expect(patch.content).toContain("<p>After</p>");
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

  it("keeps an autoLayout wrapper at the selection's own origin instead of the parent's 0,0", () => {
    const html = `<main><div data-agent-native-node-id="x" style="position: absolute; left: 240px; top: 180px; width: 120px; height: 60px">X</div><div data-agent-native-node-id="y" style="position: absolute; left: 240px; top: 300px; width: 120px; height: 60px">Y</div></main>`;
    const patch = applyVisualEdit(html, {
      kind: "wrapNodes",
      targetIds: ["x", "y"],
      autoLayout: true,
    });

    expect(patch.result.status).toBe("applied");
    const wrapperStyle = new RegExp(
      `data-agent-native-node-id="${patch.result.wrapperNodeId}"[^>]*style="([^"]*)"`,
    ).exec(patch.content)?.[1];
    expect(wrapperStyle).toContain("position: absolute");
    expect(wrapperStyle).toContain("left: 240px");
    expect(wrapperStyle).toContain("top: 180px");
    expect(wrapperStyle).toContain("display: flex");
    // No width/height: an auto-layout frame hugs its children, like Figma's.
    expect(wrapperStyle).not.toContain("width:");
    expect(wrapperStyle).not.toContain("height:");
  });

  it("keeps an autoLayout wrapper at the origin even when children have no width/height", () => {
    const html = `<main><div data-agent-native-node-id="x" style="position: absolute; left: 240px; top: 180px">Hello</div></main>`;
    const patch = applyVisualEdit(html, {
      kind: "wrapNodes",
      targetIds: ["x"],
      autoLayout: true,
    });

    expect(patch.result.status).toBe("applied");
    const wrapperStyle = new RegExp(
      `data-agent-native-node-id="${patch.result.wrapperNodeId}"[^>]*style="([^"]*)"`,
    ).exec(patch.content)?.[1];
    expect(wrapperStyle).toContain("left: 240px");
    expect(wrapperStyle).toContain("top: 180px");
    expect(wrapperStyle).toContain("display: flex");
  });

  it("wraps a single absolutely-positioned node at its own bounds", () => {
    const html = `<main><div data-agent-native-node-id="x" style="position: absolute; left: 64px; top: 32px; width: 100px; height: 40px">X</div></main>`;
    const patch = applyVisualEdit(html, {
      kind: "wrapNodes",
      targetIds: ["x"],
    });

    expect(patch.result.status).toBe("applied");
    expect(patch.content).toContain("left: 64px; top: 32px");
    expect(patch.content).toContain("width: 100px; height: 40px");
    // The child is rebased into the wrapper's coordinate space.
    expect(patch.content).toContain("left: 0px");
    expect(patch.content).toContain("top: 0px");
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

  it("groups non-contiguous same-parent siblings at the TOPMOST member's z-position, not the bottommost (L6)", () => {
    // a (bottom), b (middle, unselected), c (top) — later source position
    // paints on top for plain siblings. Figma places the resulting group at
    // c's stacking position, so b ends up BELOW the group, not above it.
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
    // b (not selected) is left behind in the original parent, BEFORE the
    // wrapper — i.e. below the new group, matching Figma's topmost-child
    // z-position placement.
    expect(bIdx).toBeLessThan(wrapperIdx);
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

describe("booleanSubtract", () => {
  const html = `<main><div data-agent-native-node-id="base" data-agent-native-layer-name="Base" data-an-primitive="rectangle" style="position:absolute;left:20px;top:30px;width:38px;height:38px;background-color:rgb(255, 0, 0);border-radius:8px"></div><div data-agent-native-node-id="cutter" data-agent-native-layer-name="Cutter" data-an-primitive="ellipse" style="position:absolute;left:31px;top:41px;width:16px;height:16px;background-color:#336699"></div><div data-agent-native-node-id="after" style="position:absolute;left:80px;top:30px;width:12px;height:12px;background:#000"></div></main>`;

  it("creates a source-backed group with editable operands and a bounded SVG mask", () => {
    const patch = applyVisualEdit(html, {
      kind: "booleanSubtract",
      targetIds: ["base", "cutter"],
    });

    expect(patch.result.status).toBe("applied");
    expect(patch.result.wrapperNodeId).toBeTruthy();
    expect(patch.content).toContain('maskUnits="objectBoundingBox"');
    expect(patch.content).toContain('width="120%"');
    expect(patch.content).not.toContain("100000");
    expect(
      patch.content.match(/data-agent-native-node-id="base"/g),
    ).toHaveLength(1);
    expect(
      patch.content.match(/data-agent-native-node-id="cutter"/g),
    ).toHaveLength(1);
    expect(patch.content).toContain('data-an-boolean-operand="base"');
    expect(patch.content).toContain('data-an-boolean-operand="subtract"');
    expect(patch.content).toContain("--boolean-mask-fill:white");
    expect(patch.content).toContain('data-an-boolean-cutter-stroke="true"');
    expect(patch.content).toContain("overflow:visible;opacity:1");
    expect(patch.content).toContain('style="--boolean-mask-fill:black;');

    const projection = buildCodeLayerProjection(patch.content);
    const root = projection.nodes.find(
      (node) =>
        node.dataAttributes["data-agent-native-node-id"] ===
        patch.result.wrapperNodeId,
    );
    const operands = projection.nodes.filter(
      (node) => node.dataAttributes["data-an-primitive"] === "boolean-operand",
    );
    expect(root?.dataAttributes["data-an-primitive"]).toBe("boolean");
    expect(operands.map((node) => node.layerName)).toEqual(["Base", "Cutter"]);
    expect(operands.every((node) => node.parentId === root?.id)).toBe(true);
    expect(root?.children).toEqual(operands.map((node) => node.id));
  });

  it("keeps child paint and geometry edits connected to SVG source geometry", () => {
    const created = applyVisualEdit(html, {
      kind: "booleanSubtract",
      targetIds: ["base", "cutter"],
    });
    const color = applyVisualEdit(created.content, {
      kind: "style",
      target: { nodeId: "cutter" },
      property: "fill",
      value: "#ff0000",
    });
    expect(color.result.status).toBe("applied");
    expect(color.content).toContain("--operand-fill: #ff0000");
    const stroke = applyVisualEdit(color.content, {
      kind: "style",
      target: { nodeId: "cutter" },
      property: "stroke-width",
      value: "2px",
    });
    expect(stroke.result.status).toBe("applied");
    const width = applyVisualEdit(stroke.content, {
      kind: "style",
      target: { nodeId: "cutter" },
      property: "width",
      value: "20px",
    });
    expect(width.result.status).toBe("applied");
    expect(width.content).toContain('width="20"');
    expect(width.content).toContain('viewBox="0 0 20 16"');
    expect(width.content).toContain('<rect x="1" y="1" width="18" height="14"');

    const rootId = created.result.wrapperNodeId;
    const resultPaint = applyVisualEdit(created.content, {
      kind: "style",
      target: { nodeId: rootId! },
      property: "fill",
      value: "#224466",
    });
    expect(resultPaint.result.status).toBe("applied");
    expect(resultPaint.content).toContain("--boolean-mask-fill: #224466");
    expect(resultPaint.content).toMatch(/fill:\s*var\(--boolean-mask-fill\)/);
    const resultOpacity = applyVisualEdit(resultPaint.content, {
      kind: "style",
      target: { nodeId: rootId! },
      property: "opacity",
      value: "0.5",
    });
    expect(resultOpacity.result.status).toBe("applied");
    expect(resultOpacity.content).toContain("opacity: 0.5");
    expect(resultOpacity.content).toMatch(/opacity:\s*1/);

    const resultRadius = applyVisualEdit(created.content, {
      kind: "style",
      target: { nodeId: rootId! },
      property: "border-radius",
      value: "13px",
    });
    expect(resultRadius.result.status).toBe("applied");
    expect(resultRadius.content).toContain("border-radius: 13px");
    expect(resultRadius.content).toContain("--boolean-result-radius-x: 13px");
    expect(resultRadius.content).toContain("--boolean-result-radius-y: 13px");
    expect(
      applyVisualEdit(resultRadius.content, {
        kind: "style",
        target: { nodeId: rootId! },
        property: "border-top-left-radius",
        value: "13px",
      }).result.status,
    ).toBe("applied");
    expect(
      applyVisualEdit(resultRadius.content, {
        kind: "style",
        target: { nodeId: rootId! },
        property: "border-top-left-radius",
        value: "4px",
      }).result.status,
    ).toBe("unsupported");
    const resultStroke = applyVisualEdit(created.content, {
      kind: "style",
      target: { nodeId: rootId! },
      property: "stroke",
      value: "#000000",
    });
    expect(resultStroke.result.status).toBe("applied");
    expect(resultStroke.content).toContain("--boolean-mask-stroke: #000000");
    const resultStrokeWidth = applyVisualEdit(resultStroke.content, {
      kind: "style",
      target: { nodeId: rootId! },
      property: "stroke-width",
      value: "4px",
    });
    expect(resultStrokeWidth.result.status).toBe("applied");
    expect(resultStrokeWidth.content).toContain(
      "--boolean-mask-stroke-width: 4px",
    );
    const resultStrokeOpacity = applyVisualEdit(resultStrokeWidth.content, {
      kind: "style",
      target: { nodeId: rootId! },
      property: "stroke-opacity",
      value: "0.25",
    });
    expect(resultStrokeOpacity.result.status).toBe("applied");
    const projectedStroke = buildCodeLayerProjection(
      resultStrokeOpacity.content,
    ).nodes.find(
      (node) => node.dataAttributes["data-agent-native-node-id"] === rootId,
    );
    expect(projectedStroke?.style.stroke).toBe("#000000");
    expect(projectedStroke?.style["stroke-width"]).toBe("4px");
    expect(projectedStroke?.style["stroke-opacity"]).toBe("0.25");
  });

  it("keeps Boolean operand X edits semantic after absolute positioning", () => {
    const created = applyVisualEdit(html, {
      kind: "booleanSubtract",
      targetIds: ["base", "cutter"],
    });
    const rootId = created.result.wrapperNodeId!;
    const rotated = applyVisualEdit(created.content, {
      kind: "style",
      target: { nodeId: rootId },
      property: "rotation",
      value: "45deg",
    });
    const positioned = applyVisualEdit(rotated.content, {
      kind: "style",
      target: { nodeId: "cutter" },
      property: "position",
      value: "absolute",
    });

    expect(positioned.result.status).toBe("applied");
    const moved = applyVisualEdit(positioned.content, {
      kind: "style",
      target: { nodeId: "cutter" },
      property: "left",
      value: "30px",
    });

    expect(moved.result.status).toBe("applied");
    const projection = buildCodeLayerProjection(moved.content);
    const operand = projection.nodes.find(
      (node) => node.dataAttributes["data-agent-native-node-id"] === "cutter",
    );
    const root = projection.nodes.find(
      (node) => node.dataAttributes["data-agent-native-node-id"] === rootId,
    );
    expect(operand?.attributes.x).toBe("30");
    expect(operand?.style.left).toBe("30px");
    expect(root?.style.rotate).toBe("45deg");
    expect(moved.content).toContain(`href="#${operand?.attributes.id}"`);
  });

  it("keeps standalone SVG position edits on their wrapper", () => {
    const standalone =
      '<body><svg data-agent-native-node-id="vector" data-an-primitive="path" style="position:absolute;left:20px;top:30px;width:100px;height:100px"><path d="M 0 0 L 80 60 Z"/></svg></body>';
    const positioned = applyVisualEdit(standalone, {
      kind: "style",
      target: { nodeId: "vector" },
      property: "position",
      value: "absolute",
    });
    const moved = applyVisualEdit(positioned.content, {
      kind: "style",
      target: { nodeId: "vector" },
      property: "left",
      value: "40px",
    });

    expect(positioned.result.status).toBe("applied");
    expect(moved.result.status).toBe("applied");
    expect(moved.content).toContain("left: 40px");
    expect(moved.content).toContain('<path d="M 0 0 L 80 60 Z"');
  });

  it("keeps result stroke edits inside their own Boolean group", () => {
    const source = html.replace(
      "</main>",
      '<div data-agent-native-node-id="base-2" data-agent-native-layer-name="Base 2" data-an-primitive="rectangle" style="position:absolute;left:140px;top:30px;width:38px;height:38px;background:#00f"></div><div data-agent-native-node-id="cutter-2" data-agent-native-layer-name="Cutter 2" data-an-primitive="ellipse" style="position:absolute;left:151px;top:41px;width:16px;height:16px;background:#0f0"></div></main>',
    );
    const first = applyVisualEdit(source, {
      kind: "booleanSubtract",
      targetIds: ["base", "cutter"],
    });
    const second = applyVisualEdit(first.content, {
      kind: "booleanSubtract",
      targetIds: ["base-2", "cutter-2"],
    });
    const secondRootId = second.result.wrapperNodeId!;
    const cutterStrokeStyle = (content: string, rootId: string) => {
      const rootStart = content.indexOf(
        `data-agent-native-node-id="${rootId}"`,
      );
      const marker = content.indexOf(
        'data-an-boolean-cutter-stroke="true"',
        rootStart,
      );
      const start = content.lastIndexOf("<use", marker);
      const end = content.indexOf(">", marker);
      return content.slice(start, end);
    };
    const untouchedStyle = cutterStrokeStyle(second.content, secondRootId);

    const editedFirst = applyVisualEdit(second.content, {
      kind: "style",
      target: { nodeId: first.result.wrapperNodeId! },
      property: "stroke",
      value: "#ff0000",
    });

    expect(editedFirst.result.status).toBe("applied");
    expect(cutterStrokeStyle(editedFirst.content, secondRootId)).toBe(
      untouchedStyle,
    );
  });

  it("releases Boolean operands with their own paint, transform, and result radius", () => {
    const source = html
      .replace(
        "background-color:rgb(255, 0, 0);border-radius:8px",
        "background-color:#d9d9d9;border-radius:8px;opacity:0.7",
      )
      .replace(
        "background-color:#336699",
        "background-color:#ff0000;opacity:0.6",
      )
      .replace("left:31px;top:41px", "left:35px;top:41px");
    const created = applyVisualEdit(source, {
      kind: "booleanSubtract",
      targetIds: ["base", "cutter"],
    });
    const rootId = created.result.wrapperNodeId!;
    const resultFill = applyVisualEdit(created.content, {
      kind: "style",
      target: { nodeId: rootId },
      property: "fill",
      value: "#336699",
    });
    const rotated = applyVisualEdit(resultFill.content, {
      kind: "style",
      target: { nodeId: rootId },
      property: "rotation",
      value: "-45deg",
    });
    const rounded = applyVisualEdit(rotated.content, {
      kind: "style",
      target: { nodeId: rootId },
      property: "border-radius",
      value: "13px",
    });
    const translucent = applyVisualEdit(rounded.content, {
      kind: "style",
      target: { nodeId: rootId },
      property: "opacity",
      value: "0.5",
    });

    const released = applyVisualEdit(translucent.content, {
      kind: "unwrap",
      targetId: rootId,
    });

    expect(released.result.status).toBe("applied");
    expect(released.content).not.toContain('data-an-primitive="boolean"');
    expect(released.content).not.toContain("data-an-boolean-cutter");
    expect(released.content).not.toContain("data-an-boolean-result");
    expect(released.content).not.toContain('mask="url(#');
    expect(released.content).toContain(
      'data-agent-native-node-id="base" data-agent-native-layer-name="Base" data-an-primitive="rectangle"',
    );
    expect(released.content).toContain(
      'data-agent-native-node-id="cutter" data-agent-native-layer-name="Cutter" data-an-primitive="ellipse"',
    );
    expect(released.content).toContain("fill: #d9d9d9");
    expect(released.content).toContain("fill: #ff0000");
    expect(released.content).not.toContain("#336699");
    expect(released.content).toContain("opacity: 0.7");
    expect(released.content).toContain("opacity: 0.6");
    expect(released.content).not.toContain("opacity: 0.5");
    expect(released.content.match(/rotate: -45deg/g)).toHaveLength(2);
    expect(released.content).toContain('rx="13"');
    expect(released.content).toContain('ry="13"');
    expect(released.content).not.toContain("--operand-fill");
    expect(released.content).not.toContain("--boolean-result-radius");

    const projection = buildCodeLayerProjection(released.content);
    const releasedNodes = projection.nodes.filter((node) =>
      ["base", "cutter"].includes(
        node.dataAttributes["data-agent-native-node-id"] ?? "",
      ),
    );
    expect(
      releasedNodes.map((node) => node.dataAttributes["data-an-primitive"]),
    ).toEqual(["rectangle", "ellipse"]);
    const base = releasedNodes.find(
      (node) => node.dataAttributes["data-agent-native-node-id"] === "base",
    );
    const cutter = releasedNodes.find(
      (node) => node.dataAttributes["data-agent-native-node-id"] === "cutter",
    );
    expect(base?.style.left).toBe("20px");
    expect(base?.style.top).toBe("30px");
    expect(Number.parseFloat(cutter?.style.left ?? "")).toBeCloseTo(33.8284, 3);
    expect(Number.parseFloat(cutter?.style.top ?? "")).toBeCloseTo(38.1716, 3);

    const recolored = applyVisualEdit(released.content, {
      kind: "style",
      target: { nodeId: "base" },
      property: "fill",
      value: "#112233",
    });
    expect(recolored.result.status).toBe("applied");
    expect(recolored.content).toContain("fill: #112233");
    const radiusEdit = applyVisualEdit(recolored.content, {
      kind: "style",
      target: { nodeId: "base" },
      property: "border-radius",
      value: "9px",
    });
    expect(radiusEdit.result.status).toBe("applied");
    expect(radiusEdit.content).toContain('rx="9"');
    expect(radiusEdit.content).toContain('ry="9"');
    expect(radiusEdit.content).toContain("border-radius: 9px");
  });

  it("releases three operands when the editable base is an ellipse", () => {
    const source = html
      .replace(
        'data-agent-native-node-id="base" data-agent-native-layer-name="Base" data-an-primitive="rectangle"',
        'data-agent-native-node-id="base" data-agent-native-layer-name="Base" data-an-primitive="ellipse"',
      )
      .replace(
        'data-agent-native-node-id="after" style=',
        'data-agent-native-node-id="after" data-an-primitive="rectangle" style=',
      )
      .replace("left:80px;top:30px", "left:35px;top:44px");
    const created = applyVisualEdit(source, {
      kind: "booleanSubtract",
      targetIds: ["base", "cutter", "after"],
    });
    expect(created.result.status).toBe("applied");

    const released = applyVisualEdit(created.content, {
      kind: "unwrap",
      targetId: created.result.wrapperNodeId!,
    });
    expect(released.result.status).toBe("applied");
    expect(released.content).not.toContain('data-an-primitive="boolean"');
    expect(released.content).not.toContain("data-an-boolean-operand");
    for (const [id, shape] of [
      ["base", "ellipse"],
      ["cutter", "ellipse"],
      ["after", "rectangle"],
    ]) {
      expect(released.content).toMatch(
        new RegExp(
          'data-agent-native-node-id="' +
            id +
            '"[^>]*data-an-primitive="' +
            shape +
            '"',
        ),
      );
    }
    const projection = buildCodeLayerProjection(released.content);
    expect(
      projection.nodes.filter((node) =>
        ["base", "cutter", "after"].includes(
          node.dataAttributes["data-agent-native-node-id"] ?? "",
        ),
      ),
    ).toHaveLength(3);
  });

  it("protects canonical operands from moves and deletes that break mask references", () => {
    const created = applyVisualEdit(html, {
      kind: "booleanSubtract",
      targetIds: ["base", "cutter"],
    });
    const rootId = created.result.wrapperNodeId!;

    const unwrappedOperand = applyVisualEdit(created.content, {
      kind: "unwrap",
      targetId: "cutter",
    });
    expect(unwrappedOperand.result.status).toBe("unsupported");
    expect(unwrappedOperand.content).toBe(created.content);

    const deleted = applyVisualEdit(created.content, {
      kind: "deleteNode",
      target: { nodeId: "cutter" },
    });
    expect(deleted.result.status).toBe("unsupported");
    expect(deleted.content).toBe(created.content);

    const moved = applyVisualEdit(created.content, {
      kind: "moveNode",
      target: { nodeId: "cutter" },
      anchor: { nodeId: "after" },
      placement: "before",
    });
    expect(moved.result.status).toBe("unsupported");
    expect(moved.content).toBe(created.content);

    const movedIntoRoot = applyVisualEdit(created.content, {
      kind: "moveNode",
      target: { nodeId: "after" },
      anchor: { nodeId: rootId },
      placement: "inside",
    });
    expect(movedIntoRoot.result.status).toBe("unsupported");
    expect(movedIntoRoot.content).toBe(created.content);

    const movedIntoOperand = applyVisualEdit(created.content, {
      kind: "moveNode",
      target: { nodeId: "after" },
      anchor: { nodeId: "base" },
      placement: "inside",
    });
    expect(movedIntoOperand.result.status).toBe("unsupported");
    expect(movedIntoOperand.content).toBe(created.content);
  });

  it("refuses non-sibling, unsupported and nonuniform corner geometry", () => {
    const nonConsecutive = html.replace(
      '<div data-agent-native-node-id="cutter"',
      '<p data-agent-native-node-id="between">Label</p><div data-agent-native-node-id="cutter"',
    );
    expect(
      applyVisualEdit(nonConsecutive, {
        kind: "booleanSubtract",
        targetIds: ["base", "cutter"],
      }).result.status,
    ).toBe("unsupported");

    const customMarkup = html.replace(
      'data-agent-native-layer-name="Base"',
      'data-agent-native-layer-name="Base" class="rounded-lg"',
    );
    expect(
      applyVisualEdit(customMarkup, {
        kind: "booleanSubtract",
        targetIds: ["base", "cutter"],
      }).result.status,
    ).toBe("unsupported");

    const asymmetricRadius = html.replace(
      "border-radius:8px",
      "border-radius:8px 2px",
    );
    expect(
      applyVisualEdit(asymmetricRadius, {
        kind: "booleanSubtract",
        targetIds: ["base", "cutter"],
      }).result.status,
    ).toBe("unsupported");
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

  it("L3: rebases a measured flow origin and relative wrapper inset on unwrap", () => {
    const html =
      `<main>` +
      `<div data-agent-native-node-id="wrapper" data-agent-native-group-wrapper="true" data-agent-native-group-origin-left="100px" data-agent-native-group-origin-top="80px" style="position:relative;left:10px;top:5px">` +
      `<div data-agent-native-node-id="child" style="position:absolute;left:2px;top:3px">Child</div>` +
      `</div>` +
      `</main>`;
    const patch = applyVisualEdit(html, {
      kind: "unwrap",
      targetId: "wrapper",
    });

    expect(patch.result.status).toBe("applied");
    expect(patch.content).toContain("left: 112px");
    expect(patch.content).toContain("top: 88px");
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

  it("L3: ignores inert offsets on a static wrapper", () => {
    const html =
      `<main>` +
      `<div data-agent-native-node-id="wrapper" style="left: 50px; top: 30px">` +
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
    expect(patch.content).not.toContain("left: 60px");
  });
});

describe("autoLayout", () => {
  const treeNodeById = (
    nodes: ReturnType<typeof buildCodeLayerTree>,
    id: string,
  ): (typeof nodes)[number] | undefined => {
    for (const node of nodes) {
      if (node.id === id) return node;
      const nested = treeNodeById(node.children, id);
      if (nested) return nested;
    }
    return undefined;
  };

  it("changes a grouped wrapper into a Frame and keeps that identity when auto-layout is removed", () => {
    const wrapped = applyVisualEdit(
      `<main><div data-agent-native-node-id="a" style="position:absolute;left:10px;top:10px">A</div><div data-agent-native-node-id="b" style="position:absolute;left:30px;top:10px">B</div></main>`,
      { kind: "wrapNodes", targetIds: ["a", "b"] },
    );
    const groupId = wrapped.result.wrapperNodeId;
    expect(groupId).toBeTruthy();
    expect(wrapped.content).toContain(`data-agent-native-group="true"`);

    const enabled = applyVisualEdit(wrapped.content, {
      kind: "autoLayout",
      targetId: groupId!,
      enabled: true,
      direction: "row",
      gap: "8px",
    });
    expect(enabled.result.status).toBe("applied");
    expect(enabled.content).not.toContain(`data-agent-native-group="true"`);
    expect(enabled.content).toContain(`data-an-primitive="frame"`);
    const enabledProjection = buildCodeLayerProjection(enabled.content);
    const enabledWrapper = enabledProjection.nodes.find(
      (node) => node.dataAttributes["data-agent-native-node-id"] === groupId,
    );
    expect(enabledWrapper).toBeDefined();
    expect(enabledWrapper?.layerName).toBe("Frame 1");
    expect(
      treeNodeById(buildCodeLayerTree(enabledProjection), enabledWrapper!.id)
        ?.type,
    ).toBe("frame");

    const disabled = applyVisualEdit(enabled.content, {
      kind: "autoLayout",
      targetId: groupId!,
      enabled: false,
      childRects: {
        a: { x: 0, y: 0, width: 20, height: 20 },
        b: { x: 20, y: 0, width: 20, height: 20 },
      },
      containerRect: { width: 40, height: 20 },
    });
    expect(disabled.result.status).toBe("applied");
    expect(disabled.content).toContain(`data-an-primitive="frame"`);
    expect(disabled.content).not.toContain(`data-agent-native-group="true"`);
    const disabledProjection = buildCodeLayerProjection(disabled.content);
    const disabledWrapper = disabledProjection.nodes.find(
      (node) => node.dataAttributes["data-agent-native-node-id"] === groupId,
    );
    expect(disabledWrapper).toBeDefined();
    expect(
      treeNodeById(buildCodeLayerTree(disabledProjection), disabledWrapper!.id)
        ?.type,
    ).toBe("frame");
  });

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

  it("keeps direct Frame children as containing blocks when enabling auto-layout", () => {
    const html =
      `<div data-agent-native-node-id="workspace">` +
      `<div data-agent-native-node-id="frame" data-an-primitive="frame" ` +
      `style="position:absolute;inset:24px;background:#475569">` +
      `<button data-agent-native-node-id="badge" style="position:absolute;right:10px;bottom:13px">Play</button>` +
      `</div></div>`;
    const patch = applyVisualEdit(html, {
      kind: "autoLayout",
      targetId: "workspace",
      enabled: true,
      direction: "row",
    });

    expect(patch.result.status).toBe("applied");
    const frameTag = patch.content.match(
      /<div[^>]*data-agent-native-node-id="frame"[^>]*>/,
    )?.[0];
    expect(frameTag).toBeTruthy();
    expect(frameTag).toMatch(/position:\s*relative\s*!important/i);
    expect(frameTag).toMatch(/left:\s*auto\s*!important/i);
    expect(frameTag).toMatch(/top:\s*auto\s*!important/i);
    expect(frameTag).toMatch(/right:\s*auto\s*!important/i);
    expect(frameTag).toMatch(/bottom:\s*auto\s*!important/i);
    expect(patch.content).toContain(
      'data-agent-native-node-id="badge" style="position:absolute;right:10px;bottom:13px"',
    );
  });

  it("writes grid tracks from containerStyles and reflows the children", () => {
    const html =
      `<div data-agent-native-node-id="box">` +
      `<div data-agent-native-node-id="a" style="position: absolute; left: 40px; top: 12px">A</div>` +
      `<div data-agent-native-node-id="b" class="absolute" style="left: 90px">B</div>` +
      `</div>`;
    const patch = applyVisualEdit(html, {
      kind: "autoLayout",
      targetId: "box",
      enabled: true,
      containerStyles: {
        display: "grid",
        gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
        gridTemplateRows: "repeat(1, max-content)",
      },
    });

    expect(patch.result.status).toBe("applied");
    expect(patch.content).toContain("display: grid");
    expect(patch.content).toContain(
      "grid-template-columns: repeat(2, minmax(0, 1fr))",
    );
    expect(patch.content).not.toContain("display: flex");
    expect(patch.content).not.toMatch(/position:\s*absolute/);
    expect(patch.content).not.toMatch(/left:\s*40px/);
    expect(patch.content).not.toMatch(/class="absolute"/);
  });

  it("rejects containerStyles that carry no writable declaration", () => {
    const html = `<div data-agent-native-node-id="box"><span>A</span></div>`;
    const patch = applyVisualEdit(html, {
      kind: "autoLayout",
      targetId: "box",
      enabled: true,
      containerStyles: { display: "grid; content: url(javascript:0)" },
    });

    expect(patch.result.status).toBe("needsAgent");
    expect(patch.content).toBe(html);
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

  it("replaces a min-height:0 that would let the container collapse anyway", () => {
    const html =
      `<div data-agent-native-node-id="container" style="display: flex; min-height: 0; overflow: hidden">` +
      `<div data-agent-native-node-id="a">A</div>` +
      `</div>`;
    const patch = applyVisualEdit(html, {
      kind: "autoLayout",
      targetId: "container",
      enabled: false,
      childRects: { a: { x: 0, y: 0, width: 120, height: 40 } },
      containerRect: { width: 120, height: 40 },
    });
    expect(patch.content).toMatch(/min-height:\s*40px/);
  });

  it("pins a padded child by its border box, not by its margin edge", () => {
    const html =
      `<div data-agent-native-node-id="container" style="display: flex">` +
      `<div data-agent-native-node-id="a" style="padding: 8px; margin: 12px">A</div>` +
      `</div>`;
    const patch = applyVisualEdit(html, {
      kind: "autoLayout",
      targetId: "container",
      enabled: false,
      childRects: { a: { x: 12, y: 12, width: 120, height: 40 } },
      containerRect: { width: 144, height: 64 },
    });
    const child = /data-agent-native-node-id="a" style="([^"]*)"/.exec(
      patch.content,
    )?.[1];
    expect(child).toMatch(/box-sizing:\s*border-box/);
    expect(child).toMatch(/margin:\s*0/);
  });

  it("keeps the container's extent when every child leaves flow", () => {
    // A hug-sized flex container has no width/height of its own. Once every
    // child is absolute the content box is empty, so the container collapses
    // and overflow:hidden makes the pinned children invisible.
    const html =
      `<div data-agent-native-node-id="container" style="display: flex; flex-direction: column; gap: 8px; overflow: hidden">` +
      `<div data-agent-native-node-id="a">A</div>` +
      `</div>`;
    const patch = applyVisualEdit(html, {
      kind: "autoLayout",
      targetId: "container",
      enabled: false,
      childRects: { a: { x: 0, y: 0, width: 120, height: 40 } },
      containerRect: { width: 120, height: 40 },
    });
    expect(patch.result.status).toBe("applied");
    const container =
      /data-agent-native-node-id="container" style="([^"]*)"/.exec(
        patch.content,
      )?.[1];
    expect(container).toMatch(/(?:min-)?height:\s*\d/);
  });

  it("pins children where they render when disabling, so they can be moved freely", () => {
    // Figma parity: turning auto layout OFF must leave a freeform container.
    // display:block alone re-stacks the children and they cannot be dragged.
    const html =
      `<div data-agent-native-node-id="container" style="display: flex; flex-direction: column; gap: 8px">` +
      `<div data-agent-native-node-id="a">A</div>` +
      `<div data-agent-native-node-id="b">B</div>` +
      `</div>`;
    const patch = applyVisualEdit(html, {
      kind: "autoLayout",
      targetId: "container",
      enabled: false,
      childRects: {
        a: { x: 0, y: 0, width: 120, height: 40 },
        b: { x: 0, y: 48, width: 200, height: 60 },
      },
    });

    expect(patch.result.status).toBe("applied");
    const container =
      /data-agent-native-node-id="container"[^>]*style="([^"]*)"/.exec(
        patch.content,
      )?.[1] ?? "";
    expect(container).toContain("display: block");
    // Absolute children need a positioned ancestor or they escape to the page.
    expect(container).toContain("position: relative");

    const childStyle = (id: string) =>
      /style="([^"]*)"/.exec(
        new RegExp(`data-agent-native-node-id="${id}"[^>]*`).exec(
          patch.content,
        )?.[0] ?? "",
      )?.[1] ?? "";
    expect(childStyle("a")).toContain("position: absolute");
    expect(childStyle("a")).toContain("left: 0px");
    expect(childStyle("a")).toContain("top: 0px");
    expect(childStyle("b")).toContain("top: 48px");
    expect(childStyle("b")).toContain("width: 200px");
  });

  it("leaves children alone when disabling without measured rects", () => {
    const html =
      `<div data-agent-native-node-id="container" style="display: flex">` +
      `<div data-agent-native-node-id="a">A</div></div>`;
    const patch = applyVisualEdit(html, {
      kind: "autoLayout",
      targetId: "container",
      enabled: false,
    });

    expect(patch.result.status).toBe("needsAgent");
    expect(patch.content).toBe(html);
    expect(patch.content).not.toContain("position: absolute");
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

    expect(patch.result.status).toBe("needsAgent");
    expect(patch.content).toBe(html);
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

  it("repairs duplicate ids already inside the moved subtree per occurrence", () => {
    const sourceHtml =
      `<body>` +
      `<section data-agent-native-node-id="move-root">` +
      `<div data-agent-native-node-id="duplicate"><span data-agent-native-node-id="duplicate">A</span></div>` +
      `<div data-agent-native-node-id="duplicate">B</div>` +
      `</section>` +
      `</body>`;
    const destHtml = `<body><div data-agent-native-node-id="existing">Existing</div></body>`;

    const result = moveNodeBetweenDocuments(sourceHtml, destHtml, {
      nodeId: "move-root",
    });

    expect(result.status).toBe("applied");
    expect(result.movedNodeId).toBe("move-root");
    const allIds = Array.from(
      result.destHtml.matchAll(/data-agent-native-node-id="([^"]+)"/g),
      (match) => match[1]!,
    );
    expect(new Set(allIds).size).toBe(allIds.length);
    expect(allIds.filter((id) => id === "duplicate")).toHaveLength(1);
    expect(result.destHtml).toContain(">A</span>");
    expect(result.destHtml).toContain(">B</div>");
  });

  it("returns the root's occurrence-specific remap when root and descendant collide with the destination", () => {
    const sourceHtml =
      `<body>` +
      `<section data-agent-native-node-id="duplicate">` +
      `<span data-agent-native-node-id="duplicate">Child</span>` +
      `</section>` +
      `</body>`;
    const destHtml = `<body><div data-agent-native-node-id="duplicate">Existing</div></body>`;

    const result = moveNodeBetweenDocuments(sourceHtml, destHtml, {
      nodeId: "duplicate",
      sourceSelector: 'section[data-agent-native-node-id="duplicate"]',
    });

    expect(result.status).toBe("applied");
    expect(result.movedNodeId).toBeTruthy();
    expect(result.movedNodeId).not.toBe("duplicate");
    const allIds = Array.from(
      result.destHtml.matchAll(/data-agent-native-node-id="([^"]+)"/g),
      (match) => match[1]!,
    );
    expect(new Set(allIds).size).toBe(allIds.length);
    expect(allIds).toContain(result.movedNodeId!);
    expect(allIds.filter((id) => id === "duplicate")).toHaveLength(1);
  });

  // Regression for the cross-screen "drop lands inside <template> markup"
  // corruption bug: findClosingTag used to do a naive "first </tag> after
  // `from`" search for NON_VISUAL_TAGS (template/script/style/etc), which
  // broke the instant the same tag nested inside itself (a completely
  // ordinary Alpine x-if-wrapping-x-for pattern). That matched the INNER
  // </template> and desynced the whole parse, corrupting contentEnd tracking
  // for real elements and letting body-append land inside template interiors
  // (invisible, Alpine-cloned, unselectable afterward).
  it("no-anchor body-append never lands inside a nested <template> — template depth 2 (x-if wrapping x-for)", () => {
    const sourceHtml = `<body><div data-agent-native-node-id="move-me">Move</div></body>`;
    const destHtml =
      `<body>` +
      `<template x-if="true"><ul><template x-for="t in tasks"><li>Task</li></template></ul></template>` +
      `<div data-agent-native-node-id="real">Real content</div>` +
      `</body>`;

    const result = moveNodeBetweenDocuments(sourceHtml, destHtml, {
      nodeId: "move-me",
    });

    expect(result.status).toBe("applied");
    // Must land after the outer </template>, not inside the nested <ul>.
    const templateCloseIdx = result.destHtml.lastIndexOf("</template>");
    const movedIdx = result.destHtml.indexOf(
      `data-agent-native-node-id="move-me"`,
    );
    expect(movedIdx).toBeGreaterThan(templateCloseIdx);
    // The moved node must be a sibling of <body>'s real content, not nested
    // inside the <ul> that lives inside the templates.
    const ulOpenIdx = result.destHtml.indexOf("<ul>");
    const ulCloseIdx = result.destHtml.indexOf("</ul>");
    expect(movedIdx < ulOpenIdx || movedIdx > ulCloseIdx).toBe(true);
    // Real (non-template) sibling content must be untouched and still present.
    expect(result.destHtml).toContain("Real content");
  });

  it("no-anchor body-append is unaffected by a single-level <template> (no nesting)", () => {
    const sourceHtml = `<body><div data-agent-native-node-id="move-me">Move</div></body>`;
    const destHtml = `<body><template x-if="true"><li>Task</li></template><div data-agent-native-node-id="real">Real</div></body>`;

    const result = moveNodeBetweenDocuments(sourceHtml, destHtml, {
      nodeId: "move-me",
    });

    expect(result.status).toBe("applied");
    expect(result.destHtml).toContain("Real");
    const templateCloseIdx = result.destHtml.indexOf("</template>");
    const movedIdx = result.destHtml.indexOf(
      `data-agent-native-node-id="move-me"`,
    );
    expect(movedIdx).toBeGreaterThan(templateCloseIdx);
  });

  it("no-anchor body-append strips absolute positioning when the destination <body> is a flex container", () => {
    const sourceHtml = `<body><div data-agent-native-node-id="move-me" style="position: absolute; left: 24px; top: 48px; color: red">Move</div></body>`;
    const destHtml = `<body style="display: flex; flex-direction: column; gap: 16px"><div data-agent-native-node-id="existing">Existing</div></body>`;

    const result = moveNodeBetweenDocuments(sourceHtml, destHtml, {
      nodeId: "move-me",
    });

    expect(result.status).toBe("applied");
    // Same normalization as the anchored `placement: "inside"` branch: the
    // moved node becomes a flow child of the flex body, so its stale
    // absolute offsets must be stripped or it renders detached from the
    // body's ordering/gap/alignment.
    const movedIdx = result.destHtml.indexOf(
      `data-agent-native-node-id="move-me"`,
    );
    expect(movedIdx).toBeGreaterThan(-1);
    const movedTag = result.destHtml.slice(
      result.destHtml.lastIndexOf("<", movedIdx),
      result.destHtml.indexOf(">", movedIdx) + 1,
    );
    expect(movedTag).not.toContain("position: absolute");
    expect(movedTag).not.toMatch(/position:\s*relative/i);
    expect(movedTag).not.toContain("left:");
    expect(movedTag).not.toContain("top:");
    // Non-positioning styles on the moved root survive.
    expect(movedTag).toContain("color: red");
  });

  it("no-anchor body-append keeps absolute positioning when the destination <body> is a plain flow container", () => {
    const sourceHtml = `<body><div data-agent-native-node-id="move-me" style="position: absolute; left: 24px; top: 48px">Move</div></body>`;
    const destHtml = `<body><div data-agent-native-node-id="existing">Existing</div></body>`;

    const result = moveNodeBetweenDocuments(sourceHtml, destHtml, {
      nodeId: "move-me",
    });

    expect(result.status).toBe("applied");
    // A non-flex/grid body is a normal positioning context; the moved node's
    // explicit absolute placement is intentional and must be preserved.
    expect(result.destHtml).toContain("position: absolute");
    expect(result.destHtml).toContain("left: 24px");
  });

  it("no-anchor body-append strips leftover flex-item styling when the destination <body> is not flow", () => {
    // Regression: a node dragged OUT of a flex/grid parent into an absolute
    // context (here, a plain non-flex screen root) must lose flex-item-only
    // styling (flex-grow/shrink/basis, align-self, order) — those properties
    // only mean anything inside a flex/grid parent, and leaving them behind
    // is dead source clutter that would resurrect with a stale value if the
    // node were ever reparented back into flow (e.g. via undo). Mirrors the
    // "strips absolute positioning when the destination is flex" case above
    // in the opposite direction.
    const sourceHtml =
      `<body><div data-agent-native-node-id="move-me" ` +
      `style="flex-grow: 2; flex-shrink: 3; flex-basis: 40px; align-self: center; order: 1; color: red">Move</div></body>`;
    const destHtml = `<body><div data-agent-native-node-id="existing">Existing</div></body>`;

    const result = moveNodeBetweenDocuments(sourceHtml, destHtml, {
      nodeId: "move-me",
    });

    expect(result.status).toBe("applied");
    const movedIdx = result.destHtml.indexOf(
      `data-agent-native-node-id="move-me"`,
    );
    expect(movedIdx).toBeGreaterThan(-1);
    const movedTag = result.destHtml.slice(
      result.destHtml.lastIndexOf("<", movedIdx),
      result.destHtml.indexOf(">", movedIdx) + 1,
    );
    expect(movedTag).not.toContain("flex-grow");
    expect(movedTag).not.toContain("flex-shrink");
    expect(movedTag).not.toContain("flex-basis");
    expect(movedTag).not.toContain("align-self");
    expect(movedTag).not.toContain("order");
    // Non-flex-item styles on the moved root survive.
    expect(movedTag).toContain("color: red");
  });

  it("moves an Alpine absolute subtree before a nested grid child without flattening descendant positioning", () => {
    const sourceHtml =
      `<body x-data="{ open: true }">` +
      `<article data-agent-native-node-id="move-me" x-show="open" class="absolute left-4 top-8 rounded">` +
      `<span data-agent-native-node-id="nested" style="position: absolute; left: 3px; top: 5px">Nested</span>` +
      `</article>` +
      `</body>`;
    const destHtml =
      `<body>` +
      `<section data-agent-native-node-id="grid" class="grid grid-cols-2 gap-4">` +
      `<div data-agent-native-node-id="anchor">Anchor</div>` +
      `</section>` +
      `</body>`;

    const result = moveNodeBetweenDocuments(sourceHtml, destHtml, {
      nodeId: "move-me",
      anchorNodeId: "anchor",
      placement: "before",
    });

    expect(result.status).toBe("applied");
    const movedOpenTag = result.destHtml.match(
      /<article[^>]*data-agent-native-node-id="move-me"[^>]*>/,
    )?.[0];
    expect(movedOpenTag).toBeTruthy();
    expect(movedOpenTag).not.toMatch(/\babsolute\b/);
    expect(movedOpenTag).toContain('x-show="open"');
    // Only the moved root becomes a grid-flow child. Its nested absolute
    // positioning context is intentional and must survive the reparent.
    expect(result.destHtml).toContain(
      'data-agent-native-node-id="nested" style="position: absolute; left: 3px; top: 5px"',
    );
    expect(result.destHtml.indexOf("move-me")).toBeLessThan(
      result.destHtml.indexOf("anchor"),
    );
  });

  it("anchored insert (placement inside) never lands inside a nested <template> even when the anchor itself precedes templates", () => {
    const sourceHtml = `<body><div data-agent-native-node-id="move-me">Move</div></body>`;
    const destHtml =
      `<body>` +
      `<div data-agent-native-node-id="container">` +
      `<template x-if="true"><ul><template x-for="t in tasks"><li>Task</li></template></ul></template>` +
      `</div>` +
      `</body>`;

    const result = moveNodeBetweenDocuments(sourceHtml, destHtml, {
      nodeId: "move-me",
      anchorNodeId: "container",
      placement: "inside",
    });

    expect(result.status).toBe("applied");
    // Must not be spliced inside the nested <ul> (inside the templates).
    const ulOpenIdx = result.destHtml.indexOf("<ul>");
    const ulCloseIdx = result.destHtml.indexOf("</ul>");
    const movedIdx = result.destHtml.indexOf(
      `data-agent-native-node-id="move-me"`,
    );
    expect(movedIdx < ulOpenIdx || movedIdx > ulCloseIdx).toBe(true);
  });

  // Finding 8: the template-interior guard (isOffsetInsideTemplateInterior /
  // findEnclosingTemplateClose) used to always redirect a caught offset to
  // the end of <body>/the document (a silent teleport, potentially far from
  // where the user actually dropped). It now redirects to immediately AFTER
  // the ENCLOSING outer </template> instead — still guaranteed-safe (a real
  // DOM slot right after a closing tag), just much closer to the anchor.
  //
  // This is tested directly against findEnclosingTemplateClose (exported
  // for exactly this purpose — see its doc comment) rather than through
  // moveNodeBetweenDocuments: with findClosingTag's offset-miscalculation
  // bug already fixed, every real insertAt this module computes lands
  // outside template interiors in practice, so the guard has no reachable
  // integration-level repro today — it is a true defense-in-depth backstop.
  // The sibling "never lands inside a nested <template>" tests above still
  // cover the end-to-end anchored/no-anchor paths.
  describe("findEnclosingTemplateClose (finding 8 redirect target)", () => {
    it("returns null when the offset is outside any template", () => {
      const html = `<body><template x-if="a"><div>X</div></template><div>Real</div></body>`;
      const realIdx = html.indexOf("<div>Real</div>");
      expect(findEnclosingTemplateClose(html, realIdx)).toBeNull();
    });

    it("returns the OUTER template's closeEnd for an offset inside a nested template interior", () => {
      const html =
        `<body>` +
        `<template x-if="true"><ul><template x-for="t in tasks"><li>Task</li></template></ul></template>` +
        `<div>Trailing</div>` +
        `</body>`;
      const innerOffset = html.indexOf("<li>Task</li>");
      const outerTemplateCloseEnd =
        html.lastIndexOf("</template>") + "</template>".length;
      const result = findEnclosingTemplateClose(html, innerOffset);
      expect(result).not.toBeNull();
      expect(result?.closeEnd).toBe(outerTemplateCloseEnd);
      // The redirect target is right after the outer template's close, NOT
      // doc end — well before "Trailing" and far short of html.length.
      expect(result?.closeEnd).toBeLessThan(html.indexOf("Trailing"));
      expect(result?.closeEnd).toBeLessThan(html.length);
    });

    it("returns the enclosing template's closeEnd for a single-level (non-nested) template", () => {
      const html = `<body><template x-if="true"><li>Task</li></template><div>Real</div></body>`;
      // Offset strictly inside the <li> element's own tag (not exactly at
      // the template's openEnd boundary, which the guard treats as "at",
      // not "inside").
      const innerOffset = html.indexOf("Task");
      const templateCloseEnd =
        html.indexOf("</template>") + "</template>".length;
      const result = findEnclosingTemplateClose(html, innerOffset);
      expect(result?.closeEnd).toBe(templateCloseEnd);
    });
  });

  it("re-parses correctly after a triple-nested same-tag NON_VISUAL_TAGS scenario (template^3)", () => {
    const sourceHtml = `<body><div data-agent-native-node-id="move-me">Move</div></body>`;
    const destHtml =
      `<body>` +
      `<template x-if="a"><template x-if="b"><template x-if="c"><span>Deep</span></template></template></template>` +
      `<div data-agent-native-node-id="real">Real</div>` +
      `</body>`;

    const result = moveNodeBetweenDocuments(sourceHtml, destHtml, {
      nodeId: "move-me",
    });

    expect(result.status).toBe("applied");
    expect(result.destHtml).toContain("Real");
    const lastTemplateCloseIdx = result.destHtml.lastIndexOf("</template>");
    const movedIdx = result.destHtml.indexOf(
      `data-agent-native-node-id="move-me"`,
    );
    expect(movedIdx).toBeGreaterThan(lastTemplateCloseIdx);
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

describe("breakpoint-scoped edits (§6.4 Framer cascade)", () => {
  const html = `<html><head></head><body><section data-agent-native-node-id="hero" class="text-sm p-4">Hello</section></body></html>`;

  it("responsive-class with maxWidthPx writes a max-[Npx]: scoped token", () => {
    const patch = applyVisualEdit(html, {
      kind: "responsive-class",
      target: { nodeId: "hero" },
      prefix: "base",
      maxWidthPx: 809,
      operation: "replace",
      utility: "text-lg",
    } as EditIntent);

    expect(patch.result.status).toBe("applied");
    expect(patch.content).toContain("max-[809px]:text-lg");
    // Base token untouched — the override cascades below 810 only.
    expect(patch.content).toContain("text-sm");
  });

  it("responsive-class replace at the same bound swaps the same stem", () => {
    const withOverride = applyVisualEdit(html, {
      kind: "responsive-class",
      target: { nodeId: "hero" },
      prefix: "base",
      maxWidthPx: 809,
      operation: "replace",
      utility: "text-lg",
    } as EditIntent).content;

    const patch = applyVisualEdit(withOverride, {
      kind: "responsive-class",
      target: { nodeId: "hero" },
      prefix: "base",
      maxWidthPx: 809,
      operation: "replace",
      utility: "text-2xl",
    } as EditIntent);

    expect(patch.result.status).toBe("applied");
    expect(patch.content).toContain("max-[809px]:text-2xl");
    expect(patch.content).not.toContain("max-[809px]:text-lg");
  });

  it("responsive-class remove with maxWidthPx strips only that bound's stem", () => {
    const withOverrides = `<html><head></head><body><section data-agent-native-node-id="hero" class="text-sm max-[809px]:text-lg max-[389px]:text-xs">Hello</section></body></html>`;
    const patch = applyVisualEdit(withOverrides, {
      kind: "responsive-class",
      target: { nodeId: "hero" },
      prefix: "base",
      maxWidthPx: 809,
      operation: "remove",
      stem: "font-size",
    } as EditIntent);

    expect(patch.result.status).toBe("applied");
    expect(patch.content).not.toContain("max-[809px]:text-lg");
    expect(patch.content).toContain("max-[389px]:text-xs");
    expect(patch.content).toContain("text-sm");
  });

  it("breakpoint-style writes a managed @media rule targeting the node id", () => {
    const patch = applyVisualEdit(html, {
      kind: "breakpoint-style",
      target: { nodeId: "hero" },
      maxWidthPx: 809,
      property: "left",
      value: "137px",
      operation: "set",
    } as EditIntent);

    expect(patch.result.status).toBe("applied");
    expect(patch.content).toContain("<style data-agent-native-breakpoints>");
    expect(patch.content).toContain("@media (max-width: 809px)");
    // Doubled attribute selector — specificity (0,2,0) so the managed
    // override beats runtime-injected Tailwind CDN utilities (0,1,0). A
    // regression back to the single-attribute form must fail this test.
    expect(patch.content).toContain(
      '[data-agent-native-node-id="hero"][data-agent-native-node-id="hero"] {',
    );
    expect(patch.content).toContain("left: 137px;");
    // The element's inline style is NOT touched — base keeps cascading.
    expect(patch.content).not.toContain('style="left');
  });

  it("breakpoint-style stamps a node id when the element has none", () => {
    const bare = `<html><head></head><body><section class="p-4">Hello</section></body></html>`;
    const projection = buildCodeLayerProjection(bare);
    const section = projection.nodes.find((node) => node.tag === "section");
    expect(section).toBeTruthy();

    const patch = applyVisualEdit(bare, {
      kind: "breakpoint-style",
      target: { nodeId: section!.id },
      maxWidthPx: 1279,
      property: "top",
      value: "24px",
    } as EditIntent);

    expect(patch.result.status).toBe("applied");
    const stamped = /data-agent-native-node-id="([^"]+)"/.exec(patch.content);
    expect(stamped).toBeTruthy();
    // Doubled selector, same as above — single-attribute form is a
    // specificity regression against the Tailwind CDN runtime sheet.
    expect(patch.content).toContain(
      `[data-agent-native-node-id="${stamped![1]}"][data-agent-native-node-id="${stamped![1]}"] {`,
    );
    expect(patch.content).toContain("top: 24px;");
  });

  it("breakpoint-style remove prunes the declaration and empty block", () => {
    const withRule = applyVisualEdit(html, {
      kind: "breakpoint-style",
      target: { nodeId: "hero" },
      maxWidthPx: 809,
      property: "left",
      value: "137px",
    } as EditIntent).content;

    const patch = applyVisualEdit(withRule, {
      kind: "breakpoint-style",
      target: { nodeId: "hero" },
      maxWidthPx: 809,
      property: "left",
      operation: "remove",
    } as EditIntent);

    expect(patch.result.status).toBe("applied");
    expect(patch.content).not.toContain("data-agent-native-breakpoints");
  });

  it("breakpoint-style rejects unsafe values", () => {
    const patch = applyVisualEdit(html, {
      kind: "breakpoint-style",
      target: { nodeId: "hero" },
      maxWidthPx: 809,
      property: "background",
      value: "url(https://evil.example/x)",
    } as EditIntent);

    expect(patch.result.status).toBe("unsupported");
  });

  it("breakpoint-style still rejects url() on the background shorthand even though background-image now allows it", () => {
    const patch = applyVisualEdit(html, {
      kind: "breakpoint-style",
      target: { nodeId: "hero" },
      maxWidthPx: 809,
      property: "background",
      value: 'url("https://example.com/fill.png")',
    } as EditIntent);

    expect(patch.result.status).toBe("unsupported");
  });

  it.each(["background-size", "background-repeat", "background-position"])(
    "breakpoint-style accepts the new fill layer property %s",
    (property) => {
      const patch = applyVisualEdit(html, {
        kind: "breakpoint-style",
        target: { nodeId: "hero" },
        maxWidthPx: 809,
        property,
        value: "cover",
      } as EditIntent);

      expect(patch.result.status).toBe("applied");
      expect(patch.content).toContain(`${property}: cover;`);
    },
  );

  it("breakpoint-style accepts a safe backgroundImage url() and scopes it to the media block", () => {
    const patch = applyVisualEdit(html, {
      kind: "breakpoint-style",
      target: { nodeId: "hero" },
      maxWidthPx: 809,
      property: "backgroundImage",
      value: 'url("https://example.com/fill.png")',
    } as EditIntent);

    expect(patch.result.status).toBe("applied");
    expect(patch.content).toContain("<style data-agent-native-breakpoints>");
    expect(patch.content).toContain(
      'background-image: url("https://example.com/fill.png");',
    );
    expect(patch.content).not.toContain('style="background');
  });

  it("breakpoint-style rejects a backgroundImage url() with an unsafe scheme", () => {
    const patch = applyVisualEdit(html, {
      kind: "breakpoint-style",
      target: { nodeId: "hero" },
      maxWidthPx: 809,
      property: "backgroundImage",
      value: "url(javascript:alert(1))",
    } as EditIntent);

    expect(patch.result.status).toBe("unsupported");
  });

  it("breakpoint-style rejects a backgroundImage data: URI that isn't an image", () => {
    const patch = applyVisualEdit(html, {
      kind: "breakpoint-style",
      target: { nodeId: "hero" },
      maxWidthPx: 809,
      property: "backgroundImage",
      value: "url(data:text/html,<script>alert(1)</script>)",
    } as EditIntent);

    expect(patch.result.status).toBe("unsupported");
  });

  it("breakpoint-style accepts a data:image/... backgroundImage url()", () => {
    const patch = applyVisualEdit(html, {
      kind: "breakpoint-style",
      target: { nodeId: "hero" },
      maxWidthPx: 809,
      property: "backgroundImage",
      value: "url(data:image/png;base64,iVBORw0KGgo=)",
    } as EditIntent);

    expect(patch.result.status).toBe("applied");
  });
});

describe("style edit property normalization for fill layers", () => {
  const html = `<button id="cta">Buy</button>`;

  it.each([
    ["object-fit", "contain"],
    ["objectFit", "cover"],
    ["background-size", "cover"],
    ["backgroundSize", "cover"],
    ["background-repeat", "no-repeat"],
    ["backgroundRepeat", "no-repeat"],
    ["background-position", "center"],
    ["backgroundPosition", "center"],
  ])("normalizes and applies the %s style property", (property, value) => {
    const patch = applyVisualEdit(html, {
      kind: "style",
      target: { selector: "#cta" },
      property,
      value,
    } as EditIntent);

    expect(patch.result.status).toBe("applied");
    expect(patch.content).toContain(value);
  });

  it("applies a safe backgroundImage url() as a base inline style", () => {
    const patch = applyVisualEdit(html, {
      kind: "style",
      target: { selector: "#cta" },
      property: "backgroundImage",
      value: 'url("https://example.com/fill.png")',
    } as EditIntent);

    expect(patch.result.status).toBe("applied");
    expect(patch.content).toContain("background-image");
  });

  it("keeps quoted image URLs intact across sequential style patches", () => {
    const imagePatch = applyVisualEdit(html, {
      kind: "style",
      target: { selector: "#cta" },
      property: "backgroundImage",
      value:
        'url("https://example.com/fill.png") /* agent-native-image-fit:tile */',
    } as EditIntent);
    const repeatPatch = applyVisualEdit(imagePatch.content, {
      kind: "style",
      target: { selector: "#cta" },
      property: "backgroundRepeat",
      value: "repeat",
    } as EditIntent);
    const positionPatch = applyVisualEdit(repeatPatch.content, {
      kind: "style",
      target: { selector: "#cta" },
      property: "backgroundPosition",
      value: "top left",
    } as EditIntent);

    expect(positionPatch.result.status).toBe("applied");
    expect(positionPatch.content).toContain(
      "url(&quot;https://example.com/fill.png&quot;)",
    );
    expect(positionPatch.content).not.toContain("&amp;quot;");
    const projection = buildCodeLayerProjection(positionPatch.content);
    const button = projection.nodes.find((node) => node.tag === "button");
    expect(button?.style["background-image"]).toContain(
      'url("https://example.com/fill.png")',
    );
    expect(button?.style["background-repeat"]).toBe("repeat");
    expect(button?.style["background-position"]).toBe("top left");
  });

  it("rejects a backgroundImage url() with a javascript: scheme", () => {
    const patch = applyVisualEdit(html, {
      kind: "style",
      target: { selector: "#cta" },
      property: "backgroundImage",
      value: "url(javascript:alert(1))",
    } as EditIntent);

    expect(patch.result.status).toBe("unsupported");
    expect(patch.content).toBe(html);
  });

  it("rejects the background shorthand carrying a url(), even a safe-looking one", () => {
    const patch = applyVisualEdit(html, {
      kind: "style",
      target: { selector: "#cta" },
      property: "background",
      value: 'url("https://example.com/fill.png")',
    } as EditIntent);

    expect(patch.result.status).toBe("unsupported");
    expect(patch.content).toBe(html);
  });

  it("still applies a plain color value on the background shorthand", () => {
    const patch = applyVisualEdit(html, {
      kind: "style",
      target: { selector: "#cta" },
      property: "background",
      value: "#f5f5f5",
    } as EditIntent);

    expect(patch.result.status).toBe("applied");
    expect(patch.content).toContain("background: #f5f5f5");
  });
});

describe("design node classification", () => {
  const typeOf = (html: string, tag: string) => {
    const tree = buildCodeLayerTree(buildCodeLayerProjection(html));
    const found: Array<{ type: string; name: string; isComponent?: boolean }> =
      [];
    const walk = (nodes: ReturnType<typeof buildCodeLayerTree>) => {
      for (const node of nodes) {
        if (node.tag === tag) {
          found.push({
            type: node.type,
            name: node.name,
            isComponent: node.isComponent,
          });
        }
        walk(node.children);
      }
    };
    walk(tree);
    return found[0];
  };

  it("classifies a painted, padded text leaf as a frame, not text", () => {
    const node = typeOf(
      `<div><button class="px-6 py-3 bg-blue-600 rounded">Get Started</button></div>`,
      "button",
    );
    expect(node?.type).toBe("frame");
    expect(node?.isComponent).toBe(true);
  });

  it("keeps a plain text leaf as text", () => {
    expect(typeOf(`<div><a href="/x">Features</a></div>`, "a")?.type).toBe(
      "text",
    );
    expect(
      typeOf(`<div><h1 class="text-4xl">Hello</h1></div>`, "h1")?.type,
    ).toBe("text");
  });

  it("keeps a heading with inline runs as one text layer", () => {
    const html = `<div><h1 class="text-4xl">Transform <span class="text-blue-400">Your</span> Workflow</h1></div>`;
    const heading = typeOf(html, "h1");
    expect(heading?.type).toBe("text");
    expect(heading?.name).toBe("Transform Your Workflow");
    expect(typeOf(html, "span")).toBeUndefined();
  });

  it("classifies painted void leaves by their radius", () => {
    const dot = buildCodeLayerTree(
      buildCodeLayerProjection(
        `<section><div class="w-3 h-3 rounded-full bg-red-500"></div><div class="h-px w-full bg-border"></div></section>`,
      ),
    )[0]?.children;
    expect(dot?.[0]?.type).toBe("ellipse");
    expect(dot?.[1]?.type).toBe("shape");
  });

  it("treats a wide rounded-full box as a pill, not an ellipse", () => {
    const shapes = buildCodeLayerTree(
      buildCodeLayerProjection(
        `<section><div class="w-20 h-6 rounded-full bg-slate-200"></div><div class="size-3 rounded-full bg-red-500"></div></section>`,
      ),
    )[0]?.children;
    expect(shapes?.[0]?.type).toBe("shape");
    expect(shapes?.[1]?.type).toBe("ellipse");
  });

  it("does not treat a colour utility as a component marker", () => {
    const card = typeOf(
      `<section><div class="p-6 rounded-lg border bg-card"><p>Body</p></div></section>`,
      "div",
    );
    expect(card?.type).toBe("frame");
    expect(card?.isComponent).toBe(false);
  });

  it("never names a layer after a tailwind utility", () => {
    const tree = buildCodeLayerTree(
      buildCodeLayerProjection(
        `<section><div class="flex flex-col opacity-90 top-0"><p class="text-lg">Body</p></div></section>`,
      ),
    );
    expect(tree[0]?.children[0]?.name).toBe("Frame");
  });
});

describe("wrapBareTextLeavesInHtml", () => {
  it("gives a painted text leaf its own text layer", () => {
    const wrapped = wrapBareTextLeavesInHtml(
      `<div><button class="px-6 py-3 bg-blue-600">Get Started</button></div>`,
    );
    expect(wrapped.wrapped).toBe(1);
    const tree = buildCodeLayerTree(buildCodeLayerProjection(wrapped.content));
    const button = tree[0]?.children[0];
    expect(button?.type).toBe("frame");
    expect(button?.children[0]?.type).toBe("text");
    expect(button?.children[0]?.name).toBe("Get Started");
  });

  it("is idempotent", () => {
    const html = `<div><button class="px-6 py-3 bg-blue-600">Save</button></div>`;
    const once = wrapBareTextLeavesInHtml(html);
    expect(once.changed).toBe(true);
    expect(once.wrapped).toBe(1);
    const twice = wrapBareTextLeavesInHtml(once.content);
    expect(twice.changed).toBe(false);
    expect(twice.content).toBe(once.content);
  });

  it("leaves unpainted text and mixed content alone", () => {
    const result = wrapBareTextLeavesInHtml(
      `<div><h1 class="text-4xl">Title</h1><p class="p-4 bg-muted">Hi <b>there</b></p><button class="px-4 py-2 bg-blue-600">Save</button></div>`,
    );
    expect(result.wrapped).toBe(1);
    expect(result.content).toContain(`<h1 class="text-4xl">Title</h1>`);
    expect(result.content).toContain(
      `<p class="p-4 bg-muted">Hi <b>there</b></p>`,
    );
  });
});
