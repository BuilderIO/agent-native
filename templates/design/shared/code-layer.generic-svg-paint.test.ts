import { describe, expect, it } from "vitest";

import {
  applyVisualEdit,
  buildCodeLayerProjection,
  buildCodeLayerTree,
} from "./code-layer";

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

  it("refuses fill and stroke edits on use elements", () => {
    const html = `<svg data-agent-native-node-id="pasted" data-an-primitive="pasted-svg" viewBox="0 0 20 10"><defs><path id="source" d="M0 0h20v10z" fill="#f97316" stroke="#111827"/></defs><use id="instance" href="#source"/></svg>`;
    const useNode = buildCodeLayerProjection(html).nodes.find(
      (node) => node.tag === "use",
    );
    expect(useNode).toBeDefined();

    for (const nodeId of [useNode!.id, "pasted"]) {
      for (const property of ["fill", "stroke"] as const) {
        const result = applyVisualEdit(html, {
          kind: "style",
          target: { nodeId },
          property,
          value: property === "fill" ? "#3b82f6" : "#22c55e",
        });

        expect(result.result.status).toBe("unsupported");
        expect(result.content).toBe(html);
      }
    }
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

  it("keeps sequential stroke gradients on the selected pasted SVG shapes", () => {
    const html = `<svg data-agent-native-node-id="pasted" data-an-primitive="pasted-svg" viewBox="0 0 20 10" style="width:20px;height:10px"><path id="first" d="M0 0h8v8z" stroke="#111111"/><path id="second" d="M12 0h8v8z" stroke="#222222" style="fill: none"/></svg>`;
    const firstNode = buildCodeLayerProjection(html).nodes.find(
      (node) => node.attributes.id === "first",
    );
    expect(firstNode).toBeDefined();

    const first = applyVisualEdit(html, {
      kind: "style",
      target: { nodeId: firstNode!.id },
      property: "stroke",
      value: "linear-gradient(90deg, #ff0000 0%, #0000ff 100%)",
    });
    expect(first.result.status).toBe("applied");

    const secondNode = buildCodeLayerProjection(first.content).nodes.find(
      (node) => node.attributes.id === "second",
    );
    expect(secondNode).toBeDefined();
    const second = applyVisualEdit(first.content, {
      kind: "style",
      target: { nodeId: secondNode!.id },
      property: "stroke",
      value: "linear-gradient(90deg, #00ff00 0%, #0000ff 100%)",
    });

    expect(second.result.status).toBe("applied");
    const firstPath = second.content.match(/<path\b[^>]*id="first"[^>]*>/)?.[0];
    const secondPath = second.content.match(
      /<path\b[^>]*id="second"[^>]*>/,
    )?.[0];
    expect(firstPath).toBeDefined();
    expect(secondPath).toBeDefined();
    for (const [path, gradientId, gradient] of [
      [
        firstPath!,
        "pasted-stroke-gradient",
        "linear-gradient(90deg, #ff0000 0%, #0000ff 100%)",
      ],
      [
        secondPath!,
        "pasted-stroke-gradient-2",
        "linear-gradient(90deg, #00ff00 0%, #0000ff 100%)",
      ],
    ] as const) {
      expect(path.match(/\bstyle=/g)).toHaveLength(1);
      expect(path).toContain(`stroke: url(#${gradientId})`);
      expect(path).toContain(`--an-vector-stroke-gradient: ${gradient}`);
    }
    expect(second.content).toContain('id="pasted-stroke-gradient"');
    expect(second.content).toContain('id="pasted-stroke-gradient-2"');

    const refreshedSecondNode = buildCodeLayerProjection(
      second.content,
    ).nodes.find((node) => node.attributes.id === "second");
    const solidSecond = applyVisualEdit(second.content, {
      kind: "style",
      target: { nodeId: refreshedSecondNode!.id },
      property: "stroke",
      value: "#00ff00",
    });
    expect(solidSecond.result.status).toBe("applied");
    expect(solidSecond.content).toContain('id="pasted-stroke-gradient"');
    expect(solidSecond.content).not.toContain('id="pasted-stroke-gradient-2"');
    const solidFirstPath = solidSecond.content.match(
      /<path\b[^>]*id="first"[^>]*>/,
    )?.[0];
    const solidSecondPath = solidSecond.content.match(
      /<path\b[^>]*id="second"[^>]*>/,
    )?.[0];
    expect(solidFirstPath).toContain(
      "--an-vector-stroke-gradient: linear-gradient(",
    );
    expect(solidFirstPath).toContain("stroke: url(#pasted-stroke-gradient)");
    expect(solidSecondPath).toContain("stroke: #00ff00");
    expect(solidSecondPath).not.toContain("--an-vector-stroke-gradient");
  });

  it("inserts a grouped shape's stroke gradient into its owning pasted SVG", () => {
    const html = `<svg data-agent-native-node-id="pasted" data-an-primitive="pasted-svg" viewBox="0 0 20 10" style="width:20px;height:10px"><g><path id="nested" d="M0 0h20v10z" stroke="#111111"/></g></svg>`;
    const node = buildCodeLayerProjection(html).nodes.find(
      (candidate) => candidate.attributes.id === "nested",
    );
    expect(node).toBeDefined();

    const result = applyVisualEdit(html, {
      kind: "style",
      target: { nodeId: node!.id },
      property: "stroke",
      value: "linear-gradient(90deg, #ff0000 0%, #0000ff 100%)",
    });

    expect(result.result.status).toBe("applied");
    expect(result.content).toMatch(
      /<svg[^>]*><defs data-an-vector-stroke-gradient="">[\s\S]*<\/defs><g><path[^>]*id="nested"[^>]*style="[^"]*stroke: url\(#pasted-stroke-gradient\)/,
    );
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

describe("imported SVG paint through <g> wrappers", () => {
  const JEV = `<svg data-agent-native-node-id="jev" data-an-primitive="pasted-svg" style="position:absolute;width:38px;height:43px;background-color:#ff0000;border-width:1px;border-style:solid;border-color:#ffd6d6" viewBox="0 0 299 420" fill="none"><g transform="scale(2.92 2.92)"><path d="M0 0h20v20z" fill-rule="nonzero" fill="rgb(254, 254, 254)"/></g></svg>`;

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
    expect(stroked.content).toMatch(/<path[^>]*style="[^"]*stroke-width: 2px/);
  });

  it("keeps an unmarked multi-shape SVG as a generic wrapper", () => {
    const two = (a: string, b: string) =>
      `<div data-agent-native-node-id="container"><svg data-agent-native-node-id="icon" viewBox="0 0 24 24"><g><path d="M0 0h1v1z" fill="${a}"/></g><circle cx="12" cy="12" r="4" fill="${b}"/><defs><path d="M0 0" fill="#00ff00"/></defs></svg></div>`;
    const html = two("#111111", "#222222");
    const tree = buildCodeLayerTree(buildCodeLayerProjection(html));
    expect(tree[0]?.children.map((node) => node.type)).toEqual(["shape"]);

    const result = applyVisualEdit(html, {
      kind: "style",
      target: { nodeId: "icon" },
      property: "fill",
      value: "#abcdef",
    });
    expect(result.result.status).toBe("applied");
    expect(result.content).toMatch(/<circle[^>]*style="[^"]*fill: #abcdef/);
    expect(result.content).toContain('fill="#111111"');
    expect(result.content).toContain('fill="#222222"');
  });
});
