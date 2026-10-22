import { NATIVE_EFFECT_LATEST_DEFINITIONS } from "@shared/native-effect-presets";
import { pruneDeletedNativeEffects } from "@shared/native-effect-pruning";
import {
  applyNativeEffectToHtml,
  parseEffectsFromHtml,
} from "@shared/native-effects";
import { describe, expect, it } from "vitest";

const definition = NATIVE_EFFECT_LATEST_DEFINITIONS.find(
  (candidate) => candidate.name === "Mesh Gradient",
)!;

function sourceWithEffects(): string {
  let html = `<!doctype html><html><body>
    <div data-agent-native-node-id="parent"><span data-agent-native-node-id="child"></span></div>
    <div data-agent-native-node-id="sibling"></div>
    <div data-agent-native-node-id="preexisting-orphan"></div>
  </body></html>`;
  for (const nodeId of ["parent", "child", "sibling", "preexisting-orphan"]) {
    const applied = applyNativeEffectToHtml(html, {
      nodeId,
      definition,
      placement: "fill",
    });
    if (applied.errors.length) throw new Error(applied.errors[0]);
    html = applied.html;
  }
  return html.replace(
    '<div data-agent-native-node-id="preexisting-orphan"></div>',
    "",
  );
}

describe("pruneDeletedNativeEffects", () => {
  it("removes effects for a deleted subtree while preserving siblings and earlier orphans", () => {
    const before = sourceWithEffects();
    const after = before.replace(
      '<div data-agent-native-node-id="parent"><span data-agent-native-node-id="child"></span></div>',
      "",
    );
    const pruned = pruneDeletedNativeEffects(before, after);
    expect(
      parseEffectsFromHtml(pruned).document?.instances.map(
        (instance) => instance.nodeId,
      ),
    ).toEqual(["sibling", "preexisting-orphan"]);
    expect(pruned).toContain('data-agent-native-node-id="sibling"');
  });

  it("leaves the manifest intact when an edit hides rather than deletes a node", () => {
    const before = sourceWithEffects();
    const after = before.replace(
      'data-agent-native-node-id="parent"',
      'data-agent-native-node-id="parent" style="display:none"',
    );
    expect(pruneDeletedNativeEffects(before, after)).toBe(after);
  });
});
