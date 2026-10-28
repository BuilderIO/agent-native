import { describe, expect, it } from "vitest";

import { vectorEndpointInspectorIdentity } from "./vector-endpoint-inspector";

const baseElement = {
  sourceLayerIdentity: undefined,
  sourceId: "",
  pendingNodeId: "",
  runtimeSourceId: "",
  runtimeSelector: "",
  selector: "",
  id: "",
  tagName: "svg",
  primitiveKind: "line",
  boundingRect: { x: 0, y: 0, width: 100, height: 40 },
};

describe("vector endpoint inspector identity", () => {
  it("does not reuse local state for unnamed vectors with different geometry", () => {
    const first = vectorEndpointInspectorIdentity({
      ...baseElement,
      boundingRect: { ...baseElement.boundingRect, x: 10 },
    });
    const second = vectorEndpointInspectorIdentity({
      ...baseElement,
      boundingRect: { ...baseElement.boundingRect, x: 110 },
    });

    expect(first).not.toBe(second);
  });

  it("prefers the stable source-layer identity when it is available", () => {
    expect(
      vectorEndpointInspectorIdentity({
        ...baseElement,
        sourceLayerIdentity: { screenId: "screen-1", nodeId: "node-1" },
        boundingRect: { ...baseElement.boundingRect, x: 999 },
      }),
    ).toBe("screen-1:node-1:line");
  });
});
