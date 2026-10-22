import { buildCodeLayerProjection } from "@shared/code-layer";
import { afterEach, expect, it, vi } from "vitest";
import * as Y from "yjs";

import type { ElementInfo } from "@/components/design/types";
import {
  __resetCanvasOutcomeTrackingForTests,
  flushCanvasOutcomeCounts,
  setCanvasOutcomeContext,
} from "@/lib/canvas-outcome-tracking";
import {
  runCommitVisualStyles,
  type CommitVisualStylesArgs,
} from "@/pages/design-editor/commands/commit-visual-styles";
import { flushCommitsAfterPaint } from "@/pages/design-editor/commit-after-paint";

const outcomeMocks = vi.hoisted(() => ({ trackDesignRelay: vi.fn() }));

const shader = vi.hoisted(() => ({
  inFlight: false,
  settle: undefined as undefined | ((ok: boolean) => void),
}));

vi.mock(
  "@/components/design/shader-source-coordination",
  async (importOriginal) => ({
    ...(await importOriginal<Record<string, unknown>>()),
    isShaderWriteInFlight: () => shader.inFlight,
    waitForShaderWriteToSettle: () =>
      new Promise<void>((resolve, reject) => {
        shader.settle = (ok) => {
          shader.inFlight = false;
          if (ok) resolve();
          else reject(new Error("shader write failed"));
        };
      }),
  }),
);

vi.mock("@/lib/design-relay-tracking", () => ({
  trackDesignRelay: outcomeMocks.trackDesignRelay,
}));

function styleOutcomes(): Record<string, number> {
  flushCanvasOutcomeCounts();
  const out: Record<string, number> = {};
  for (const [, props] of outcomeMocks.trackDesignRelay.mock.calls) {
    const { operation, outcome, reason, count } = props as Record<
      string,
      string | number
    >;
    const key = `${operation}/${outcome}/${reason}`;
    out[key] = (out[key] ?? 0) + Number(count);
  }
  outcomeMocks.trackDesignRelay.mockReset();
  return out;
}

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

it("counts a style commit once, only after the source rewrite lands", () => {
  __resetCanvasOutcomeTrackingForTests();
  setCanvasOutcomeContext({ designId: undefined, signedIn: true });
  styleOutcomes();
  vi.stubGlobal("window", { __designCanvasSendStyle: vi.fn() });
  const args = commitArgs();

  runCommitVisualStyles(args, "#target", { color: "rgb(0, 128, 0)" });
  expect(styleOutcomes()).toEqual({});

  flushCommitsAfterPaint();
  expect(styleOutcomes()).toEqual({ "style_commit/succeeded/none": 1 });
});

it("counts a selector that no longer matches as a failed style commit", () => {
  __resetCanvasOutcomeTrackingForTests();
  setCanvasOutcomeContext({ designId: undefined, signedIn: true });
  styleOutcomes();
  vi.stubGlobal("window", { __designCanvasSendStyle: vi.fn() });
  const resolvedContent =
    '<html><body><h1 data-agent-native-node-id="an-first">First</h1></body></html>';
  let currentContent = resolvedContent;
  const args = commitArgs({
    activeCodeLayerProjection: buildCodeLayerProjection(resolvedContent, {
      source: { kind: "design-file", fileId },
    }),
    activeProjectionContent: resolvedContent,
    getScreenContent: () => currentContent,
  });

  runCommitVisualStyles(args, "body > h1", { color: "rgb(0, 128, 0)" });
  currentContent =
    '<html><body><h1 data-agent-native-node-id="an-second">Second</h1></body></html>';
  flushCommitsAfterPaint();

  expect(args.queueFileContentSave).not.toHaveBeenCalled();
  expect(styleOutcomes()).toEqual({ "style_commit/failed/patch_failed": 1 });
});

it("counts a commit without edit rights as skipped, outside the success rate", () => {
  __resetCanvasOutcomeTrackingForTests();
  setCanvasOutcomeContext({ designId: undefined, signedIn: true });
  styleOutcomes();
  vi.stubGlobal("window", { __designCanvasSendStyle: vi.fn() });
  const args = commitArgs({ canEditDesign: false });

  runCommitVisualStyles(args, "#target", { color: "rgb(0, 128, 0)" });
  flushCommitsAfterPaint();

  expect(styleOutcomes()).toEqual({ "style_commit/skipped/no_edit_rights": 1 });
});

it("never counts a queued component-instance edit as a success", () => {
  __resetCanvasOutcomeTrackingForTests();
  setCanvasOutcomeContext({ designId: undefined, signedIn: true });
  styleOutcomes();
  const linkedContent =
    '<html><body><main id="target" data-agent-native-node-id="target" data-agent-native-component-id="card" style="color: red">Title</main></body></html>';
  vi.stubGlobal("window", { __designCanvasSendStyle: vi.fn() });
  const applyLinkedComponentEdit = vi.fn();
  const args = commitArgs({
    activeCodeLayerProjection: buildCodeLayerProjection(linkedContent, {
      source: { kind: "design-file", fileId },
    }),
    activeProjectionContent: linkedContent,
    applyLinkedComponentEdit,
    getScreenContent: () => linkedContent,
    selectedElement: { selector: "#target", sourceId: "target" } as ElementInfo,
  });

  runCommitVisualStyles(args, "#target", { color: "rgb(0, 128, 0)" });
  flushCommitsAfterPaint();

  expect(applyLinkedComponentEdit).toHaveBeenCalledOnce();
  expect(styleOutcomes()).toEqual({
    "style_commit/deferred/linked_edit_queued": 1,
  });
});

it("labels a committed fill and a committed move by kind of change", () => {
  __resetCanvasOutcomeTrackingForTests();
  setCanvasOutcomeContext({ designId: undefined, signedIn: true });
  styleOutcomes();
  vi.stubGlobal("window", { __designCanvasSendStyle: vi.fn() });
  const args = commitArgs();

  runCommitVisualStyles(args, "#target", { color: "rgb(0, 128, 0)" });
  runCommitVisualStyles(args, "#target", {
    position: "relative",
    left: "12px",
    top: "4px",
  });
  flushCommitsAfterPaint();
  flushCanvasOutcomeCounts();

  const kinds = outcomeMocks.trackDesignRelay.mock.calls.map(
    ([, props]) => (props as { style_kind?: string }).style_kind,
  );
  expect(kinds.sort()).toEqual(["fill", "position"]);
});

it.each([
  ["persisted", "style_commit/succeeded/none"],
  ["conflict", "style_commit/failed/not_persisted"],
  ["retryable", "style_commit/deferred/save_unfinished"],
  ["failed", "style_commit/deferred/save_unfinished"],
  [false, "style_commit/skipped/no_edit_rights"],
] as const)(
  "counts an accepted-source commit by its save result (%s)",
  async (result, expected) => {
    __resetCanvasOutcomeTrackingForTests();
    setCanvasOutcomeContext({ designId: undefined, signedIn: true });
    styleOutcomes();
    vi.stubGlobal("window", { __designCanvasSendStyle: vi.fn() });
    const save = deferred<typeof result>();
    const args = commitArgs({
      queueFileContentSave: vi.fn(() => save.promise),
    });

    runCommitVisualStyles(
      args,
      "#target",
      { backgroundImage: 'url("https://assets.test/upload.png")' },
      { requirePersistedSourceAcceptance: true },
    );
    flushCommitsAfterPaint();
    expect(styleOutcomes()).toEqual({});

    save.resolve(result);
    await save.promise;
    await Promise.resolve();
    expect(styleOutcomes()).toEqual({ [expected]: 1 });
  },
);

it("counts a commit that waited on a shader write once, by its result", async () => {
  __resetCanvasOutcomeTrackingForTests();
  setCanvasOutcomeContext({ designId: undefined, signedIn: true });
  styleOutcomes();
  vi.stubGlobal("window", { __designCanvasSendStyle: vi.fn() });
  shader.inFlight = true;
  const args = commitArgs();
  vi.mocked(args.commitVisualStyles).mockImplementation(
    (selector, styles, options) =>
      runCommitVisualStyles(args, selector, styles, options),
  );

  runCommitVisualStyles(args, "#target", { color: "rgb(0, 128, 0)" });
  expect(styleOutcomes()).toEqual({});

  shader.settle!(true);
  await new Promise((resolve) => setTimeout(resolve, 0));
  flushCommitsAfterPaint();
  expect(args.queueFileContentSave).toHaveBeenCalledOnce();
  expect(styleOutcomes()).toEqual({ "style_commit/succeeded/none": 1 });
});

it("counts a commit whose shader wait failed as failed, once", async () => {
  __resetCanvasOutcomeTrackingForTests();
  setCanvasOutcomeContext({ designId: undefined, signedIn: true });
  styleOutcomes();
  vi.stubGlobal("window", { __designCanvasSendStyle: vi.fn() });
  shader.inFlight = true;
  const args = commitArgs();

  runCommitVisualStyles(args, "#target", { color: "rgb(0, 128, 0)" });
  shader.settle!(false);
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(args.commitVisualStyles).not.toHaveBeenCalled();
  expect(styleOutcomes()).toEqual({
    "style_commit/failed/shader_write_failed": 1,
  });
});
