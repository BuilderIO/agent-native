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
const GROUP = `<div data-agent-native-node-id="group-a" data-agent-native-group="true" data-agent-native-layer-name="Group">
  <div data-agent-native-node-id="group-child" data-an-primitive="rectangle" style="width:80px;height:40px;background:#f97316"></div>
</div>`;
const LEGACY_GROUP = `<div data-agent-native-node-id="an-legacygroup" layer-name="Group" data-agent-native-preserve-styles="true">
  <div data-agent-native-node-id="legacy-child" data-an-primitive="rectangle" style="width:80px;height:40px;background:#f97316"></div>
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

    const resolved = projection.nodes.find(
      (node) => node.id === headingInsideCopy.id,
    )!;
    expect(resolved.source!.start).toBe(headingInsideCopy.source!.start);

    const afterDelete = removeCodeLayerNodeFromHtml(withCopy, resolved);
    expect(afterDelete, "delete returned no content").not.toBeNull();
    expect(afterDelete!.match(/<h3/g)?.length).toBe(1);
    expect(afterDelete!.indexOf("<h3")).toBeLessThan(copyRootStart);
  });

  it("preserves explicit group identity when cloning a group layer", () => {
    const inserted = insertClonedHtmlLayers(GROUP, [GROUP]);
    expect(inserted).not.toBeNull();

    const clonedGroup = buildCodeLayerProjection(inserted!.content).nodes.find(
      (node) =>
        node.dataAttributes["data-agent-native-node-id"] ===
        inserted!.rootNodeIds[0],
    );
    expect(clonedGroup?.dataAttributes["data-agent-native-group"]).toBe("true");
  });

  it("recognizes a raw legacy Group wrapper when cloning", () => {
    const inserted = insertClonedHtmlLayers(LEGACY_GROUP, [LEGACY_GROUP]);
    expect(inserted).not.toBeNull();

    const clonedGroup = buildCodeLayerProjection(inserted!.content).nodes.find(
      (node) =>
        node.dataAttributes["data-agent-native-node-id"] ===
        inserted!.rootNodeIds[0],
    );
    expect(clonedGroup?.layerName).toBe("Group");
    expect(clonedGroup?.layerNameAttribute).toBe("layer-name");
    expect(clonedGroup?.dataAttributes["data-agent-native-group-wrapper"]).toBe(
      "true",
    );
  });
});
