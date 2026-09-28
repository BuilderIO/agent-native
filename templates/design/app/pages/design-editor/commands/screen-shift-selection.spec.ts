import { buildCodeLayerProjection } from "@shared/code-layer";
import { describe, expect, it, vi } from "vitest";

import { prepareCanonicalSourceContent } from "@/pages/design-editor/source-publication";

import { runLayerSelectionChange } from "./layer-selection-change";

const alphaId = "screen-alpha";
const betaId = "screen-beta";
const boardId = "board";
const file = (id: string) => ({
  id,
  filename: `${id}.html`,
  fileType: "html" as const,
  content: `<body>${id}</body>`,
  createdAt: "",
  updatedAt: "",
});

const boardFile = {
  ...file(boardId),
  filename: "__board__.html",
  content:
    '<body><div data-agent-native-node-id="board-target">Board Target</div></body>',
};
const boardProjection = buildCodeLayerProjection(boardFile.content, {
  source: {
    kind: "design-file",
    fileId: boardId,
    filename: boardFile.filename,
  },
});
const boardNode = boardProjection.nodes.find(
  (node) => node.dataAttributes["data-agent-native-node-id"] === "board-target",
)!;
const betaFile = {
  ...file(betaId),
  content:
    '<body><div data-agent-native-node-id="beta-target">Beta Target</div></body>',
};
const betaProjection = buildCodeLayerProjection(betaFile.content, {
  source: { kind: "design-file", fileId: betaId, filename: betaFile.filename },
});
const betaNode = betaProjection.nodes.find(
  (node) => node.dataAttributes["data-agent-native-node-id"] === "beta-target",
)!;

function select(ids: string[], clickedId: string, range: boolean) {
  let selectedScreenIds = [alphaId];
  let selectedLayerIds: string[] = [];

  runLayerSelectionChange(
    {
      activeFile: file(alphaId),
      applyFileContentUpdate: vi.fn((fileId: string, content: string) => {
        const prepared = prepareCanonicalSourceContent(content, {
          fileId,
          fileType: "html",
        });
        return {
          status: "accepted" as const,
          content: prepared.content,
          nodeIdMap: prepared.nodeIdMap,
        };
      }),
      clearPendingOverviewLayerSelectionTimer: vi.fn(),
      codeLayerOwnerByNodeId: new Map([
        [
          boardNode.id,
          {
            fileId: boardId,
            node: boardNode,
            sourceProjection: boardProjection,
            tree: [],
            runtimeOnly: false,
          },
        ],
        [
          betaNode.id,
          {
            fileId: betaId,
            node: betaNode,
            sourceProjection: betaProjection,
            tree: [],
            runtimeOnly: false,
          },
        ],
      ]),
      effectiveCodeLayerState: {
        hiddenIds: new Set(),
        lockedIds: new Set(),
      },
      files: [file(alphaId), betaFile, boardFile],
      getScreenContent: () => "",
      focusDesignInspectorForSelection: vi.fn(),
      overviewSelectedScreenIds: selectedScreenIds,
      pendingOverviewLayerSelectionRef: { current: null },
      pendingOverviewScreenSelectionRef: { current: null },
      selectedElement: null,
      setActiveFileId: vi.fn(),
      setActiveTool: vi.fn(),
      setCreatedOverviewLayerSelection: vi.fn(),
      setMode: vi.fn(),
      setOverviewSelectedScreenIds: (value) => {
        selectedScreenIds =
          typeof value === "function" ? value(selectedScreenIds) : value;
      },
      setSelectedElement: vi.fn(),
      setSelectedLayerIdsState: (value) => {
        selectedLayerIds =
          typeof value === "function" ? value(selectedLayerIds) : value;
      },
      setViewMode: vi.fn(),
      viewModeRef: { current: "overview" },
    },
    ids,
    {
      additive: false,
      currentSelectedIds: [alphaId],
      id: clickedId,
      range,
    },
  );

  return { selectedLayerIds, selectedScreenIds };
}

describe("Layers screen selection", () => {
  it("preserves every Screen in a Shift range", () => {
    expect(select([betaId, alphaId], betaId, true)).toEqual({
      selectedLayerIds: [betaId, alphaId],
      selectedScreenIds: [betaId, alphaId],
    });
  });

  it("keeps ordinary single-Screen selection", () => {
    expect(select([betaId], betaId, false)).toEqual({
      selectedLayerIds: [betaId],
      selectedScreenIds: [betaId],
    });
  });

  it("normalizes a legacy code-prefixed Screen row", () => {
    expect(select([`code:${betaId}`], `code:${betaId}`, false)).toEqual({
      selectedLayerIds: [betaId],
      selectedScreenIds: [betaId],
    });
  });

  it("keeps selected Screen rows when a Board layer is the mixed selection target", () => {
    expect(
      select([alphaId, boardNode.id], boardNode.id, false).selectedScreenIds,
    ).toEqual([alphaId]);
    expect(
      select([boardNode.id, alphaId], alphaId, false).selectedScreenIds,
    ).toEqual([alphaId]);
    expect(
      select([boardNode.id], boardNode.id, false).selectedScreenIds,
    ).toEqual([]);
  });

  it("keeps explicit Screen rows when a layer in another Screen is selected", () => {
    expect(
      select([alphaId, betaNode.id], betaNode.id, false).selectedScreenIds,
    ).toEqual([alphaId]);
    expect(select([betaNode.id], betaNode.id, false).selectedScreenIds).toEqual(
      [betaId],
    );
  });
});
