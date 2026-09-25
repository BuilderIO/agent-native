// @vitest-environment happy-dom

import { describe, expect, it, vi } from "vitest";

import { buildCodeLayerProjection } from "../../../../shared/code-layer";
import type { DesignFile } from "../types";
import { runPasteToReplace } from "./paste-to-replace";

const CONTENT_WITH_IDS = `<!DOCTYPE html><html><body><div data-agent-native-node-id="parent" style="position:absolute;left:100px;top:100px;width:600px;height:400px"><div data-agent-native-node-id="target" style="position:absolute;left:300px;top:40px;width:200px;height:100px"></div></div></body></html>`;

const CONTENT_WITHOUT_TARGET_ID = CONTENT_WITH_IDS.replace(
  ' data-agent-native-node-id="target"',
  ' data-agent-native-layer-name="Target"',
);

describe("runPasteToReplace with pasted OS content", () => {
  it.each([
    ["an id", CONTENT_WITH_IDS],
    ["no id", CONTENT_WITHOUT_TARGET_ID],
  ])(
    "puts the pasted layer at the target's top-left in its parent (target with %s)",
    (_label, CONTENT) => {
      const target = buildCodeLayerProjection(CONTENT, {
        source: { kind: "design-file", fileId: "screen-1" },
      }).nodes.find((node) => node.style.top === "40px")!;
      const applyLocalContentUpdate = vi.fn();

      runPasteToReplace(
        {
          activeFile: { id: "screen-1", content: CONTENT } as DesignFile,
          applyLocalContentUpdate,
          canEditDesign: true,
          getCanvasClipboardEntries: () => [],
          getFreshActiveContent: () => CONTENT,
          runtimeStructureInsertRevisionRef: { current: 0 },
          selectInsertedLayers: vi.fn(),
          selectedCanvasSelector: target.selectors[0]!,
          selectedElement: {
            tagName: "div",
            selector: target.selectors[0]!,
            classes: [],
            computedStyles: {},
            boundingRect: { x: 400, y: 140, width: 200, height: 100 },
            isFlexChild: false,
            isFlexContainer: false,
          },
          setRuntimeStructureInsertRequest: vi.fn(),
          t: (key) => key,
        },
        '<div data-agent-native-node-id="pasted" data-agent-native-layer-name="Frame" style="position:absolute;width:24px;height:24px"></div>',
      );

      const doc = new DOMParser().parseFromString(
        applyLocalContentUpdate.mock.calls[0]![0] as string,
        "text/html",
      );
      expect(doc.querySelectorAll('[style*="height:100px"]')).toHaveLength(0);
      const pasted = doc.querySelector<HTMLElement>(
        '[data-agent-native-layer-name="Frame"]',
      )!;
      expect(pasted.parentElement?.dataset.agentNativeNodeId).toBe("parent");
      expect([pasted.style.left, pasted.style.top, pasted.style.width]).toEqual(
        ["300px", "40px", "24px"],
      );
    },
  );
});
