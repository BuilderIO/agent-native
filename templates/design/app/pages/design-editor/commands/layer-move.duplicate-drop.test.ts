import { buildCodeLayerProjection } from "@shared/code-layer";
import { describe, expect, it } from "vitest";

import { duplicateNodeForPanelDrop } from "./layer-move";

/**
 * unique-paths-1: Alt-drag inside the Layers panel must duplicate the
 * dragged layer at the drop position and leave the original untouched —
 * before this fix, LayersPanel.tsx's handleDrop had no altKey branch at
 * all, so the drag only ever reordered/reparented the original node.
 */
describe("duplicateNodeForPanelDrop", () => {
  const html = `<!doctype html><html><body>
    <div data-agent-native-node-id="alpha" data-agent-native-layer-name="Alpha Button">Alpha</div>
    <div data-agent-native-node-id="beta" data-agent-native-layer-name="Beta Button">Beta</div>
  </body></html>`;

  function idOf(content: string, name: string): string {
    const projection = buildCodeLayerProjection(content);
    return projection.nodes.find(
      (node) => node.dataAttributes["data-agent-native-node-id"] === name,
    )!.id;
  }

  it("clones the dragged node next to the target and keeps the original", () => {
    const alphaId = idOf(html, "alpha");
    const betaId = idOf(html, "beta");

    const result = duplicateNodeForPanelDrop(html, alphaId, betaId, "after");
    expect(result).not.toBeNull();

    const { content, duplicatedNodeId } = result!;
    expect(duplicatedNodeId).not.toBe("alpha");

    // The original must survive unchanged — exactly one "alpha" and one
    // "beta" node id, plus the fresh clone.
    expect(
      content.match(/data-agent-native-node-id="alpha"/g),
    ).toHaveLength(1);
    expect(content.match(/data-agent-native-node-id="beta"/g)).toHaveLength(
      1,
    );
    const projection = buildCodeLayerProjection(content);
    const clone = projection.nodes.find(
      (node) =>
        node.dataAttributes["data-agent-native-node-id"] === duplicatedNodeId,
    );
    expect(clone).toBeTruthy();
    expect(clone!.layerName).toBe("Alpha Button");
  });

  it("returns null when the dragged node id isn't in the document", () => {
    const betaId = idOf(html, "beta");
    expect(
      duplicateNodeForPanelDrop(html, "not-a-real-id", betaId, "after"),
    ).toBeNull();
  });
});
