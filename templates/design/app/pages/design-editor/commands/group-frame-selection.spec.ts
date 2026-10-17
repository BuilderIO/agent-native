import {
  buildCodeLayerProjection,
  buildCodeLayerTree,
} from "@shared/code-layer";
import type { Dispatch, SetStateAction } from "react";
import { describe, expect, it } from "vitest";

import type { ElementInfo } from "@/components/design/types";
import { prepareCanonicalSourceContent } from "@/pages/design-editor/source-publication";
import type { DesignFile } from "@/pages/design-editor/types";

import { runFrameSelection } from "./frame-selection";
import { runGroupSelection } from "./group-selection";

const CONTENT = `<!doctype html><html><body>
  <div data-agent-native-node-id="one" data-agent-native-layer-name="One" style="position:absolute;left:10px;top:10px;width:80px;height:40px;background:#f97316"></div>
  <div data-agent-native-node-id="two" data-agent-native-layer-name="Two" style="position:absolute;left:110px;top:10px;width:80px;height:40px;background:#f97316"></div>
</body></html>`;

function makeSelectionArgs() {
  let content = CONTENT;
  let selectedElement: ElementInfo | null = null;
  let selectedLayerIds: string[] = ["one", "two"];
  const args = {
    activeBreakpointWidthState: undefined,
    activeFile: { id: "file" } as DesignFile,
    applyLocalContentUpdate: (nextContent: string) => {
      const publication = prepareCanonicalSourceContent(nextContent, {
        fileId: "file",
        fileType: "html",
      });
      content = publication.content;
      return { status: "accepted" as const, ...publication };
    },
    canEditDesign: true,
    boardFileId: undefined,
    contentHistorySelectionAfterRef: { current: new Map() },
    contentUndoStackRef: { current: [] },
    files: [],
    getFreshActiveContent: () => content,
    overviewSelectedScreenIds: [],
    selectedLayerIdsState: selectedLayerIds,
    setSelectedElement: ((next) => {
      selectedElement =
        typeof next === "function" ? next(selectedElement) : next;
    }) as Dispatch<SetStateAction<ElementInfo | null>>,
    setSelectedLayerIdsState: ((next) => {
      selectedLayerIds =
        typeof next === "function" ? next(selectedLayerIds) : next;
    }) as Dispatch<SetStateAction<string[]>>,
    t: (key: string) => key,
    undoManagerRef: { current: null },
  };
  return {
    args,
    content: () => content,
    selectedElement: () => selectedElement,
    selectedLayerIds: () => selectedLayerIds,
  };
}

describe("group and frame selection markers", () => {
  it("marks Cmd+G wrappers as groups and carries that identity into selection", () => {
    const state = makeSelectionArgs();
    runGroupSelection({
      ...state.args,
      codeLayerOwnerByNodeIdRef: { current: new Map() },
      sendRuntimeLayerSemanticHandoff: () => false,
    });

    const projection = buildCodeLayerProjection(state.content());
    const wrapper = projection.nodes.find(
      (node) => node.dataAttributes["data-agent-native-group"] === "true",
    );
    expect(wrapper).toBeDefined();
    expect(state.selectedElement()?.isGroup).toBe(true);
    expect(buildCodeLayerTree(projection)[0]?.type).toBe("group");
  });

  it("keeps Cmd+Option+G wrappers as frames", () => {
    const state = makeSelectionArgs();
    runFrameSelection(state.args);

    const projection = buildCodeLayerProjection(state.content());
    const wrapper = projection.nodes.find(
      (node) => node.dataAttributes["data-an-primitive"] === "frame",
    );
    expect(wrapper).toBeDefined();
    expect(wrapper?.dataAttributes["data-agent-native-group"]).toBeUndefined();
    expect(state.selectedElement()?.isGroup).toBe(false);
    expect(buildCodeLayerTree(projection)[0]?.type).toBe("frame");
  });
});
