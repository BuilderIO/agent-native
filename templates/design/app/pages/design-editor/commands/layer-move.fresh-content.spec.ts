import {
  buildCodeLayerProjection,
  buildCodeLayerTree,
} from "@shared/code-layer";
import { describe, expect, it, vi } from "vitest";

import {
  codeLayerSourceNodeIdAttrs,
  isCodeLayerNodeRuntimeOnly,
} from "@/pages/design-editor/code-layer-state";
import { prepareCanonicalSourceContent } from "@/pages/design-editor/source-publication";
import type { DesignFile } from "@/pages/design-editor/types";

import { runLayerMove } from "./layer-move";
import { runLayerMoveToScreen } from "./layer-move-to-screen";

const EMPTY_HTML = "<html><body></body></html>";
const SOURCE_HTML =
  '<html><body><div data-agent-native-node-id="moving">Move me</div></body></html>';
const DESTINATION_HTML =
  '<html><body><div data-agent-native-node-id="anchor">Anchor</div></body></html>';

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

function file(id: string, content: string): DesignFile {
  return {
    id,
    filename: `${id}.html`,
    fileType: "html",
    content,
  } as DesignFile;
}

function codeLayerSource(fileId: string) {
  return { kind: "design-file" as const, fileId, filename: `${fileId}.html` };
}

function ownerFor(fileId: string, html: string, authoredId: string) {
  const projection = buildCodeLayerProjection(html, {
    source: codeLayerSource(fileId),
  });
  const node = projection.nodes.find(
    (candidate) =>
      candidate.dataAttributes["data-agent-native-node-id"] === authoredId,
  );
  if (!node) throw new Error(`Missing fixture node ${authoredId}`);
  return [
    node.id,
    {
      fileId,
      node,
      sourceProjection: projection,
      tree: buildCodeLayerTree(projection),
      runtimeOnly: false,
    },
  ] as const;
}

function writesByFile() {
  const writes = new Map<string, string>();
  const applyFileContentUpdate = vi.fn((fileId: string, content: string) => {
    const accepted = acceptFixture(fileId, content);
    writes.set(fileId, accepted.content);
    return accepted;
  });
  return { applyFileContentUpdate, writes };
}

function moveFixture(
  renderedContent: string,
  currentSourceContent: string,
  selectedTexts: string[],
) {
  const projection = buildCodeLayerProjection(renderedContent, {
    source: codeLayerSource("source"),
  });
  const tree = buildCodeLayerTree(projection);
  const nodes = selectedTexts.map((text) => {
    const node = projection.nodes.find(
      (candidate) =>
        candidate.tag !== "html" &&
        candidate.tag !== "body" &&
        candidate.textSnippet === text,
    );
    if (!node) throw new Error(`Missing fixture node ${text}`);
    return node;
  });
  const { applyFileContentUpdate, writes } = writesByFile();
  runLayerMoveToScreen(
    {
      activeFile: file("active", EMPTY_HTML),
      applyFileContentUpdate,
      boardFileId: "source",
      codeLayerOwnerByNodeId: new Map(
        nodes.map((node) => [
          node.id,
          {
            fileId: "source",
            node,
            sourceProjection: projection,
            tree,
            runtimeOnly: false,
          },
        ]),
      ),
      effectiveCodeLayerState: {
        lockedIds: new Set(),
        hiddenIds: new Set(),
      },
      files: [
        file("active", EMPTY_HTML),
        file("source", renderedContent),
        file("destination", EMPTY_HTML),
      ],
      getFreshActiveContent: () => EMPTY_HTML,
      getScreenContent: (fileId: string) =>
        fileId === "source" ? currentSourceContent : EMPTY_HTML,
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
      draggedIds: nodes.map((node) => node.id),
      targetId: "destination",
      placement: "inside",
    },
    "destination",
  );
  return { applyFileContentUpdate, writes };
}

function moveOwnScreenFixture(
  renderedContent: string,
  currentContent: string,
  selectedTexts: string[],
) {
  const screenId = "destination";
  const projection = buildCodeLayerProjection(renderedContent, {
    source: codeLayerSource(screenId),
  });
  const tree = buildCodeLayerTree(projection);
  const nodes = selectedTexts.map((text) => {
    const node = projection.nodes.find(
      (candidate) =>
        candidate.tag !== "html" &&
        candidate.tag !== "body" &&
        candidate.textSnippet === text,
    );
    if (!node) throw new Error(`Missing fixture node ${text}`);
    return node;
  });
  const { applyFileContentUpdate, writes } = writesByFile();
  runLayerMoveToScreen(
    {
      activeFile: file(screenId, renderedContent),
      applyFileContentUpdate,
      boardFileId: "board",
      codeLayerOwnerByNodeId: new Map(
        nodes.map((node) => [
          node.id,
          {
            fileId: screenId,
            node,
            sourceProjection: projection,
            tree,
            runtimeOnly: false,
          },
        ]),
      ),
      effectiveCodeLayerState: {
        lockedIds: new Set(),
        hiddenIds: new Set(),
      },
      files: [file(screenId, renderedContent)],
      getFreshActiveContent: () => currentContent,
      getScreenContent: () => currentContent,
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
      draggedIds: nodes.map((node) => node.id),
      targetId: screenId,
      placement: "inside",
    },
    screenId,
  );
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
    const applyFileContentUpdate = vi.fn((fileId: string, content: string) =>
      acceptFixture(fileId, content),
    );
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

  it("refuses to stamp an idless owner from an older source projection", () => {
    const renderedContent =
      '<html><body><button class="same">one</button><button class="same">selected</button></body></html>';
    const currentSourceContent =
      '<html><body><button class="same">one</button><button class="same">inserted</button><button class="same">selected</button></body></html>';
    const projection = buildCodeLayerProjection(renderedContent, {
      source: codeLayerSource("source"),
    });
    const node = projection.nodes.filter(
      (candidate) => candidate.tag === "button",
    )[1]!;
    const { applyFileContentUpdate } = writesByFile();

    runLayerMoveToScreen(
      {
        activeFile: file("active", EMPTY_HTML),
        applyFileContentUpdate,
        boardFileId: "source",
        codeLayerOwnerByNodeId: new Map([
          [
            node.id,
            {
              fileId: "source",
              node,
              sourceProjection: projection,
              tree: buildCodeLayerTree(projection),
              runtimeOnly: false,
            },
          ],
        ]),
        effectiveCodeLayerState: {
          lockedIds: new Set(),
          hiddenIds: new Set(),
        },
        files: [
          file("active", EMPTY_HTML),
          file("source", renderedContent),
          file("destination", EMPTY_HTML),
        ],
        getFreshActiveContent: () => EMPTY_HTML,
        getScreenContent: (fileId: string) =>
          fileId === "source" ? currentSourceContent : EMPTY_HTML,
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
        draggedIds: [node.id],
        targetId: "destination",
        placement: "inside",
      },
      "destination",
    );

    expect(applyFileContentUpdate).not.toHaveBeenCalled();
  });

  it.each([
    [
      "an inserted duplicate",
      '<html><body><div data-agent-native-node-id="dup">A</div><div data-agent-native-node-id="dup">X</div><div data-agent-native-node-id="dup">B</div></body></html>',
    ],
    [
      "the selected duplicate deleted",
      '<html><body><div data-agent-native-node-id="dup">A</div></body></html>',
    ],
  ])("refuses a stale duplicate owner after %s", (_name, currentContent) => {
    const renderedContent =
      '<html><body><div data-agent-native-node-id="dup">A</div><div data-agent-native-node-id="dup">B</div></body></html>';
    const { applyFileContentUpdate } = moveFixture(
      renderedContent,
      currentContent,
      ["B"],
    );

    expect(applyFileContentUpdate).not.toHaveBeenCalled();
  });

  it("prepares selected duplicate IDs before moving either node", () => {
    const content =
      '<html><body><div data-agent-native-node-id="dup">A</div><div data-agent-native-node-id="dup">B</div><div>Keep</div></body></html>';
    const { writes } = moveFixture(content, content, ["A", "B"]);

    expect(writes.get("source")).toContain(">Keep<");
    expect(writes.get("source")).not.toMatch(/>[AB]</);
    expect(writes.get("destination")).toMatch(/>A<.*>B</s);
    const movedIds = Array.from(
      (writes.get("destination") ?? "").matchAll(
        /<div\b[^>]*data-agent-native-node-id="([^"]+)"/g,
      ),
      (match) => match[1],
    );
    expect(new Set(movedIds).size).toBe(2);
  });

  it("moves a unique authored ID after an unrelated source edit", () => {
    const renderedContent =
      '<html><body><div data-agent-native-node-id="stable">Move</div></body></html>';
    const currentContent =
      '<html><body><p>Unrelated</p><div data-agent-native-node-id="stable">Move</div></body></html>';
    const { writes } = moveFixture(renderedContent, currentContent, ["Move"]);

    expect(writes.get("source")).toContain(">Unrelated<");
    expect(writes.get("source")).not.toContain(">Move<");
    expect(writes.get("destination")).toContain(">Move<");
  });

  it("moves multiple idless siblings by identities fixed before the first removal", () => {
    const sourceContent =
      '<html><body><div class="first">A</div><div>B</div><div>C</div><div>D</div></body></html>';
    const projection = buildCodeLayerProjection(sourceContent, {
      source: codeLayerSource("source"),
    });
    const tree = buildCodeLayerTree(projection);
    const nodes = ["A", "C"].map((text) => {
      const node = projection.nodes.find(
        (candidate) =>
          candidate.tag === "div" && candidate.textSnippet === text,
      );
      if (!node) throw new Error(`Missing fixture node ${text}`);
      return node;
    });
    const owners = new Map(
      nodes.map((node) => [
        node.id,
        {
          fileId: "source",
          node,
          sourceProjection: projection,
          tree,
          runtimeOnly: false,
        },
      ]),
    );
    const currentContent = new Map([
      ["active", EMPTY_HTML],
      ["source", sourceContent],
      ["destination", EMPTY_HTML],
    ]);
    const { applyFileContentUpdate, writes } = writesByFile();

    runLayerMoveToScreen(
      {
        activeFile: file("active", EMPTY_HTML),
        applyFileContentUpdate,
        boardFileId: "source",
        codeLayerOwnerByNodeId: owners,
        effectiveCodeLayerState: {
          lockedIds: new Set(),
          hiddenIds: new Set(),
        },
        files: [
          file("active", EMPTY_HTML),
          file("source", sourceContent),
          file("destination", EMPTY_HTML),
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
        draggedIds: nodes.map((node) => node.id),
        targetId: "destination",
        placement: "inside",
      },
      "destination",
    );

    expect(writes.get("source")).toMatch(/>B<.*>D</s);
    expect(writes.get("source")).not.toMatch(/>[AC]</);
    expect(writes.get("destination")).toMatch(/>A<.*>C</s);
    expect(writes.get("destination")).not.toContain(">D<");
  });

  it("moves multiple idless siblings onto their own Screen row", () => {
    const content =
      '<html><body><div class="first">A</div><div>B</div><div>C</div><div>D</div></body></html>';
    const { writes } = moveOwnScreenFixture(content, content, ["A", "C"]);

    expect(writes.get("destination")).toMatch(/>B<.*>D<.*>A<.*>C</s);
  });

  it("refuses a stale idless owner moved onto its own Screen row", () => {
    const renderedContent =
      '<html><body><button class="same">one</button><button class="same">selected</button><div>last</div></body></html>';
    const currentContent =
      '<html><body><button class="same">one</button><button class="same">inserted</button><button class="same">selected</button><div>last</div></body></html>';
    const { applyFileContentUpdate } = moveOwnScreenFixture(
      renderedContent,
      currentContent,
      ["selected"],
    );

    expect(applyFileContentUpdate).not.toHaveBeenCalled();
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
