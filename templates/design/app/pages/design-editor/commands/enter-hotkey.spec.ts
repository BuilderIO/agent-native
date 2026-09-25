import type { CodeLayerNode } from "@shared/code-layer";
import { beforeEach, expect, it, vi } from "vitest";

import type { ElementInfo } from "@/components/design/types";
import { scheduleBeginTextEditForScreen } from "@/pages/design-editor/text-edit-utils";

import { runEnterHotkey, type EnterHotkeyArgs } from "./enter-hotkey";

vi.mock("@/pages/design-editor/text-edit-utils", () => ({
  scheduleBeginTextEditForScreen: vi.fn(),
}));

const scheduleTextEdit = vi.mocked(scheduleBeginTextEditForScreen);

beforeEach(() => {
  scheduleTextEdit.mockReset();
});

it("passes only the selected layer's repeat identity to text edit", () => {
  const node = {
    id: "layer",
    tag: "strong",
    dataAttributes: { "data-agent-native-node-id": "title" },
    children: [],
  } as unknown as CodeLayerNode;
  const owner = {
    fileId: "screen-a",
    node,
    tree: [],
    runtimeOnly: false,
  };
  const selectedElement: ElementInfo = {
    tagName: "strong",
    classes: [],
    computedStyles: {},
    boundingRect: { x: 0, y: 0, width: 100, height: 20 },
    isFlexChild: false,
    isFlexContainer: false,
    sourceLayerIdentity: { screenId: "screen-a", nodeId: "layer" },
    repeat: {
      sourceSelector: '[data-agent-native-node-id="title"]',
      instanceCount: 3,
      instanceIndex: 2,
      xFor: "card in cards",
      itemIndex: 1,
      textBinding: "card.title",
      keyExpression: "card.id",
      itemKey: "2",
    },
  };
  const args: EnterHotkeyArgs = {
    SINGLE_MODE_TEXT_TAGS: new Set(["strong"]),
    activeFile: { id: "screen-a" } as EnterHotkeyArgs["activeFile"],
    activeFileId: "screen-a",
    boardFileId: undefined,
    codeLayerOwnerByNodeIdRef: {
      current: new Map([["layer", owner]]),
    },
    enterVectorEditForSelection: () => false,
    getProjectionContentForScreen: () => "",
    overviewSelectedScreenIds: [],
    selectedElement,
    selectCodeLayerNodesForHotkey: () => false,
    selectedLayerIdsState: ["layer"],
    setActiveFileId: vi.fn(),
    setSelectedLayerIdsState: vi.fn(),
    viewMode: "single",
  };

  runEnterHotkey(args);
  expect(scheduleTextEdit).toHaveBeenLastCalledWith("screen-a", "title", {
    boardFileId: undefined,
    reopenExisting: true,
    repeat: {
      sourceSelector: '[data-agent-native-node-id="title"]',
      itemIndex: 1,
    },
  });

  runEnterHotkey({
    ...args,
    selectedElement: {
      ...selectedElement,
      sourceLayerIdentity: { screenId: "screen-a", nodeId: "other-layer" },
    },
  });
  expect(scheduleTextEdit).toHaveBeenLastCalledWith("screen-a", "title", {
    boardFileId: undefined,
    reopenExisting: true,
    repeat: undefined,
  });
});
