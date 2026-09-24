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
