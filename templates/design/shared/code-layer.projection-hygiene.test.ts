import { describe, expect, it } from "vitest";

import { applyVisualEdit, buildCodeLayerProjection } from "./code-layer";

function project(html: string) {
  return buildCodeLayerProjection(html).nodes;
}

describe("layer names never leak source code", () => {
  // A `>` inside a quoted attribute is ordinary Alpine. Naive tag-stripping
  // ends the tag there and spills the attribute into the parent's text.
  it("does not spill an arrow function into the parent's name", () => {
    const html = `<body><ul class="feed"><template x-for="a in items.filter(x => x.unread)" :key="a.id"><li>Row</li></template></ul></body>`;
    const list = project(html).find((node) => node.classes.includes("feed"));

    expect(list?.layerName).not.toContain("=>");
    expect(list?.layerName).not.toContain(":key");
    expect(list?.layerName).not.toContain("unread");
  });

  it("does not spill a comparison in a binding into the parent's name", () => {
    const html = `<body><section class="wrap"><p x-show="count > 0">Live</p></section></body>`;
    const wrap = project(html).find((node) => node.classes.includes("wrap"));

    expect(wrap?.layerName).not.toContain(">");
    expect(wrap?.layerName).not.toContain("count");
  });

  it("still reads real text through nested markup", () => {
    const html = `<body><h1>Hello <strong>there</strong> friend</h1></body>`;
    const heading = project(html).find((node) => node.tag === "h1");

    expect(heading?.textSnippet).toBe("Hello there friend");
  });
});

describe("boxless void metadata is not a layer", () => {
  // Both bridges already strip these from the runtime snapshot, so a row for
  // one is a layer the panel offers and the canvas can never show.
  it("skips source and track inside picture and video", () => {
    const html = `<body>
      <picture class="shot"><source srcset="a.webp" type="image/webp" /><img src="a.png" alt="a" /></picture>
      <video class="clip" controls><source src="v.mp4" type="video/mp4" /><track kind="captions" src="c.vtt" /></video>
    </body>`;
    const nodes = project(html);

    expect(nodes.some((node) => node.tag === "source")).toBe(false);
    expect(nodes.some((node) => node.tag === "track")).toBe(false);
    // The elements that DO have a box stay.
    expect(nodes.some((node) => node.tag === "picture")).toBe(true);
    expect(nodes.some((node) => node.tag === "img")).toBe(true);
    expect(nodes.some((node) => node.tag === "video")).toBe(true);
  });
});

describe("a position that source does not have is never resolved to a different element", () => {
  // A repeat plus one static sibling: clone row 2 yields `li:nth-of-type(2)`,
  // which source lacks. Stripping the position leaves the STATIC row.
  const REPEAT_PLUS_STATIC = `<body><ul data-agent-native-node-id="an-list">
  <template x-for="t in todos" :key="t.text"><li class="row">x</li></template>
  <li class="row" data-agent-native-node-id="an-static">+ Add a task</li>
</ul></body>`;

  it("refuses instead of writing the user's edit onto the static sibling", () => {
    const patch = applyVisualEdit(REPEAT_PLUS_STATIC, {
      kind: "style",
      target: {
        selector: 'ul[data-agent-native-node-id="an-list"] > li:nth-of-type(2)',
      },
      property: "padding",
      value: "40px",
    });

    expect(patch.result.status).not.toBe("applied");
    expect(patch.content).toBe(REPEAT_PLUS_STATIC);
    expect(patch.content).not.toContain("40px");
  });

  it("still resolves normally through a stable node id", () => {
    const patch = applyVisualEdit(REPEAT_PLUS_STATIC, {
      kind: "style",
      target: { nodeId: "an-static" },
      property: "padding",
      value: "40px",
    });

    expect(patch.result.status).toBe("applied");
    expect(patch.content).toContain("40px");
  });
});

describe("the position-tolerant retry needs evidence, not just uniqueness", () => {
  it("allows the drift case, where the part keeps its class", () => {
    const html = `<section class="list"><div class="row">A</div><div class="target">C</div></section>`;
    const patch = applyVisualEdit(html, {
      kind: "style",
      target: { selector: "section.list > div.target:nth-of-type(9)" },
      property: "color",
      value: "#111",
    });

    expect(patch.result.status).toBe("applied");
  });

  it("refuses when stripping leaves a bare tag, whatever the markup", () => {
    for (const selector of [
      "ul > li:nth-of-type(4)",
      "div > p:nth-of-type(2)",
      "section.list > div:nth-of-type(3)",
    ]) {
      const html = `<body><ul><li>only</li></ul><div><p>only</p></div><section class="list"><div>only</div></section></body>`;
      const patch = applyVisualEdit(html, {
        kind: "style",
        target: { selector },
        property: "color",
        value: "#111",
      });

      expect(patch.result.status, selector).toBe("conflict");
      expect(patch.content, selector).toBe(html);
    }
  });
});
