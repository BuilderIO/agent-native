import { describe, expect, it } from "vitest";

import { applyVisualEdit, buildCodeLayerProjection } from "./code-layer";

describe("generic inline SVG fill edits", () => {
  it("projects only drawable children of pasted SVGs and edits one shape in place", () => {
    const html = `<svg data-agent-native-node-id="pasted" data-an-primitive="pasted-svg" fill="#111111"><defs><linearGradient id="paint"><stop offset="0" stop-color="red"/></linearGradient><clipPath id="cut"><circle r="5"/></clipPath></defs><path data-agent-native-node-id="first" d="M0 0h10v10z" fill="#f97316"/><circle data-agent-native-node-id="second" cx="15" cy="5" r="4" fill="#16a34a"/></svg>`;
    const projection = buildCodeLayerProjection(html);
    expect(projection.nodes.map((node) => node.tag)).toEqual([
      "svg",
      "path",
      "circle",
    ]);
    const firstShape = projection.nodes.find((node) => node.tag === "path");
    expect(firstShape?.style.fill).toBe("#f97316");

    const result = applyVisualEdit(html, {
      kind: "style",
      target: { nodeId: firstShape!.id },
      property: "fill",
      value: "#3b82f6",
    });

    expect(result.result.status).toBe("applied");
    expect(result.content).toContain('data-agent-native-node-id="second"');
    expect(result.content).toContain('fill="#16a34a"');
    expect(result.content).toContain('fill="#111111"');
    expect(result.content).toMatch(
      /<path[^>]*data-agent-native-node-id="first"[^>]*fill="#f97316"[^>]*style="[^"]*fill: #3b82f6/,
    );
  });

  it("keeps authored SVGs fail-closed and hides their geometry from the projection", () => {
    const html = `<svg data-agent-native-node-id="authored"><defs><linearGradient id="paint"/></defs><path data-agent-native-node-id="authored-path" d="M0 0h10v10z" fill="#f97316"/><circle data-agent-native-node-id="authored-circle" r="4"/></svg>`;
    const projection = buildCodeLayerProjection(html);
    expect(projection.nodes.map((node) => node.tag)).toEqual(["svg"]);

    const result = applyVisualEdit(html, {
      kind: "style",
      target: { nodeId: "authored-path" },
      property: "fill",
      value: "#3b82f6",
    });
    expect(["unsupported", "conflict"]).toContain(result.result.status);
    expect(result.content).toBe(html);
  });

  it("routes a marked pasted SVG path fill to its only direct shape", () => {
    const html = `<svg data-agent-native-node-id="pasted" data-an-primitive="pasted-svg" viewBox="0 0 20 20"><path d="M0 0h20v20z" fill="#f97316"/></svg>`;
    const node = buildCodeLayerProjection(html).nodes[0];
    expect(node?.style.fill).toBe("#f97316");

    const result = applyVisualEdit(html, {
      kind: "style",
      target: { nodeId: "pasted" },
      property: "fill",
      value: "#3b82f6",
    });

    expect(result.result.status).toBe("applied");
    expect(result.content).toMatch(
      /<path[^>]*fill="#f97316"[^>]*style="[^\"]*fill: #3b82f6/,
    );
    expect(result.content).not.toMatch(/<svg[^>]*style="[^\"]*fill: #3b82f6/);
  });

  it("routes a marked pasted SVG fill through a group with one drawable shape", () => {
    const html = `<svg data-agent-native-node-id="pasted" data-an-primitive="pasted-svg"><g><path d="M0 0h20v20z" fill="#f97316"/></g></svg>`;
    const result = applyVisualEdit(html, {
      kind: "style",
      target: { nodeId: "pasted" },
      property: "fill",
      value: "#3b82f6",
    });

    expect(result.result.status).toBe("applied");
    expect(result.content).toMatch(
      /<path[^>]*fill="#f97316"[^>]*style="[^\"]*fill: #3b82f6/,
    );
    expect(result.content).not.toMatch(/<svg[^>]*style="[^\"]*fill: #3b82f6/);
  });

  it("keeps a grouped multi-shape pasted SVG wrapper paint ambiguous", () => {
    const html = `<svg data-agent-native-node-id="pasted" data-an-primitive="pasted-svg"><g><path d="M0 0h20v20z"/><circle cx="10" cy="10" r="4"/></g></svg>`;
    const result = applyVisualEdit(html, {
      kind: "style",
      target: { nodeId: "pasted" },
      property: "fill",
      value: "#3b82f6",
    });

    expect(result.result.status).toBe("unsupported");
    expect(result.content).toBe(html);
  });

  it("refuses paint edits for marked pasted SVGs with multiple direct shapes", () => {
    const html = `<svg data-agent-native-node-id="pasted" data-an-primitive="pasted-svg"><path d="M0 0h20v20z"/><circle cx="10" cy="10" r="4"/></svg>`;
    const result = applyVisualEdit(html, {
      kind: "style",
      target: { nodeId: "pasted" },
      property: "fill",
      value: "#3b82f6",
    });

    expect(result.result.status).toBe("unsupported");
    expect(result.content).toBe(html);
  });

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
