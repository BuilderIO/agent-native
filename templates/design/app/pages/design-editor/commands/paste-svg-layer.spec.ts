import { describe, expect, it } from "vitest";

import type { ElementInfo } from "@/components/design/types";
import type { SelectedLayerTarget } from "@/pages/design-editor/code-layer-state";

import { resolvePastedSvgInsertionOptions } from "./paste-svg-layer";

const FRAME_CONTENT = `<!doctype html><html><body>
  <section data-agent-native-node-id="paste-target" data-an-primitive="frame" style="position:absolute;left:80px;top:90px;width:260px;height:180px">
    <div data-agent-native-node-id="existing-child" style="position:absolute;left:8px;top:8px;width:24px;height:20px"></div>
  </section>
  <p data-agent-native-node-id="caption">Caption</p>
</body></html>`;

function elementInfoFor(nodeId: string, tagName = "div"): ElementInfo {
  return {
    tagName,
    sourceId: nodeId,
    selector: `[data-agent-native-node-id="${nodeId}"]`,
    classes: [],
    computedStyles: {},
    boundingRect: { x: 0, y: 0, width: 0, height: 0 },
  } as unknown as ElementInfo;
}

function selectedLayerTarget(
  fileId: string,
  nodeId: string,
): SelectedLayerTarget {
  return {
    fileId,
    elementInfo: elementInfoFor(nodeId, "section"),
    node: {
      selector: `[data-agent-native-node-id="${nodeId}"]`,
    },
  } as unknown as SelectedLayerTarget;
}

describe("resolvePastedSvgInsertionOptions", () => {
  it("nests an SVG into the selected frame in the target screen", () => {
    const selector = '[data-agent-native-node-id="paste-target"]';
    const options = resolvePastedSvgInsertionOptions({
      activeFileId: "board",
      baseContent: FRAME_CONTENT,
      point: { x: 360, y: 280 },
      selectedElement: null,
      selectedLayerTargets: [selectedLayerTarget("screen-1", "paste-target")],
      targetFileId: "screen-1",
    });

    expect(options).toMatchObject({
      placement: "inside",
      stripRootPosition: true,
    });
    expect(options.targetSelectors).toContain(selector);
    expect(options.positions).toBeUndefined();
  });

  it("uses the paste point when the active selection is not a container", () => {
    const options = resolvePastedSvgInsertionOptions({
      activeFileId: "screen-1",
      baseContent: FRAME_CONTENT,
      point: { x: 320, y: 240 },
      selectedElement: elementInfoFor("caption", "p"),
      selectedLayerTargets: [],
      targetFileId: "screen-1",
    });

    expect(options).toEqual({
      positions: [{ x: 320, y: 240, space: "visual" }],
    });
  });
});
