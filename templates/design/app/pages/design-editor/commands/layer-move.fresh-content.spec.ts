import {
  buildCodeLayerProjection,
  buildCodeLayerTree,
} from "@shared/code-layer";
import { describe, expect, it, vi } from "vitest";

import {
  codeLayerSourceNodeIdAttrs,
  isCodeLayerNodeRuntimeOnly,
} from "@/pages/design-editor/code-layer-state";
import type { DesignFile } from "@/pages/design-editor/types";

import { runLayerMove } from "./layer-move";
import { runLayerMoveToScreen } from "./layer-move-to-screen";

const EMPTY_HTML = "<html><body></body></html>";
const SOURCE_HTML =
  '<html><body><div data-agent-native-node-id="moving">Move me</div></body></html>';
const DESTINATION_HTML =
  '<html><body><div data-agent-native-node-id="anchor">Anchor</div></body></html>';

function file(id: string, content: string): DesignFile {
  return {
    id,
    filename: `${id}.html`,
    fileType: "html",
    content,
  } as DesignFile;
}

function ownerFor(fileId: string, html: string, authoredId: string) {
  const projection = buildCodeLayerProjection(html);
  const node = projection.nodes.find(
    (candidate) =>
      candidate.dataAttributes["data-agent-native-node-id"] === authoredId,
  );
  if (!node) throw new Error(`Missing fixture node ${authoredId}`);
  return [
    node.id,
    { fileId, node, tree: buildCodeLayerTree(projection), runtimeOnly: false },
  ] as const;
}

function writesByFile() {
  const writes = new Map<string, string>();
  const applyFileContentUpdate = vi.fn((fileId: string, content: string) => {
    writes.set(fileId, content);
  });
  return { applyFileContentUpdate, writes };
}

describe("layer moves use the current content behind the rendered layer tree", () => {
  it("routes editor-minted runtime ids through the screen bridge, not source HTML", () => {
    const screenId = "source";
    const sourceContent =
      '<html><body><div id="subject">Subject</div><div id="anchor">Anchor</div></body></html>';
    const runtimeProjection = buildCodeLayerProjection(
      '<html><body><div id="subject" data-agent-native-node-id="runtime-1m2vou">Subject</div><div id="anchor" data-agent-native-node-id="runtime-2abcde">Anchor</div></body></html>',
    );
    const runtimeTree = buildCodeLayerTree(runtimeProjection);
    const sourceNodeIdAttrs = codeLayerSourceNodeIdAttrs(sourceContent);
    const owners = new Map(
      runtimeProjection.nodes.map((node) => [
        node.id,
        {
          fileId: screenId,
          node,
          tree: runtimeTree,
          runtimeOnly: isCodeLayerNodeRuntimeOnly({
            fileIsRuntimeProjected: false,
            nodeIdAttr: node.dataAttributes["data-agent-native-node-id"],
            sourceNodeIdAttrs,
          }),
        },
      ]),
    );
    const subject = runtimeProjection.nodes.find(
      (node) =>
        node.dataAttributes["data-agent-native-node-id"] === "runtime-1m2vou",
    )!;
    const anchor = runtimeProjection.nodes.find(
      (node) =>
        node.dataAttributes["data-agent-native-node-id"] === "runtime-2abcde",
    )!;
    const applyFileContentUpdate = vi.fn();
    const sendRuntimeLayerMoveSemanticHandoff = vi.fn(() => false);
    let runtimeRequest: unknown = null;

    runLayerMove(
      {
        activeFile: file(screenId, sourceContent),
        applyFileContentUpdate,
        canEditDesign: true,
        canMoveLayer: () => true,
        codeLayerOwnerByNodeId: owners,
        effectiveCodeLayerState: {
          lockedIds: new Set(),
          hiddenIds: new Set(),
        },
        files: [file(screenId, sourceContent)],
        getFreshActiveContent: () => sourceContent,
        getScreenContent: () => sourceContent,
        handleLayerMoveToScreen: vi.fn(),
        handleScreenLayerMove: vi.fn(),
        recordContentHistoryEntry: vi.fn(),
        recordLocalContentHistoryEntry: vi.fn(),
        runtimeStructureMoveRevisionRef: { current: 0 },
        sendRuntimeLayerMoveSemanticHandoff,
        setExpandedLayerIds: vi.fn(),
        setRuntimeStructureMoveRequest: (request: unknown) => {
          runtimeRequest = request;
        },
        setSelectedElement: vi.fn(),
        setSelectedLayerIdsState: vi.fn(),
        t: (key: string) => key,
        viewModeRef: { current: "overview" },
        visualScreenFileIds: new Set(),
      } as unknown as Parameters<typeof runLayerMove>[0],
      {
        draggedIds: [subject.id],
        targetId: anchor.id,
        placement: "after",
      },
    );

    expect(runtimeRequest).toMatchObject({
      screenId,
      subject: { sourceId: "runtime-1m2vou" },
      anchor: { sourceId: "runtime-2abcde" },
      placement: "after",
    });
    expect(applyFileContentUpdate).not.toHaveBeenCalled();
    expect(sendRuntimeLayerMoveSemanticHandoff).not.toHaveBeenCalled();
  });

  it("moves a layer when its rendered source is newer than the file snapshot", () => {
    const sourceOwner = ownerFor("source", SOURCE_HTML, "moving");
    const targetOwner = ownerFor("destination", DESTINATION_HTML, "anchor");
    const owners = new Map([sourceOwner, targetOwner]);
    const currentContent = new Map([
      ["active", EMPTY_HTML],
      ["source", SOURCE_HTML],
      ["destination", DESTINATION_HTML],
    ]);
    const { applyFileContentUpdate, writes } = writesByFile();

    runLayerMove(
      {
        activeFile: file("active", EMPTY_HTML),
        applyFileContentUpdate,
        canEditDesign: true,
        canMoveLayer: () => true,
        codeLayerOwnerByNodeId: owners,
        effectiveCodeLayerState: {
          lockedIds: new Set(),
          hiddenIds: new Set(),
        },
        files: [
          file("active", EMPTY_HTML),
          file("source", EMPTY_HTML),
          file("destination", DESTINATION_HTML),
        ],
        getFreshActiveContent: () => EMPTY_HTML,
        getScreenContent: (fileId: string) => currentContent.get(fileId) ?? "",
        handleLayerMoveToScreen: vi.fn(),
        handleScreenLayerMove: vi.fn(),
        recordContentHistoryEntry: vi.fn(),
        recordLocalContentHistoryEntry: vi.fn(),
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
        draggedIds: [sourceOwner[0]],
        targetId: targetOwner[0],
        placement: "after",
      },
    );

    expect(writes.get("source") ?? "").not.toContain(
      'data-agent-native-node-id="moving"',
    );
    expect(writes.get("destination") ?? "").toContain(
      'data-agent-native-node-id="moving"',
    );
    expect(writes.get("destination") ?? "").toContain(
      'data-agent-native-node-id="anchor"',
    );
  });

  it("moves a freshly added board layer onto a screen row from current source HTML", () => {
    const sourceOwner = ownerFor("board", SOURCE_HTML, "moving");
    const currentContent = new Map([
      ["active", EMPTY_HTML],
      ["board", SOURCE_HTML],
      ["destination", DESTINATION_HTML],
    ]);
    const { applyFileContentUpdate, writes } = writesByFile();

    runLayerMoveToScreen(
      {
        activeFile: file("active", EMPTY_HTML),
        applyFileContentUpdate,
        boardFileId: "board",
        codeLayerOwnerByNodeId: new Map([sourceOwner]),
        effectiveCodeLayerState: {
          lockedIds: new Set(),
          hiddenIds: new Set(),
        },
        files: [
          file("active", EMPTY_HTML),
          file("board", EMPTY_HTML),
          file("destination", DESTINATION_HTML),
        ],
        getFreshActiveContent: () => EMPTY_HTML,
        getScreenContent: (fileId: string) => currentContent.get(fileId) ?? "",
        recordContentHistoryEntry: vi.fn(),
        recordLocalContentHistoryEntry: vi.fn(),
        runtimeStructureInsertRevisionRef: { current: 0 },
        setExpandedLayerIds: vi.fn(),
        setRuntimeStructureInsertRequest: vi.fn(),
        setSelectedElement: vi.fn(),
        setSelectedLayerIdsState: vi.fn(),
        t: (key: string) => key,
        viewModeRef: { current: "overview" },
      } as unknown as Parameters<typeof runLayerMoveToScreen>[0],
      {
        draggedIds: [sourceOwner[0]],
        targetId: "destination",
        placement: "inside",
      },
      "destination",
    );

    expect(writes.get("board") ?? "").not.toContain(
      'data-agent-native-node-id="moving"',
    );
    expect(writes.get("destination") ?? "").toContain(
      'data-agent-native-node-id="moving"',
    );
    expect(writes.get("destination") ?? "").toContain(
      'data-agent-native-node-id="anchor"',
    );
  });
});
