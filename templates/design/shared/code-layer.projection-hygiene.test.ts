import { describe, expect, it } from "vitest";

import { applyVisualEdit, buildCodeLayerProjection } from "./code-layer";

function project(html: string) {
  return buildCodeLayerProjection(html).nodes;
}

describe("layer names never leak source code", () => {
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

  it.each([
    [
      `<section><h2> Hello&nbsp;<b>big</b>&amp;<i> small </i></h2><p>tail &#x26;lt; end</p></section>`,
      [
        ["section", "Hello big & small tail < end"],
        ["h2", "Hello big & small"],
        ["b", "big"],
        ["i", "small"],
        ["p", "tail < end"],
      ],
    ],
    [
      `<div><span title="a > b" x-show="n > 0">kept</span> after</div>`,
      [
        ["div", "kept after"],
        ["span", "kept"],
      ],
    ],
    [
      `<ul><li>one<li>two</ul>`,
      [
        ["ul", "one two"],
        ["li", "one"],
        ["li", "two"],
      ],
    ],
    [
      `<section><span>a <'</span>b'> c</section>`,
      [
        ["section", "a c"],
        ["span", "a"],
      ],
    ],
  ])("reads nested text for %s", (html, expected) => {
    expect(project(html).map((node) => [node.tag, node.textSnippet])).toEqual(
      expected,
    );
  });

  it("truncates text gathered across children", () => {
    const long = "word ".repeat(40).trim();
    const [article, first] = project(
      `<article><p>${long}</p><p>more</p></article>`,
    );

    expect(article?.textSnippet).toBe(`${long.slice(0, 157)}...`);
    expect(first?.textSnippet).toBe(`${long.slice(0, 157)}...`);
  });
});

describe("boxless void metadata is not a layer", () => {
  it("skips source and track inside picture and video", () => {
    const html = `<body>
      <picture class="shot"><source srcset="a.webp" type="image/webp" /><img src="a.png" alt="a" /></picture>
      <video class="clip" controls><source src="v.mp4" type="video/mp4" /><track kind="captions" src="c.vtt" /></video>
    </body>`;
    const nodes = project(html);

    expect(nodes.some((node) => node.tag === "source")).toBe(false);
    expect(nodes.some((node) => node.tag === "track")).toBe(false);
    expect(nodes.some((node) => node.tag === "picture")).toBe(true);
    expect(nodes.some((node) => node.tag === "img")).toBe(true);
    expect(nodes.some((node) => node.tag === "video")).toBe(true);
  });
});

describe("a position that source does not have is never resolved to a different element", () => {
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
