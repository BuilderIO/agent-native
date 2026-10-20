import { describe, expect, it } from "vitest";

import {
  applyVisualEdit,
  buildCodeLayerProjection,
  removeCodeLayerNodeFromHtml,
} from "./code-layer";
import { catalogShader } from "./native-effect-catalog-kit";
import {
  NativeEffectPruningError,
  pruneDeletedNativeEffects,
} from "./native-effect-pruning";
import {
  applyNativeEffectToHtml,
  parseEffectsFromHtml,
} from "./native-effects";

const definition = catalogShader({
  id: "pruning-proof",
  name: "Pruning",
  kind: "generator",
  properties: {},
  fragment: () => "return vec4f(0.0);",
});
function fixture() {
  let html =
    '<html><body><div data-agent-native-node-id="parent"><span data-agent-native-node-id="child"></span></div><div data-agent-native-node-id="sibling"></div><div data-agent-native-node-id="orphan"></div></body></html>';
  for (const nodeId of ["parent", "parent", "child", "sibling", "orphan"]) {
    const applied = applyNativeEffectToHtml(html, {
      nodeId,
      definition,
      placement: "fill",
    });
    expect(applied.errors).toEqual([]);
    html = applied.html;
  }
  return html.replace('<div data-agent-native-node-id="orphan"></div>', "");
}
function nodeIds(html: string) {
  const parsed = parseEffectsFromHtml(html);
  expect(parsed.errors).toEqual([]);
  return parsed.document!.instances.map((instance) => instance.nodeId);
}

describe("native effects at the shared node-deletion boundary", () => {
  it("preserves effects when a layer is hidden, and ignores inert template targets", () => {
    const before = fixture();
    const hidden = before.replace(
      'data-agent-native-node-id="parent"',
      'data-agent-native-node-id="parent" style="display:none"',
    );
    expect(pruneDeletedNativeEffects(before, hidden)).toBe(hidden);
    const inert = before.replace(
      '<span data-agent-native-node-id="child"></span>',
      '<template><span data-agent-native-node-id="child"></span></template>',
    );
    expect(nodeIds(pruneDeletedNativeEffects(before, inert))).toEqual([
      "parent",
      "parent",
      "sibling",
      "orphan",
    ]);
  });

  it("throws a typed failure for an unreadable manifest on either side", () => {
    const before = fixture();
    const invalid = before.replace(
      /"schemaVersion"\s*:\s*2/,
      '"schemaVersion":999',
    );
    expect(invalid).not.toBe(before);
    expect(() => pruneDeletedNativeEffects(invalid, before)).toThrow(
      NativeEffectPruningError,
    );
    expect(() => pruneDeletedNativeEffects(before, invalid)).toThrow(
      NativeEffectPruningError,
    );
  });

  it("removes every deleted subtree Fill while preserving surviving targets and earlier orphans", () => {
    const before = fixture();
    const parent = buildCodeLayerProjection(before).nodes.find(
      (node) => node.dataAttributes["data-agent-native-node-id"] === "parent",
    )!;
    const after = removeCodeLayerNodeFromHtml(before, parent);
    expect(after).not.toBeNull();
    expect(nodeIds(after!)).toEqual(["sibling", "orphan"]);
    expect(after).not.toContain('data-agent-native-node-id="child"');
  });

  it("prunes the canonical agent deleteNode operation with the same stable target semantics", () => {
    const before = fixture();
    const patch = applyVisualEdit(before, {
      kind: "deleteNode",
      target: { nodeId: "parent" },
    });
    expect(patch.result.status).toBe("applied");
    expect(nodeIds(patch.content)).toEqual(["sibling", "orphan"]);
    expect(
      patch.projection.nodes.some(
        (node) => node.dataAttributes["data-agent-native-node-id"] === "parent",
      ),
    ).toBe(false);
  });
});
