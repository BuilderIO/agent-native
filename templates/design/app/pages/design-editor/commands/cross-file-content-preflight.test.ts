// @vitest-environment happy-dom

import {
  buildCodeLayerProjection,
  buildCodeLayerTree,
  moveNodeBetweenDocuments,
} from "@shared/code-layer";
import { expect, it, vi } from "vitest";

import { runApplyFileContentUpdate } from "@/pages/design-editor/commands/apply-file-content-update";
import {
  prepareAcceptedSourceContent,
  prepareCanonicalSourceContent,
} from "@/pages/design-editor/source-publication";
import type { DesignFile } from "@/pages/design-editor/types";

import { runLayerMove, type LayerMoveArgs } from "./layer-move";
import { runLayerMoveToScreen } from "./layer-move-to-screen";
import { runOverviewPrimitiveReparent } from "./overview-primitive-reparent";

vi.mock("sonner", () => ({ toast: { error: vi.fn(), message: vi.fn() } }));

const SOURCE_ID = "alpine-source";
const TARGET_ID = "plain-target";
const ACTIVE_ID = "other-active";

const sourceContent = `<!doctype html><html><head><script src="https://cdn.jsdelivr.net/npm/alpinejs@3.x.x/dist/cdn.min.js" defer></script></head><body><button data-agent-native-node-id="moving" x-data="{ open: true }" x-show="open">Move me</button></body></html>`;
const targetContent = `<!doctype html><html><head></head><body><main data-agent-native-node-id="target"></main></body></html>`;
const activeContent = "<!doctype html><html><body></body></html>";

function file(id: string, content: string): DesignFile {
  return {
    id,
    filename: `${id}.html`,
    fileType: "html",
    content,
  } as DesignFile;
}

function nodeById(
  nodes: ReturnType<typeof buildCodeLayerProjection>["nodes"],
  id: string,
) {
  const node = nodes.find(
    (candidate) => candidate.dataAttributes["data-agent-native-node-id"] === id,
  );
  if (!node) throw new Error(`Missing source node ${id}`);
  return node;
}

it.each(["layers-panel move", "move-to-screen", "overview reparent"] as const)(
  "preflights both files before source deletion when target integrity rejects the moved Alpine subtree (%s)",
  (command) => {
    const source = prepareCanonicalSourceContent(sourceContent, {
      fileId: SOURCE_ID,
      fileType: "html",
    }).content;
    const target = prepareCanonicalSourceContent(targetContent, {
      fileId: TARGET_ID,
      fileType: "html",
    }).content;
    const moved = moveNodeBetweenDocuments(source, target, {
      nodeId: "moving",
      anchorNodeId: "target",
      placement: "inside",
    });
    expect(moved.status).toBe("applied");
    expect(() =>
      prepareAcceptedSourceContent(moved.destHtml, {
        fileId: TARGET_ID,
        previousContent: target,
      }),
    ).toThrow(/Alpine|integrity|invalid/i);

    const sourceFile = file(SOURCE_ID, source);
    const targetFile = file(TARGET_ID, target);
    const activeFile = file(ACTIVE_ID, activeContent);
    let design = { files: [sourceFile, targetFile, activeFile] };
    const applyCalls: string[] = [];
    const queuedSaves: string[] = [];
    const history: unknown[] = [];
    const queryClient = {
      setQueryData: (
        _key: unknown,
        update: (old: typeof design) => typeof design,
      ) => {
        design = update(design);
      },
    };
    const applyArgs = {
      acknowledgeAuthoritativeClipboardMutation: vi.fn(),
      activeFile,
      applyFileContentUpdate: vi.fn(),
      applyLocalContentUpdate: vi.fn(() => ({ status: "refused" as const })),
      canEditDesignRef: { current: true },
      cancelQueuedFileContentSave: vi.fn(),
      clearPendingLocalFileContent: vi.fn(),
      files: design.files,
      getScreenContent: (fileId: string) =>
        design.files.find((candidate) => candidate.id === fileId)?.content ??
        "",
      id: "design",
      markPendingLocalFileContent: vi.fn(),
      overviewIsSynced: false,
      overviewPresenceFileId: null,
      overviewYdoc: null,
      queryClient,
      queueFileContentSave: (fileId: string) => queuedSaves.push(fileId),
      recordContentHistoryEntry: vi.fn(),
      suppressContentHistoryRef: { current: false },
      t: (key: string) => key,
    };
    const apply = (fileId: string, content: string, options?: object) => {
      applyCalls.push(fileId);
      return runApplyFileContentUpdate(
        { ...applyArgs, applyFileContentUpdate: apply } as never,
        fileId,
        content,
        options as never,
      );
    };
    expect(apply(TARGET_ID, moved.destHtml).status).toBe("refused");
    applyCalls.length = 0;
    queuedSaves.length = 0;

    const sourceProjection = buildCodeLayerProjection(source, {
      source: { kind: "design-file", fileId: SOURCE_ID },
    });
    const targetProjection = buildCodeLayerProjection(target, {
      source: { kind: "design-file", fileId: TARGET_ID },
    });
    const draggedNode = nodeById(sourceProjection.nodes, "moving");
    const targetNode = nodeById(targetProjection.nodes, "target");
    const owners: LayerMoveArgs["codeLayerOwnerByNodeId"] = new Map();
    for (const node of sourceProjection.nodes) {
      owners.set(node.id, {
        fileId: SOURCE_ID,
        node,
        sourceProjection,
        tree: buildCodeLayerTree(sourceProjection),
        runtimeOnly: false,
      });
    }
    for (const node of targetProjection.nodes) {
      owners.set(node.id, {
        fileId: TARGET_ID,
        node,
        sourceProjection: targetProjection,
        tree: buildCodeLayerTree(targetProjection),
        runtimeOnly: false,
      });
    }
    const applyFileContentUpdate = vi.fn(apply);

    const commandArgs = {
      activeFile,
      applyFileContentUpdate,
      canEditDesign: true,
      canMoveLayer: () => true,
      codeLayerOwnerByNodeId: owners,
      effectiveCodeLayerState: { lockedIds: new Set(), hiddenIds: new Set() },
      files: design.files,
      getFreshActiveContent: () => activeContent,
      getScreenContent: (fileId: string) =>
        design.files.find((candidate) => candidate.id === fileId)?.content ??
        "",
      handleLayerMoveToScreen: vi.fn(),
      handleScreenLayerMove: vi.fn(),
      recordContentHistoryEntry: (entry: unknown) => history.push(entry),
      recordLocalContentHistoryEntry: (entry: unknown) => history.push(entry),
      remapMotionTracksForClone: vi.fn(),
      runtimeStructureMoveRevisionRef: { current: 0 },
      sendRuntimeLayerMoveSemanticHandoff: () => false,
      setExpandedLayerIds: vi.fn(),
      setRuntimeStructureMoveRequest: vi.fn(),
      setSelectedElement: vi.fn(),
      setSelectedLayerIdsState: vi.fn(),
      t: (key: string) => key,
      viewModeRef: { current: "overview" },
      visualScreenFileIds: new Set(),
      runtimeStructureInsertRevisionRef: { current: 0 },
      setRuntimeStructureInsertRequest: vi.fn(),
      boardFileId: undefined,
      activeFileId: ACTIVE_ID,
      activeBreakpointWidthState: 0,
      overviewSelectedScreenIds: [],
      contentUndoStackRef: { current: [] },
      contentHistorySelectionAfterRef: { current: new Map() },
    };
    const intent = {
      draggedIds: [draggedNode.id],
      targetId: targetNode.id,
      placement: "inside" as const,
    };
    if (command === "layers-panel move") {
      runLayerMove(commandArgs as unknown as LayerMoveArgs, intent);
    } else if (command === "move-to-screen") {
      runLayerMoveToScreen(commandArgs as never, intent, TARGET_ID);
    } else {
      runOverviewPrimitiveReparent(
        {
          ...commandArgs,
          canEditDesign: true,
        } as never,
        {
          sourceNodeId: "moving",
          sourceScreenId: SOURCE_ID,
          targetNodeId: "target",
          targetScreenId: TARGET_ID,
          placement: "inside",
        },
      );
    }

    expect(applyFileContentUpdate).not.toHaveBeenCalled();
    expect(applyCalls).toEqual([]);
    expect(queuedSaves).toEqual([]);
    expect(history).toEqual([]);
    expect(
      design.files.find((candidate) => candidate.id === SOURCE_ID)?.content,
    ).toBe(source);
    expect(
      design.files.find((candidate) => candidate.id === TARGET_ID)?.content,
    ).toBe(target);
  },
);

it("does not record a move-to-screen when a real writer rejects a stale permission callback", () => {
  const source = prepareCanonicalSourceContent(
    `<html><body><button data-agent-native-node-id="moving">Move me</button></body></html>`,
    { fileId: SOURCE_ID, fileType: "html" },
  ).content;
  const target = prepareCanonicalSourceContent(
    `<html><body><main data-agent-native-node-id="target"></main></body></html>`,
    { fileId: TARGET_ID, fileType: "html" },
  ).content;
  const sourceFile = file(SOURCE_ID, source);
  const targetFile = file(TARGET_ID, target);
  const activeFile = file(ACTIVE_ID, activeContent);
  const files = [sourceFile, targetFile, activeFile];
  const writerCalls: Array<{ fileId: string; status: string }> = [];
  const history: unknown[] = [];
  const queuedSaves: string[] = [];
  let queryWrites = 0;
  const queryClient = {
    setQueryData: () => {
      queryWrites += 1;
    },
  };
  const writerArgs = {
    acknowledgeAuthoritativeClipboardMutation: vi.fn(),
    activeFile,
    applyFileContentUpdate: () => {},
    applyLocalContentUpdate: vi.fn(() => ({ status: "refused" as const })),
    canEditDesignRef: { current: false },
    cancelQueuedFileContentSave: vi.fn(),
    clearPendingLocalFileContent: vi.fn(),
    files,
    getScreenContent: (fileId: string) =>
      files.find((candidate) => candidate.id === fileId)?.content ?? "",
    id: "design",
    markPendingLocalFileContent: vi.fn(),
    overviewIsSynced: false,
    overviewPresenceFileId: null,
    overviewYdoc: null,
    queryClient,
    queueFileContentSave: (fileId: string) => queuedSaves.push(fileId),
    recordContentHistoryEntry: (entry: unknown) => history.push(entry),
    suppressContentHistoryRef: { current: false },
    t: (key: string) => key,
  };
  const publish = (fileId: string, content: string, options?: object) => {
    const result = runApplyFileContentUpdate(
      { ...writerArgs, applyFileContentUpdate: publish } as never,
      fileId,
      content,
      options as never,
    );
    writerCalls.push({ fileId, status: result.status });
    return result;
  };
  const sourceProjection = buildCodeLayerProjection(source, {
    source: { kind: "design-file", fileId: SOURCE_ID },
  });
  const targetProjection = buildCodeLayerProjection(target, {
    source: { kind: "design-file", fileId: TARGET_ID },
  });
  const moving = nodeById(sourceProjection.nodes, "moving");
  const targetNode = nodeById(targetProjection.nodes, "target");
  const owners: LayerMoveArgs["codeLayerOwnerByNodeId"] = new Map();
  for (const [fileId, projection] of [
    [SOURCE_ID, sourceProjection],
    [TARGET_ID, targetProjection],
  ] as const) {
    const tree = buildCodeLayerTree(projection);
    for (const node of projection.nodes) {
      owners.set(node.id, {
        fileId,
        node,
        sourceProjection: projection,
        tree,
        runtimeOnly: false,
      });
    }
  }
  const setSelectedElement = vi.fn();
  const setSelectedLayerIdsState = vi.fn();
  const applyFileContentUpdate = vi.fn(publish);

  runLayerMoveToScreen(
    {
      activeFile,
      applyFileContentUpdate,
      boardFileId: undefined,
      codeLayerOwnerByNodeId: owners,
      effectiveCodeLayerState: { lockedIds: new Set(), hiddenIds: new Set() },
      files,
      getFreshActiveContent: () => activeContent,
      getScreenContent: (fileId: string) =>
        files.find((candidate) => candidate.id === fileId)?.content ?? "",
      recordContentHistoryEntry: (entry: unknown) => history.push(entry),
      recordLocalContentHistoryEntry: (entry: unknown) => history.push(entry),
      runtimeStructureInsertRevisionRef: { current: 0 },
      setExpandedLayerIds: vi.fn(),
      setRuntimeStructureInsertRequest: vi.fn(),
      setSelectedElement,
      setSelectedLayerIdsState,
      t: (key: string) => key,
      viewModeRef: { current: "overview" },
    } as never,
    {
      draggedIds: [moving.id],
      targetId: targetNode.id,
      placement: "inside",
    },
    TARGET_ID,
  );

  expect(writerCalls).toEqual([{ fileId: SOURCE_ID, status: "refused" }]);
  expect(applyFileContentUpdate).toHaveBeenCalledTimes(1);
  expect(queuedSaves).toEqual([]);
  expect(queryWrites).toBe(0);
  expect(history).toEqual([]);
  expect(setSelectedElement).not.toHaveBeenCalled();
  expect(setSelectedLayerIdsState).not.toHaveBeenCalled();
  expect(files.map((candidate) => candidate.content)).toEqual([
    source,
    target,
    activeContent,
  ]);
});
