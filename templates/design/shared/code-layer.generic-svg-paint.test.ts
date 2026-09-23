import { describe, expect, it } from "vitest";

import { applyVisualEdit, buildCodeLayerProjection } from "./code-layer";

describe("generic inline SVG fill edits", () => {
  it("routes a single direct SVG shape fill to the shape child", () => {
    const html = `<svg data-agent-native-node-id="icon" style="width:24px;height:24px" viewBox="0 0 24 24"><circle cx="12" cy="12" r="8" fill="#f97316" stroke="#111827" stroke-width="2"/></svg>`;
    const node = buildCodeLayerProjection(html).nodes[0];
    expect(node?.style.fill).toBe("#f97316");

    const result = applyVisualEdit(html, {
      kind: "style",
      target: { nodeId: "icon" },
      property: "fill",
      value: "#3b82f6",
    });

    expect(result.result.status).toBe("applied");
    expect(result.content).toMatch(
      /<circle[^>]*fill="#f97316"[^>]*style="[^"]*fill: #3b82f6/,
    );
    expect(result.content).toContain('stroke="#111827"');
    expect(result.content).not.toMatch(/<svg[^>]*style="[^"]*fill: #3b82f6/);
  });

  it("uses the SVG default black fill for an unpainted direct path", () => {
    const html = `<svg data-agent-native-node-id="icon" style="width:24px;height:24px"><path d="M0 0h20v20z"/></svg>`;
    const node = buildCodeLayerProjection(html).nodes[0];

    expect(node?.style.fill).toBe("black");
  });
});

describe("imported SVG paint through <g> wrappers", () => {
  const JEV = `<svg data-agent-native-node-id="jev" style="position:absolute;width:38px;height:43px;background-color:#ff0000;border-width:1px;border-style:solid;border-color:#ffd6d6" viewBox="0 0 299 420" fill="none"><g transform="scale(2.92 2.92)"><path d="M0 0h20v20z" fill-rule="nonzero" fill="rgb(254, 254, 254)"/></g></svg>`;

  it("reads the wrapped path's fill as the vector's fill", () => {
    expect(buildCodeLayerProjection(JEV).nodes[0]?.style.fill).toBe(
      "rgb(254, 254, 254)",
    );
  });

  it("writes fill and stroke onto the path, clears box paint, and pins stroke weight to screen px", () => {
    const filled = applyVisualEdit(JEV, {
      kind: "style",
      target: { nodeId: "jev" },
      property: "fill",
      value: "#ff0000",
    });
    expect(filled.result.status).toBe("applied");
    expect(filled.content).toMatch(/<path[^>]*style="[^"]*fill: #ff0000/);
    expect(filled.content).not.toMatch(/<svg[^>]*background-color/);
    expect(filled.content).not.toMatch(/<svg[^>]*border-color/);

    const stroked = applyVisualEdit(filled.content, {
      kind: "style",
      target: { nodeId: "jev" },
      property: "stroke-width",
      value: "2px",
    });
    expect(stroked.content).toMatch(
      /<path[^>]*style="[^"]*stroke-width: 2px[^"]*vector-effect: non-scaling-stroke/,
    );
  });

  it("treats several shapes as one paint when they agree, Mixed when not, and writes all", () => {
    const two = (a: string, b: string) =>
      `<svg data-agent-native-node-id="icon" viewBox="0 0 24 24"><g><path d="M0 0h1v1z" fill="${a}"/></g><circle cx="12" cy="12" r="4" fill="${b}"/><defs><path d="M0 0" fill="#00ff00"/></defs></svg>`;
    expect(
      buildCodeLayerProjection(two("#111111", "#111111")).nodes[0]?.style.fill,
    ).toBe("#111111");
    expect(
      buildCodeLayerProjection(two("#111111", "#222222")).nodes[0]?.style.fill,
    ).toBe("Mixed");

    const result = applyVisualEdit(two("#111111", "#222222"), {
      kind: "style",
      target: { nodeId: "icon" },
      property: "fill",
      value: "#abcdef",
    });
    expect(result.result.status).toBe("applied");
    expect(result.content.match(/fill: #abcdef/g)).toHaveLength(2);
    expect(result.content).toContain('<path d="M0 0" fill="#00ff00"/>');
  });
});
