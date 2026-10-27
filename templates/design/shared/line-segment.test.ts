import { describe, expect, it } from "vitest";

import { applyVisualEdit } from "./code-layer";
import { LINE_SEGMENT_PROPERTY } from "./line-segment";

const LINE = `<!DOCTYPE html><html><body>
<svg data-agent-native-node-id="line" data-an-primitive="arrow" viewBox="0 0 200 100" preserveAspectRatio="none" style="position:absolute;left:100px;top:100px;width:200px;height:100px;overflow:visible;--an-vector-start-point:none;--an-vector-end-point:triangle"><defs data-an-vector-endpoints="true"><marker id="line-end"><path d="M 0 0 L 10 5 L 0 10 z"></path></marker></defs><path d="M 0 0 L 200 100" stroke="#111" marker-end="url(#line-end)"></path></svg>
</body></html>`;

function edit(content: string, value: string) {
  return applyVisualEdit(content, {
    kind: "style",
    target: { nodeId: "line" },
    property: LINE_SEGMENT_PROPERTY,
    value,
  });
}

describe("line segment edits", () => {
  it("rewrite the segment path and viewBox, leaving markers and style alone", () => {
    const { result, content } = edit(LINE, "100 50 0 0");
    expect(result.status).toBe("applied");
    expect(content).toContain('viewBox="0 0 100 50"');
    expect(content).toContain(
      '<path d="M 100 50 L 0 0" stroke="#111" marker-end="url(#line-end)">',
    );
    expect(content).toContain('<path d="M 0 0 L 10 5 L 0 10 z">');
    expect(content).not.toContain(LINE_SEGMENT_PROPERTY);
    expect(content).toContain("width:200px;height:100px");
  });

  it("keep a flat segment one pixel tall", () => {
    const { result, content } = edit(LINE, "0 0 211 0");
    expect(result.status).toBe("applied");
    expect(content).toContain('viewBox="0 0 211 1"');
    expect(content).toContain('d="M 0 0 L 211 0"');
  });

  it("refuse a segment that does not span its own box", () => {
    expect(edit(LINE, "10 10 200 100").result.status).not.toBe("applied");
    expect(edit(LINE, "0 0 1.5 4").result.status).not.toBe("applied");
    expect(edit(LINE, "0 0 L 4").result.status).not.toBe("applied");
  });

  it("refuse a layer that is not a drawn line", () => {
    const rect = LINE.replace(
      'data-an-primitive="arrow"',
      'data-an-primitive="path"',
    );
    expect(edit(rect, "0 0 20 10").result.status).not.toBe("applied");
  });
});
