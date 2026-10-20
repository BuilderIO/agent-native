import { buildCodeLayerProjection } from "@shared/code-layer";
import { describe, expect, it } from "vitest";

import { projectMotionLayerVisibility } from "./motion-layer-visibility";

describe("projectMotionLayerVisibility", () => {
  it("maps Motion target ids to Design layer ids and back to hidden targets", () => {
    const projection = buildCodeLayerProjection(
      '<main data-agent-native-node-id="screen"><article data-agent-native-node-id="motion-card">Card</article></main>',
    );
    const card = projection.nodes.find(
      (node) =>
        node.dataAttributes["data-agent-native-node-id"] === "motion-card",
    );

    expect(card).toBeDefined();
    expect(card?.id).not.toBe("motion-card");

    const visibility = projectMotionLayerVisibility(
      projection,
      new Set([card!.id]),
    );

    expect(visibility.codeLayerIdByMotionNodeId.get("motion-card")).toBe(
      card!.id,
    );
    expect(visibility.hiddenMotionNodeIds).toEqual(
      new Set([card!.id, "motion-card"]),
    );
  });

  it("preserves identity ids for projected nodes without Motion ids", () => {
    const projection = buildCodeLayerProjection(
      '<main data-agent-native-node-id="screen"><article data-agent-native-node-id="motion-card">Card</article></main>',
    );
    const card = projection.nodes.find(
      (node) =>
        node.dataAttributes["data-agent-native-node-id"] === "motion-card",
    );

    expect(card).toBeDefined();

    const visibility = projectMotionLayerVisibility(
      projection,
      new Set([card!.id]),
    );

    expect(visibility.codeLayerIdByMotionNodeId.get(card!.id)).toBe(card!.id);
    expect(visibility.hiddenMotionNodeIds.has(card!.id)).toBe(true);
  });
});
