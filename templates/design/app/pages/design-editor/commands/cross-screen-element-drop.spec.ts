// @vitest-environment happy-dom

const shaderLocks = vi.hoisted(() => ({ fileIds: new Set<string>() }));

vi.mock("sonner", () => ({ toast: { error: vi.fn() } }));
vi.mock("@/components/design/inspector/GlslShaderPanel", () => ({
  isShaderWriteInFlight: (fileId: string) => shaderLocks.fileIds.has(fileId),
  waitForShaderWriteToSettle: async () => {},
}));

import {
  buildCodeLayerProjection,
  buildCodeLayerTree,
} from "@shared/code-layer";
import { analyzeComponentLinks } from "@shared/component-links";
import { COMPONENT_REF_ATTR } from "@shared/component-model";
import { createSourceDocumentProvenance } from "@shared/preview-source-provenance";
import { toast } from "sonner";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  codeLayerSourceNodeIdAttrs,
  isCodeLayerNodeRuntimeOnly,
} from "@/pages/design-editor/code-layer-state";
import { prepareCanonicalSourceContent } from "@/pages/design-editor/source-publication";

import { runApplyFileContentUpdate } from "./apply-file-content-update";
import {
  absolutePlacePointForDrop,
  runCrossScreenElementDrop,
  shouldAbsolutePlaceOnEmptyScreen,
} from "./cross-screen-element-drop";
import type { FileContentSaveCompletion } from "./save-file-content";

const EMPTY_SCREEN = `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"></head><body></body></html>`;

const SCREEN_WITH_FRAME = `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"></head><body>
<div data-agent-native-node-id="frame-1"></div>
</body></html>`;

afterEach(() => {
  shaderLocks.fileIds.clear();
  vi.clearAllMocks();
});

function acceptFixture(fileId: string, content: string) {
  const prepared = prepareCanonicalSourceContent(content, {
    fileId,
    fileType: "html",
  });
  return {
    status: "accepted" as const,
    content: prepared.content,
    nodeIdMap: prepared.nodeIdMap,
  };
}

function runStoredCrossScreenDrop(args: {
  sourceContent: string;
  destinationContent: string;
  refusePersistFalseFor?: string[];
  drop: Parameters<typeof runCrossScreenElementDrop>[1];
  publish?: Parameters<
    typeof runCrossScreenElementDrop
  >[0]["applyFileContentUpdate"];
  afterDrop?: (args: {
    applyFileContentUpdate: Parameters<
      typeof runCrossScreenElementDrop
    >[0]["applyFileContentUpdate"];
    contentByFile: Map<string, string>;
    setSelectionFingerprint: (value: string) => void;
    setServerSnapshot: (
      fileId: string,
      snapshot: { content: string; updatedAt?: string | null },
    ) => void;
  }) => void;
}) {
  const writes = new Map<string, string>();
  const contentByFile = new Map([
    ["source", args.sourceContent],
    ["target", args.destinationContent],
  ]);
  const serverSnapshotByFile = new Map<
    string,
    { content: string; updatedAt?: string | null }
  >([
    ["source", { content: args.sourceContent, updatedAt: "before-drop" }],
    ["target", { content: args.destinationContent, updatedAt: "before-drop" }],
  ]);
  const baseContentByFile = new Map(contentByFile);
  const historyEntries: unknown[] = [];
  const selectionEvents: string[] = [];
  const cancelledFileIds: string[] = [];
  const fileHistoryMutationPendingRef = { current: false };
  let clearPendingHistoryCalls = 0;
  let activeFileId: string | null = null;
  let createdOverviewLayerSelection: {
    screenId: string;
    layerId: string;
  } | null = null;
  let selectedLayerIds: string[] = [];
  let selectedElement: unknown = null;
  let selectionFingerprint = "before-drop";
  const saveOperationRevisionByFile: Record<string, number> = {};
  const publish: Parameters<
    typeof runCrossScreenElementDrop
  >[0]["applyFileContentUpdate"] =
    args.publish ?? ((fileId, content) => acceptFixture(fileId, content));
  const applyFileContentUpdate = (
    fileId: string,
    content: string,
    options?: Parameters<
      Parameters<typeof runCrossScreenElementDrop>[0]["applyFileContentUpdate"]
    >[2],
  ) => {
    if (options?.persist === false) cancelledFileIds.push(fileId);
    if (
      options?.persist === false &&
      args.refusePersistFalseFor?.includes(fileId)
    ) {
      return { status: "refused" as const };
    }
    const result =
      options?.persist === false
        ? { ...acceptFixture(fileId, content), saveCompletion: undefined }
        : publish(fileId, content, options);
    if (result.status === "accepted") {
      if (options?.persist !== false) {
        saveOperationRevisionByFile[fileId] =
          (saveOperationRevisionByFile[fileId] ?? 0) + 1;
      }
      writes.set(fileId, result.content);
      contentByFile.set(fileId, result.content);
      if (result.saveCompletion) {
        return {
          ...result,
          saveCompletion: result.saveCompletion.then(
            (persisted) => {
              if (persisted === "conflict" || persisted === "failed") {
                contentByFile.set(fileId, baseContentByFile.get(fileId) ?? "");
              }
              return persisted;
            },
            (error) => {
              contentByFile.set(fileId, baseContentByFile.get(fileId) ?? "");
              throw error;
            },
          ),
        };
      }
    }
    return result;
  };
  runCrossScreenElementDrop(
    {
      applyFileContentUpdate,
      boardFileId: undefined,
      canEditDesign: true,
      clearPendingOverviewLayerSelectionTimer: () => {},
      codeLayerOwnerByNodeIdRef: { current: new Map() },
      designSourceType: "inline",
      fileHistoryMutationPendingRef,
      fileSaveOperationRevisionRef: {
        current: saveOperationRevisionByFile,
      },
      getCurrentFileSnapshot: (fileId) =>
        serverSnapshotByFile.get(fileId) ?? { content: "" },
      getCurrentSelectionFingerprint: () => selectionFingerprint,
      getScreenContent: (screenId) => contentByFile.get(screenId) ?? "",
      id: undefined,
      overviewScreens: [
        {
          id: "target",
          filename: "target.html",
          content: args.destinationContent,
          updatedAt: "2026-09-13T00:00:00.000Z",
          heightPinned: false,
          sourceType: "inline",
        },
      ],
      pendingOverviewLayerSelectionRef: { current: null },
      pendingOverviewScreenSelectionRef: { current: null },
      recordContentHistoryEntry: (entry) => historyEntries.push(entry),
      clearPendingHistory: () => {
        clearPendingHistoryCalls += 1;
      },
      syncUndoRedoState: () => {},
      runtimeStructureInsertRevisionRef: { current: 0 },
      sendRuntimeLayerMoveSemanticHandoff: () => false,
      setActiveFileId: (value) => {
        selectionEvents.push("active-file");
        activeFileId =
          typeof value === "function" ? value(activeFileId) : value;
      },
      setCreatedOverviewLayerSelection: (value) => {
        selectionEvents.push("created-layer");
        createdOverviewLayerSelection =
          typeof value === "function"
            ? value(createdOverviewLayerSelection)
            : value;
      },
      setOverviewSelectedScreenIds: () => {},
      setRuntimeStructureInsertRequest: () => {},
      setSelectedElement: (value) => {
        selectionEvents.push("element");
        selectedElement =
          typeof value === "function" ? value(selectedElement as never) : value;
      },
      setSelectedLayerIdsState: (value) => {
        selectionEvents.push("layers");
        selectedLayerIds =
          typeof value === "function" ? value(selectedLayerIds) : value;
      },
      t: (key) => key,
      viewModeRef: { current: "overview" },
    },
    args.drop,
  );
  args.afterDrop?.({
    applyFileContentUpdate,
    contentByFile,
    setSelectionFingerprint: (value) => {
      selectionFingerprint = value;
    },
    setServerSnapshot: (fileId, snapshot) => {
      serverSnapshotByFile.set(fileId, snapshot);
    },
  });
  return {
    activeFileId,
    createdOverviewLayerSelection,
    historyEntries,
    fileHistoryMutationPendingRef,
    selectionEvents,
    selectedElement,
    selectedLayerIds,
    contentByFile,
    clearPendingHistoryCalls: () => clearPendingHistoryCalls,
    cancelledFileIds,
    writes,
  };
}

function createRealWriterHarness(
  sourceContent: string,
  destinationContent: string,
  canEdit = true,
) {
  const activeContent =
    "<!doctype html><html><head></head><body></body></html>";
  const files = [
    {
      id: "source",
      filename: "source.html",
      fileType: "html",
      content: sourceContent,
      updatedAt: "1",
    },
    {
      id: "target",
      filename: "target.html",
      fileType: "html",
      content: destinationContent,
      updatedAt: "1",
    },
    {
      id: "active",
      filename: "active.html",
      fileType: "html",
      content: activeContent,
      updatedAt: "1",
    },
  ];
  const contentByFile = new Map(files.map((file) => [file.id, file.content]));
  const calls: Array<{
    fileId: string;
    status: string;
    historyBeforeContent?: string;
  }> = [];
  const history: unknown[] = [];
  const queuedSaves: string[] = [];
  let queryWrites = 0;
  const queryClient = {
    setQueryData: (_key: unknown, update: any) => {
      queryWrites += 1;
      const previous = {
        files: files.map((file) => ({
          ...file,
          content: contentByFile.get(file.id),
        })),
      };
      const next = typeof update === "function" ? update(previous) : update;
      for (const file of next?.files ?? []) {
        contentByFile.set(file.id, file.content);
      }
    },
  };
  const writerArgs = {
    acknowledgeAuthoritativeClipboardMutation: () => {},
    activeFile: files[2],
    applyFileContentUpdate: () => {},
    applyLocalContentUpdate: () => ({ status: "refused" as const }),
    canEditDesignRef: { current: canEdit },
    cancelQueuedFileContentSave: () => {},
    clearPendingLocalFileContent: () => {},
    files,
    getScreenContent: (fileId: string) => contentByFile.get(fileId) ?? "",
    id: "design",
    markPendingLocalFileContent: () => {},
    overviewIsSynced: false,
    overviewPresenceFileId: null,
    overviewYdoc: null,
    queryClient,
    queueFileContentSave: (fileId: string) => queuedSaves.push(fileId),
    recordContentHistoryEntry: (entry: unknown) => history.push(entry),
    suppressContentHistoryRef: { current: false },
    t: (key: string) => key,
  };
  const publish: Parameters<
    typeof runCrossScreenElementDrop
  >[0]["applyFileContentUpdate"] = (fileId, content, options) => {
    const result = runApplyFileContentUpdate(
      { ...writerArgs, applyFileContentUpdate: publish } as never,
      fileId,
      content,
      options,
    );
    calls.push({
      fileId,
      status: result.status,
      historyBeforeContent: options?.historyBeforeContent,
    });
    return result;
  };

  return {
    calls,
    contentByFile,
    history,
    publish,
    queuedSaves,
    get queryWrites() {
      return queryWrites;
    },
  };
}

describe("shouldAbsolutePlaceOnEmptyScreen", () => {
  it("places at the pointer when the destination body has no elements", () => {
    expect(
      shouldAbsolutePlaceOnEmptyScreen({
        destHtml: EMPTY_SCREEN,
        targetLocalPoint: { x: 180, y: 240 },
      }),
    ).toBe(true);
  });

  it("leaves flow-insert alone when the destination already has layers", () => {
    expect(
      shouldAbsolutePlaceOnEmptyScreen({
        destHtml: SCREEN_WITH_FRAME,
        targetLocalPoint: { x: 180, y: 240 },
      }),
    ).toBe(false);
  });

  it("does not treat a live-app URL destination as an empty screen", () => {
    expect(
      shouldAbsolutePlaceOnEmptyScreen({
        destHtml: "http://localhost:5173/",
        targetLocalPoint: { x: 180, y: 240 },
      }),
    ).toBe(false);
  });

  it("requires a pointer", () => {
    expect(
      shouldAbsolutePlaceOnEmptyScreen({
        destHtml: EMPTY_SCREEN,
        targetLocalPoint: null,
      }),
    ).toBe(false);
  });
});

describe("absolutePlacePointForDrop", () => {
  it("uses the pointer on an empty screen even when a stale anchor rect is present", () => {
    expect(
      absolutePlacePointForDrop({
        placeAbsoluteOnEmptyScreen: true,
        targetAnchorRect: { left: 180, top: 240 },
        targetLocalPoint: { x: 180, y: 240 },
      }),
    ).toEqual({ x: 180, y: 240 });
  });

  it("subtracts the anchor origin when placing into a positioned container", () => {
    expect(
      absolutePlacePointForDrop({
        placeAbsoluteOnEmptyScreen: false,
        targetAnchorRect: { left: 100, top: 50 },
        targetLocalPoint: { x: 180, y: 240 },
      }),
    ).toEqual({ x: 80, y: 190 });
  });
});

it("preflights both real writes before moving Alpine-owned source into a destination without Alpine", () => {
  const sourceInput = `<!DOCTYPE html><html><head>
    <script defer src="https://cdn.jsdelivr.net/npm/alpinejs@3.14.0/dist/cdn.min.js"></script>
  </head><body><div style="position:absolute;left:20px;top:20px" data-agent-native-node-id="moving" x-data="{ open: true }"><span x-text="open"></span></div></body></html>`;
  const targetInput = `<!DOCTYPE html><html><head></head><body><main data-agent-native-node-id="target-root"></main></body></html>`;
  const sourceContent = prepareCanonicalSourceContent(sourceInput, {
    fileId: "source",
    fileType: "html",
  }).content;
  const targetContent = prepareCanonicalSourceContent(targetInput, {
    fileId: "target",
    fileType: "html",
  }).content;
  const activeContent =
    "<!DOCTYPE html><html><head></head><body></body></html>";
  const files = [
    {
      id: "source",
      filename: "source.html",
      fileType: "html",
      content: sourceContent,
      createdAt: "1",
      updatedAt: "1",
    },
    {
      id: "target",
      filename: "target.html",
      fileType: "html",
      content: targetContent,
      createdAt: "1",
      updatedAt: "1",
    },
    {
      id: "active",
      filename: "active.html",
      fileType: "html",
      content: activeContent,
      createdAt: "1",
      updatedAt: "1",
    },
  ] as any;
  const contentByFile = new Map<string, string>(
    files.map((file: any) => [file.id, file.content]),
  );
  const writes: string[] = [];
  const historyEntries: unknown[] = [];
  const publications: Array<{ fileId: string; status: string }> = [];
  const queryClient = {
    setQueryData: (_key: unknown, update: any) => {
      const previous = {
        files: files.map((file: any) => ({
          ...file,
          content: contentByFile.get(file.id),
        })),
      };
      const next = typeof update === "function" ? update(previous) : update;
      for (const file of next?.files ?? [])
        contentByFile.set(file.id, file.content);
    },
  };
  const writerArgs = {
    acknowledgeAuthoritativeClipboardMutation: () => {},
    activeFile: files[2],
    applyFileContentUpdate: () => {},
    applyLocalContentUpdate: () => ({ status: "refused" as const }),
    canEditDesignRef: { current: true },
    cancelQueuedFileContentSave: () => {},
    clearPendingLocalFileContent: () => {},
    files,
    getScreenContent: (fileId: string) => contentByFile.get(fileId) ?? "",
    id: "design",
    markPendingLocalFileContent: () => {},
    overviewIsSynced: false,
    overviewPresenceFileId: null,
    overviewYdoc: null,
    queryClient: queryClient as any,
    queueFileContentSave: (fileId: string) => writes.push(fileId),
    recordContentHistoryEntry: () => {},
    suppressContentHistoryRef: { current: false },
    t: () => "Save failed",
  };
  const publish = (fileId: string, content: string, options?: any) => {
    const result = runApplyFileContentUpdate(
      writerArgs as any,
      fileId,
      content,
      options,
    );
    publications.push({ fileId, status: result.status });
    return result;
  };

  runCrossScreenElementDrop(
    {
      applyFileContentUpdate: publish,
      boardFileId: undefined,
      canEditDesign: true,
      clearPendingOverviewLayerSelectionTimer: () => {},
      codeLayerOwnerByNodeIdRef: { current: new Map() },
      designSourceType: "inline",
      getScreenContent: (screenId) => contentByFile.get(screenId) ?? "",
      id: "design",
      overviewScreens: [
        {
          id: "target",
          filename: "target.html",
          content: targetContent,
          updatedAt: "1",
          heightPinned: false,
          sourceType: "inline",
        },
      ],
      pendingOverviewLayerSelectionRef: { current: null },
      pendingOverviewScreenSelectionRef: { current: null },
      recordContentHistoryEntry: (entry) => historyEntries.push(entry),
      runtimeStructureInsertRevisionRef: { current: 0 },
      sendRuntimeLayerMoveSemanticHandoff: () => false,
      setActiveFileId: () => {},
      setCreatedOverviewLayerSelection: () => {},
      setOverviewSelectedScreenIds: () => {},
      setRuntimeStructureInsertRequest: () => {},
      setSelectedElement: () => {},
      setSelectedLayerIdsState: () => {},
      t: (key) => key,
      viewModeRef: { current: "overview" },
    },
    {
      sourceSelector: '[data-agent-native-node-id="moving"]',
      sourceNodeId: "moving",
      sourceProvenance: { uniqueNodeId: "moving" },
      sourceScreenId: "source",
      targetScreenId: "target",
    },
  );

  expect(publications).toEqual([]);
  expect(contentByFile.get("source")).toBe(sourceContent);
  expect(contentByFile.get("target")).toBe(targetContent);
  expect(writes).toEqual([]);
  expect(historyEntries).toEqual([]);
});

describe("runCrossScreenElementDrop duplicate routing", () => {
  it("links an inline duplicate into another Screen in the same Design", () => {
    const designId = "design-1";
    const sourceContent = `<!doctype html><html><body>
      <article data-agent-native-node-id="card-main" data-agent-native-component-id="cmp-card" data-agent-native-component="Card">Card</article>
    </body></html>`;
    const targetContent = SCREEN_WITH_FRAME;
    const cloneHtml = `<article data-agent-native-node-id="card-main" data-agent-native-component-id="cmp-card" data-agent-native-component="Card">Card</article>`;
    let nextTargetContent = targetContent;
    const source = {
      kind: "design-file" as const,
      designId,
      fileId: "source",
      filename: "source.html",
    };
    const target = {
      kind: "design-file" as const,
      designId,
      fileId: "target",
      filename: "target.html",
    };

    runCrossScreenElementDrop(
      {
        applyFileContentUpdate: (_fileId, nextContent) => {
          nextTargetContent = nextContent;
          return acceptFixture("target", nextContent);
        },
        boardFileId: undefined,
        canEditDesign: true,
        clearPendingOverviewLayerSelectionTimer: () => {},
        codeLayerOwnerByNodeIdRef: { current: new Map() },
        designSourceType: "inline",
        getScreenContent: (screenId) =>
          screenId === "source" ? sourceContent : targetContent,
        id: designId,
        overviewScreens: [
          {
            id: "source",
            filename: "source.html",
            content: sourceContent,
            updatedAt: "2026-09-14T00:00:00.000Z",
            heightPinned: false,
            sourceType: "inline",
          },
          {
            id: "target",
            filename: "target.html",
            content: targetContent,
            updatedAt: "2026-09-14T00:00:00.000Z",
            heightPinned: false,
            sourceType: "inline",
          },
        ],
        pendingOverviewLayerSelectionRef: { current: null },
        pendingOverviewScreenSelectionRef: { current: null },
        recordContentHistoryEntry: () => {},
        runtimeStructureInsertRevisionRef: { current: 0 },
        sendRuntimeLayerMoveSemanticHandoff: () => false,
        setActiveFileId: () => {},
        setCreatedOverviewLayerSelection: () => {},
        setOverviewSelectedScreenIds: () => {},
        setRuntimeStructureInsertRequest: () => {},
        setSelectedElement: () => {},
        setSelectedLayerIdsState: () => {},
        t: (key) => key,
        viewModeRef: { current: "overview" },
      },
      {
        sourceSelector: '[data-agent-native-node-id="card-main"]',
        sourceNodeId: "card-main",
        sourceScreenId: "source",
        targetScreenId: "target",
        targetAnchorNodeId: "frame-1",
        targetAnchorSelector: '[data-agent-native-node-id="frame-1"]',
        targetAnchorProvenance: { uniqueNodeId: "frame-1" },
        targetAnchorPlacement: "inside",
        targetDropMode: "flow-insert",
        duplicate: true,
        sourceCloneHtml: cloneHtml,
      },
    );

    const sourceProjection = buildCodeLayerProjection(sourceContent, {
      source,
    });
    const targetProjection = buildCodeLayerProjection(nextTargetContent, {
      source: target,
    });
    expect(
      targetProjection.nodes.some(
        (node) => node.dataAttributes[COMPONENT_REF_ATTR] === "cmp-card",
      ),
    ).toBe(true);
    expect(
      analyzeComponentLinks([sourceProjection, targetProjection]).components,
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          componentId: "cmp-card",
          status: "resolved",
        }),
      ]),
    );
  });

  it.each(["localhost", "fusion"])(
    "queues an inline Alt-drag copy for a %s screen",
    (sourceType) => {
      const runtimeStructureInsertRevisionRef = { current: 0 };
      let runtimeStructureInsertRequest: unknown = null;

      runCrossScreenElementDrop(
        {
          applyFileContentUpdate: () => {
            throw new Error("live duplicate must not write stored content");
          },
          boardFileId: undefined,
          canEditDesign: true,
          clearPendingOverviewLayerSelectionTimer: () => {},
          codeLayerOwnerByNodeIdRef: { current: new Map() },
          designSourceType: "inline",
          getScreenContent: (screenId) =>
            screenId === "source"
              ? SCREEN_WITH_FRAME
              : "http://localhost:5173/",
          id: undefined,
          overviewScreens: [
            {
              id: "target",
              filename: "target.html",
              content: "http://localhost:5173/",
              updatedAt: "2026-09-11T00:00:00.000Z",
              heightPinned: false,
              sourceType,
            },
          ],
          pendingOverviewLayerSelectionRef: { current: null },
          pendingOverviewScreenSelectionRef: { current: null },
          recordContentHistoryEntry: () => {},
          runtimeStructureInsertRevisionRef,
          sendRuntimeLayerMoveSemanticHandoff: () => {
            throw new Error("duplicate must not use move-only handoff");
          },
          setActiveFileId: () => {},
          setCreatedOverviewLayerSelection: () => {},
          setOverviewSelectedScreenIds: () => {},
          setRuntimeStructureInsertRequest: (value) => {
            runtimeStructureInsertRequest =
              typeof value === "function" ? value(null) : value;
          },
          setSelectedElement: () => {},
          setSelectedLayerIdsState: () => {},
          t: (key) => key,
          viewModeRef: { current: "overview" },
        },
        {
          sourceSelector: "#source",
          sourceNodeId: "source-id",
          sourceScreenId: "source",
          targetScreenId: "target",
          targetAnchorSelector: "body",
          targetAnchorPlacement: "inside",
          targetDropMode: "absolute-container",
          targetAnchorRect: { left: 100, top: 50, width: 400, height: 300 },
          targetLocalPoint: { x: 240, y: 300 },
          sourcePointerOffset: { x: 10, y: 12 },
          duplicate: true,
          sourceCloneHtml:
            '<section id="source-root" data-agent-native-node-id="copy-id" style="position:absolute;left:4px;top:6px"></section>',
        },
      );

      expect(runtimeStructureInsertRevisionRef.current).toBe(1);
      expect(runtimeStructureInsertRequest).toMatchObject({
        screenId: "target",
        anchor: { selector: "body" },
        placement: "inside",
      });
      const insertedHtml = (runtimeStructureInsertRequest as { html: string })
        .html;
      expect(insertedHtml).not.toContain('id="source-root"');
      expect(insertedHtml).toMatch(/data-agent-native-node-id="[^"]+"/);
      expect(insertedHtml).toContain("left: 130px");
      expect(insertedHtml).toContain("top: 238px");
    },
  );

  it("preserves the grab offset for an inline cross-screen copy", () => {
    const runtimeStructureInsertRevisionRef = { current: 0 };
    let nextDestinationContent = "";

    runCrossScreenElementDrop(
      {
        applyFileContentUpdate: (_fileId, nextContent) => {
          nextDestinationContent = nextContent;
          return acceptFixture("target", nextContent);
        },
        boardFileId: undefined,
        canEditDesign: true,
        clearPendingOverviewLayerSelectionTimer: () => {},
        codeLayerOwnerByNodeIdRef: { current: new Map() },
        designSourceType: "inline",
        getScreenContent: (screenId) =>
          screenId === "source" ? SCREEN_WITH_FRAME : SCREEN_WITH_FRAME,
        id: undefined,
        overviewScreens: [
          {
            id: "target",
            filename: "target.html",
            content: SCREEN_WITH_FRAME,
            updatedAt: "2026-09-11T00:00:00.000Z",
            heightPinned: false,
            sourceType: "inline",
          },
        ],
        pendingOverviewLayerSelectionRef: { current: null },
        pendingOverviewScreenSelectionRef: { current: null },
        recordContentHistoryEntry: () => {},
        runtimeStructureInsertRevisionRef,
        sendRuntimeLayerMoveSemanticHandoff: () => true,
        setActiveFileId: () => {},
        setCreatedOverviewLayerSelection: () => {},
        setOverviewSelectedScreenIds: () => {},
        setRuntimeStructureInsertRequest: () => {},
        setSelectedElement: () => {},
        setSelectedLayerIdsState: () => {},
        t: (key) => key,
        viewModeRef: { current: "overview" },
      },
      {
        sourceSelector: "#source",
        sourceNodeId: "source-id",
        sourceScreenId: "source",
        targetScreenId: "target",
        targetAnchorSelector: '[data-agent-native-node-id="frame-1"]',
        targetAnchorPlacement: "inside",
        targetDropMode: "absolute-container",
        targetAnchorRect: { left: 100, top: 50, width: 400, height: 300 },
        targetLocalPoint: { x: 240, y: 300 },
        sourcePointerOffset: { x: 10, y: 12 },
        targetAnchorProvenance: { uniqueNodeId: "frame-1" },
        duplicate: true,
        sourceCloneHtml:
          '<section data-agent-native-node-id="copy-id" style="position:absolute;left:4px;top:6px"></section>',
      },
    );

    expect(nextDestinationContent).toContain("left: 130px");
    expect(nextDestinationContent).toContain("top: 238px");
  });

  it("moves the selected duplicate-id source and anchor by their selectors", () => {
    const sourceHtml = `<!DOCTYPE html><html><body>
      <div data-agent-native-node-id="duplicate-source">First source</div>
      <div data-agent-native-node-id="duplicate-source">Selected source</div>
    </body></html>`;
    const destHtml = `<!DOCTYPE html><html><body><section>
      <div data-agent-native-node-id="duplicate-anchor">First anchor</div>
      <div data-agent-native-node-id="duplicate-anchor">Selected anchor</div>
    </section></body></html>`;
    const updates = new Map<string, string>();

    runCrossScreenElementDrop(
      {
        applyFileContentUpdate: (fileId, nextContent) => {
          const publication = acceptFixture(fileId, nextContent);
          updates.set(fileId, publication.content);
          return publication;
        },
        boardFileId: undefined,
        canEditDesign: true,
        clearPendingOverviewLayerSelectionTimer: () => {},
        codeLayerOwnerByNodeIdRef: { current: new Map() },
        designSourceType: "inline",
        getScreenContent: (screenId) =>
          screenId === "source" ? sourceHtml : destHtml,
        id: undefined,
        overviewScreens: [
          {
            id: "target",
            filename: "target.html",
            content: destHtml,
            updatedAt: "2026-09-11T00:00:00.000Z",
            heightPinned: false,
            sourceType: "inline",
          },
        ],
        pendingOverviewLayerSelectionRef: { current: null },
        pendingOverviewScreenSelectionRef: { current: null },
        recordContentHistoryEntry: () => {},
        runtimeStructureInsertRevisionRef: { current: 0 },
        sendRuntimeLayerMoveSemanticHandoff: () => true,
        setActiveFileId: () => {},
        setCreatedOverviewLayerSelection: () => {},
        setOverviewSelectedScreenIds: () => {},
        setRuntimeStructureInsertRequest: () => {},
        setSelectedElement: () => {},
        setSelectedLayerIdsState: () => {},
        t: (key) => key,
        viewModeRef: { current: "overview" },
      },
      {
        sourceSelector:
          'body > div[data-agent-native-node-id="duplicate-source"]:nth-of-type(2)',
        sourceNodeId: "duplicate-source",
        sourceScreenId: "source",
        targetScreenId: "target",
        targetAnchorNodeId: "duplicate-anchor",
        targetAnchorSelector:
          'body > section > div[data-agent-native-node-id="duplicate-anchor"]:nth-of-type(2)',
        targetAnchorPlacement: "inside",
        targetDropMode: "flow-insert",
        sourceProvenance: {
          versionHash: createSourceDocumentProvenance(sourceHtml).versionHash,
        },
        targetAnchorProvenance: {
          versionHash: createSourceDocumentProvenance(destHtml).versionHash,
        },
      },
    );

    const nextSource = updates.get("source");
    const nextDest = updates.get("target");
    expect(nextSource).toContain("First source");
    expect(nextSource).not.toContain("Selected source");
    expect(nextDest).toContain("First anchor</div>");
    expect(nextDest).toContain("Selected anchor");
    const parsedDest = new DOMParser().parseFromString(nextDest!, "text/html");
    const anchorDivs = parsedDest.querySelectorAll("section > div");
    expect(anchorDivs).toHaveLength(2);
    expect(anchorDivs[0]?.textContent).toBe("First anchor");
    expect(anchorDivs[1]?.textContent).toContain("Selected source");
  });
  it("never leaves the dropped copy sharing the still-live source's node id", () => {
    // Regression for B4: an alt-drag duplicate across the screen boundary
    // leaves the ORIGINAL alive in its own file. insertClonedHtmlLayers's
    // preserveIncomingNodeIds only reserved ids already in the destination
    // doc, so the copy silently kept the source's own
    // data-agent-native-node-id — two live elements, two files, one id,
    // which broke every id-keyed lookup on either (including the
    // subsequent Option+Arrow nudge landing on/writing to the wrong file).
    const SOURCE_SCREEN = `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"></head><body>
<div id="source-frame" data-agent-native-node-id="source-id" style="position:absolute;left:400px;top:400px;width:60px;height:60px;"><span data-agent-native-node-id="source-child-id"></span></div>
</body></html>`;
    const runtimeStructureInsertRevisionRef = { current: 0 };
    let nextDestinationContent = "";

    runCrossScreenElementDrop(
      {
        applyFileContentUpdate: (_fileId, nextContent) => {
          nextDestinationContent = nextContent;
          return acceptFixture("target", nextContent);
        },
        boardFileId: "board",
        canEditDesign: true,
        clearPendingOverviewLayerSelectionTimer: () => {},
        codeLayerOwnerByNodeIdRef: { current: new Map() },
        designSourceType: "inline",
        getScreenContent: (screenId) =>
          screenId === "board" ? SOURCE_SCREEN : SCREEN_WITH_FRAME,
        id: undefined,
        overviewScreens: [
          {
            id: "target",
            filename: "target.html",
            content: SCREEN_WITH_FRAME,
            updatedAt: "2026-09-11T00:00:00.000Z",
            heightPinned: false,
            sourceType: "inline",
          },
        ],
        pendingOverviewLayerSelectionRef: { current: null },
        pendingOverviewScreenSelectionRef: { current: null },
        recordContentHistoryEntry: () => {},
        runtimeStructureInsertRevisionRef,
        sendRuntimeLayerMoveSemanticHandoff: () => true,
        setActiveFileId: () => {},
        setCreatedOverviewLayerSelection: () => {},
        setOverviewSelectedScreenIds: () => {},
        setRuntimeStructureInsertRequest: () => {},
        setSelectedElement: () => {},
        setSelectedLayerIdsState: () => {},
        t: (key) => key,
        viewModeRef: { current: "overview" },
      },
      {
        sourceSelector: "#source-frame",
        sourceNodeId: "source-id",
        sourceScreenId: "board",
        targetScreenId: "target",
        targetAnchorNodeId: "frame-1",
        targetAnchorSelector: '[data-agent-native-node-id="frame-1"]',
        targetAnchorProvenance: { uniqueNodeId: "frame-1" },
        targetAnchorPlacement: "inside",
        targetDropMode: "absolute-container",
        targetAnchorRect: { left: 100, top: 50, width: 400, height: 300 },
        targetLocalPoint: { x: 240, y: 300 },
        sourcePointerOffset: { x: 10, y: 12 },
        duplicate: true,
        sourceCloneHtml:
          '<div id="source-frame" data-agent-native-node-id="source-id" style="position:absolute;left:400px;top:400px;width:60px;height:60px;"><span data-agent-native-node-id="source-child-id"></span></div>',
      },
    );

    const projection = buildCodeLayerProjection(nextDestinationContent);
    const copyNodes = projection.nodes.filter((node) => {
      const id = node.dataAttributes["data-agent-native-node-id"];
      return id && id !== "frame-1";
    });
    const copyIds = copyNodes.map(
      (node) => node.dataAttributes["data-agent-native-node-id"],
    );
    // The root AND descendant must be re-stamped while the original source
    // remains live in its own Screen.
    expect(copyIds).toHaveLength(2);
    expect(copyIds).not.toContain("source-id");
    expect(copyIds).not.toContain("source-child-id");
    expect(new Set(copyIds).size).toBe(2);
    const copyRoot = copyNodes.find(
      (node) => !copyIds.includes(node.parentId ?? ""),
    );
    const copyChild = copyNodes.find((node) => node.id !== copyRoot?.id);
    expect(copyChild?.parentId).toBe(copyRoot?.id);
  });

  it("reserves localhost clone root and descendant ids while the source remains live", () => {
    const sourceCloneHtml = `<div id="live-node" data-agent-native-node-id="live-root-id">
  <span data-agent-native-node-id="live-child-id">child</span>
</div>`;
    const { writes } = runStoredCrossScreenDrop({
      sourceContent: "http://localhost:5173/",
      destinationContent: SCREEN_WITH_FRAME,
      drop: {
        sourceSelector: "#live-node",
        sourceNodeId: "live-root-id",
        sourceScreenId: "source",
        targetScreenId: "target",
        targetAnchorNodeId: "frame-1",
        targetAnchorSelector: '[data-agent-native-node-id="frame-1"]',
        targetAnchorProvenance: { uniqueNodeId: "frame-1" },
        targetAnchorPlacement: "inside",
        targetDropMode: "absolute-container",
        targetAnchorRect: { left: 100, top: 50, width: 400, height: 300 },
        targetLocalPoint: { x: 240, y: 300 },
        duplicate: true,
        sourceCloneHtml,
      },
    });

    const nextDestinationContent = writes.get("target");
    expect(nextDestinationContent).toBeTruthy();
    expect(writes.has("source")).toBe(false);
    const projection = buildCodeLayerProjection(nextDestinationContent!);
    const copyIds = projection.nodes
      .map((node) => node.dataAttributes["data-agent-native-node-id"])
      .filter((id) => id?.startsWith("copy-"))
      .filter((id): id is string => Boolean(id));
    expect(copyIds).toHaveLength(2);
    expect(copyIds).not.toContain("live-root-id");
    expect(copyIds).not.toContain("live-child-id");
    expect(new Set(copyIds).size).toBe(2);
    const destinationIds = projection.nodes
      .map((node) => node.dataAttributes["data-agent-native-node-id"])
      .filter((id): id is string => Boolean(id));
    expect(new Set(destinationIds).size).toBe(destinationIds.length);
  });
});

describe("runCrossScreenElementDrop ordinary move routing", () => {
  it("preserves resolved dimensions only when a drop converts auto layout to absolute positioning", () => {
    const sourceContent = `<!DOCTYPE html><html><body><section style="display:flex"><div data-agent-native-node-id="flow-child" style="flex:0 0 100px;height:50px"></div></section></body></html>`;
    const styleSnapshot = {
      version: 1 as const,
      nodes: [
        {
          path: [],
          styles: { flex: "0 0 100px", height: "50px" },
        },
      ],
    };
    const absoluteDrop = runStoredCrossScreenDrop({
      sourceContent,
      destinationContent: EMPTY_SCREEN,
      drop: {
        sourceSelector: '[data-agent-native-node-id="flow-child"]',
        sourceNodeId: "flow-child",
        sourceProvenance: { uniqueNodeId: "flow-child" },
        sourceScreenId: "source",
        targetScreenId: "target",
        targetLocalPoint: { x: 180, y: 240 },
        sourceComputedSize: { width: 100, height: 50 },
        styleSnapshot,
      },
    });
    const movedAbsolute = new DOMParser()
      .parseFromString(absoluteDrop.writes.get("target")!, "text/html")
      .querySelector('[data-agent-native-node-id="flow-child"]') as HTMLElement;

    expect(movedAbsolute.style.position).toBe("absolute");
    expect(movedAbsolute.style.width).toBe("100px");
    expect(movedAbsolute.style.height).toBe("50px");
    expect(movedAbsolute.style.flex).toBe("");
  });

  it("absolute-places a move dropped onto an empty screen root", () => {
    const selection = runStoredCrossScreenDrop({
      sourceContent: `<!DOCTYPE html>
<html><body><div id="move-me" data-agent-native-node-id="move-id" style="position:absolute;left:10px;top:10px;width:40px;height:40px"></div></body></html>`,
      destinationContent: EMPTY_SCREEN,
      drop: {
        sourceSelector: "#move-me",
        sourceNodeId: "move-id",
        sourceProvenance: { uniqueNodeId: "move-id" },
        sourceScreenId: "source",
        targetScreenId: "target",
        targetLocalPoint: { x: 180, y: 240 },
      },
    });

    const nextSource = selection.writes.get("source");
    const nextDestination = selection.writes.get("target");
    expect(nextSource).toBeTruthy();
    expect(nextDestination).toContain('data-agent-native-node-id="move-id"');
    expect(nextDestination).toMatch(
      /data-agent-native-node-id="move-id"[^>]*style="[^"]*position:\s*absolute[^\"]*left:\s*180px[^\"]*top:\s*240px/i,
    );
    expect(nextSource).not.toContain('data-agent-native-node-id="move-id"');
  });

  it("keeps the moved node's authored id — only duplicates need a fresh one", () => {
    const sourceContent = `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"></head><body>
<div id="move-me" data-agent-native-node-id="move-id" style="position:absolute;left:10px;top:10px;width:40px;height:40px;"></div>
</body></html>`;
    const selection = runStoredCrossScreenDrop({
      sourceContent,
      destinationContent: SCREEN_WITH_FRAME,
      drop: {
        sourceSelector: "#move-me",
        sourceNodeId: "move-id",
        sourceProvenance: { uniqueNodeId: "move-id" },
        sourceScreenId: "source",
        targetScreenId: "target",
        targetLocalPoint: { x: 240, y: 300 },
      },
    });

    const nextSource = selection.writes.get("source");
    const nextDestination = selection.writes.get("target");
    expect(nextSource).toBeTruthy();
    expect(nextDestination).toBeTruthy();
    const destinationProjection = buildCodeLayerProjection(nextDestination!, {
      source: { kind: "design-file", fileId: "target" },
    });
    const movedNode = destinationProjection.nodes.find(
      (node) => node.attributes.id === "move-me",
    );
    expect(movedNode?.dataAttributes["data-agent-native-node-id"]).toBe(
      "move-id",
    );
    expect(selection.selectedLayerIds).toEqual([movedNode!.id]);
    expect(selection.createdOverviewLayerSelection).toEqual({
      screenId: "target",
      layerId: movedNode!.id,
    });
    expect(selection.activeFileId).toBe("target");
    expect(selection.selectedElement).toMatchObject({
      sourceId: "move-id",
      selector: expect.stringContaining('data-agent-native-node-id="move-id"'),
    });
    const sourceIds = buildCodeLayerProjection(nextSource!).nodes.map(
      (node) => node.dataAttributes["data-agent-native-node-id"],
    );
    expect(sourceIds).not.toContain("move-id");
  });
});

describe("runCrossScreenElementDrop shader publication preflight", () => {
  it.each(["source", "target"])(
    "leaves source, destination, and history untouched when %s is shader-locked",
    (lockedFileId) => {
      const sourceContent = `<html><body><div id="move-me" data-agent-native-node-id="move-id">Move</div></body></html>`;
      shaderLocks.fileIds.add(lockedFileId);

      const { writes, historyEntries } = runStoredCrossScreenDrop({
        sourceContent,
        destinationContent: SCREEN_WITH_FRAME,
        drop: {
          sourceSelector: "#move-me",
          sourceNodeId: "move-id",
          sourceProvenance: { uniqueNodeId: "move-id" },
          sourceScreenId: "source",
          targetScreenId: "target",
        },
      });

      expect(writes.size).toBe(0);
      expect(historyEntries).toHaveLength(0);
    },
  );

  it("preflights the destination before recording a duplicate-only history entry", () => {
    shaderLocks.fileIds.add("target");
    const { writes, historyEntries } = runStoredCrossScreenDrop({
      sourceContent: "http://localhost:5173/",
      destinationContent: SCREEN_WITH_FRAME,
      drop: {
        sourceSelector: "#live-node",
        sourceNodeId: "live-root-id",
        sourceScreenId: "source",
        targetScreenId: "target",
        targetAnchorNodeId: "frame-1",
        targetAnchorSelector: '[data-agent-native-node-id="frame-1"]',
        targetAnchorProvenance: { uniqueNodeId: "frame-1" },
        targetAnchorPlacement: "inside",
        targetDropMode: "absolute-container",
        targetAnchorRect: { left: 100, top: 50, width: 400, height: 300 },
        targetLocalPoint: { x: 240, y: 300 },
        duplicate: true,
        sourceCloneHtml:
          '<div id="live-node" data-agent-native-node-id="live-root-id"><span data-agent-native-node-id="live-child-id">child</span></div>',
      },
    });

    expect(writes.size).toBe(0);
    expect(historyEntries).toHaveLength(0);
  });
});

describe("runCrossScreenElementDrop real publication refusal", () => {
  it("rolls the destination back when the source refuses after destination publication", () => {
    const sourceContent = `<!doctype html><html><body><button data-agent-native-node-id="moving">Move</button></body></html>`;
    const destinationContent = `<!doctype html><html><body><main data-agent-native-node-id="target-root"></main></body></html>`;
    const calls: Array<{ fileId: string; content: string }> = [];
    let sourceAttempted = false;
    const result = runStoredCrossScreenDrop({
      sourceContent,
      destinationContent,
      publish: (fileId, content) => {
        calls.push({ fileId, content });
        if (fileId === "source") {
          sourceAttempted = true;
          return { status: "refused" as const };
        }
        if (fileId === "target" && sourceAttempted) {
          return acceptFixture(fileId, destinationContent);
        }
        return acceptFixture(fileId, content);
      },
      drop: {
        sourceSelector: '[data-agent-native-node-id="moving"]',
        sourceNodeId: "moving",
        sourceProvenance: { uniqueNodeId: "moving" },
        sourceScreenId: "source",
        targetScreenId: "target",
        targetAnchorNodeId: "target-root",
        targetAnchorSelector: '[data-agent-native-node-id="target-root"]',
        targetAnchorProvenance: { uniqueNodeId: "target-root" },
        targetAnchorPlacement: "inside",
      },
    });

    expect(calls.map(({ fileId }) => fileId)).toEqual([
      "target",
      "source",
      "target",
    ]);
    expect(calls[2]?.content).toBe(destinationContent);
    expect(result.historyEntries).toEqual([]);
    expect(result.selectionEvents).toEqual([]);
  });

  it.each(["source", "target"] as const)(
    "compensates the other file when the %s save conflicts later",
    async (conflictingFile) => {
      const sourceContent = `<!doctype html><html><body><button data-agent-native-node-id="moving">Move</button></body></html>`;
      const destinationContent = `<!doctype html><html><body><main data-agent-native-node-id="target-root"></main></body></html>`;
      const canonicalSourceContent = acceptFixture(
        "source",
        sourceContent,
      ).content;
      const canonicalDestinationContent = acceptFixture(
        "target",
        destinationContent,
      ).content;
      const calls: Array<{ fileId: string; content: string }> = [];
      let resolveTarget!: (saved: FileContentSaveCompletion) => void;
      let resolveSource!: (saved: FileContentSaveCompletion) => void;
      const targetSave = new Promise<FileContentSaveCompletion>((resolve) => {
        resolveTarget = resolve;
      });
      const sourceSave = new Promise<FileContentSaveCompletion>((resolve) => {
        resolveSource = resolve;
      });
      let publicationCount = 0;
      const result = runStoredCrossScreenDrop({
        sourceContent,
        destinationContent,
        publish: (fileId, content) => {
          calls.push({ fileId, content });
          publicationCount += 1;
          const publication = acceptFixture(fileId, content);
          if (publicationCount === 1) {
            return { ...publication, saveCompletion: targetSave };
          }
          if (publicationCount === 2) {
            return { ...publication, saveCompletion: sourceSave };
          }
          return {
            ...publication,
            saveCompletion: Promise.resolve("persisted" as const),
          };
        },
        drop: {
          sourceSelector: '[data-agent-native-node-id="moving"]',
          sourceNodeId: "moving",
          sourceProvenance: { uniqueNodeId: "moving" },
          sourceScreenId: "source",
          targetScreenId: "target",
          targetAnchorNodeId: "target-root",
          targetAnchorSelector: '[data-agent-native-node-id="target-root"]',
          targetAnchorProvenance: { uniqueNodeId: "target-root" },
          targetAnchorPlacement: "inside",
        },
      });

      expect(result.historyEntries).toEqual([]);
      resolveTarget(conflictingFile === "target" ? "conflict" : "persisted");
      resolveSource(conflictingFile === "source" ? "conflict" : "persisted");
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(calls.map(({ fileId }) => fileId)).toEqual([
        "target",
        "source",
        conflictingFile === "source" ? "target" : "source",
      ]);
      expect(calls[2]?.content).toBe(
        conflictingFile === "source" ? destinationContent : sourceContent,
      );
      expect(result.historyEntries).toEqual([]);
      expect(result.selectionEvents).toEqual([]);
      expect(result.contentByFile.get("source")).toBe(
        conflictingFile === "target" ? canonicalSourceContent : sourceContent,
      );
      expect(result.contentByFile.get("target")).toBe(
        conflictingFile === "source"
          ? canonicalDestinationContent
          : destinationContent,
      );
    },
  );

  it("rolls back both optimistic files and history queues for a retryable save", async () => {
    const sourceContent = `<!doctype html><html><body><button data-agent-native-node-id="moving">Move</button></body></html>`;
    const destinationContent = `<!doctype html><html><body><main data-agent-native-node-id="target-root"></main></body></html>`;
    let resolveTarget!: (saved: FileContentSaveCompletion) => void;
    let resolveSource!: (saved: FileContentSaveCompletion) => void;
    const targetSave = new Promise<FileContentSaveCompletion>((resolve) => {
      resolveTarget = resolve;
    });
    const sourceSave = new Promise<FileContentSaveCompletion>((resolve) => {
      resolveSource = resolve;
    });
    let publicationCount = 0;
    const result = runStoredCrossScreenDrop({
      sourceContent,
      destinationContent,
      publish: (fileId, content) => {
        const publication = acceptFixture(fileId, content);
        publicationCount += 1;
        return {
          ...publication,
          saveCompletion:
            publicationCount === 1
              ? targetSave
              : publicationCount === 2
                ? sourceSave
                : Promise.resolve("persisted" as const),
        };
      },
      drop: {
        sourceSelector: '[data-agent-native-node-id="moving"]',
        sourceNodeId: "moving",
        sourceProvenance: { uniqueNodeId: "moving" },
        sourceScreenId: "source",
        targetScreenId: "target",
        targetAnchorNodeId: "target-root",
        targetAnchorSelector: '[data-agent-native-node-id="target-root"]',
        targetAnchorProvenance: { uniqueNodeId: "target-root" },
        targetAnchorPlacement: "inside",
      },
    });

    resolveTarget("persisted");
    resolveSource("retryable");
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(result.historyEntries).toEqual([]);
    expect(result.selectionEvents).toEqual([]);
    expect(publicationCount).toBe(3);
    expect(result.clearPendingHistoryCalls()).toBe(1);
    expect(result.cancelledFileIds).toEqual(["source"]);
    expect(result.contentByFile.get("source")).toBe(
      acceptFixture("source", sourceContent).content,
    );
    expect(result.contentByFile.get("target")).toBe(
      acceptFixture("target", destinationContent).content,
    );
  });

  it("does not locally restore a conflicting side in a mixed retryable result", async () => {
    const sourceContent = `<!doctype html><html><body><button data-agent-native-node-id="moving">Move</button></body></html>`;
    const destinationContent = `<!doctype html><html><body><main data-agent-native-node-id="target-root"></main></body></html>`;
    let resolveTarget!: (saved: FileContentSaveCompletion) => void;
    let resolveSource!: (saved: FileContentSaveCompletion) => void;
    const targetSave = new Promise<FileContentSaveCompletion>((resolve) => {
      resolveTarget = resolve;
    });
    const sourceSave = new Promise<FileContentSaveCompletion>((resolve) => {
      resolveSource = resolve;
    });
    let publicationCount = 0;
    const result = runStoredCrossScreenDrop({
      sourceContent,
      destinationContent,
      publish: (fileId, content) => {
        const publication = acceptFixture(fileId, content);
        publicationCount += 1;
        return {
          ...publication,
          saveCompletion: publicationCount === 1 ? targetSave : sourceSave,
        };
      },
      drop: {
        sourceSelector: '[data-agent-native-node-id="moving"]',
        sourceNodeId: "moving",
        sourceProvenance: { uniqueNodeId: "moving" },
        sourceScreenId: "source",
        targetScreenId: "target",
        targetAnchorNodeId: "target-root",
        targetAnchorSelector: '[data-agent-native-node-id="target-root"]',
        targetAnchorProvenance: { uniqueNodeId: "target-root" },
        targetAnchorPlacement: "inside",
      },
    });

    resolveTarget("conflict");
    resolveSource("retryable");
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(publicationCount).toBe(2);
    expect(result.cancelledFileIds).toEqual(["source"]);
    expect(result.historyEntries).toEqual([]);
    expect(result.selectionEvents).toEqual([]);
    expect(result.contentByFile.get("target")).toBe(destinationContent);
  });

  it("still restores the source when the target retryable rollback refuses", async () => {
    const sourceContent = `<!doctype html><html><body><button data-agent-native-node-id="moving">Move</button></body></html>`;
    const destinationContent = `<!doctype html><html><body><main data-agent-native-node-id="target-root"></main></body></html>`;
    let resolveTarget!: (saved: FileContentSaveCompletion) => void;
    let resolveSource!: (saved: FileContentSaveCompletion) => void;
    const targetSave = new Promise<FileContentSaveCompletion>((resolve) => {
      resolveTarget = resolve;
    });
    const sourceSave = new Promise<FileContentSaveCompletion>((resolve) => {
      resolveSource = resolve;
    });
    let publicationCount = 0;
    const result = runStoredCrossScreenDrop({
      sourceContent,
      destinationContent,
      refusePersistFalseFor: ["target"],
      publish: (fileId, content) => {
        const publication = acceptFixture(fileId, content);
        publicationCount += 1;
        return {
          ...publication,
          saveCompletion:
            publicationCount === 1
              ? targetSave
              : publicationCount === 2
                ? sourceSave
                : Promise.resolve("persisted" as const),
        };
      },
      drop: {
        sourceSelector: '[data-agent-native-node-id="moving"]',
        sourceNodeId: "moving",
        sourceProvenance: { uniqueNodeId: "moving" },
        sourceScreenId: "source",
        targetScreenId: "target",
        targetAnchorNodeId: "target-root",
        targetAnchorSelector: '[data-agent-native-node-id="target-root"]',
        targetAnchorProvenance: { uniqueNodeId: "target-root" },
        targetAnchorPlacement: "inside",
      },
    });

    resolveTarget("retryable");
    resolveSource("retryable");
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(publicationCount).toBe(2);
    expect(result.cancelledFileIds).toEqual(["target", "source"]);
    expect(result.contentByFile.get("source")).toBe(
      acceptFixture("source", sourceContent).content,
    );
    expect(result.historyEntries).toEqual([]);
    expect(result.selectionEvents).toEqual([]);
    expect(result.clearPendingHistoryCalls()).toBe(1);
    expect(toast.error).toHaveBeenCalledWith(
      "designEditor.toasts.saveConflict",
    );
  });

  it("toasts and clears pending history when both saves conflict", async () => {
    const sourceContent = `<!doctype html><html><body><button data-agent-native-node-id="moving">Move</button></body></html>`;
    const destinationContent = `<!doctype html><html><body><main data-agent-native-node-id="target-root"></main></body></html>`;
    let resolveTarget!: (saved: FileContentSaveCompletion) => void;
    let resolveSource!: (saved: FileContentSaveCompletion) => void;
    const targetSave = new Promise<FileContentSaveCompletion>((resolve) => {
      resolveTarget = resolve;
    });
    const sourceSave = new Promise<FileContentSaveCompletion>((resolve) => {
      resolveSource = resolve;
    });
    let publicationCount = 0;
    const result = runStoredCrossScreenDrop({
      sourceContent,
      destinationContent,
      publish: (fileId, content) => {
        const publication = acceptFixture(fileId, content);
        publicationCount += 1;
        return {
          ...publication,
          saveCompletion:
            publicationCount === 1
              ? targetSave
              : publicationCount === 2
                ? sourceSave
                : Promise.resolve("persisted" as const),
        };
      },
      drop: {
        sourceSelector: '[data-agent-native-node-id="moving"]',
        sourceNodeId: "moving",
        sourceProvenance: { uniqueNodeId: "moving" },
        sourceScreenId: "source",
        targetScreenId: "target",
        targetAnchorNodeId: "target-root",
        targetAnchorSelector: '[data-agent-native-node-id="target-root"]',
        targetAnchorProvenance: { uniqueNodeId: "target-root" },
        targetAnchorPlacement: "inside",
      },
    });

    resolveTarget("conflict");
    resolveSource("conflict");
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(publicationCount).toBe(2);
    expect(result.historyEntries).toEqual([]);
    expect(result.selectionEvents).toEqual([]);
    expect(result.clearPendingHistoryCalls()).toBe(1);
    expect(toast.error).toHaveBeenCalledWith(
      "designEditor.toasts.saveConflict",
    );
  });

  it("keeps history blocked until a failed source rollback persists", async () => {
    const sourceContent = `<!doctype html><html><body><button data-agent-native-node-id="moving">Move</button></body></html>`;
    const destinationContent = `<!doctype html><html><body><main data-agent-native-node-id="target-root"></main></body></html>`;
    let resolveRollback!: (saved: FileContentSaveCompletion) => void;
    const rollbackSave = new Promise<FileContentSaveCompletion>((resolve) => {
      resolveRollback = resolve;
    });
    let publicationCount = 0;
    const result = runStoredCrossScreenDrop({
      sourceContent,
      destinationContent,
      publish: (fileId, content) => {
        publicationCount += 1;
        if (fileId === "source") return { status: "refused" as const };
        const publication = acceptFixture(fileId, content);
        return {
          ...publication,
          saveCompletion:
            publicationCount === 1
              ? Promise.resolve("persisted" as const)
              : rollbackSave,
        };
      },
      drop: {
        sourceSelector: '[data-agent-native-node-id="moving"]',
        sourceNodeId: "moving",
        sourceProvenance: { uniqueNodeId: "moving" },
        sourceScreenId: "source",
        targetScreenId: "target",
        targetAnchorNodeId: "target-root",
        targetAnchorSelector: '[data-agent-native-node-id="target-root"]',
        targetAnchorProvenance: { uniqueNodeId: "target-root" },
        targetAnchorPlacement: "inside",
      },
    });

    expect(publicationCount).toBe(3);
    expect(result.fileHistoryMutationPendingRef.current).toBe(true);
    resolveRollback("persisted");
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(result.fileHistoryMutationPendingRef.current).toBe(false);
  });

  it("does not finalize stale history or selection after a later edit", async () => {
    const sourceContent = `<!doctype html><html><body><button data-agent-native-node-id="moving">Move</button></body></html>`;
    const destinationContent = `<!doctype html><html><body><main data-agent-native-node-id="target-root"></main></body></html>`;
    let resolveTarget!: (saved: FileContentSaveCompletion) => void;
    let resolveSource!: (saved: FileContentSaveCompletion) => void;
    const targetSave = new Promise<FileContentSaveCompletion>((resolve) => {
      resolveTarget = resolve;
    });
    const sourceSave = new Promise<FileContentSaveCompletion>((resolve) => {
      resolveSource = resolve;
    });
    let publicationCount = 0;
    const laterSourceContent =
      '<!doctype html><html><body><p data-agent-native-node-id="later">Later</p></body></html>';
    const result = runStoredCrossScreenDrop({
      sourceContent,
      destinationContent,
      publish: (fileId, content) => {
        const publication = acceptFixture(fileId, content);
        publicationCount += 1;
        if (publicationCount === 1) {
          return { ...publication, saveCompletion: targetSave };
        }
        if (publicationCount === 2) {
          return { ...publication, saveCompletion: sourceSave };
        }
        return {
          ...publication,
          saveCompletion: Promise.resolve("persisted" as const),
        };
      },
      afterDrop: ({ applyFileContentUpdate, setSelectionFingerprint }) => {
        applyFileContentUpdate("source", laterSourceContent);
        setSelectionFingerprint("after-drop-selection");
      },
      drop: {
        sourceSelector: '[data-agent-native-node-id="moving"]',
        sourceNodeId: "moving",
        sourceProvenance: { uniqueNodeId: "moving" },
        sourceScreenId: "source",
        targetScreenId: "target",
        targetAnchorNodeId: "target-root",
        targetAnchorSelector: '[data-agent-native-node-id="target-root"]',
        targetAnchorProvenance: { uniqueNodeId: "target-root" },
        targetAnchorPlacement: "inside",
      },
    });

    resolveTarget("persisted");
    resolveSource("persisted");
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(result.historyEntries).toEqual([]);
    expect(result.selectionEvents).toEqual([]);
    expect(result.contentByFile.get("source")).toContain(
      'data-agent-native-node-id="later"',
    );
  });

  it("records history after persisted saves despite a stale query repaint", async () => {
    const sourceContent = `<!doctype html><html><body><button data-agent-native-node-id="moving">Move</button></body></html>`;
    const destinationContent = `<!doctype html><html><body><main data-agent-native-node-id="target-root"></main></body></html>`;
    let resolveTarget!: (saved: FileContentSaveCompletion) => void;
    let resolveSource!: (saved: FileContentSaveCompletion) => void;
    const targetSave = new Promise<FileContentSaveCompletion>((resolve) => {
      resolveTarget = resolve;
    });
    const sourceSave = new Promise<FileContentSaveCompletion>((resolve) => {
      resolveSource = resolve;
    });
    let publicationCount = 0;
    const result = runStoredCrossScreenDrop({
      sourceContent,
      destinationContent,
      publish: (fileId, content) => {
        const publication = acceptFixture(fileId, content);
        publicationCount += 1;
        return {
          ...publication,
          saveCompletion:
            publicationCount === 1
              ? targetSave
              : publicationCount === 2
                ? sourceSave
                : Promise.resolve("persisted" as const),
        };
      },
      afterDrop: ({ contentByFile }) => {
        // Model a refetch that lands after the optimistic overlay retires but
        // before the cross-file history publication callback runs.
        contentByFile.set("target", destinationContent);
      },
      drop: {
        sourceSelector: '[data-agent-native-node-id="moving"]',
        sourceNodeId: "moving",
        sourceProvenance: { uniqueNodeId: "moving" },
        sourceScreenId: "source",
        targetScreenId: "target",
        targetAnchorNodeId: "target-root",
        targetAnchorSelector: '[data-agent-native-node-id="target-root"]',
        targetAnchorProvenance: { uniqueNodeId: "target-root" },
        targetAnchorPlacement: "inside",
      },
    });

    expect(result.fileHistoryMutationPendingRef.current).toBe(true);
    resolveTarget("persisted");
    resolveSource("persisted");
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(result.fileHistoryMutationPendingRef.current).toBe(false);
    expect(result.historyEntries).toHaveLength(1);
    expect(result.selectionEvents).toContain("active-file");
  });

  it("does not finalize history after an authoritative peer update", async () => {
    const sourceContent = `<!doctype html><html><body><button data-agent-native-node-id="moving">Move</button></body></html>`;
    const destinationContent = `<!doctype html><html><body><main data-agent-native-node-id="target-root"></main></body></html>`;
    let resolveTarget!: (saved: FileContentSaveCompletion) => void;
    let resolveSource!: (saved: FileContentSaveCompletion) => void;
    const targetSave = new Promise<FileContentSaveCompletion>((resolve) => {
      resolveTarget = resolve;
    });
    const sourceSave = new Promise<FileContentSaveCompletion>((resolve) => {
      resolveSource = resolve;
    });
    let publicationCount = 0;
    const remoteTargetContent =
      '<!doctype html><html><body><main data-agent-native-node-id="remote">Remote</main></body></html>';
    const result = runStoredCrossScreenDrop({
      sourceContent,
      destinationContent,
      publish: (fileId, content) => {
        const publication = acceptFixture(fileId, content);
        publicationCount += 1;
        return {
          ...publication,
          saveCompletion:
            publicationCount === 1
              ? targetSave
              : publicationCount === 2
                ? sourceSave
                : Promise.resolve("persisted" as const),
        };
      },
      afterDrop: ({ contentByFile, setServerSnapshot }) => {
        setServerSnapshot("target", {
          content: remoteTargetContent,
          updatedAt: "peer-update",
        });
      },
      drop: {
        sourceSelector: '[data-agent-native-node-id="moving"]',
        sourceNodeId: "moving",
        sourceProvenance: { uniqueNodeId: "moving" },
        sourceScreenId: "source",
        targetScreenId: "target",
        targetAnchorNodeId: "target-root",
        targetAnchorSelector: '[data-agent-native-node-id="target-root"]',
        targetAnchorProvenance: { uniqueNodeId: "target-root" },
        targetAnchorPlacement: "inside",
      },
    });

    resolveTarget("persisted");
    resolveSource("persisted");
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(result.historyEntries).toEqual([]);
    expect(result.selectionEvents).toEqual([]);
  });

  it("records no duplicate history or selection when the real writer rejects Alpine content", () => {
    const sourceInput = `<!doctype html><html><head>
      <script defer src="https://cdn.jsdelivr.net/npm/alpinejs@3.14.0/dist/cdn.min.js"></script>
    </head><body><div data-agent-native-node-id="alpine-owner" x-data="{ open: true }"><span data-agent-native-node-id="alpine-child" x-text="open"></span></div></body></html>`;
    const destinationInput = `<!doctype html><html><head></head><body><main data-agent-native-node-id="target-root"></main></body></html>`;
    const sourceContent = prepareCanonicalSourceContent(sourceInput, {
      fileId: "source",
      fileType: "html",
    }).content;
    const destinationContent = prepareCanonicalSourceContent(destinationInput, {
      fileId: "target",
      fileType: "html",
    }).content;
    const writer = createRealWriterHarness(sourceContent, destinationContent);
    const result = runStoredCrossScreenDrop({
      sourceContent,
      destinationContent,
      publish: writer.publish,
      drop: {
        sourceSelector: '[data-agent-native-node-id="alpine-owner"]',
        sourceNodeId: "alpine-owner",
        sourceScreenId: "source",
        targetScreenId: "target",
        targetAnchorNodeId: "target-root",
        targetAnchorSelector: '[data-agent-native-node-id="target-root"]',
        targetAnchorProvenance: { uniqueNodeId: "target-root" },
        targetAnchorPlacement: "inside",
        duplicate: true,
        sourceCloneHtml:
          '<div data-agent-native-node-id="alpine-owner" x-data="{ open: true }"><span data-agent-native-node-id="alpine-child" x-text="open"></span></div>',
      },
    });

    expect(writer.calls).toEqual([
      {
        fileId: "target",
        status: "refused",
        historyBeforeContent: destinationContent,
      },
    ]);
    expect(writer.history).toEqual([]);
    expect(writer.queuedSaves).toEqual([]);
    expect(writer.queryWrites).toBe(0);
    expect(result.writes.size).toBe(0);
    expect(result.historyEntries).toEqual([]);
    expect(result.selectionEvents).toEqual([]);
    expect(result.selectedLayerIds).toEqual([]);
    expect(result.selectedElement).toBeNull();
    expect(result.activeFileId).toBeNull();
    expect(writer.contentByFile.get("source")).toBe(sourceContent);
    expect(writer.contentByFile.get("target")).toBe(destinationContent);
  });

  it("records no history or selection when a stale canvas drag reaches a denied writer", () => {
    const sourceContent = `<!doctype html><html><body><button data-agent-native-node-id="moving">Move</button></body></html>`;
    const destinationContent = `<!doctype html><html><body><main data-agent-native-node-id="target-root"></main></body></html>`;
    const writer = createRealWriterHarness(
      sourceContent,
      destinationContent,
      false,
    );
    const result = runStoredCrossScreenDrop({
      sourceContent,
      destinationContent,
      publish: writer.publish,
      drop: {
        sourceSelector: '[data-agent-native-node-id="moving"]',
        sourceNodeId: "moving",
        sourceProvenance: { uniqueNodeId: "moving" },
        sourceScreenId: "source",
        targetScreenId: "target",
        targetAnchorNodeId: "target-root",
        targetAnchorSelector: '[data-agent-native-node-id="target-root"]',
        targetAnchorProvenance: { uniqueNodeId: "target-root" },
        targetAnchorPlacement: "inside",
      },
    });

    expect(writer.calls).toEqual([
      {
        fileId: "target",
        status: "refused",
        historyBeforeContent: destinationContent,
      },
    ]);
    expect(writer.history).toEqual([]);
    expect(writer.queuedSaves).toEqual([]);
    expect(writer.queryWrites).toBe(0);
    expect(result.writes.size).toBe(0);
    expect(result.historyEntries).toEqual([]);
    expect(result.selectionEvents).toEqual([]);
    expect(result.selectedLayerIds).toEqual([]);
    expect(result.selectedElement).toBeNull();
    expect(result.activeFileId).toBeNull();
    expect(writer.contentByFile.get("source")).toBe(sourceContent);
    expect(writer.contentByFile.get("target")).toBe(destinationContent);
  });
});

describe("runCrossScreenElementDrop source provenance", () => {
  it("refuses a static move with no source provenance", () => {
    const source = `<html><body><button class="movable">moving</button></body></html>`;
    const sourceNode = buildCodeLayerProjection(source).nodes.find(
      (node) => node.tag === "button",
    )!;
    const { writes, historyEntries } = runStoredCrossScreenDrop({
      sourceContent: source,
      destinationContent: `<html><body><main></main></body></html>`,
      drop: {
        sourceSelector: sourceNode.path,
        sourceScreenId: "source",
        targetScreenId: "target",
      },
    });

    expect(writes.size).toBe(0);
    expect(historyEntries).toHaveLength(0);
  });

  it("uses a proven unique ID even when the supplied selector points elsewhere", () => {
    const source = `<html><body>
      <button id="wrong">keep this node</button>
      <button data-agent-native-node-id="moving">move this node</button>
    </body></html>`;
    const wrongNode = buildCodeLayerProjection(source).nodes.find(
      (node) => node.attributes.id === "wrong",
    )!;
    const { writes, historyEntries } = runStoredCrossScreenDrop({
      sourceContent: source,
      destinationContent: `<html><body><main></main></body></html>`,
      drop: {
        sourceSelector: wrongNode.path,
        sourceNodeId: "moving",
        sourceScreenId: "source",
        targetScreenId: "target",
        sourceProvenance: {
          versionHash: createSourceDocumentProvenance(source).versionHash,
          uniqueNodeId: "moving",
        },
      },
    });

    expect(writes.get("source")).toContain("keep this node");
    expect(writes.get("source")).not.toContain("move this node");
    expect(writes.get("target")).toContain("move this node");
    expect(historyEntries).toHaveLength(1);
  });

  it("refuses an old ambiguous alias after its sibling was removed", () => {
    const renderedSource = `<html><body>
      <button data-agent-native-node-id="shared-alias">selected</button>
      <aside data-loc="shared-alias">historical alias collision</aside>
    </body></html>`;
    const currentSource = `<html><body>
      <button data-agent-native-node-id="shared-alias">selected</button>
    </body></html>`;
    const staleSource = buildCodeLayerProjection(renderedSource).nodes.find(
      (node) => node.tag === "button",
    )!;
    expect(
      createSourceDocumentProvenance(renderedSource).uniqueNodeIds,
    ).not.toContain("shared-alias");

    const { writes, historyEntries } = runStoredCrossScreenDrop({
      sourceContent: currentSource,
      destinationContent: `<html><body><main></main></body></html>`,
      drop: {
        sourceSelector: staleSource.path,
        sourceNodeId: "shared-alias",
        sourceScreenId: "source",
        targetScreenId: "target",
        sourceProvenance: {
          versionHash:
            createSourceDocumentProvenance(renderedSource).versionHash,
        },
      },
    });

    expect(writes.size).toBe(0);
    expect(historyEntries).toHaveLength(0);
  });

  it("refuses an idless move source when fresh HTML invalidates its bridge path", () => {
    const renderedSource = `<html><body><main>
      <button class="same">first</button>
      <button class="same">selected</button>
    </main></body></html>`;
    const currentSource = `<html><body><main>
      <button class="same">first</button>
      <button class="same">inserted-during-drag</button>
      <button class="same">selected</button>
    </main></body></html>`;
    const destination = `<html><body><div>destination</div></body></html>`;
    const staleSource = buildCodeLayerProjection(renderedSource).nodes.find(
      (node) => node.tag === "button" && node.textSnippet === "selected",
    )!;
    const { writes, historyEntries } = runStoredCrossScreenDrop({
      sourceContent: currentSource,
      destinationContent: destination,
      drop: {
        sourceSelector: staleSource.path,
        sourceScreenId: "source",
        targetScreenId: "target",
        sourceProvenance: {
          versionHash:
            createSourceDocumentProvenance(renderedSource).versionHash,
        },
      },
    });

    expect(writes.size).toBe(0);
    expect(historyEntries).toHaveLength(0);
  });

  it("refuses a stale idless duplicate anchor before selector fallback", () => {
    const renderedDestination = `<html><body><main>
      <button class="same">first</button>
      <button class="same">selected-anchor</button>
    </main></body></html>`;
    const currentDestination = `<html><body><main>
      <button class="same">first</button>
      <button class="same">inserted-before-anchor</button>
      <button class="same">selected-anchor</button>
    </main></body></html>`;
    const source = `<html><body><div>source</div></body></html>`;
    const staleAnchor = buildCodeLayerProjection(
      renderedDestination,
    ).nodes.find(
      (node) => node.tag === "button" && node.textSnippet === "selected-anchor",
    )!;
    const { writes, historyEntries } = runStoredCrossScreenDrop({
      sourceContent: source,
      destinationContent: currentDestination,
      drop: {
        sourceSelector: "",
        sourceScreenId: "source",
        targetScreenId: "target",
        targetAnchorPendingNodeId: "pending-anchor",
        targetAnchorSelector: staleAnchor.path,
        targetAnchorPlacement: "inside",
        duplicate: true,
        sourceCloneHtml:
          '<section data-agent-native-node-id="copy">copy</section>',
        targetAnchorProvenance: {
          versionHash:
            createSourceDocumentProvenance(renderedDestination).versionHash,
        },
      },
    });

    expect(writes.size).toBe(0);
    expect(historyEntries).toHaveLength(0);
  });

  it("allows idless source and anchor selectors for the exact rendered versions", () => {
    const source = `<html><body><main>
      <button class="source">moving</button>
    </main></body></html>`;
    const destination = `<html><body><main>
      <section class="anchor">anchor</section>
    </main></body></html>`;
    const sourceNode = buildCodeLayerProjection(source).nodes.find(
      (node) => node.tag === "button",
    )!;
    const anchorNode = buildCodeLayerProjection(destination).nodes.find(
      (node) => node.tag === "section",
    )!;
    const { writes, historyEntries } = runStoredCrossScreenDrop({
      sourceContent: source,
      destinationContent: destination,
      drop: {
        sourceSelector: sourceNode.path,
        sourceScreenId: "source",
        targetScreenId: "target",
        targetAnchorSelector: anchorNode.path,
        targetAnchorPendingNodeId: "pending-anchor",
        targetAnchorPlacement: "inside",
        sourceProvenance: {
          versionHash: createSourceDocumentProvenance(source).versionHash,
        },
        targetAnchorProvenance: {
          versionHash: createSourceDocumentProvenance(destination).versionHash,
        },
      },
    });

    expect(writes.get("source")).not.toContain("moving");
    const nextDestination = writes.get("target")!;
    expect(nextDestination).toContain("moving");
    const parsed = new DOMParser().parseFromString(
      nextDestination,
      "text/html",
    );
    expect(parsed.querySelector("section > button")?.textContent).toBe(
      "moving",
    );
    expect(historyEntries).toHaveLength(1);
  });

  it("uses unique raw IDs across unrelated edits when version hashes are absent", () => {
    const renderedSource = `<html><body><main>
      <button data-agent-native-node-id="moving">selected</button>
    </main></body></html>`;
    const currentSource = `<html><body><main>
      <button>unrelated insert</button>
      <button data-agent-native-node-id="moving">selected</button>
    </main></body></html>`;
    const renderedDestination = `<html><body><main>
      <section data-agent-native-node-id="anchor">anchor</section>
    </main></body></html>`;
    const currentDestination = `<html><body><main>
      <section>unrelated insert</section>
      <section data-agent-native-node-id="anchor">anchor</section>
    </main></body></html>`;
    const staleSource = buildCodeLayerProjection(renderedSource).nodes.find(
      (node) => node.dataAttributes["data-agent-native-node-id"] === "moving",
    )!;
    const staleAnchor = buildCodeLayerProjection(
      renderedDestination,
    ).nodes.find(
      (node) => node.dataAttributes["data-agent-native-node-id"] === "anchor",
    )!;
    const { writes, historyEntries } = runStoredCrossScreenDrop({
      sourceContent: currentSource,
      destinationContent: currentDestination,
      drop: {
        sourceSelector: staleSource.path,
        sourceNodeId: "moving",
        sourceScreenId: "source",
        targetScreenId: "target",
        targetAnchorNodeId: "anchor",
        targetAnchorSelector: staleAnchor.path,
        targetAnchorPlacement: "inside",
        sourceProvenance: { uniqueNodeId: "moving" },
        targetAnchorProvenance: { uniqueNodeId: "anchor" },
      },
    });

    expect(writes.get("source")).not.toContain(">selected</button>");
    const nextDestination = writes.get("target")!;
    expect(nextDestination).toContain("selected");
    const parsed = new DOMParser().parseFromString(
      nextDestination,
      "text/html",
    );
    expect(
      parsed
        .querySelector('[data-agent-native-node-id="anchor"]')
        ?.querySelector("button")?.textContent,
    ).toBe("selected");
    expect(historyEntries).toHaveLength(1);
  });
});

describe("runCrossScreenElementDrop runtime-only routing", () => {
  it("routes a public live-to-empty-board move through one runtime transaction", () => {
    const sourceMarkup =
      '<div data-agent-native-node-id="runtime-source">Source</div>';
    const sourceNode = buildCodeLayerProjection(sourceMarkup).nodes[0]!;
    const sourceTree = buildCodeLayerTree(
      buildCodeLayerProjection(sourceMarkup),
    );
    let insertRequest: unknown = null;
    let deleteRequest: unknown = null;

    runCrossScreenElementDrop(
      {
        applyFileContentUpdate: () => {
          throw new Error("public live-to-board moves must not write content");
        },
        boardFileId: "board",
        canEditDesign: false,
        canEditLiveBoard: true,
        canEditLiveScreen: () => true,
        clearPendingOverviewLayerSelectionTimer: () => {},
        codeLayerOwnerByNodeIdRef: {
          current: new Map([
            [
              sourceNode.id,
              {
                fileId: "source",
                node: sourceNode,
                tree: sourceTree,
                runtimeOnly: true,
              },
            ],
          ]),
        },
        designSourceType: "localhost",
        getScreenContent: (screenId) =>
          screenId === "board"
            ? "<!doctype html><html><body></body></html>"
            : "http://localhost:5173/",
        id: undefined,
        overviewScreens: [
          {
            id: "source",
            filename: "source.html",
            content: "http://localhost:5173/",
            sourceType: "localhost",
            updatedAt: "2026-09-22T00:00:00.000Z",
            heightPinned: false,
          },
        ],
        pendingOverviewLayerSelectionRef: { current: null },
        pendingOverviewScreenSelectionRef: { current: null },
        recordContentHistoryEntry: vi.fn(),
        runtimeStructureInsertRevisionRef: { current: 0 },
        sendRuntimeLayerMoveSemanticHandoff: vi.fn(),
        setActiveFileId: vi.fn(),
        setCreatedOverviewLayerSelection: vi.fn(),
        setOverviewSelectedScreenIds: vi.fn(),
        setRuntimeStructureDeleteRequest: (value) => {
          deleteRequest = typeof value === "function" ? value(null) : value;
        },
        setRuntimeStructureInsertRequest: (value) => {
          insertRequest = typeof value === "function" ? value(null) : value;
        },
        setSelectedElement: vi.fn(),
        setSelectedLayerIdsState: vi.fn(),
        t: (key) => key,
        viewModeRef: { current: "overview" },
      },
      {
        sourceSelector: '[data-agent-native-node-id="runtime-source"]',
        sourceNodeId: "runtime-source",
        sourceScreenId: "source",
        targetScreenId: "board",
        targetLocalPoint: { x: 120, y: 180 },
        targetDropMode: "absolute-container",
        sourcePointerOffset: { x: 8, y: 10 },
        sourceCloneHtml: sourceMarkup,
      },
    );

    expect(insertRequest).toMatchObject({
      screenId: "board",
      sourceScreenId: "source",
      remintCollidingNodeIds: true,
      anchor: { selector: "" },
    });
    expect((insertRequest as { html: string }).html).toContain(">Source</div>");
    expect(deleteRequest).toMatchObject({
      screenId: "source",
      selector: '[data-agent-native-node-id="runtime-source"]',
      waitForInsertTransaction: true,
    });
    expect((insertRequest as { transactionId?: string }).transactionId).toBe(
      (deleteRequest as { transactionId?: string }).transactionId,
    );
  });

  it("refuses a second live transaction while the first is awaiting acknowledgement", () => {
    const sourceMarkup =
      '<div data-agent-native-node-id="runtime-source">Source</div>';
    const sourceNode = buildCodeLayerProjection(sourceMarkup).nodes[0]!;
    const sourceTree = buildCodeLayerTree(
      buildCodeLayerProjection(sourceMarkup),
    );
    const pendingTransactionRef = { current: "already-pending" };
    const setInsertRequest = vi.fn();
    const setDeleteRequest = vi.fn();
    const sharedArgs = {
      applyFileContentUpdate: () => {
        throw new Error("public live-to-board moves must not write content");
      },
      boardFileId: "board",
      canEditDesign: false,
      canEditLiveBoard: true,
      canEditLiveScreen: () => true,
      clearPendingOverviewLayerSelectionTimer: () => {},
      codeLayerOwnerByNodeIdRef: {
        current: new Map([
          [
            sourceNode.id,
            {
              fileId: "source",
              node: sourceNode,
              tree: sourceTree,
              runtimeOnly: true,
            },
          ],
        ]),
      },
      designSourceType: "localhost" as const,
      getScreenContent: (screenId: string) =>
        screenId === "board"
          ? "<!doctype html><html><body></body></html>"
          : "http://localhost:5173/",
      id: undefined,
      overviewScreens: [
        {
          id: "source",
          filename: "source.html",
          content: "http://localhost:5173/",
          sourceType: "localhost" as const,
          updatedAt: "2026-09-22T00:00:00.000Z",
          heightPinned: false,
        },
      ],
      pendingOverviewLayerSelectionRef: { current: null },
      pendingOverviewScreenSelectionRef: { current: null },
      recordContentHistoryEntry: vi.fn(),
      runtimeStructureInsertRevisionRef: { current: 0 },
      runtimeStructurePendingTransactionRef: pendingTransactionRef,
      sendRuntimeLayerMoveSemanticHandoff: vi.fn(),
      setActiveFileId: vi.fn(),
      setCreatedOverviewLayerSelection: vi.fn(),
      setOverviewSelectedScreenIds: vi.fn(),
      setRuntimeStructureDeleteRequest: setDeleteRequest,
      setRuntimeStructureInsertRequest: setInsertRequest,
      setSelectedElement: vi.fn(),
      setSelectedLayerIdsState: vi.fn(),
      t: (key: string) => key,
      viewModeRef: { current: "overview" as const },
    } satisfies Parameters<typeof runCrossScreenElementDrop>[0];

    runCrossScreenElementDrop(sharedArgs, {
      sourceSelector: '[data-agent-native-node-id="runtime-source"]',
      sourceNodeId: "runtime-source",
      sourceScreenId: "source",
      targetScreenId: "board",
      targetLocalPoint: { x: 120, y: 180 },
      targetDropMode: "absolute-container",
      sourcePointerOffset: { x: 8, y: 10 },
      sourceCloneHtml: sourceMarkup,
    });

    expect(setInsertRequest).not.toHaveBeenCalled();
    expect(setDeleteRequest).not.toHaveBeenCalled();
    expect(pendingTransactionRef.current).toBe("already-pending");
    expect(toast.error).toHaveBeenCalledWith(
      "designEditor.toasts.layerMoveFailed",
      { duration: 4000 },
    );
  });

  it("uses the live source outerHTML for an atomic live-to-live move", () => {
    const sourceMarkup =
      '<div data-agent-native-node-id="runtime-source">Source</div>';
    const sourceNode = buildCodeLayerProjection(sourceMarkup).nodes[0]!;
    const sourceTree = buildCodeLayerTree(
      buildCodeLayerProjection(sourceMarkup),
    );
    let insertRequest: unknown = null;
    let deleteRequest: unknown = null;

    runCrossScreenElementDrop(
      {
        applyFileContentUpdate: () => {
          throw new Error("live-to-live moves must not write stored content");
        },
        boardFileId: undefined,
        canEditDesign: true,
        canEditLiveScreen: () => true,
        clearPendingOverviewLayerSelectionTimer: () => {},
        codeLayerOwnerByNodeIdRef: {
          current: new Map([
            [
              sourceNode.id,
              {
                fileId: "source",
                node: sourceNode,
                tree: sourceTree,
                runtimeOnly: true,
              },
            ],
          ]),
        },
        designSourceType: "localhost",
        getScreenContent: () => "http://localhost:5173/",
        id: undefined,
        overviewScreens: [
          {
            id: "source",
            filename: "source.html",
            content: "http://localhost:5173/",
            updatedAt: "2026-09-11T00:00:00.000Z",
            heightPinned: false,
            sourceType: "localhost",
          },
          {
            id: "target",
            filename: "target.html",
            content: "http://localhost:5173/?screen=target",
            updatedAt: "2026-09-11T00:00:00.000Z",
            heightPinned: false,
            sourceType: "localhost",
          },
        ],
        pendingOverviewLayerSelectionRef: { current: null },
        pendingOverviewScreenSelectionRef: { current: null },
        recordContentHistoryEntry: vi.fn(),
        runtimeStructureInsertRevisionRef: { current: 0 },
        sendRuntimeLayerMoveSemanticHandoff: vi.fn(),
        setActiveFileId: vi.fn(),
        setCreatedOverviewLayerSelection: vi.fn(),
        setOverviewSelectedScreenIds: vi.fn(),
        setRuntimeStructureDeleteRequest: (value) => {
          deleteRequest = typeof value === "function" ? value(null) : value;
        },
        setRuntimeStructureInsertRequest: (value) => {
          insertRequest = typeof value === "function" ? value(null) : value;
        },
        setSelectedElement: vi.fn(),
        setSelectedLayerIdsState: vi.fn(),
        t: (key) => key,
        viewModeRef: { current: "overview" },
      },
      {
        sourceSelector: '[data-agent-native-node-id="runtime-source"]',
        sourceNodeId: "runtime-source",
        sourceScreenId: "source",
        targetScreenId: "target",
        targetAnchorSelector: "body",
        targetAnchorPlacement: "inside",
        sourceCloneHtml: sourceMarkup,
      },
    );

    expect(insertRequest).toMatchObject({
      screenId: "target",
      remintCollidingNodeIds: true,
      anchor: { selector: "body" },
    });
    expect((insertRequest as { html: string }).html).toContain(">Source</div>");
    expect(deleteRequest).toMatchObject({
      screenId: "source",
      selector: '[data-agent-native-node-id="runtime-source"]',
      waitForInsertTransaction: true,
    });
  });

  it("inserts a runtime-projected board node back into a live destination", () => {
    const boardMarkup =
      '<button data-agent-native-node-id="canvas-runtime">From canvas</button>';
    const boardProjection = buildCodeLayerProjection(boardMarkup);
    const boardNode = boardProjection.nodes[0]!;
    const boardTree = buildCodeLayerTree(boardProjection);
    let insertRequest: unknown = null;
    const semanticHandoff = vi.fn();

    runCrossScreenElementDrop(
      {
        applyFileContentUpdate: () => {
          throw new Error("board-to-live drops must not write stored content");
        },
        boardFileId: "board",
        canEditDesign: false,
        canEditLiveBoard: true,
        canEditLiveScreen: () => true,
        clearPendingOverviewLayerSelectionTimer: () => {},
        codeLayerOwnerByNodeIdRef: {
          current: new Map([
            [
              boardNode.id,
              {
                fileId: "board",
                node: boardNode,
                tree: boardTree,
                runtimeOnly: true,
              },
            ],
          ]),
        },
        designSourceType: "localhost",
        // The live-to-board leg is transient, so the stored board document
        // does not contain the node even though sourceHtmlSnapshot does.
        getScreenContent: (screenId) =>
          screenId === "board" ? "" : "http://localhost:3102/library",
        id: undefined,
        overviewScreens: [
          {
            id: "live",
            filename: "library.html",
            content: "http://localhost:3102/library",
            sourceType: "localhost",
            updatedAt: "2026-09-22T00:00:00.000Z",
            heightPinned: false,
          },
        ],
        pendingOverviewLayerSelectionRef: { current: null },
        pendingOverviewScreenSelectionRef: { current: null },
        recordContentHistoryEntry: vi.fn(),
        runtimeStructureInsertRevisionRef: { current: 0 },
        runtimeStructurePendingTransactionRef: { current: null },
        sendRuntimeLayerMoveSemanticHandoff: semanticHandoff,
        setActiveFileId: vi.fn(),
        setCreatedOverviewLayerSelection: vi.fn(),
        setOverviewSelectedScreenIds: vi.fn(),
        setRuntimeStructureInsertRequest: (value) => {
          insertRequest = typeof value === "function" ? value(null) : value;
        },
        setSelectedElement: vi.fn(),
        setSelectedLayerIdsState: vi.fn(),
        t: (key) => key,
        viewModeRef: { current: "overview" },
      },
      {
        sourceSelector: '[data-agent-native-node-id="canvas-runtime"]',
        sourceNodeId: "canvas-runtime",
        sourceScreenId: "board",
        targetScreenId: "live",
        targetAnchorSelector: "body",
        targetAnchorPlacement: "inside",
        targetDropMode: "flow-insert",
        sourceHtmlSnapshot: boardMarkup,
      },
    );

    expect(semanticHandoff).not.toHaveBeenCalled();
    expect(insertRequest).toMatchObject({
      screenId: "live",
      sourceScreenId: "board",
      remintCollidingNodeIds: true,
      anchor: { selector: "body" },
    });
    expect((insertRequest as { html: string }).html).toContain(
      'data-agent-native-node-id="canvas-runtime"',
    );
  });

  it("routes a runtime-only id absent from source HTML through the runtime handoff", () => {
    const sourceContent =
      '<html><body><div id="subject">Subject</div></body></html>';
    const runtimeContent =
      '<html><body><div id="subject" data-agent-native-node-id="runtime-1m2vou">Subject</div></body></html>';
    const targetContent =
      '<html><body><div data-agent-native-node-id="an-anchor">Anchor</div></body></html>';
    const runtimeProjection = buildCodeLayerProjection(runtimeContent);
    const runtimeTree = buildCodeLayerTree(runtimeProjection);
    const sourceNodeIdAttrs = codeLayerSourceNodeIdAttrs(sourceContent);
    const sourceNode = runtimeProjection.nodes.find(
      (node) =>
        node.dataAttributes["data-agent-native-node-id"] === "runtime-1m2vou",
    )!;
    const targetProjection = buildCodeLayerProjection(targetContent);
    const targetTree = buildCodeLayerTree(targetProjection);
    const targetNode = targetProjection.nodes.find(
      (node) =>
        node.dataAttributes["data-agent-native-node-id"] === "an-anchor",
    )!;
    const owners = new Map([
      [
        sourceNode.id,
        {
          fileId: "source",
          node: sourceNode,
          tree: runtimeTree,
          runtimeOnly: isCodeLayerNodeRuntimeOnly({
            fileIsRuntimeProjected: false,
            nodeIdAttr: "runtime-1m2vou",
            sourceNodeIdAttrs,
          }),
        },
      ],
      [
        targetNode.id,
        {
          fileId: "target",
          node: targetNode,
          tree: targetTree,
          runtimeOnly: false,
        },
      ],
    ]);
    const applyFileContentUpdate = vi.fn();
    const sendRuntimeLayerMoveSemanticHandoff = vi.fn(() => true);

    runCrossScreenElementDrop(
      {
        applyFileContentUpdate,
        boardFileId: undefined,
        canEditDesign: true,
        clearPendingOverviewLayerSelectionTimer: () => {},
        codeLayerOwnerByNodeIdRef: { current: owners },
        designSourceType: "inline",
        getScreenContent: (screenId) =>
          screenId === "source" ? sourceContent : targetContent,
        id: undefined,
        overviewScreens: [
          {
            id: "target",
            filename: "target.html",
            content: targetContent,
            updatedAt: "2026-09-11T00:00:00.000Z",
            heightPinned: false,
            sourceType: "inline",
          },
        ],
        pendingOverviewLayerSelectionRef: { current: null },
        pendingOverviewScreenSelectionRef: { current: null },
        recordContentHistoryEntry: vi.fn(),
        runtimeStructureInsertRevisionRef: { current: 0 },
        sendRuntimeLayerMoveSemanticHandoff,
        setActiveFileId: vi.fn(),
        setCreatedOverviewLayerSelection: vi.fn(),
        setOverviewSelectedScreenIds: vi.fn(),
        setRuntimeStructureInsertRequest: vi.fn(),
        setSelectedElement: vi.fn(),
        setSelectedLayerIdsState: vi.fn(),
        t: (key) => key,
        viewModeRef: { current: "overview" },
      },
      {
        sourceSelector: '[data-agent-native-node-id="runtime-1m2vou"]',
        sourceNodeId: "runtime-1m2vou",
        sourceScreenId: "source",
        targetScreenId: "target",
        targetAnchorNodeId: "an-anchor",
        targetAnchorSelector: '[data-agent-native-node-id="an-anchor"]',
        targetAnchorPlacement: "after",
        targetDropMode: "flow-insert",
      },
    );

    expect(sendRuntimeLayerMoveSemanticHandoff).toHaveBeenCalledWith(
      sourceNode.id,
      targetNode.id,
      "after",
    );
    expect(applyFileContentUpdate).not.toHaveBeenCalled();
  });
});

describe("runCrossScreenElementDrop — portable style capture failure", () => {
  it("refuses the move: no history entry, no file write for either file, both files' content unchanged, toast shown once", () => {
    vi.clearAllMocks();
    // A real (mutable) per-file store, not just call-count mocks — writing
    // TO it is what "applyFileContentUpdate" would mean, so reading it back
    // afterward is a real "the file didn't change" assertion, not an
    // inference from a spy never having been called.
    const screens: Record<string, string> = {
      source: SCREEN_WITH_FRAME,
      target: SCREEN_WITH_FRAME,
    };
    const applyFileContentUpdate = vi.fn((fileId: string, next: string) => {
      screens[fileId] = next;
      return acceptFixture(fileId, next);
    });
    const recordContentHistoryEntry = vi.fn();
    const sendRuntimeLayerMoveSemanticHandoff = vi.fn();
    const setRuntimeStructureInsertRequest = vi.fn();
    const setSelectedElement = vi.fn();
    const setSelectedLayerIdsState = vi.fn();

    runCrossScreenElementDrop(
      {
        applyFileContentUpdate,
        boardFileId: undefined,
        canEditDesign: true,
        clearPendingOverviewLayerSelectionTimer: () => {},
        codeLayerOwnerByNodeIdRef: { current: new Map() },
        designSourceType: "inline",
        getScreenContent: (screenId) => screens[screenId] ?? "",
        id: undefined,
        overviewScreens: [
          {
            id: "target",
            filename: "target.html",
            content: screens.target!,
            updatedAt: "2026-09-11T00:00:00.000Z",
            heightPinned: false,
            sourceType: "inline",
          },
        ],
        pendingOverviewLayerSelectionRef: { current: null },
        pendingOverviewScreenSelectionRef: { current: null },
        recordContentHistoryEntry,
        runtimeStructureInsertRevisionRef: { current: 0 },
        sendRuntimeLayerMoveSemanticHandoff,
        setActiveFileId: () => {},
        setCreatedOverviewLayerSelection: () => {},
        setOverviewSelectedScreenIds: () => {},
        setRuntimeStructureInsertRequest,
        setSelectedElement,
        setSelectedLayerIdsState,
        t: (key) => key,
        viewModeRef: { current: "overview" },
      },
      {
        sourceSelector: '[data-agent-native-node-id="frame-1"]',
        sourceNodeId: "frame-1",
        sourceScreenId: "source",
        targetScreenId: "target",
        targetAnchorSelector: "body",
        targetAnchorPlacement: "inside",
        targetDropMode: "absolute-container",
        targetAnchorRect: { left: 100, top: 50, width: 400, height: 300 },
        targetLocalPoint: { x: 240, y: 300 },
        // The capture-failed signal — distinct from `styleSnapshot: undefined`
        // (legitimately nothing to carry), which must keep moving normally;
        // see the "queues an inline Alt-drag copy" tests above for that case.
        styleSnapshotCaptureFailed: true,
      },
    );

    expect(applyFileContentUpdate).not.toHaveBeenCalled();
    expect(recordContentHistoryEntry).not.toHaveBeenCalled();
    expect(sendRuntimeLayerMoveSemanticHandoff).not.toHaveBeenCalled();
    expect(setRuntimeStructureInsertRequest).not.toHaveBeenCalled();
    expect(setSelectedElement).not.toHaveBeenCalled();
    expect(setSelectedLayerIdsState).not.toHaveBeenCalled();
    // Read back the store itself — not just "the write function wasn't
    // called" — as the actual "both files unchanged" proof.
    expect(screens.source).toBe(SCREEN_WITH_FRAME);
    expect(screens.target).toBe(SCREEN_WITH_FRAME);
    expect(toast.error).toHaveBeenCalledTimes(1);
    expect(toast.error).toHaveBeenCalledWith(
      "designEditor.toasts.layerMoveFailed",
      expect.any(Object),
    );
  });
});
