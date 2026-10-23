import { buildCodeLayerProjection } from "@shared/code-layer";
import { describe, expect, it, vi } from "vitest";

const toastError = vi.hoisted(() => vi.fn());
vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), { error: toastError }),
}));

import type { FrameMeasurement } from "@/pages/design-editor/measure-child-rects";

import {
  runSuggestAutoLayout,
  type SuggestAutoLayoutArgs,
} from "./suggest-auto-layout";

const CONTENT = `<body><div data-agent-native-node-id="card" style="position:absolute;left:400px;top:300px;width:200px;height:136px"><div data-agent-native-node-id="b" style="position:absolute;left:16px;top:76px;width:168px;height:44px"></div><div data-agent-native-node-id="a" style="position:absolute;left:16px;top:16px;width:168px;height:44px"></div></div></body>`;

function suggest(measure: SuggestAutoLayoutArgs["measureLayoutFrame"]) {
  const projection = buildCodeLayerProjection(CONTENT, {
    source: { kind: "design-file", fileId: "screen" },
  });
  const card = projection.nodes.find(
    (node) => node.dataAttributes["data-agent-native-node-id"] === "card",
  )!;
  const setPreview = vi.fn();
  runSuggestAutoLayout({
    activeCanvasSourceType: "inline",
    activeFile: { id: "screen" },
    canEditDesign: true,
    designSourceType: "inline",
    getActiveFileSelectedNodeIds: () => [card.id],
    getFreshActiveContent: () => CONTENT,
    measureLayoutFrame: measure,
    runtimeLayerSnapshotsById: {},
    setAutoLayoutSuggestionPreview: setPreview,
    t: (key: string) => key,
    viewModeRef: { current: "single" },
  } as unknown as SuggestAutoLayoutArgs);
  return setPreview;
}

describe("runSuggestAutoLayout", () => {
  it("proposes a flow from children measured in the container's padding box", () => {
    const measured: FrameMeasurement = {
      status: "measured",
      display: "block",
      boxSizing: "content-box",
      size: { width: 200, height: 136 },
      paddingBox: { width: 200, height: 136 },
      children: [
        {
          id: "b",
          rect: { x: 16, y: 76, width: 168, height: 44 },
          position: "absolute",
          transformed: false,
          box: { sizing: "content-box", edges: { width: 0, height: 0 } },
        },
        {
          id: "a",
          rect: { x: 16, y: 16, width: 168, height: 44 },
          position: "absolute",
          transformed: false,
          box: { sizing: "content-box", edges: { width: 0, height: 0 } },
        },
      ],
      unidentifiedChildren: 0,
    };
    const setPreview = suggest(() => measured);
    expect(setPreview.mock.calls[0]?.[0].suggestion).toMatchObject({
      direction: "column",
      orderedChildIds: ["a", "b"],
      gap: 16,
      padding: { top: 16, right: 16, bottom: 16, left: 16 },
    });
  });

  it("refuses visibly instead of suggesting from guessed geometry", () => {
    toastError.mockClear();
    const setPreview = suggest((node) => ({
      status: "unmeasurable",
      nodeId: node.id,
      reason: "no-preview",
    }));
    expect(setPreview).not.toHaveBeenCalled();
    expect(toastError).toHaveBeenCalledWith(
      "designEditor.toasts.layoutUnmeasurable",
    );
  });
});
