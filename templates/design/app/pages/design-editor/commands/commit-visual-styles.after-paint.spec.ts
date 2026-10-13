import { buildCodeLayerProjection } from "@shared/code-layer";
import { afterEach, expect, it, vi } from "vitest";
import * as Y from "yjs";

import type { ElementInfo } from "@/components/design/types";
import {
  runCommitVisualStyles,
  type CommitVisualStylesArgs,
} from "@/pages/design-editor/commands/commit-visual-styles";
import { flushCommitsAfterPaint } from "@/pages/design-editor/commit-after-paint";

const ref = <T>(current: T) => ({ current });
const fileId = "screen-1";
const content =
  '<html><body><h1 id="target" style="color: red">Title</h1></body></html>';
const testDocs: Y.Doc[] = [];

function createDoc(initialContent: string): Y.Doc {
  const ydoc = new Y.Doc();
  ydoc.getText("content").insert(0, initialContent);
  testDocs.push(ydoc);
  return ydoc;
}

function commitArgs(
  overrides: Partial<CommitVisualStylesArgs> = {},
): CommitVisualStylesArgs {
  return {
    activeBreakpointUpperBoundPx: null,
    activeBreakpointWidthStateRef: ref<number | undefined>(undefined),
    activeCanvasSourceType: "inline",
    activeCodeLayerProjection: buildCodeLayerProjection(content, {
      source: { kind: "design-file", fileId },
    }),
    activeFile: {
      id: fileId,
      filename: "index.html",
      fileType: "html",
      content,
      createdAt: "2026-09-30T00:00:00.000Z",
      updatedAt: "2026-09-30T00:00:00.000Z",
    },
    activeFileIdRef: ref<string | null>(fileId),
    currentYDocRef: ref<Y.Doc | null>(null),
    activeProjectionContent: content,
    canApplyContentEdit: () => true,
    canEditDesign: true,
    commitVisualStyles: vi.fn(),
    getScreenContent: () => content,
    isSynced: false,
    lastDuplicateTransformRef: ref(null),
    lastLocalContentRef: ref<string | null>(content),
    latestActiveContentRef: ref<string | null>(content),
    liveScreenSnapshotsById: {},
    onNoRenderedBox: vi.fn(),
    queueFileContentSave: vi.fn(),
    recordContentHistoryEntry: vi.fn(),
    recordLocalContentHistoryChangeFallback: vi.fn(),
    recordLocalContentHistoryEntry: vi.fn(),
    recordPendingVisualStyleEdit: vi.fn(),
    replacePreviewContent: vi.fn(() => "applied" as const),
    responsiveEditScopeRef: ref("cascade-smaller"),
    selectedElement: null,
    selectedElementRef: ref<ElementInfo | null>(null),
    setCollabContent: vi.fn(),
    setCollabContentFileId: vi.fn(),
    setContentRenderRevision: vi.fn(),
    setPatchProof: vi.fn(),
    setSelectedElement: vi.fn(),
    setSelectedLayerIdsState: vi.fn(),
    suppressContentHistoryRef: ref(false),
    t: (key: string) => key,
    undoManagerRef: ref(null),
    updateLiveScreenSnapshotContent: vi.fn(() => false),
    upsertMotionKeyframesFromStyles: vi.fn(),
    viewModeRef: ref("single"),
    ydoc: null,
    ...overrides,
  };
}

afterEach(() => {
  flushCommitsAfterPaint();
  for (const ydoc of testDocs.splice(0)) ydoc.destroy();
  vi.unstubAllGlobals();
});

it("shows the runtime style immediately and rewrites the source after paint", () => {
  const sendStyle = vi.fn();
  vi.stubGlobal("window", { __designCanvasSendStyle: sendStyle });
  const args = commitArgs();

  runCommitVisualStyles(args, "#target", { color: "rgb(0, 128, 0)" });

  expect(sendStyle).toHaveBeenCalledWith(
    "#target",
    "color",
    "rgb(0, 128, 0)",
    expect.anything(),
  );
  expect(args.queueFileContentSave).not.toHaveBeenCalled();

  flushCommitsAfterPaint();

  expect(args.queueFileContentSave).toHaveBeenCalledOnce();
  expect(vi.mocked(args.queueFileContentSave).mock.calls[0]![1]).toContain(
    "rgb(0, 128, 0)",
  );
  expect(args.setSelectedElement).toHaveBeenCalledOnce();
});

it("leaves a selection made before the commit landed alone", () => {
  vi.stubGlobal("window", { __designCanvasSendStyle: vi.fn() });
  const selectedElementRef = ref<ElementInfo | null>(null);
  const args = commitArgs({ selectedElementRef });

  runCommitVisualStyles(args, "#target", { color: "rgb(0, 128, 0)" });
  selectedElementRef.current = { selector: "#other" } as ElementInfo;
  flushCommitsAfterPaint();

  expect(args.queueFileContentSave).toHaveBeenCalledOnce();
  expect(args.setSelectedElement).not.toHaveBeenCalled();
  expect(args.setSelectedLayerIdsState).not.toHaveBeenCalled();
});

it("refuses to restyle by selector when the screen changed before the write", () => {
  vi.stubGlobal("window", { __designCanvasSendStyle: vi.fn() });
  const resolvedContent =
    '<html><body><h1 data-agent-native-node-id="an-first">First</h1></body></html>';
  const editedContent =
    '<html><body><h1 data-agent-native-node-id="an-second">Second</h1></body></html>';
  let currentContent = resolvedContent;
  const args = commitArgs({
    activeCodeLayerProjection: buildCodeLayerProjection(resolvedContent, {
      source: { kind: "design-file", fileId },
    }),
    activeProjectionContent: resolvedContent,
    getScreenContent: () => currentContent,
  });

  runCommitVisualStyles(args, "body > h1", { color: "rgb(0, 128, 0)" });
  currentContent = editedContent;
  flushCommitsAfterPaint();

  expect(args.queueFileContentSave).not.toHaveBeenCalled();
});

function replaceYText(ydoc: Y.Doc, content: string) {
  const ytext = ydoc.getText("content");
  ydoc.transact(() => {
    ytext.delete(0, ytext.length);
    ytext.insert(0, content);
  });
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

it("publishes an async image fill only after the source save is accepted", async () => {
  const ydoc = createDoc(content);
  const save = deferred<"persisted" | "conflict">();
  const sendStyle = vi.fn();
  vi.stubGlobal("window", { __designCanvasSendStyle: sendStyle });
  let currentContent = content;
  const replacePreviewContent = vi.fn(() => "applied" as const);
  const recordLocalContentHistoryEntry = vi.fn();
  let acceptedContent = content;
  const queueFileContentSave = vi.fn<
    CommitVisualStylesArgs["queueFileContentSave"]
  >((_fileId, _nextContent, options) =>
    save.promise.then((result) => {
      if (result === "persisted") options.onPersistedContent?.(acceptedContent);
      return result;
    }),
  );
  const latestActiveContentRef = ref<string | null>(content);
  const lastLocalContentRef = ref<string | null>(content);
  const args = commitArgs({
    getScreenContent: () => currentContent,
    isSynced: true,
    latestActiveContentRef,
    lastLocalContentRef,
    queueFileContentSave,
    recordLocalContentHistoryEntry,
    replacePreviewContent,
    currentYDocRef: ref(ydoc),
    ydoc,
  });

  runCommitVisualStyles(
    args,
    "#target",
    { backgroundImage: 'url("https://assets.test/upload.png")' },
    { requirePersistedSourceAcceptance: true },
  );
  flushCommitsAfterPaint();

  expect(queueFileContentSave).toHaveBeenCalledOnce();
  expect(queueFileContentSave.mock.calls[0]?.[1]).toContain(
    "https://assets.test/upload.png",
  );
  expect(queueFileContentSave.mock.calls[0]?.[2]).toMatchObject({
    immediate: true,
    syncCollab: false,
    expectedVersionHash: expect.any(String),
  });
  expect(ydoc.getText("content").toString()).toBe(content);
  expect(sendStyle).not.toHaveBeenCalled();
  expect(recordLocalContentHistoryEntry).not.toHaveBeenCalled();
  expect(replacePreviewContent).not.toHaveBeenCalled();
  expect(latestActiveContentRef.current).toBe(content);
  expect(lastLocalContentRef.current).toBe(content);

  acceptedContent = content
    .replace("Title", "Remote title")
    .replace(
      "color: red",
      'color: red; background-image: url("https://assets.test/upload.png")',
    );
  save.resolve("persisted");
  await expect(
    Promise.resolve(queueFileContentSave.mock.results[0]!.value),
  ).resolves.toBe("persisted");

  expect(ydoc.getText("content").toString()).toBe(acceptedContent);
  expect(latestActiveContentRef.current).toBe(acceptedContent);
  expect(lastLocalContentRef.current).toBe(acceptedContent);
  expect(recordLocalContentHistoryEntry).toHaveBeenCalledOnce();
  expect(replacePreviewContent).toHaveBeenCalledWith(
    acceptedContent,
    "#target",
    { forceFullDocument: true },
  );
  expect(sendStyle).not.toHaveBeenCalled();
});

it("saves a captured Screen A upload after switching to B without publishing into B", async () => {
  const screenBId = "screen-2";
  const screenBContent =
    '<html><body><h1 id="target" style="color: blue">Screen B</h1></body></html>';
  const screenBDoc = createDoc(screenBContent);
  const save = deferred<"persisted" | "conflict">();
  vi.stubGlobal("window", { __designCanvasSendStyle: vi.fn() });
  const replacePreviewContent = vi.fn(() => "applied" as const);
  const recordLocalContentHistoryEntry = vi.fn();
  const setCollabContent = vi.fn();
  const setCollabContentFileId = vi.fn();
  const latestActiveContentRef = ref<string | null>(screenBContent);
  const lastLocalContentRef = ref<string | null>(screenBContent);
  const activeFileIdRef = ref<string | null>(screenBId);
  const queueFileContentSave = vi.fn<
    CommitVisualStylesArgs["queueFileContentSave"]
  >((_fileId, _nextContent, options) =>
    save.promise.then((result) => {
      if (result === "persisted") {
        options.onPersistedContent?.(
          content.replace(
            "color: red",
            'color: red; background-image: url("https://assets.test/upload.png")',
          ),
        );
      }
      return result;
    }),
  );
  const args = commitArgs({
    activeFileIdRef,
    currentYDocRef: ref(screenBDoc),
    getScreenContent: (requestedFileId) =>
      requestedFileId === screenBId ? screenBContent : content,
    latestActiveContentRef,
    lastLocalContentRef,
    queueFileContentSave,
    recordLocalContentHistoryEntry,
    replacePreviewContent,
    setCollabContent,
    setCollabContentFileId,
    ydoc: screenBDoc,
    isSynced: true,
  });

  runCommitVisualStyles(
    args,
    "#target",
    { backgroundImage: 'url("https://assets.test/upload.png")' },
    { requirePersistedSourceAcceptance: true },
  );
  flushCommitsAfterPaint();

  expect(queueFileContentSave).toHaveBeenCalledOnce();
  expect(queueFileContentSave.mock.calls[0]?.[0]).toBe(fileId);
  expect(queueFileContentSave.mock.calls[0]?.[1]).toContain(
    "https://assets.test/upload.png",
  );
  expect(args.setPatchProof).not.toHaveBeenCalled();

  save.resolve("persisted");
  await expect(
    Promise.resolve(queueFileContentSave.mock.results[0]!.value),
  ).resolves.toBe("persisted");

  expect(screenBDoc.getText("content").toString()).toBe(screenBContent);
  expect(latestActiveContentRef.current).toBe(screenBContent);
  expect(lastLocalContentRef.current).toBe(screenBContent);
  expect(setCollabContent).not.toHaveBeenCalled();
  expect(setCollabContentFileId).not.toHaveBeenCalled();
  expect(recordLocalContentHistoryEntry).not.toHaveBeenCalled();
  expect(replacePreviewContent).not.toHaveBeenCalled();
});

it("keeps a conflicted async image fill out of Y.Text, history, and preview", async () => {
  const ydoc = createDoc(content);
  const save = deferred<"persisted" | "conflict">();
  const sendStyle = vi.fn();
  vi.stubGlobal("window", { __designCanvasSendStyle: sendStyle });
  const replacePreviewContent = vi.fn(() => "applied" as const);
  const recordLocalContentHistoryEntry = vi.fn();
  const queueFileContentSave = vi.fn<
    CommitVisualStylesArgs["queueFileContentSave"]
  >((_fileId, _nextContent, options) =>
    save.promise.then((result) => {
      if (result === "persisted") {
        options.onPersistedContent?.("<html>unexpected</html>");
      }
      return result;
    }),
  );
  const args = commitArgs({
    queueFileContentSave,
    recordLocalContentHistoryEntry,
    replacePreviewContent,
    ydoc,
    isSynced: true,
  });

  runCommitVisualStyles(
    args,
    "#target",
    { backgroundImage: 'url("https://assets.test/upload.png")' },
    { requirePersistedSourceAcceptance: true },
  );
  flushCommitsAfterPaint();
  save.resolve("conflict");
  await save.promise;
  await Promise.resolve();
  await Promise.resolve();

  expect(ydoc.getText("content").toString()).toBe(content);
  expect(recordLocalContentHistoryEntry).not.toHaveBeenCalled();
  expect(replacePreviewContent).not.toHaveBeenCalled();
  expect(sendStyle).not.toHaveBeenCalled();
});

it("does not overwrite a newer collaboration source after a successful save", async () => {
  const ydoc = createDoc(content);
  const save = deferred<"persisted" | "conflict">();
  vi.stubGlobal("window", { __designCanvasSendStyle: vi.fn() });
  const replacePreviewContent = vi.fn(() => "applied" as const);
  const recordLocalContentHistoryEntry = vi.fn();
  let currentContent = content;
  const latestActiveContentRef = ref<string | null>(content);
  const queueFileContentSave = vi.fn<
    CommitVisualStylesArgs["queueFileContentSave"]
  >((_fileId, _nextContent, options) =>
    save.promise.then((result) => {
      if (result === "persisted") {
        options.onPersistedContent?.(
          content
            .replace("Title", "Remote title")
            .replace(
              "color: red",
              'color: red; background-image: url("https://assets.test/upload.png")',
            ),
        );
      }
      return result;
    }),
  );
  const args = commitArgs({
    getScreenContent: () => currentContent,
    latestActiveContentRef,
    queueFileContentSave,
    recordLocalContentHistoryEntry,
    replacePreviewContent,
    currentYDocRef: ref(ydoc),
    ydoc,
    isSynced: true,
  });

  runCommitVisualStyles(
    args,
    "#target",
    { backgroundImage: 'url("https://assets.test/upload.png")' },
    { requirePersistedSourceAcceptance: true },
  );
  flushCommitsAfterPaint();

  const newerContent = content.replace("Title", "Remote title");
  currentContent = newerContent;
  latestActiveContentRef.current = newerContent;
  replaceYText(ydoc, newerContent);
  save.resolve("persisted");
  await save.promise;
  await Promise.resolve();
  await Promise.resolve();

  expect(ydoc.getText("content").toString()).toBe(newerContent);
  expect(recordLocalContentHistoryEntry).not.toHaveBeenCalled();
  expect(replacePreviewContent).not.toHaveBeenCalled();
});

it("does not preview a linked image fill before its server mutation resolves", () => {
  const linkedContent =
    '<html><body><main id="target" data-agent-native-node-id="target" data-agent-native-component-id="card" style="color: red">Title</main></body></html>';
  const sendStyle = vi.fn();
  vi.stubGlobal("window", { __designCanvasSendStyle: sendStyle });
  const applyLinkedComponentEdit = vi.fn(() => {
    expect(sendStyle).not.toHaveBeenCalled();
  });
  const args = commitArgs({
    activeFile: {
      id: fileId,
      filename: "index.html",
      fileType: "html",
      content: linkedContent,
      createdAt: "2026-09-30T00:00:00.000Z",
      updatedAt: "2026-09-30T00:00:00.000Z",
    },
    activeCodeLayerProjection: buildCodeLayerProjection(linkedContent, {
      source: { kind: "design-file", fileId },
    }),
    activeProjectionContent: linkedContent,
    applyLinkedComponentEdit,
    getScreenContent: () => linkedContent,
    selectedElement: {
      selector: "#target",
      sourceId: "target",
    } as ElementInfo,
  });

  runCommitVisualStyles(
    args,
    "#target",
    { backgroundImage: 'url("https://assets.test/upload.png")' },
    { requirePersistedSourceAcceptance: true },
  );

  expect(applyLinkedComponentEdit).toHaveBeenCalledWith(fileId, "target", {
    kind: "styleBatch",
    values: { backgroundImage: 'url("https://assets.test/upload.png")' },
  });
  expect(sendStyle).not.toHaveBeenCalled();
});
