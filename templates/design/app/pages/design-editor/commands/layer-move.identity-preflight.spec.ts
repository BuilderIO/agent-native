import {
  buildCodeLayerProjection,
  buildCodeLayerTree,
  type CodeLayerNode,
} from "@shared/code-layer";
import { describe, expect, it, vi } from "vitest";

import { prepareCanonicalSourceContent } from "@/pages/design-editor/source-publication";
import type { DesignFile } from "@/pages/design-editor/types";

import { runLayerMove } from "./layer-move";

function file(id: string, content: string): DesignFile {
  return {
    id,
    filename: `${id}.html`,
    fileType: "html",
    content,
  } as DesignFile;
}

function projection(fileId: string, content: string) {
  return buildCodeLayerProjection(content, {
    source: { kind: "design-file", fileId, filename: `${fileId}.html` },
  });
}

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

function nodeByText(nodes: CodeLayerNode[], text: string) {
  const node = nodes.find(
    (candidate) =>
      candidate.tag !== "html" &&
      candidate.tag !== "body" &&
      candidate.textSnippet === text,
  );
  if (!node) throw new Error(`Missing fixture node ${text}`);
  return node;
}

function runMove(args: {
  renderedSource: string;
  currentSource?: string;
  renderedDestination: string;
  currentDestination: string;
  draggedText: string;
  anchorText: string;
}) {
  const sourceId = args.currentSource === undefined ? "destination" : "source";
  const sourceProjection = projection(sourceId, args.renderedSource);
  const destinationProjection = projection(
    "destination",
    args.renderedDestination,
  );
  const draggedNode = nodeByText(sourceProjection.nodes, args.draggedText);
  const anchorNode = nodeByText(destinationProjection.nodes, args.anchorText);
  const sourceTree = buildCodeLayerTree(sourceProjection);
  const destinationTree = buildCodeLayerTree(destinationProjection);
  const owners = new Map([
    [
      draggedNode.id,
      {
        fileId: sourceId,
        node: draggedNode,
        sourceProjection,
        tree: sourceTree,
        runtimeOnly: false,
      },
    ],
    [
      anchorNode.id,
      {
        fileId: "destination",
        node: anchorNode,
        sourceProjection: destinationProjection,
        tree: destinationTree,
        runtimeOnly: false,
      },
    ],
  ]);
  const currentContent = new Map([
    ["destination", args.currentDestination],
    ["source", args.currentSource ?? args.currentDestination],
  ]);
  const writes = new Map<string, string>();
  const applyFileContentUpdate = vi.fn((fileId: string, content: string) => {
    const accepted = acceptFixture(fileId, content);
    writes.set(fileId, accepted.content);
    return accepted;
  });

  runLayerMove(
    {
      activeFile: file("destination", args.renderedDestination),
      applyFileContentUpdate,
      canEditDesign: true,
      canMoveLayer: () => true,
      codeLayerOwnerByNodeId: owners,
      effectiveCodeLayerState: {
        lockedIds: new Set(),
        hiddenIds: new Set(),
      },
      files: [
        file("destination", args.renderedDestination),
        file("source", args.renderedSource),
      ],
      getFreshActiveContent: () => args.currentDestination,
      getScreenContent: (fileId: string) => currentContent.get(fileId) ?? "",
      handleLayerMoveToScreen: vi.fn(),
      handleScreenLayerMove: vi.fn(),
      recordContentHistoryEntry: vi.fn(),
      recordLocalContentHistoryEntry: vi.fn(),
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
    } as unknown as Parameters<typeof runLayerMove>[0],
    {
      draggedIds: [draggedNode.id],
      targetId: anchorNode.id,
      placement: "inside",
    },
  );

  return { applyFileContentUpdate, writes };
}

describe("runLayerMove identity preflight", () => {
  it("refuses a stale idless same-file anchor", () => {
    const rendered =
      '<html><body><section class="same">one</section><section class="same">anchor</section><aside data-agent-native-node-id="drag">drag</aside></body></html>';
    const current =
      '<html><body><section class="same">one</section><section class="same">inserted</section><section class="same">anchor</section><aside data-agent-native-node-id="drag">drag</aside></body></html>';
    const { applyFileContentUpdate } = runMove({
      renderedSource: rendered,
      renderedDestination: rendered,
      currentDestination: current,
      draggedText: "drag",
      anchorText: "anchor",
    });

    expect(applyFileContentUpdate).not.toHaveBeenCalled();
  });

  it("refuses a stale duplicated cross-file anchor", () => {
    const source =
      '<html><body><aside data-agent-native-node-id="drag">drag</aside></body></html>';
    const renderedDestination =
      '<html><body><section data-agent-native-node-id="dup">one</section><section data-agent-native-node-id="dup">anchor</section></body></html>';
    const currentDestination =
      '<html><body><section data-agent-native-node-id="dup">one</section><section data-agent-native-node-id="dup">inserted</section><section data-agent-native-node-id="dup">anchor</section></body></html>';
    const { applyFileContentUpdate } = runMove({
      renderedSource: source,
      currentSource: source,
      renderedDestination,
      currentDestination,
      draggedText: "drag",
      anchorText: "anchor",
    });

    expect(applyFileContentUpdate).not.toHaveBeenCalled();
  });

  it("moves through a unique anchor after an unrelated destination edit", () => {
    const source =
      '<html><body><aside data-agent-native-node-id="drag">drag</aside></body></html>';
    const renderedDestination =
      '<html><body><section data-agent-native-node-id="anchor">anchor</section></body></html>';
    const currentDestination =
      '<html><body><p>unrelated</p><section data-agent-native-node-id="anchor">anchor</section></body></html>';
    const { writes } = runMove({
      renderedSource: source,
      currentSource: source,
      renderedDestination,
      currentDestination,
      draggedText: "drag",
      anchorText: "anchor",
    });

    expect(writes.get("source")).not.toContain(">drag<");
    expect(writes.get("destination")).toContain(">unrelated<");
    expect(writes.get("destination")).toMatch(/>anchor<.*>drag</s);
  });
});
