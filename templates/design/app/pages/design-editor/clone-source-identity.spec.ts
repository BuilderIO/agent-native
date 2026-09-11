// @vitest-environment happy-dom

import { describe, expect, it } from "vitest";

import {
  buildCodeLayerProjection,
  removeCodeLayerNodeFromHtml,
} from "@/../shared/code-layer";
import { insertClonedHtmlLayers } from "@/pages/design-editor/clone-and-pen-edit";

const CARD = `<section data-agent-native-node-id="card-a" data-builder-id="blk-1"><h3 data-loc="Card.tsx:13:6">Heading</h3></section>`;

const SCREEN = `<div data-agent-native-node-id="screen-root">
  ${CARD}
</div>`;

describe("duplicate a Figma/Fusion subtree, then edit or delete inside the copy", () => {
  function duplicate() {
    const inserted = insertClonedHtmlLayers(SCREEN, [CARD], {
      targetSelectors: [`[data-agent-native-node-id="card-a"]`],
      placement: "after",
    });
    if (!inserted) throw new Error("clone failed");
    return inserted;
  }

  it("gives the copy's descendants their own identity, not the original's source location", () => {
    const projection = buildCodeLayerProjection(duplicate().content);
    const headings = projection.nodes.filter((node) => node.tag === "h3");

    expect(headings).toHaveLength(2);
    expect(headings[0]!.id).not.toBe(headings[1]!.id);
  });

  it("resolves a heading inside the copy to the copy, not to the original", () => {
    const inserted = duplicate();
    const withCopy = inserted.content;
    const copyRootStart = withCopy.indexOf(inserted.rootNodeIds[0]!);

    const projection = buildCodeLayerProjection(withCopy);
    const headingInsideCopy = projection.nodes.find(
      (node) => node.tag === "h3" && (node.source?.start ?? -1) > copyRootStart,
    )!;

    // delete-selection.ts resolves the clicked node by id, then removes its
    // byte range. A shared id makes find() return the original instead.
    const resolved = projection.nodes.find(
      (node) => node.id === headingInsideCopy.id,
    )!;
    expect(resolved.source!.start).toBe(headingInsideCopy.source!.start);

    const afterDelete = removeCodeLayerNodeFromHtml(withCopy, resolved);
    expect(afterDelete, "delete returned no content").not.toBeNull();
    expect(afterDelete!.match(/<h3/g)?.length).toBe(1);
    expect(afterDelete!.indexOf("<h3")).toBeLessThan(copyRootStart);
  });
});
