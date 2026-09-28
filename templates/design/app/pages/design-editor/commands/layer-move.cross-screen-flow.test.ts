// @vitest-environment happy-dom

import {
  buildCodeLayerProjection,
  buildCodeLayerTree,
} from "@shared/code-layer";
import { afterEach, describe, expect, it } from "vitest";

import { runPublishCanonicalContent } from "@/pages/design-editor/commands/publish-canonical-content";
import { prepareCanonicalSourceContent } from "@/pages/design-editor/source-publication";
import type { DesignFile } from "@/pages/design-editor/types";

import { runLayerMove, type LayerMoveArgs } from "./layer-move";

const SOURCE_ID = "source.html";
const TARGET_ID = "target.html";

function mountPreview(content: string, fileId: string): void {
  const iframe = document.createElement("iframe");
  iframe.setAttribute("data-screen-iframe-id", fileId);
  document.body.append(iframe);
  const preview = iframe.contentDocument!;
  preview.open();
  preview.write(content);
  preview.close();
}

function file(id: string, content: string): DesignFile {
  return {
    id,
    filename: id,
    fileType: "html",
    content,
    createdAt: "",
    updatedAt: "",
  };
}

function publishFixture(fileId: string, content: string): string {
  return runPublishCanonicalContent(
    {
      canEditDesignRef: { current: true },
      pendingLocalFileContentsRef: { current: new Map() },
      cancelIdentityMigration: () => {},
      queueFileContentSave: () => {},
    },
    fileId,
    content,
  );
}

function acceptFixture(
  fileId: string,
  content: string,
): {
  status: "accepted";
  content: string;
  nodeIdMap: ReadonlyMap<string, string>;
} {
  const prepared = prepareCanonicalSourceContent(content, {
    fileId,
    fileType: "html",
  });
  return {
    status: "accepted",
    content: prepared.content,
    nodeIdMap: prepared.nodeIdMap,
  };
}

function runCrossScreenMove(
  sourceContent: string,
  targetContent: string,
  draggedText = "Move",
  options: { refuseSource?: boolean } = {},
) {
  const sourceFile = file(SOURCE_ID, sourceContent);
  const targetFile = file(TARGET_ID, targetContent);
  const sourceProjection = buildCodeLayerProjection(sourceContent, {
    source: { kind: "design-file", fileId: SOURCE_ID },
  });
  const targetProjection = buildCodeLayerProjection(targetContent, {
    source: { kind: "design-file", fileId: TARGET_ID },
  });
  const sourceTree = buildCodeLayerTree(sourceProjection);
  const targetTree = buildCodeLayerTree(targetProjection);
  const owners: LayerMoveArgs["codeLayerOwnerByNodeId"] = new Map();
  for (const node of sourceProjection.nodes) {
    owners.set(node.id, {
      fileId: SOURCE_ID,
      node,
      sourceProjection,
      tree: sourceTree,
      runtimeOnly: false,
    });
  }
  for (const node of targetProjection.nodes) {
    owners.set(node.id, {
      fileId: TARGET_ID,
      node,
      sourceProjection: targetProjection,
      tree: targetTree,
      runtimeOnly: false,
    });
  }
  const draggedId = sourceProjection.nodes.find(
    (node) =>
      node.tag === "div" &&
      (node.dataAttributes["data-agent-native-node-id"] === "moving" ||
        node.textSnippet === draggedText),
  )!.id;
  const targetId = targetProjection.nodes.find(
    (node) => node.dataAttributes["data-agent-native-node-id"] === "target",
  )!.id;
  const updates = new Map<string, string>();
  const selectedLayers: string[][] = [];
  const screenContents = new Map([
    [SOURCE_ID, sourceContent],
    [TARGET_ID, targetContent],
  ]);
  const args: LayerMoveArgs = {
    activeFile: targetFile,
    applyFileContentUpdate: (id, content) => {
      if (options.refuseSource && id === SOURCE_ID)
        return { status: "refused" as const };
      const publication = acceptFixture(id, content);
      updates.set(id, publication.content);
      return publication;
    },
    canEditDesign: true,
    canMoveLayer: () => true,
    codeLayerOwnerByNodeId: owners,
    effectiveCodeLayerState: { lockedIds: new Set(), hiddenIds: new Set() },
    files: [sourceFile, targetFile],
    getFreshActiveContent: () => targetContent,
    getScreenContent: (id) => screenContents.get(id) ?? "",
    handleLayerMoveToScreen: () => {},
    handleScreenLayerMove: () => {},
    recordContentHistoryEntry: () => {},
    recordLocalContentHistoryEntry: () => {},
    remapMotionTracksForClone: () => {},
    runtimeStructureMoveRevisionRef: { current: 0 },
    sendRuntimeLayerMoveSemanticHandoff: () => false,
    setExpandedLayerIds: () => {},
    setRuntimeStructureMoveRequest: () => {},
    setSelectedElement: () => {},
    setSelectedLayerIdsState: (update) =>
      selectedLayers.push(typeof update === "function" ? update([]) : update),
    t: (key) => key,
    viewModeRef: { current: "overview" },
    visualScreenFileIds: new Set(),
  };

  runLayerMove(args, {
    draggedIds: [draggedId],
    targetId,
    placement: "inside",
  });
  return { updates, draggedId, targetId, selectedLayers };
}

afterEach(() => document.body.replaceChildren());

describe("runLayerMove: cross-screen live layout", () => {
  it("moves a class-positioned freeform layer into CSS-authored auto layout flow", () => {
    const sourceContent = `<html><head><style>
.freeform { display:block; position:relative; }
.positioned { position:absolute; left:31px; top:47px; width:60px; height:40px; }
</style></head><body><section class="freeform"><div data-agent-native-node-id="moving" class="positioned" style="position:absolute;left:31px;top:47px">Move</div></section></body></html>`;
    const targetContent = `<html><head><style>.flow-target { display:flex; }</style></head><body><section data-agent-native-node-id="target" class="flow-target"></section></body></html>`;
    mountPreview(sourceContent, SOURCE_ID);
    mountPreview(targetContent, TARGET_ID);

    const { updates } = runCrossScreenMove(sourceContent, targetContent);
    const nextSource = updates.get(SOURCE_ID);
    const nextTarget = updates.get(TARGET_ID);
    expect(nextSource).not.toContain('data-agent-native-node-id="moving"');
    expect(nextTarget).toContain('data-agent-native-node-id="moving"');
    const moved = buildCodeLayerProjection(nextTarget!, {
      source: { kind: "design-file", fileId: TARGET_ID },
    }).nodes.find(
      (node) => node.dataAttributes["data-agent-native-node-id"] === "moving",
    );
    expect(moved?.style.position).toBe("relative !important");
    expect(moved?.style.left).toBe("auto !important");
    expect(moved?.style.top).toBe("auto !important");
  });

  it("preserves an ignored auto-layout child when moving between Screens", () => {
    const sourceContent = `<html><body><section data-agent-native-node-id="source-flow" style="display:flex;position:relative"><div data-agent-native-node-id="moving" style="position:absolute;left:24px;top:32px;width:60px;height:40px">Ignored</div></section></body></html>`;
    const targetContent = `<html><head><style>.flow-target { display:flex; }</style></head><body><section data-agent-native-node-id="target" class="flow-target"></section></body></html>`;
    mountPreview(sourceContent, SOURCE_ID);
    mountPreview(targetContent, TARGET_ID);

    const { updates } = runCrossScreenMove(sourceContent, targetContent);
    const nextTarget = updates.get(TARGET_ID);
    const moved = buildCodeLayerProjection(nextTarget!, {
      source: { kind: "design-file", fileId: TARGET_ID },
    }).nodes.find(
      (node) => node.dataAttributes["data-agent-native-node-id"] === "moving",
    );

    expect(moved?.style.position).toBe("absolute");
    expect(moved?.style.left).toBe("24px");
    expect(moved?.style.top).toBe("32px");
  });

  it("uses publisher-stamped identity for an originally idless source", () => {
    const rawSourceContent = `<html><head><style>
.freeform { display:block; position:relative; }
.positioned { position:absolute; left:31px; top:47px; width:60px; height:40px; }
</style></head><body><section class="freeform"><div class="positioned" style="position:absolute;left:31px;top:47px">Idless</div></section></body></html>`;
    const sourceContent = publishFixture(SOURCE_ID, rawSourceContent);
    const targetContent = publishFixture(
      TARGET_ID,
      `<html><head><style>.flow-target { display:flex; }</style></head><body><section data-agent-native-node-id="target" class="flow-target"></section></body></html>`,
    );
    mountPreview(sourceContent, SOURCE_ID);
    mountPreview(targetContent, TARGET_ID);

    const { updates } = runCrossScreenMove(
      sourceContent,
      targetContent,
      "Idless",
    );
    const nextSource = updates.get(SOURCE_ID);
    const nextTarget = updates.get(TARGET_ID);
    expect(nextSource).not.toContain("Idless");
    expect(nextTarget).toContain("Idless");
    const moved = buildCodeLayerProjection(nextTarget!, {
      source: { kind: "design-file", fileId: TARGET_ID },
    }).nodes.find(
      (node) => node.tag === "div" && node.textSnippet === "Idless",
    );
    expect(moved?.dataAttributes["data-agent-native-node-id"]).toBeTruthy();
    expect(moved?.style.position).toBe("relative !important");
  });

  it("uses exact source paths when pre-move authored ids are duplicated", () => {
    const rawSourceContent = `<html><head><style>
.freeform { display:block; position:relative; }
.positioned { position:absolute; left:31px; top:47px; width:60px; height:40px; }
</style></head><body><section class="freeform"><div id="duplicate" class="positioned" style="position:absolute;left:31px;top:47px">Chosen</div><div id="duplicate" class="positioned" style="position:absolute;left:31px;top:47px">Keep</div></section></body></html>`;
    const sourceContent = publishFixture(SOURCE_ID, rawSourceContent);
    const targetContent = publishFixture(
      TARGET_ID,
      `<html><head><style>.flow-target { display:flex; }</style></head><body><section data-agent-native-node-id="target" class="flow-target"></section></body></html>`,
    );
    mountPreview(sourceContent, SOURCE_ID);
    mountPreview(targetContent, TARGET_ID);

    const { updates } = runCrossScreenMove(
      sourceContent,
      targetContent,
      "Chosen",
    );
    const nextSource = updates.get(SOURCE_ID);
    const nextTarget = updates.get(TARGET_ID);
    expect(nextSource).not.toContain("Chosen");
    expect(nextSource).toContain("Keep");
    expect(nextTarget).toContain("Chosen");
    expect(nextTarget).not.toContain("Keep");
    const moved = buildCodeLayerProjection(nextTarget!, {
      source: { kind: "design-file", fileId: TARGET_ID },
    }).nodes.find(
      (node) => node.tag === "div" && node.classes.includes("positioned"),
    );
    expect(moved?.style.position).toBe("relative !important");
  });

  it("does not select the destination node when source publication is refused", () => {
    const sourceContent = `<html><body><section><div data-agent-native-node-id="moving">Move</div></section></body></html>`;
    const targetContent = `<html><body><section data-agent-native-node-id="target"></section></body></html>`;
    mountPreview(sourceContent, SOURCE_ID);
    mountPreview(targetContent, TARGET_ID);

    const { updates, selectedLayers } = runCrossScreenMove(
      sourceContent,
      targetContent,
      "Move",
      { refuseSource: true },
    );

    expect(updates.has(SOURCE_ID)).toBe(false);
    expect(updates.has(TARGET_ID)).toBe(true);
    expect(selectedLayers).toEqual([]);
  });
});
