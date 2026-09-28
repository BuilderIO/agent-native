import { describe, expect, it } from "vitest";

import { buildCodeLayerProjection } from "./code-layer";

function paintsOwnText(html: string, className: string): boolean {
  const node = buildCodeLayerProjection(html).nodes.find((candidate) =>
    candidate.classes.includes(className),
  );
  if (!node) throw new Error(`no node with class ${className}`);
  return node.paintsOwnText;
}

describe("which elements hold text of their own", () => {
  it("a row of dot, label and checkbox holds none", () => {
    const html = `<body><li class="row"><span class="dot"></span><span class="label">Buy milk</span><input class="check" type="checkbox" /></li></body>`;

    expect(paintsOwnText(html, "row")).toBe(false);
    expect(paintsOwnText(html, "label")).toBe(true);
  });

  it("an activity row with two texts still holds none itself", () => {
    const html = `<body><li class="row"><div class="body"><p class="msg">Closed the PR</p><p class="when">4m ago</p></div></li></body>`;

    expect(paintsOwnText(html, "row")).toBe(false);
    expect(paintsOwnText(html, "body")).toBe(false);
    expect(paintsOwnText(html, "msg")).toBe(true);
  });

  it("a plain list item holds its own", () => {
    expect(
      paintsOwnText(`<body><li class="row">Buy milk</li></body>`, "row"),
    ).toBe(true);
  });

  it("counts text sitting beside a child element", () => {
    const html = `<body><li class="row">Label: <span class="v">42</span></li></body>`;

    expect(paintsOwnText(html, "row")).toBe(true);
  });

  it("counts text that trails a child element", () => {
    const html = `<body><li class="row"><span class="v">42</span> items left</li></body>`;

    expect(paintsOwnText(html, "row")).toBe(true);
  });

  it("does not count whitespace between children as text", () => {
    const html = `<body><li class="row">\n  <span class="a">one</span>\n  <span class="b">two</span>\n</li></body>`;

    expect(paintsOwnText(html, "row")).toBe(false);
  });
});
