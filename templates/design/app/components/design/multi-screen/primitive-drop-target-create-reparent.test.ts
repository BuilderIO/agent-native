// @vitest-environment happy-dom

import { buildCodeLayerProjection } from "@shared/code-layer";
import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";

import { runCreatePrimitive } from "@/pages/design-editor/commands/create-primitive";
import { runOverviewPrimitiveReparent } from "@/pages/design-editor/commands/overview-primitive-reparent";
import {
  getFreshActiveFileContent,
  getFreshScreenContent,
} from "@/pages/design-editor/editor-state";
import { prepareCanonicalSourceContent } from "@/pages/design-editor/source-publication";
import type { DesignFile } from "@/pages/design-editor/types";

import { persistBoardDraftPrimitive } from "./persist-board-draft-primitive";
import { getPrimitiveDropTargetForPoint } from "./primitive-drop-target";
import type {
  CanvasPrimitiveInsert,
  PrimitiveCreateOptions,
  ScreenProjectionNodeIdentity,
} from "./types";

const fileId = "screen-target";
const source = {
  kind: "design-file" as const,
  designId: "design-identity-test",
  fileId,
  filename: "screen-target.html",
};

function acceptCanonicalContent(fileId: string, nextContent: string) {
  const prepared = prepareCanonicalSourceContent(nextContent, {
    fileId,
    fileType: "html",
  });
  return {
    status: "accepted" as const,
    content: prepared.content,
    nodeIdMap: prepared.nodeIdMap,
  };
}

function contentForTargets(options?: { duplicate?: boolean }) {
  const firstId = options?.duplicate ? "duplicate-target" : "target-first";
  const secondId = options?.duplicate ? "duplicate-target" : "target-second";
  return `<!doctype html><html><body>
    <div data-agent-native-node-id="${firstId}" data-origin="first" data-an-primitive="frame" style="position:absolute;left:100px;top:100px;width:180px;height:180px"></div>
    <div data-agent-native-node-id="${secondId}" data-origin="second" data-an-primitive="frame" style="position:absolute;left:300px;top:100px;width:180px;height:180px"></div>
    <div data-agent-native-node-id="background-note" data-origin="background" data-an-primitive="rectangle" style="position:absolute;left:600px;top:100px;width:40px;height:40px"></div>
  </body></html>`;
}

function hitTarget(
  content: string,
  id = fileId,
  filename = source.filename,
  point = { x: 350, y: 150 },
) {
  const targetScreen = {
    id,
    filename,
    content,
    codeLayerSource: { ...source, fileId: id, filename },
  };
  const target = getPrimitiveDropTargetForPoint(
    point,
    null,
    [targetScreen],
    { [id]: { x: 0, y: 0, width: 800, height: 600 } },
    () => ({ width: 800, height: 600 }),
  );
  if (!target) throw new Error("hit test did not return a target");
  const targetIdentity = target.targetIdentity;
  if (!targetIdentity) throw new Error("hit test did not return identity");
  return { targetScreen, target: { ...target, targetIdentity } };
}

function makeCreateArgs(
  content: string,
  fileIdForArgs = fileId,
  filename = source.filename,
) {
  let currentContent = content;
  const file: DesignFile = {
    id: fileIdForArgs,
    filename,
    fileType: "html",
    content,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
  const latestActiveContentRef = { current: content };
  const lastLocalContentRef = { current: content };
  const pendingLocalFileContentsRef = {
    current: new Map<string, { content: string; startedAt: number }>(),
  };
  const queuedSaves: Array<{ fileId: string; content: string }> = [];
  const applyLocalContentUpdate = vi.fn((nextContent: string) => {
    const accepted = acceptCanonicalContent(fileIdForArgs, nextContent);
    currentContent = accepted.content;
    latestActiveContentRef.current = accepted.content;
    lastLocalContentRef.current = accepted.content;
    pendingLocalFileContentsRef.current.set(fileIdForArgs, {
      content: accepted.content,
      startedAt: 1,
    });
    return accepted;
  });
  const recordContentHistoryEntry = vi.fn();
  const fileContentById = new Map([[fileIdForArgs, content]]);
  const getFreshScreenContentForFixture = (screenId: string) =>
    getFreshScreenContent({
      screenId,
      activeFileId: fileIdForArgs,
      freshActiveContentFileId: fileIdForArgs,
      freshActiveContent: getFreshActiveFileContent({
        activeContent: content,
        latestContent: latestActiveContentRef.current,
        lastLocalContent: lastLocalContentRef.current,
      }),
      fileContentById,
      pendingContent:
        pendingLocalFileContentsRef.current.get(screenId)?.content ?? null,
    });
  const args = {
    activeContent: content,
    activeFile: file,
    applyFileContentUpdate: (id: string, nextContent: string) => {
      const accepted = acceptCanonicalContent(id, nextContent);
      currentContent = accepted.content;
      fileContentById.set(id, accepted.content);
      pendingLocalFileContentsRef.current.set(id, {
        content: accepted.content,
        startedAt: 1,
      });
      queuedSaves.push({ fileId: id, content: accepted.content });
      return accepted;
    },
    applyLocalContentUpdate,
    boardFileId: filename === "__board__.html" ? fileIdForArgs : undefined,
    canvasBackground: null,
    canEditDesign: true,
    collabContentFileIdRef: { current: fileIdForArgs },
    collabContentRef: { current: content },
    files: [file],
    getScreenContent: getFreshScreenContentForFixture,
    id: "design-identity-test",
    isSynced: false,
    markPendingLocalFileContent: vi.fn(),
    pendingLocalFileContentsRef,
    pendingTextCreationHistoryRef: { current: null },
    pendingTextEditNodeIdRef: { current: null },
    queryClient: new QueryClient(),
    queueFileContentSave: (id: string, nextContent: string) => {
      queuedSaves.push({ fileId: id, content: nextContent });
    },
    recordContentHistoryEntry,
    runtimeStructureInsertRevisionRef: { current: 0 },
    setRuntimeStructureInsertRequest: vi.fn(),
    t: (key: string) => key,
    viewModeRef: { current: "overview" as const },
    ydoc: null,
  };
  return {
    args,
    file,
    queuedSaves,
    applyLocalContentUpdate,
    recordContentHistoryEntry,
    getFreshScreenContentForFixture,
    latestActiveContentRef,
    get content() {
      return currentContent;
    },
    set content(nextContent: string) {
      currentContent = nextContent;
    },
  };
}

function createDraft() {
  return {
    kind: "rectangle" as const,
    nodeId: "drawn-draft",
    geometry: { x: 350, y: 150, width: 20, height: 20 },
    fill: "#ffffff",
  };
}

function reparentCreatedDraft(
  fixture: ReturnType<typeof makeCreateArgs>,
  sourceNodeId: string,
  targetNodeId: string,
  targetIdentity: ScreenProjectionNodeIdentity,
  preparedTargetNodeId?: string,
  id = fileId,
  boardFileId?: string,
  placement: "before" | "after" | "inside" = "inside",
) {
  runOverviewPrimitiveReparent(
    {
      applyFileContentUpdate: (id, nextContent) => {
        const accepted = acceptCanonicalContent(id, nextContent);
        fixture.content = accepted.content;
        return accepted;
      },
      boardFileId,
      canEditDesign: true,
      getScreenContent: (screenId) =>
        screenId === id
          ? fixture.getFreshScreenContentForFixture(screenId)
          : "",
      recordContentHistoryEntry: () => {},
      setSelectedElement: () => {},
      setSelectedLayerIdsState: () => {},
      t: (key) => key,
    },
    {
      sourceNodeId,
      sourceScreenId: id,
      targetNodeId,
      targetScreenId: id,
      targetIdentity,
      preparedTargetNodeId,
      placement,
    },
  );
}

function expectDraftUnderOrigin(
  content: string,
  expectedOrigin: string,
  id = fileId,
  filename = source.filename,
  draftId = "drawn-draft",
) {
  const projection = buildCodeLayerProjection(content, {
    source: { ...source, fileId: id, filename },
  });
  const draft = projection.nodes.find(
    (node) =>
      node.dataAttributes["data-agent-native-node-id"] === draftId ||
      node.id === draftId,
  );
  const expectedParent = projection.nodes.find(
    (node) => node.dataAttributes["data-origin"] === expectedOrigin,
  );
  expect(draft?.parentId).toBe(expectedParent?.id);
}

function expectDraftAfterOrigin(content: string, origin: string) {
  const projection = buildCodeLayerProjection(content, { source });
  const firstChild = projection.nodes.find(
    (node) => node.dataAttributes["data-origin"] === origin,
  );
  const draft = projection.nodes.find(
    (node) =>
      node.dataAttributes["data-agent-native-node-id"] === "drawn-draft",
  );
  expect(firstChild?.parentId).toBeDefined();
  expect(draft?.parentId).toBe(firstChild?.parentId);
  if (!firstChild || !draft) {
    throw new Error("auto-layout child or draft is missing after reparent");
  }
  const childIndex = projection.nodes.findIndex(
    (node) => node.id === firstChild.id,
  );
  const draftIndex = projection.nodes.findIndex((node) => node.id === draft.id);
  expect(draftIndex).toBe(childIndex + 1);
}

function expectDraftBeforeOrigin(content: string, origin: string) {
  const projection = buildCodeLayerProjection(content, { source });
  const anchor = projection.nodes.find(
    (node) => node.dataAttributes["data-origin"] === origin,
  );
  const draft = projection.nodes.find(
    (node) =>
      node.dataAttributes["data-agent-native-node-id"] === "drawn-draft",
  );
  expect(anchor?.parentId).toBeDefined();
  expect(draft?.parentId).toBe(anchor?.parentId);
  if (!anchor || !draft) {
    throw new Error("auto-layout anchor or draft is missing after reparent");
  }
  const anchorIndex = projection.nodes.findIndex(
    (node) => node.id === anchor.id,
  );
  const draftIndex = projection.nodes.findIndex((node) => node.id === draft.id);
  expect(draftIndex).toBe(anchorIndex - 1);
}

describe("overview draft target identity through create and reparent", () => {
  it("returns the created node id from the non-active accepted projection", () => {
    const fixture = makeCreateArgs(contentForTargets());
    const activeFile: DesignFile = {
      id: "board-other",
      filename: "__board__.html",
      fileType: "html",
      content: "<html><body></body></html>",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    };
    fixture.args.activeFile = activeFile;
    fixture.args.files = [activeFile, fixture.file];
    fixture.args.activeContent = activeFile.content ?? "";

    const created = runCreatePrimitive(fixture.args, fileId, createDraft());
    const acceptedContent = fixture.queuedSaves.find(
      (save) => save.fileId === fileId,
    )?.content;
    expect(acceptedContent).toBeTruthy();
    const acceptedProjection = buildCodeLayerProjection(acceptedContent!, {
      source,
    });
    const acceptedNode = acceptedProjection.nodes.find(
      (node) =>
        node.dataAttributes["data-agent-native-node-id"] === "drawn-draft",
    );
    expect(acceptedNode).toBeDefined();
    expect(created).toBe(acceptedNode!.id);
  });

  it("stamps the exact geometrically hit duplicate before insertion, then reparents to it", () => {
    const initial = contentForTargets({ duplicate: true });
    const { target } = hitTarget(initial);
    const targetNode = target.targetIdentity.projection.nodes.find(
      (node) => node.id === target.targetIdentity.nodeId,
    );
    expect(targetNode?.dataAttributes["data-origin"]).toBe("second");

    const fixture = makeCreateArgs(initial);
    const created = runCreatePrimitive(fixture.args, fileId, createDraft(), {
      reparentTargetIdentity: target.targetIdentity,
    });
    expect(created).toMatchObject({
      nodeId: expect.any(String),
      preparedTargetNodeId: expect.any(String),
    });
    if (typeof created !== "object" || !created) {
      throw new Error("draft creation did not return prepared target identity");
    }
    const createdProjection = buildCodeLayerProjection(fixture.content, {
      source,
    });
    expect(
      createdProjection.nodes.filter(
        (node) =>
          node.dataAttributes["data-agent-native-node-id"] ===
          created.preparedTargetNodeId,
      ),
    ).toHaveLength(1);
    expect(fixture.file.content).toBe(initial);
    expect(fixture.latestActiveContentRef.current).toBe(fixture.content);
    expect(fixture.getFreshScreenContentForFixture(fileId)).toBe(
      fixture.content,
    );
    reparentCreatedDraft(
      fixture,
      created.nodeId,
      created.preparedTargetNodeId,
      created.preparedTargetIdentity,
      created.preparedTargetNodeId,
    );

    expectDraftUnderOrigin(fixture.content, "second");
    expect(fixture.applyLocalContentUpdate).toHaveBeenCalledTimes(1);
  });

  it("keeps the first same-tag duplicate container as the hit target", () => {
    const initial = contentForTargets({ duplicate: true });
    const { target } = hitTarget(initial, fileId, source.filename, {
      x: 150,
      y: 150,
    });
    const targetNode = target.targetIdentity.projection.nodes.find(
      (node) => node.id === target.targetIdentity.nodeId,
    );
    expect(targetNode?.dataAttributes["data-origin"]).toBe("first");
    expect(targetNode?.path).toContain(":nth-of-type(1)");
    const sourceDocument = new DOMParser().parseFromString(
      initial,
      "text/html",
    );
    expect(sourceDocument.querySelectorAll(targetNode?.path ?? "").length).toBe(
      1,
    );

    const fixture = makeCreateArgs(initial);
    const created = runCreatePrimitive(fixture.args, fileId, createDraft(), {
      reparentTargetIdentity: target.targetIdentity,
    });
    if (typeof created !== "object" || !created) {
      throw new Error("first duplicate target identity was not prepared");
    }
    reparentCreatedDraft(
      fixture,
      created.nodeId,
      created.preparedTargetNodeId,
      created.preparedTargetIdentity,
      created.preparedTargetNodeId,
    );
    expectDraftUnderOrigin(fixture.content, "first");
  });

  it("generates the inserted node id before preparing a target when absent", () => {
    const initial = contentForTargets({ duplicate: true });
    const { target } = hitTarget(initial);
    const fixture = makeCreateArgs(initial);
    const created = runCreatePrimitive(
      fixture.args,
      fileId,
      {
        kind: "rectangle",
        geometry: { x: 350, y: 150, width: 20, height: 20 },
        fill: "#ffffff",
      },
      { reparentTargetIdentity: target.targetIdentity },
    );
    expect(created).toMatchObject({
      nodeId: expect.stringMatching(/\S/),
      preparedTargetNodeId: expect.any(String),
    });
    if (typeof created !== "object" || !created) {
      throw new Error("target-identity create did not return node identity");
    }
    const createdProjection = buildCodeLayerProjection(fixture.content, {
      source,
    });
    const createdNode = createdProjection.nodes.find(
      (node) => node.id === created.nodeId,
    );
    expect(createdNode?.dataAttributes["data-agent-native-node-id"]).toMatch(
      /\S/,
    );
    reparentCreatedDraft(
      fixture,
      created.nodeId,
      created.preparedTargetNodeId,
      created.preparedTargetIdentity,
      created.preparedTargetNodeId,
    );
    expectDraftUnderOrigin(
      fixture.content,
      "second",
      fileId,
      source.filename,
      created.nodeId,
    );
  });

  it("preserves the first duplicate auto-layout anchor through draft insertion", () => {
    const initial = `<!doctype html><html><body>
      <div data-agent-native-node-id="row" data-origin="row" data-an-primitive="frame" style="position:absolute;left:100px;top:100px;width:200px;height:80px;display:flex;flex-direction:row;gap:30px">
        <div data-agent-native-node-id="duplicate-child" data-origin="first-child" data-an-primitive="rectangle" style="width:50px;height:50px"></div>
        <div data-agent-native-node-id="duplicate-child" data-origin="second-child" data-an-primitive="rectangle" style="width:50px;height:50px"></div>
      </div>
    </body></html>`;
    const { target } = hitTarget(initial, fileId, source.filename, {
      x: 165,
      y: 140,
    });
    expect(target.placement).toBe("after");
    expect(target.anchorNodeId).toBe("duplicate-child");
    const anchor = target.targetIdentity.projection.nodes.find(
      (node) => node.id === target.targetIdentity.nodeId,
    );
    expect(anchor?.dataAttributes["data-origin"]).toBe("first-child");
    expect(anchor?.path).toContain(":nth-of-type(1)");
    const sourceDocument = new DOMParser().parseFromString(
      initial,
      "text/html",
    );
    expect(sourceDocument.querySelectorAll(anchor?.path ?? "").length).toBe(1);

    const fixture = makeCreateArgs(initial);
    const created = runCreatePrimitive(fixture.args, fileId, createDraft(), {
      reparentTargetIdentity: target.targetIdentity,
    });
    if (typeof created !== "object" || !created) {
      throw new Error("first auto-layout anchor identity was not prepared");
    }
    reparentCreatedDraft(
      fixture,
      created.nodeId,
      created.preparedTargetNodeId,
      created.preparedTargetIdentity,
      created.preparedTargetNodeId,
      fileId,
      undefined,
      target.placement,
    );
    expectDraftAfterOrigin(fixture.content, "first-child");
  });

  it("uses the exact second duplicate auto-layout anchor", () => {
    const initial = `<!doctype html><html><body>
      <div data-agent-native-node-id="row" data-origin="row" data-an-primitive="frame" style="position:absolute;left:100px;top:100px;width:200px;height:80px;display:flex;flex-direction:row;gap:30px">
        <div data-agent-native-node-id="duplicate-child" data-origin="first-child" data-an-primitive="rectangle" style="width:50px;height:50px"></div>
        <div data-agent-native-node-id="duplicate-child" data-origin="second-child" data-an-primitive="rectangle" style="width:50px;height:50px"></div>
      </div>
    </body></html>`;
    const { target } = hitTarget(initial, fileId, source.filename, {
      x: 170,
      y: 140,
    });
    expect(target.placement).toBe("before");
    expect(target.anchorNodeId).toBe("duplicate-child");
    const anchor = target.targetIdentity.projection.nodes.find(
      (node) => node.id === target.targetIdentity.nodeId,
    );
    expect(anchor?.dataAttributes["data-origin"]).toBe("second-child");

    const fixture = makeCreateArgs(initial);
    const created = runCreatePrimitive(fixture.args, fileId, createDraft(), {
      reparentTargetIdentity: target.targetIdentity,
    });
    if (typeof created !== "object" || !created) {
      throw new Error("second auto-layout anchor identity was not prepared");
    }
    reparentCreatedDraft(
      fixture,
      created.nodeId,
      created.preparedTargetNodeId,
      created.preparedTargetIdentity,
      created.preparedTargetNodeId,
      fileId,
      undefined,
      target.placement,
    );
    expectDraftBeforeOrigin(fixture.content, "second-child");
  });

  it("keeps a uniquely authored hit target across an unrelated source edit before creation", () => {
    const initial = contentForTargets();
    const { target } = hitTarget(initial);
    const edited = initial.replace(
      'data-origin="background"',
      'data-origin="background-edited"',
    );
    const fixture = makeCreateArgs(edited);
    const created = runCreatePrimitive(fixture.args, fileId, createDraft(), {
      reparentTargetIdentity: target.targetIdentity,
    });
    expect(created).toMatchObject({ preparedTargetNodeId: "target-second" });
    if (typeof created !== "object" || !created) {
      throw new Error("draft creation did not retain unique target");
    }
    reparentCreatedDraft(
      fixture,
      created.nodeId,
      created.preparedTargetNodeId,
      created.preparedTargetIdentity,
      created.preparedTargetNodeId,
    );
    expectDraftUnderOrigin(fixture.content, "second");
  });

  it("refuses a stale ambiguous target before writing the draft source", () => {
    const initial = contentForTargets({ duplicate: true });
    const { target } = hitTarget(initial);
    const edited = initial.replace(
      'data-origin="background"',
      'data-origin="background-edited"',
    );
    const fixture = makeCreateArgs(edited);
    const created = runCreatePrimitive(fixture.args, fileId, createDraft(), {
      reparentTargetIdentity: target.targetIdentity,
    });

    expect(created).toBe(false);
    expect(fixture.applyLocalContentUpdate).not.toHaveBeenCalled();
    expect(fixture.recordContentHistoryEntry).not.toHaveBeenCalled();
    expect(fixture.content).toBe(edited);
  });

  it("retains the Board file namespace for a Board-surface projection", () => {
    const boardId = "board-file";
    const boardSource = {
      kind: "design-file" as const,
      designId: "design-identity-test",
      fileId: boardId,
      filename: "__board__.html",
    };
    const boardContent = contentForTargets({ duplicate: true });
    const { target } = hitTarget(boardContent, boardId, "__board__.html");
    expect(target.targetIdentity.projection.source).toEqual(boardSource);
    const fixture = makeCreateArgs(boardContent, boardId, "__board__.html");
    const primitive = createDraft();
    const boardCreate = vi.fn(
      (
        nextPrimitive: CanvasPrimitiveInsert,
        options?: PrimitiveCreateOptions,
      ) =>
        runCreatePrimitive(fixture.args, boardId, nextPrimitive, {
          reparentTargetIdentity: options?.reparentTargetIdentity,
        }),
    );
    const created = persistBoardDraftPrimitive({
      boardFileId: boardId,
      draftId: primitive.nodeId ?? "drawn-draft",
      primitive,
      handler: boardCreate,
      options: { reparentTargetIdentity: target.targetIdentity },
    });
    expect(boardCreate).toHaveBeenCalledWith(primitive, {
      reparentTargetIdentity: target.targetIdentity,
    });
    expect(created).toMatchObject({
      frameId: boardId,
      preparedTargetNodeId: expect.any(String),
      preparedTargetIdentity: { projection: { source: boardSource } },
    });
    if (!created?.preparedTargetNodeId || !created.preparedTargetIdentity) {
      throw new Error("Board draft creation did not retain source identity");
    }
    reparentCreatedDraft(
      fixture,
      created.nodeId,
      created.preparedTargetNodeId,
      created.preparedTargetIdentity,
      created.preparedTargetNodeId,
      boardId,
      boardId,
    );
    expectDraftUnderOrigin(
      fixture.content,
      "second",
      boardId,
      "__board__.html",
    );
  });

  it("keeps a geometrically hit block container when an earlier duplicate is auto-layout", () => {
    const initial = `<!doctype html><html><body>
      <div data-agent-native-node-id="duplicate-frame" data-origin="first-flex" data-an-primitive="frame" style="position:absolute;left:100px;top:100px;width:190px;height:100px;display:flex;flex-direction:row;gap:10px">
        <div data-agent-native-node-id="first-a" data-an-primitive="rectangle" style="width:50px;height:50px"></div>
        <div data-agent-native-node-id="first-b" data-an-primitive="rectangle" style="width:50px;height:50px"></div>
      </div>
      <div data-agent-native-node-id="duplicate-frame" data-origin="second-block" data-an-primitive="frame" style="position:absolute;left:300px;top:100px;width:190px;height:100px;display:block">
        <div data-agent-native-node-id="second-child" data-an-primitive="rectangle" style="position:absolute;left:10px;top:10px;width:50px;height:50px"></div>
      </div>
    </body></html>`;
    const { target } = hitTarget(initial, fileId, source.filename, {
      x: 450,
      y: 130,
    });
    const hitContainer = target.targetIdentity.projection.nodes.find(
      (node) => node.id === target.targetIdentity.nodeId,
    );
    expect(hitContainer?.dataAttributes["data-origin"]).toBe("second-block");
    expect(target.placement).toBeUndefined();
    expect(target.anchorNodeId).toBeUndefined();

    const fixture = makeCreateArgs(initial);
    const created = runCreatePrimitive(fixture.args, fileId, createDraft(), {
      reparentTargetIdentity: target.targetIdentity,
    });
    if (typeof created !== "object" || !created) {
      throw new Error("second block target was not prepared for creation");
    }
    reparentCreatedDraft(
      fixture,
      created.nodeId,
      created.preparedTargetNodeId,
      created.preparedTargetIdentity,
      created.preparedTargetNodeId,
    );
    expectDraftUnderOrigin(fixture.content, "second-block");
  });

  it("resolves the second duplicate auto-layout container and its exact insertion anchor", () => {
    const initial = `<!doctype html><html><body>
      <div data-agent-native-node-id="duplicate-frame" data-origin="first-block" data-an-primitive="frame" style="position:absolute;left:100px;top:100px;width:190px;height:100px;display:block">
        <div data-agent-native-node-id="first-child" data-an-primitive="rectangle" style="position:absolute;left:10px;top:10px;width:50px;height:50px"></div>
      </div>
      <div data-agent-native-node-id="duplicate-frame" data-origin="second-flex" data-an-primitive="frame" style="position:absolute;left:300px;top:100px;width:190px;height:100px;display:flex;flex-direction:row;gap:10px">
        <div data-agent-native-node-id="second-a" data-origin="second-a" data-an-primitive="rectangle" style="width:50px;height:50px"></div>
        <div data-agent-native-node-id="second-b" data-origin="second-b" data-an-primitive="rectangle" style="width:50px;height:50px"></div>
      </div>
    </body></html>`;
    const { target } = hitTarget(initial, fileId, source.filename, {
      x: 355,
      y: 130,
    });
    expect(target.placement).toBe("after");
    expect(target.anchorNodeId).toBe("second-a");
    const anchor = target.targetIdentity.projection.nodes.find(
      (node) => node.id === target.targetIdentity.nodeId,
    );
    expect(anchor?.dataAttributes["data-origin"]).toBe("second-a");

    const fixture = makeCreateArgs(initial);
    const created = runCreatePrimitive(fixture.args, fileId, createDraft(), {
      reparentTargetIdentity: target.targetIdentity,
    });
    if (typeof created !== "object" || !created) {
      throw new Error("second flex anchor was not prepared for creation");
    }
    reparentCreatedDraft(
      fixture,
      created.nodeId,
      created.preparedTargetNodeId,
      created.preparedTargetIdentity,
      created.preparedTargetNodeId,
      fileId,
      undefined,
      "after",
    );
    expectDraftAfterOrigin(fixture.content, "second-a");
  });
});
