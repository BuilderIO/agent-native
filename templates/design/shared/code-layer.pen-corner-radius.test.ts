import { describe, expect, it } from "vitest";

import { applyVisualEdit } from "./code-layer";

const penSvg = (nodes: string, d: string) =>
  `<svg data-agent-native-node-id="pen" data-an-primitive="path" viewBox="0 0 100 100" style="position:absolute;left:0px;top:0px;width:100px;height:100px" data-an-pen-nodes="${nodes}"><path d="${d}" fill="none" stroke="#000000"></path></svg>`;

const setRadius = (html: string, value: string) =>
  applyVisualEdit(html, {
    kind: "style",
    target: { nodeId: "pen" },
    property: "border-radius",
    value,
  });

describe("corner radius on a pen vector", () => {
  const square = penSvg(
    "[1,[0,0,null,null,null,null],[100,0,null,null,null,null],[100,100,null,null,null,null],[0,100,null,null,null,null]]",
    "M 0 0 L 100 0 L 100 100 L 0 100 L 0 0 Z",
  );

  it("rounds the path's vertices and remembers the radius", () => {
    const result = setRadius(square, "15px");
    expect(result.result.status).toBe("applied");
    expect(result.content).toContain(
      'd="M 15 0 L 85 0 A 15 15 0 0 1 100 15 L 100 85',
    );
    expect(result.content).toContain('data-an-corner-radius="15"');
  });

  it("restores sharp corners at radius 0", () => {
    const rounded = setRadius(square, "15px").content;
    expect(setRadius(rounded, "0px").content).toContain(
      'd="M 0 0 L 100 0 L 100 100 L 0 100 L 0 0 Z"',
    );
  });

  it("rounds a pasted vector's paths, through its viewBox and <g> scale", () => {
    const html = `<svg data-agent-native-node-id="pen" viewBox="0 0 100 100" style="width:50px;height:50px;border-radius:90px"><g transform="scale(2 2)"><path d="M0 0 L40 0 L40 40 L0 40 Z M5 5 L10 5 L10 10 Z" fill="#fff"></path></g></svg>`;
    const result = setRadius(html, "5px");
    expect(result.result.status).toBe("applied");
    expect(result.content).toContain('d="M 5 0 L 35 0 A 5 5 0 0 1 40 5');
    expect(result.content).toContain("A 1.464 1.464 0 0 1 10 6.464");
    expect(result.content).toContain(
      'data-an-source-d="M0 0 L40 0 L40 40 L0 40 Z M5 5 L10 5 L10 10 Z"',
    );
    expect(result.content).not.toMatch(/border-radius/);
    expect(result.content).toContain('data-an-corner-radius="5"');
    const cleared = setRadius(result.content, "0px").content;
    expect(cleared).toContain(
      'd="M0 0 L40 0 L40 40 L0 40 Z M5 5 L10 5 L10 10 Z"',
    );
  });

  it("replaces per-vertex radii with the vector radius", () => {
    const html = penSvg(
      "[1,[0,0,null,null,null,null,null],[100,0,null,null,null,null,30],[100,100,null,null,null,null,null],[0,100,null,null,null,null,null]]",
      "M 0 0 L 100 0 L 100 100 L 0 100 L 0 0 Z",
    );
    const result = setRadius(html, "10px");
    expect(result.content).toContain(
      'data-an-pen-nodes="[1,[0,0,null,null,null,null,null],[100,0,null,null,null,null,null],[100,100,null,null,null,null,null],[0,100,null,null,null,null,null]]"',
    );
    expect(result.content).toContain("A 10 10 0 0 1 100 10");
  });

  it("refuses a breakpoint-scoped radius the path cannot follow", () => {
    const result = applyVisualEdit(square, {
      kind: "breakpoint-style",
      target: { nodeId: "pen" },
      maxWidthPx: 800,
      property: "border-radius",
      value: "15px",
    });
    expect(result.result.status).toBe("unsupported");
    expect(result.content).toBe(square);
  });
});

describe("resizing a Figma-imported vector", () => {
  const svg = (extra = "") =>
    `<svg data-agent-native-node-id="v" data-figma-node-id="1:2" viewBox="0 0 30 40" style="width:30px;height:40px"${extra}><path d="M0 0 L30 40"></path></svg>`;

  it("stretches like Figma instead of letterboxing", () => {
    const result = applyVisualEdit(svg(), {
      kind: "style",
      target: { nodeId: "v" },
      property: "width",
      value: "90px",
    });
    expect(result.result.status).toBe("applied");
    expect(result.content).toContain('preserveAspectRatio="none"');
    expect(result.content).toContain("width: 90px");
  });

  it("leaves an explicit preserveAspectRatio and non-Figma icons alone", () => {
    const kept = applyVisualEdit(svg(' preserveAspectRatio="xMidYMid meet"'), {
      kind: "style",
      target: { nodeId: "v" },
      property: "width",
      value: "90px",
    });
    expect(kept.content).toContain('preserveAspectRatio="xMidYMid meet"');
    const icon = applyVisualEdit(
      svg().replace(' data-figma-node-id="1:2"', ""),
      {
        kind: "style",
        target: { nodeId: "v" },
        property: "width",
        value: "90px",
      },
    );
    expect(icon.content).not.toContain("preserveAspectRatio");
  });
});
