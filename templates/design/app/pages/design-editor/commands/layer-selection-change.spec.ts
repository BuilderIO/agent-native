import {
  buildCodeLayerProjection,
  buildCodeLayerTree,
} from "@shared/code-layer";
import { describe, expect, it, vi } from "vitest";

import type { ElementInfo } from "@/components/design/types";
import { prepareCanonicalSourceContent } from "@/pages/design-editor/source-publication";
import type { DesignFile } from "@/pages/design-editor/types";

import {
  runApplyFileContentUpdate,
  type ApplyFileContentUpdateArgs,
} from "./apply-file-content-update";
import {
  runLayerSelectionChange,
  type LayerSelectionChangeArgs,
} from "./layer-selection-change";

const HTML = `<!doctype html><html><body><main><button class="target" style="position:absolute;left:12px;top:8px">Move me</button><span>Sibling</span></main></body></html>`;
const RICH_HTML = `<!doctype html><html><body><main><button class="target" data-agent-native-node-id="button-a" style="position:absolute;left:12px;top:8px">Move me</button><span>Sibling</span></main></body></html>`;
const OTHER_SCREEN_HTML = RICH_HTML.replace('class="target"', 'class="other"');
const INSERTED_SIBLING_HTML = HTML.replace(
  '<button class="target" style="position:absolute;left:12px;top:8px">Move me</button>',
  '<button class="target">Inserted sibling</button><button class="target" style="position:absolute;left:12px;top:8px">Move me</button>',
);

function liveInfo(
  sourceLayerIdentity?: ElementInfo["sourceLayerIdentity"],
): ElementInfo {
  return {
    tagName: "button",
    sourceId: "button-a",
    selector: '[data-agent-native-node-id="button-a"]',
    classes: ["target"],
    computedStyles: { backgroundColor: "rgb(15, 118, 110)" },
    inlineStyles: { position: "absolute", left: "12px", top: "8px" },
    sourceLayerIdentity,
    portableStyleSnapshot: {
      version: 1,
      rootSourceId: "button-a",
      nodes: [
        {
          sourceId: "button-a",
          path: [],
          styles: { backgroundColor: "rgb(15, 118, 110)" },
        },
      ],
    },
    boundingRect: { x: 12, y: 8, width: 100, height: 30 },
    isFlexChild: false,
    isFlexContainer: false,
  };
}

function selectLayer(args: {
  sourceHTML?: string;
  currentHTML?: string;
  ownerFileId?: string;
  selectedElement?: ElementInfo | null;
  selectMultipleIdlessLayers?: boolean;
  equivalentProjectionForSecond?: boolean;
  applyFileContentUpdate?: LayerSelectionChangeArgs["applyFileContentUpdate"];
}) {
  const sourceHTML = args.sourceHTML ?? HTML;
  const currentHTML = args.currentHTML ?? sourceHTML;
  const ownerFileId = args.ownerFileId ?? "screen-a";
  let content = currentHTML;
  let selectedLayerIds: string[] = [];
  const state: { selectedElement: ElementInfo | null } = {
    selectedElement: null,
  };
  const projection = buildCodeLayerProjection(sourceHTML, {
    source: {
      kind: "design-file",
      fileId: ownerFileId,
      filename: "index.html",
    },
  });
  const node = projection.nodes.find((candidate) => candidate.tag === "button");
  expect(node).toBeDefined();
  const secondNode = projection.nodes.find(
    (candidate) => candidate.tag === "span",
  );
  const secondProjection = args.equivalentProjectionForSecond
    ? { ...projection, source: { ...projection.source } }
    : projection;
  const selectedNodes = args.selectMultipleIdlessLayers
    ? [node!, secondNode!]
    : [node!];
  if (args.selectMultipleIdlessLayers) expect(secondNode).toBeDefined();
  const selectionIds = selectedNodes.map((selectedNode) => selectedNode.id);
  const ownersByNodeId = new Map(
    selectedNodes.map((selectedNode, index) => {
      const sourceProjection = index === 1 ? secondProjection : projection;
      return [
        selectedNode.id,
        {
          fileId: ownerFileId,
          node: sourceProjection.nodes.find(
            (candidate) => candidate.id === selectedNode.id,
          )!,
          sourceProjection,
          tree: buildCodeLayerTree(sourceProjection),
          runtimeOnly: false,
        },
      ] as const;
    }),
  );
  const update = vi.fn((fileId: string, nextContent: string) => {
    expect(fileId).toBe(ownerFileId);
    const prepared = prepareCanonicalSourceContent(nextContent, {
      fileId,
      fileType: "html",
    });
    content = prepared.content;
    return {
      status: "accepted" as const,
      content: prepared.content,
      nodeIdMap: prepared.nodeIdMap,
    };
  });
  const activeFile = {
    id: ownerFileId,
    filename: "index.html",
    fileType: "html",
    content: currentHTML,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };

  runLayerSelectionChange(
    {
      activeFile,
      applyFileContentUpdate: args.applyFileContentUpdate ?? update,
      clearPendingOverviewLayerSelectionTimer: vi.fn(),
      codeLayerOwnerByNodeId: ownersByNodeId,
      effectiveCodeLayerState: {
        hiddenIds: new Set(),
        lockedIds: new Set(),
      },
      files: [
        activeFile,
        ...(ownerFileId === "screen-b"
          ? [
              {
                ...activeFile,
                id: "screen-a",
              },
            ]
          : []),
      ],
      getScreenContent: () => content,
      focusDesignInspectorForSelection: vi.fn(),
      overviewSelectedScreenIds: [],
      pendingOverviewLayerSelectionRef: { current: null },
      pendingOverviewScreenSelectionRef: { current: null },
      selectedElement: args.selectedElement ?? null,
      setActiveFileId: vi.fn(),
      setActiveTool: vi.fn(),
      setCreatedOverviewLayerSelection: vi.fn(),
      setMode: vi.fn(),
      setOverviewSelectedScreenIds: vi.fn(),
      setSelectedElement: (value) => {
        state.selectedElement =
          typeof value === "function" ? value(null) : value;
      },
      setSelectedLayerIdsState: (value) => {
        selectedLayerIds = typeof value === "function" ? value([]) : value;
      },
      setViewMode: vi.fn(),
      viewModeRef: { current: "single" },
    },
    selectionIds,
    {
      additive: selectionIds.length > 1,
      id: selectionIds[selectionIds.length - 1]!,
      range: false,
    },
  );

  return {
    content,
    selectedElement: state.selectedElement,
    selectedLayerIds,
    node,
    projections: [projection, secondProjection],
    update,
  };
}

function readOnlyWriterArgs(
  activeFile: DesignFile,
): ApplyFileContentUpdateArgs {
  return {
    acknowledgeAuthoritativeClipboardMutation: vi.fn(),
    activeFile,
    applyFileContentUpdate: vi.fn(),
    applyLocalContentUpdate: vi.fn((content: string) => {
      const prepared = prepareCanonicalSourceContent(content, {
        fileId: activeFile.id,
        fileType: activeFile.fileType,
      });
      return {
        status: "accepted" as const,
        content: prepared.content,
        nodeIdMap: prepared.nodeIdMap,
      };
    }),
    canEditDesignRef: { current: false },
    cancelQueuedFileContentSave: vi.fn(),
    clearPendingLocalFileContent: vi.fn(),
    files: [activeFile],
    getScreenContent: () => activeFile.content ?? "",
    id: "design",
    markPendingLocalFileContent: vi.fn(),
    overviewIsSynced: false,
    overviewPresenceFileId: null,
    overviewYdoc: null,
    queryClient: { setQueryData: vi.fn() } as never,
    queueFileContentSave: vi.fn(),
    recordContentHistoryEntry: vi.fn(),
    suppressContentHistoryRef: { current: false },
    t: (key) => key,
  };
}

describe("Layers selection source identity", () => {
  it("persists a selected source node id without adding an undo step", () => {
    const result = selectLayer({});
    expect(result.update).toHaveBeenCalledWith("screen-a", expect.any(String), {
      recordHistory: false,
    });
    const acceptedProjection = buildCodeLayerProjection(result.content, {
      source: {
        kind: "design-file",
        fileId: "screen-a",
        filename: "index.html",
      },
    });
    const refreshedNode = acceptedProjection.nodes.find(
      (candidate) =>
        candidate.tag === "button" && candidate.textSnippet === "Move me",
    );
    expect(refreshedNode).toBeDefined();
    const stableId = refreshedNode!.dataAttributes["data-agent-native-node-id"];
    expect(stableId).toMatch(/^an-/);
    expect(result.selectedLayerIds).toEqual([refreshedNode!.id]);
    expect(result.selectedElement).toMatchObject({
      tagName: "button",
      selector: expect.stringContaining(
        `data-agent-native-node-id="${stableId}"`,
      ),
    });
  });

  it("stamps all same-version multi-selected nodes from equivalent projections in one write", () => {
    const result = selectLayer({
      selectMultipleIdlessLayers: true,
      equivalentProjectionForSecond: true,
    });
    expect(result.projections[0]).not.toBe(result.projections[1]);
    expect(result.projections[0]?.projectionId).toBe(
      result.projections[1]?.projectionId,
    );
    expect(result.projections[0]?.source).toEqual(
      result.projections[1]?.source,
    );
    const stableIds = [
      ...result.content.matchAll(/data-agent-native-node-id="([^"]+)"/g),
    ].map((match) => match[1]);
    const projection = buildCodeLayerProjection(result.content, {
      source: {
        kind: "design-file",
        fileId: "screen-a",
        filename: "index.html",
      },
    });
    const selectedNodes = result.selectedLayerIds.map((id) =>
      projection.nodes.find((candidate) => candidate.id === id),
    );
    const selectedStableIds = selectedNodes.map(
      (selectedNode) =>
        selectedNode?.dataAttributes["data-agent-native-node-id"],
    );

    expect(result.update).toHaveBeenCalledOnce();
    expect(stableIds).toHaveLength(projection.nodes.length);
    expect(new Set(stableIds).size).toBe(stableIds.length);
    expect(result.selectedLayerIds).toHaveLength(2);
    expect(selectedNodes.every(Boolean)).toBe(true);
    expect(selectedNodes.map((selectedNode) => selectedNode!.tag)).toEqual([
      "button",
      "span",
    ]);
    expect(selectedStableIds.every((id) => id && stableIds.includes(id))).toBe(
      true,
    );
    expect(new Set(selectedStableIds).size).toBe(2);
    expect(result.selectedElement?.selector).toContain(
      `data-agent-native-node-id="${selectedStableIds[1]}"`,
    );
  });

  it("preserves a matching rich runtime selection from the same Screen", () => {
    const node = buildCodeLayerProjection(RICH_HTML, {
      source: {
        kind: "design-file",
        fileId: "screen-a",
        filename: "index.html",
      },
    }).nodes.find((candidate) => candidate.tag === "button");
    expect(node).toBeDefined();
    const result = selectLayer({
      sourceHTML: RICH_HTML,
      selectedElement: liveInfo({ screenId: "screen-a", nodeId: node!.id }),
    });

    expect(result.selectedElement).toMatchObject({
      computedStyles: { backgroundColor: "rgb(15, 118, 110)" },
      portableStyleSnapshot: {
        nodes: [{ styles: { backgroundColor: "rgb(15, 118, 110)" } }],
      },
    });
  });

  it("does not reuse Screen A runtime info after navigation to Screen B with the same authored id", () => {
    const screenANode = buildCodeLayerProjection(RICH_HTML, {
      source: {
        kind: "design-file",
        fileId: "screen-a",
        filename: "index.html",
      },
    }).nodes.find((candidate) => candidate.tag === "button");
    const screenBNode = buildCodeLayerProjection(OTHER_SCREEN_HTML, {
      source: {
        kind: "design-file",
        fileId: "screen-b",
        filename: "index.html",
      },
    }).nodes.find((candidate) => candidate.tag === "button");
    expect(screenANode?.id).not.toBe(screenBNode?.id);
    expect(screenANode?.dataAttributes["data-agent-native-node-id"]).toBe(
      screenBNode?.dataAttributes["data-agent-native-node-id"],
    );
    const result = selectLayer({
      sourceHTML: OTHER_SCREEN_HTML,
      ownerFileId: "screen-b",
      selectedElement: liveInfo({
        screenId: "screen-a",
        nodeId: screenANode!.id,
      }),
    });

    expect(result.selectedElement?.computedStyles).not.toHaveProperty(
      "backgroundColor",
    );
    expect(result.selectedElement?.portableStyleSnapshot).toBeUndefined();
  });

  it("resolves a unique authored ID across an unrelated source edit", () => {
    const currentHTML = RICH_HTML.replace(
      "<main>",
      "<main><p>Unrelated edit</p>",
    );
    const result = selectLayer({
      sourceHTML: RICH_HTML,
      currentHTML,
    });
    const currentProjection = buildCodeLayerProjection(currentHTML, {
      source: {
        kind: "design-file",
        fileId: "screen-a",
        filename: "index.html",
      },
    });
    const currentNode = currentProjection.nodes.find(
      (candidate) =>
        candidate.dataAttributes["data-agent-native-node-id"] === "button-a",
    );

    expect(result.update).not.toHaveBeenCalled();
    expect(result.content).toBe(currentHTML);
    expect(currentNode).toBeDefined();
    expect(result.selectedLayerIds).toEqual([currentNode!.id]);
    expect(result.selectedElement?.sourceLayerIdentity?.nodeId).toBe(
      currentNode!.id,
    );
  });

  it("does not stamp a stale positional path onto an inserted sibling", () => {
    const result = selectLayer({
      sourceHTML: HTML,
      currentHTML: INSERTED_SIBLING_HTML,
    });

    expect(result.update).not.toHaveBeenCalled();
    expect(result.content).toBe(INSERTED_SIBLING_HTML);
    expect(result.content).not.toContain("data-agent-native-node-id");
    expect(result.selectedLayerIds).toEqual([result.node!.id]);
    expect(result.selectedElement?.sourceLayerIdentity?.nodeId).toBe(
      result.node!.id,
    );
  });

  it("does not promote prospective IDs while the source write is deferred", () => {
    const deferredWrite = vi.fn(() => ({ status: "deferred" as const }));
    const result = selectLayer({ applyFileContentUpdate: deferredWrite });

    expect(deferredWrite).toHaveBeenCalledOnce();
    expect(result.content).toBe(HTML);
    expect(result.content).not.toContain("data-agent-native-node-id");
    expect(result.selectedLayerIds).toEqual([result.node!.id]);
    expect(result.selectedElement?.sourceLayerIdentity?.nodeId).toBe(
      result.node!.id,
    );
  });

  it("does not select a prospective stable ID when the source writer refuses the stamp", () => {
    const activeFile = {
      id: "screen-a",
      filename: "index.html",
      fileType: "html" as const,
      content: HTML,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    };
    const refusedWrite = vi.fn((fileId: string, nextContent: string) =>
      runApplyFileContentUpdate(
        readOnlyWriterArgs(activeFile),
        fileId,
        nextContent,
        { recordHistory: false },
      ),
    );

    const result = selectLayer({ applyFileContentUpdate: refusedWrite });
    const attemptedStamp = /data-agent-native-node-id="([^"]+)"/.exec(
      result.content,
    )?.[1];

    expect(refusedWrite).toHaveBeenCalledOnce();
    expect(refusedWrite.mock.results[0]?.value).toEqual({
      status: "refused",
    });
    expect(result.content).toBe(HTML);
    expect(attemptedStamp).toBeUndefined();
    expect(result.selectedLayerIds).toEqual([result.node!.id]);
    expect(result.selectedElement?.sourceLayerIdentity?.nodeId).toBe(
      result.node!.id,
    );
  });
});
