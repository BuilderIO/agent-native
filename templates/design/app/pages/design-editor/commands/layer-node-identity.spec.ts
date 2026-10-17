import { buildCodeLayerProjection } from "@shared/code-layer";
import { describe, expect, it, vi } from "vitest";

import { prepareLayerNodeIdentities } from "./layer-node-identity";

describe("prepareLayerNodeIdentities", () => {
  it("indexes authored identities once for a large selection", () => {
    const content =
      "<main>" +
      Array.from(
        { length: 2_000 },
        (_, index) =>
          '<div data-agent-native-node-id="layer-' + index + '"></div>',
      ).join("") +
      "</main>";
    const renderedProjection = buildCodeLayerProjection(content);
    const selectedNodes = renderedProjection.nodes.filter(
      (node) => node.dataAttributes["data-agent-native-node-id"],
    );
    const originalFilter = Array.prototype.filter;
    let predicateInvocations = 0;
    const countedFilter = function <T>(
      this: T[],
      predicate: (value: T, index: number, array: T[]) => unknown,
      thisArg?: unknown,
    ): T[] {
      return originalFilter.call(
        this,
        (value, index, array) => {
          predicateInvocations += 1;
          return predicate.call(thisArg, value, index, array);
        },
        thisArg,
      );
    };
    const filterSpy = vi
      .spyOn(Array.prototype, "filter")
      .mockImplementation(countedFilter as typeof Array.prototype.filter);

    let result: ReturnType<typeof prepareLayerNodeIdentities>;
    try {
      result = prepareLayerNodeIdentities({
        content,
        nodes: selectedNodes,
        renderedProjection,
      });
    } finally {
      filterSpy.mockRestore();
    }

    expect(result.nodeIds.size).toBe(2_000);
    expect(result.content).toBe(content);
    expect(predicateInvocations).toBeLessThan(20_000);
  });
});
