import { buildCodeLayerProjection } from "@shared/code-layer";
import { GRAIN_GRADIENT_EFFECT } from "@shared/native-effect-presets";
import {
  applyNativeEffectToHtml,
  parseEffectsFromHtml,
} from "@shared/native-effects";
import { expect, it, vi } from "vitest";

import { resolveCodeLayerNodeFromBridge } from "@/pages/design-editor/code-layer-state";

import {
  runScreenVisualStyleChange,
  type ScreenVisualStyleChangeArgs,
} from "./screen-visual-style-change";

it("commits a solid paint and removes the replaced native fill in one file update", () => {
  const plain =
    '<html><body><div id="target" data-agent-native-node-id="target" style="background-color: white"></div><div data-agent-native-node-id="other"></div></body></html>';
  const first = applyNativeEffectToHtml(plain, {
    nodeId: "target",
    definition: GRAIN_GRADIENT_EFFECT,
    placement: "fill",
  });
  expect(first.errors).toEqual([]);
  const second = applyNativeEffectToHtml(first.html, {
    nodeId: "other",
    definition: GRAIN_GRADIENT_EFFECT,
    placement: "fill",
  });
  expect(second.errors).toEqual([]);
  const projection = buildCodeLayerProjection(second.html, {
    source: { kind: "design-file", fileId: "board" },
  });
  const selector = projection.nodes.find(
    (node) => node.dataAttributes["data-agent-native-node-id"] === "target",
  )?.selector;
  expect(
    resolveCodeLayerNodeFromBridge(projection, selector)?.dataAttributes[
      "data-agent-native-node-id"
    ],
  ).toBe("target");
  const applyFileContentUpdate = vi.fn();
  const args: ScreenVisualStyleChangeArgs = {
    activeBreakpointUpperBoundPx: null,
    activeBreakpointWidthStateRef: { current: undefined },
    activeFile: {
      id: "active-other",
      filename: "other.html",
      fileType: "html",
      content: "<html></html>",
      createdAt: "2026-10-06T00:00:00.000Z",
      updatedAt: "2026-10-06T00:00:00.000Z",
    },
    applyFileContentUpdate,
    canEditDesign: true,
    designSourceType: "inline",
    getScreenContent: () => second.html,
    handleVisualStyleChange: vi.fn(),
    overviewScreens: [],
    recordPendingVisualStyleEdit: vi.fn(),
    responsiveEditScopeRef: { current: "cascade-smaller" },
    t: (key) => key,
  };
  runScreenVisualStyleChange(
    args,
    "board",
    selector!,
    {
      backgroundColor: "rgb(255, 0, 0)",
    },
    undefined,
    { fillStyleIntent: "replace" },
  );
  expect(applyFileContentUpdate).toHaveBeenCalledOnce();
  const [, saved] = applyFileContentUpdate.mock.calls[0];
  expect(saved).toContain("rgb(255, 0, 0)");
  expect(
    parseEffectsFromHtml(saved).document?.instances.map(
      (instance) => instance.nodeId,
    ),
  ).toEqual(["other"]);
});
