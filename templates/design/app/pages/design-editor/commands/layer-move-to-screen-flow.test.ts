// @vitest-environment happy-dom

const shaderLocks = vi.hoisted(() => ({ fileIds: new Set<string>() }));

vi.mock("@/components/design/inspector/GlslShaderPanel", () => ({
  isShaderWriteInFlight: (fileId: string) => shaderLocks.fileIds.has(fileId),
}));

import {
  buildCodeLayerProjection,
  buildCodeLayerTree,
} from "@shared/code-layer";
import { afterEach, describe, expect, it, vi } from "vitest";

import { prepareCanonicalSourceContent } from "@/pages/design-editor/source-publication";
import type { DesignFile } from "@/pages/design-editor/types";

import {
  runLayerMoveToScreen,
  type LayerMoveToScreenArgs,
} from "./layer-move-to-screen";

const SOURCE_ID = "source.html";
const TARGET_ID = "target.html";

function mountPreview(
  content: string,
  fileId: string,
  isBoard = false,
): Document {
  const iframe = document.createElement("iframe");
  if (isBoard) {
    iframe.setAttribute("data-design-preview-iframe", "");
    const boardSurface = document.createElement("div");
    boardSurface.setAttribute("data-board-surface-layer", "");
    boardSurface.append(iframe);
    document.body.append(boardSurface);
  } else {
    iframe.setAttribute("data-screen-iframe-id", fileId);
    document.body.append(iframe);
  }
  const preview = iframe.contentDocument!;
  preview.open();
  preview.write(content);
  preview.close();
  return preview;
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

afterEach(() => {
  shaderLocks.fileIds.clear();
  document.body.replaceChildren();
});

it("does not mutate source, destination, or history while either moved file is shader-locked", () => {
  const sourceContent = `<html><body><div data-agent-native-node-id="moving" style="position:absolute;left:20px;top:20px;width:40px;height:40px">Move</div></body></html>`;
  const targetContent = `<html><body><main data-agent-native-node-id="target"></main></body></html>`;
  const sourceFile = file(SOURCE_ID, sourceContent);
  const targetFile = file(TARGET_ID, targetContent);
  const sourceProjection = buildCodeLayerProjection(sourceContent, {
    source: { kind: "design-file", fileId: SOURCE_ID },
  });
  const targetProjection = buildCodeLayerProjection(targetContent, {
    source: { kind: "design-file", fileId: TARGET_ID },
  });
  const sourceTree = buildCodeLayerTree(sourceProjection);
  const moving = sourceProjection.nodes.find(
    (node) => node.dataAttributes["data-agent-native-node-id"] === "moving",
  )!;
  const writes = vi.fn((id: string, content: string) =>
    acceptFixture(id, content),
  );
  const history = vi.fn();
  mountPreview(sourceContent, SOURCE_ID);
  mountPreview(targetContent, TARGET_ID);
  shaderLocks.fileIds.add(TARGET_ID);

  runLayerMoveToScreen(
    {
      activeFile: sourceFile,
      applyFileContentUpdate: writes,
      boardFileId: undefined,
      codeLayerOwnerByNodeId: new Map([
        [
          moving.id,
          {
            fileId: SOURCE_ID,
            node: moving,
            sourceProjection,
            tree: sourceTree,
            runtimeOnly: false,
          },
        ],
      ]),
      effectiveCodeLayerState: { lockedIds: new Set(), hiddenIds: new Set() },
      files: [sourceFile, targetFile],
      getFreshActiveContent: () => sourceContent,
      getScreenContent: (id) =>
        id === SOURCE_ID ? sourceContent : targetContent,
      recordContentHistoryEntry: history,
      recordLocalContentHistoryEntry: history,
      runtimeStructureInsertRevisionRef: { current: 0 },
      setExpandedLayerIds: vi.fn(),
      setRuntimeStructureInsertRequest: vi.fn(),
      setSelectedElement: vi.fn(),
      setSelectedLayerIdsState: vi.fn(),
      t: (key) => key,
      viewModeRef: { current: "overview" },
    },
    {
      draggedIds: [moving.id],
      targetId: targetProjection.nodes[0]!.id,
      placement: "inside",
    },
    TARGET_ID,
  );

  expect(writes).not.toHaveBeenCalled();
  expect(history).not.toHaveBeenCalled();
});

function moveBoardLayerIntoLiveScreenBody(
  sourceContent: string,
  liveScreenHtml: string,
) {
  const liveUrl = "http://localhost:8210/dashboard";
  const sourceFile = file(SOURCE_ID, sourceContent);
  const targetFile = file(TARGET_ID, liveUrl);
  const sourceProjection = buildCodeLayerProjection(sourceContent, {
    source: { kind: "design-file", fileId: SOURCE_ID },
  });
  const sourceTree = buildCodeLayerTree(sourceProjection);
  const moving = sourceProjection.nodes.find(
    (node) => node.dataAttributes["data-agent-native-node-id"] === "moving",
  )!;
  const ownerMap = new Map([
    [
      moving.id,
      {
        fileId: SOURCE_ID,
        node: moving,
        sourceProjection,
        tree: sourceTree,
        runtimeOnly: false,
      },
    ],
  ]);
  const writes = new Map<string, string>();
  let runtimeInsertHtml: string | null = null;
  let runtimeInsertScreenId: string | null = null;
  const sourceDocument = mountPreview(sourceContent, SOURCE_ID, true);
  const targetDocument = mountPreview(liveScreenHtml, TARGET_ID);
  const args: LayerMoveToScreenArgs = {
    activeFile: sourceFile,
    applyFileContentUpdate: (id, content) => {
      const publication = acceptFixture(id, content);
      writes.set(id, publication.content);
      return publication;
    },
    boardFileId: SOURCE_ID,
    codeLayerOwnerByNodeId: ownerMap,
    effectiveCodeLayerState: { lockedIds: new Set(), hiddenIds: new Set() },
    files: [sourceFile, targetFile],
    getFreshActiveContent: () => sourceContent,
    getScreenContent: (id) => (id === TARGET_ID ? liveUrl : sourceContent),
    recordContentHistoryEntry: () => {},
    recordLocalContentHistoryEntry: () => {},
    runtimeStructureInsertRevisionRef: { current: 0 },
    setExpandedLayerIds: () => {},
    setRuntimeStructureInsertRequest: (request) => {
      if (typeof request !== "function" && request) {
        runtimeInsertHtml = request.html;
        runtimeInsertScreenId = request.screenId;
      }
    },
    setSelectedElement: () => {},
    setSelectedLayerIdsState: () => {},
    t: (key) => key,
    viewModeRef: { current: "overview" },
  };
  runLayerMoveToScreen(
    args,
    { draggedIds: [moving.id], targetId: TARGET_ID, placement: "inside" },
    TARGET_ID,
  );

  const inserted = runtimeInsertHtml
    ? (new DOMParser()
        .parseFromString(
          `<template>${runtimeInsertHtml}</template>`,
          "text/html",
        )
        .querySelector("template")?.content.firstElementChild ?? null)
    : null;
  if (inserted)
    targetDocument.body.append(targetDocument.importNode(inserted, true));
  return {
    inserted: targetDocument.body.querySelector(
      '[data-agent-native-node-id="moving"]',
    ),
    liveUrl,
    runtimeInsertScreenId,
    sourceDocument,
    targetDocument,
    writes,
  };
}

describe("runLayerMoveToScreen: live body layout", () => {
  it("normalizes a class-positioned layer when the destination body is auto layout", () => {
    const sourceContent = `<html><head><style>
.freeform { display:block; position:relative; }
.positioned { position:absolute; left:31px; top:47px; width:60px; height:40px; }
</style></head><body><section class="freeform"><div data-agent-native-node-id="moving" class="positioned">Move</div></section></body></html>`;
    const targetContent = `<html><head><style>body { display:flex; gap:12px; }</style></head><body></body></html>`;
    const sourceFile = file(SOURCE_ID, sourceContent);
    const targetFile = file(TARGET_ID, targetContent);
    const sourceProjection = buildCodeLayerProjection(sourceContent, {
      source: { kind: "design-file", fileId: SOURCE_ID },
    });
    const sourceTree = buildCodeLayerTree(sourceProjection);
    const moving = sourceProjection.nodes.find(
      (node) => node.dataAttributes["data-agent-native-node-id"] === "moving",
    )!;
    const ownerMap = new Map([
      [
        moving.id,
        {
          fileId: SOURCE_ID,
          node: moving,
          sourceProjection,
          tree: sourceTree,
          runtimeOnly: false,
        },
      ],
    ]);
    const updates = new Map<string, string>();
    const contentById = new Map([
      [SOURCE_ID, sourceContent],
      [TARGET_ID, targetContent],
    ]);
    mountPreview(sourceContent, SOURCE_ID);
    mountPreview(targetContent, TARGET_ID);

    const args: LayerMoveToScreenArgs = {
      activeBreakpointWidthState: undefined,
      activeFile: sourceFile,
      applyFileContentUpdate: (id, content) => {
        const publication = acceptFixture(id, content);
        updates.set(id, publication.content);
        return publication;
      },
      boardFileId: undefined,
      codeLayerOwnerByNodeId: ownerMap,
      effectiveCodeLayerState: { lockedIds: new Set(), hiddenIds: new Set() },
      files: [sourceFile, targetFile],
      getFreshActiveContent: () => sourceContent,
      getScreenContent: (id) => contentById.get(id) ?? "",
      recordContentHistoryEntry: () => {},
      recordLocalContentHistoryEntry: () => {},
      runtimeStructureInsertRevisionRef: { current: 0 },
      setExpandedLayerIds: () => {},
      setRuntimeStructureInsertRequest: () => {},
      setSelectedElement: () => {},
      setSelectedLayerIdsState: () => {},
      t: (key) => key,
      viewModeRef: { current: "overview" },
    };

    runLayerMoveToScreen(
      args,
      { draggedIds: [moving.id], targetId: TARGET_ID, placement: "inside" },
      TARGET_ID,
    );

    const nextTarget = updates.get(TARGET_ID);
    expect(nextTarget).toBeTruthy();
    const moved = buildCodeLayerProjection(nextTarget!, {
      source: { kind: "design-file", fileId: TARGET_ID },
    }).nodes.find(
      (node) => node.dataAttributes["data-agent-native-node-id"] === "moving",
    );
    expect(moved?.style.position).toBe("relative !important");
    expect(moved?.style.left).toBe("auto !important");
    expect(moved?.style.top).toBe("auto !important");
  });

  it("moves a legacy idless source after canonical publication updates the live iframe", () => {
    const rawSourceContent = `<html><head><style>
.freeform { display:block; position:relative; }
.positioned { position:absolute; left:31px; top:47px; width:60px; height:40px; }
</style></head><body><section class="freeform"><div class="positioned" style="position:absolute;left:31px;top:47px">Append idless</div></section></body></html>`;
    const sourceContent = acceptFixture(SOURCE_ID, rawSourceContent).content;
    const targetContent = `<html><head><style>body { display:flex; gap:12px; }</style></head><body></body></html>`;
    const sourceFile = file(SOURCE_ID, sourceContent);
    const targetFile = file(TARGET_ID, targetContent);
    const sourceProjection = buildCodeLayerProjection(sourceContent, {
      source: { kind: "design-file", fileId: SOURCE_ID },
    });
    const sourceTree = buildCodeLayerTree(sourceProjection);
    const moving = sourceProjection.nodes.find(
      (node) => node.tag === "div" && node.textSnippet === "Append idless",
    )!;
    const ownerMap = new Map([
      [
        moving.id,
        {
          fileId: SOURCE_ID,
          node: moving,
          sourceProjection,
          tree: sourceTree,
          runtimeOnly: false,
        },
      ],
    ]);
    const updates = new Map<string, string>();
    const contentById = new Map([
      [SOURCE_ID, sourceContent],
      [TARGET_ID, targetContent],
    ]);
    mountPreview(sourceContent, SOURCE_ID);
    mountPreview(targetContent, TARGET_ID);

    const args: LayerMoveToScreenArgs = {
      activeBreakpointWidthState: undefined,
      activeFile: sourceFile,
      applyFileContentUpdate: (id, content) => {
        const publication = acceptFixture(id, content);
        updates.set(id, publication.content);
        return publication;
      },
      boardFileId: undefined,
      codeLayerOwnerByNodeId: ownerMap,
      effectiveCodeLayerState: { lockedIds: new Set(), hiddenIds: new Set() },
      files: [sourceFile, targetFile],
      getFreshActiveContent: () => sourceContent,
      getScreenContent: (id) => contentById.get(id) ?? "",
      overviewScreens: undefined,
      recordContentHistoryEntry: () => {},
      recordLocalContentHistoryEntry: () => {},
      runtimeStructureInsertRevisionRef: { current: 0 },
      setExpandedLayerIds: () => {},
      setRuntimeStructureInsertRequest: () => {},
      setSelectedElement: () => {},
      setSelectedLayerIdsState: () => {},
      t: (key) => key,
      viewModeRef: { current: "overview" },
    };

    runLayerMoveToScreen(
      args,
      { draggedIds: [moving.id], targetId: TARGET_ID, placement: "inside" },
      TARGET_ID,
    );

    const nextSource = updates.get(SOURCE_ID);
    const nextTarget = updates.get(TARGET_ID);
    expect(nextSource).not.toContain("Append idless");
    expect(nextTarget).toContain("Append idless");
    const moved = buildCodeLayerProjection(nextTarget!, {
      source: { kind: "design-file", fileId: TARGET_ID },
    }).nodes.find(
      (node) => node.tag === "div" && node.textSnippet === "Append idless",
    );
    expect(moved?.dataAttributes["data-agent-native-node-id"]).toBeTruthy();
    expect(moved?.style.position).toBe("relative !important");
  });

  it("normalizes a freeform absolute layer inserted into a live flex body", () => {
    const sourceContent = `<html><head><style>
.freeform { display:block; position:relative; }
.positioned { position:absolute; left:31px; top:47px; width:60px; height:40px; }
.nested-absolute { position:absolute; right:4px; bottom:5px; width:8px; height:8px; }
</style></head><body><section class="freeform"><div data-agent-native-node-id="moving" class="positioned"><span data-agent-native-node-id="nested" class="nested-absolute">Nested</span></div></section></body></html>`;
    const liveScreenHtml = `<html><head><style>
body { display:flex; gap:12px; }
.positioned { position:absolute; }
.nested-absolute { position:absolute; }
</style></head><body></body></html>`;
    const result = moveBoardLayerIntoLiveScreenBody(
      sourceContent,
      liveScreenHtml,
    );

    const source = result.sourceDocument.querySelector(
      '[data-agent-native-node-id="moving"]',
    )!;
    const sourceParent = source.parentElement!;
    const destinationBody = result.targetDocument.body;
    const inserted = result.inserted!;
    const nested = inserted.querySelector(
      '[data-agent-native-node-id="nested"]',
    )!;
    const targetWindow = result.targetDocument.defaultView!;
    const sourceWindow = result.sourceDocument.defaultView!;
    expect(sourceWindow.getComputedStyle(source).position).toBe("absolute");
    expect(sourceWindow.getComputedStyle(sourceParent).display).toBe("block");
    expect(targetWindow.getComputedStyle(destinationBody).display).toBe("flex");
    expect(targetWindow.getComputedStyle(inserted).position).toBe("relative");
    expect(targetWindow.getComputedStyle(nested).position).toBe("absolute");
    expect(nested.parentElement).toBe(inserted);
    expect(inserted.getAttribute("data-agent-native-node-id")).toBe("moving");
    expect(nested.getAttribute("data-agent-native-node-id")).toBe("nested");
    expect(result.runtimeInsertScreenId).toBe(TARGET_ID);
    expect(result.writes.size).toBe(0);
    expect(result.liveUrl).toBe("http://localhost:8210/dashboard");
  });

  it("keeps an ignored auto-layout child absolute when inserted into another live auto-layout body", () => {
    const sourceContent = `<html><head><style>.source-auto { display:flex; }</style></head><body><section class="source-auto"><div data-agent-native-node-id="moving" style="position:absolute;left:31px;top:47px;width:60px;height:40px">Move</div></section></body></html>`;
    const liveScreenHtml = `<html><head><style>body { display:grid; }</style></head><body></body></html>`;
    const result = moveBoardLayerIntoLiveScreenBody(
      sourceContent,
      liveScreenHtml,
    );

    expect(
      result.targetDocument.defaultView!.getComputedStyle(
        result.targetDocument.body,
      ).display,
    ).toBe("grid");
    expect(
      result.targetDocument.defaultView!.getComputedStyle(result.inserted!)
        .position,
    ).toBe("absolute");
    expect(result.writes.size).toBe(0);
    expect(result.liveUrl).toBe("http://localhost:8210/dashboard");
  });
});
