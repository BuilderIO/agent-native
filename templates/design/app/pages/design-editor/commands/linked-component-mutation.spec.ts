import { sourceContentHash } from "@shared/source-workspace";
import { describe, expect, it, vi } from "vitest";

import { runUndo } from "@/pages/design-editor/commands/undo";
import type { FileContentSaveRequest } from "@/pages/design-editor/editor-state";
import { reserveLinkedComponentContentHistory } from "@/pages/design-editor/history";

import {
  createLinkedComponentMutationQueue,
  type LinkedComponentActionResult,
  type LinkedComponentEditPayload,
  type LinkedComponentMutationQueueArgs,
} from "./linked-component-mutation";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function resultFor(
  before: Map<string, string>,
  after: Map<string, string>,
  revision: string,
): LinkedComponentActionResult {
  const changedFileIds = [...after.keys()];
  return {
    persisted: true,
    changes: changedFileIds.map((fileId) => ({
      fileId,
      before: before.get(fileId)!,
      after: after.get(fileId)!,
      beforeVersionHash: sourceContentHash(before.get(fileId)!),
      afterVersionHash: sourceContentHash(after.get(fileId)!),
      updatedAt: revision,
    })),
    sourceBases: [...before.keys()].map((fileId) => ({
      fileId,
      versionHash: sourceContentHash(after.get(fileId) ?? before.get(fileId)!),
      updatedAt: revision,
    })),
  };
}

function queueArgs(overrides: Partial<LinkedComponentMutationQueueArgs> = {}) {
  const content = new Map([
    ["file-main", "main-v0"],
    ["file-copy", "copy-v0"],
  ]);
  const fileSaveChainsRef = { current: {} as Record<string, Promise<void>> };
  const pendingFileSavesRef = {
    current: {} as Record<string, FileContentSaveRequest>,
  };
  const applyFileContentUpdate = vi.fn((fileId: string, next: string) => {
    content.set(fileId, next);
    return {
      status: "accepted" as const,
      content: next,
      nodeIdMap: new Map([[fileId, fileId]]),
    };
  });
  const recordContentHistoryEntry = vi.fn();
  const refreshAfterConflict = vi.fn();
  const reportFailure = vi.fn();
  const args: LinkedComponentMutationQueueArgs = {
    designId: "design-1",
    fileIds: () => [...content.keys()],
    getContent: (fileId) => content.get(fileId) ?? "",
    getSourceBaseContent: (fileId) => content.get(fileId) ?? "",
    canonicalizeSourceContent: (_fileId, source) => source,
    flushPendingSaves: vi.fn(),
    hasPendingSave: () => false,
    fileSaveChainsRef,
    pendingFileSavesRef,
    invokeAction: vi.fn(async () => ({ persisted: false })),
    applyFileContentUpdate,
    reserveContentHistory: () => ({
      commit: (changes) => recordContentHistoryEntry({ changes }),
      cancel: vi.fn(),
    }),
    waitForHostWrites: async () => {},
    syncUndoRedoState: vi.fn(),
    refreshAfterConflict,
    reportFailure,
    ...overrides,
  };
  return {
    args,
    content,
    applyFileContentUpdate,
    recordContentHistoryEntry,
    refreshAfterConflict,
    reportFailure,
  };
}

describe("linked component mutation queue", () => {
  it("reports an action CTA before requiring source bases and cancels its reservation", async () => {
    const setup = queueArgs({
      invokeAction: vi.fn(async () => ({
        ctaRequired: true,
        ctaMessage: "This source requires a visual editing capability.",
      })),
    });
    const commit = vi.fn();
    const cancel = vi.fn();
    setup.args.reserveContentHistory = vi.fn(() => ({ commit, cancel }));
    const queue = createLinkedComponentMutationQueue(setup.args);

    const result = await Promise.allSettled([
      queue.enqueue("file-copy", "copy-root", {
        kind: "textContent",
        value: "edit",
      }),
    ]);

    expect(result[0].status).toBe("rejected");
    expect(setup.applyFileContentUpdate).not.toHaveBeenCalled();
    expect(setup.recordContentHistoryEntry).not.toHaveBeenCalled();
    expect(commit).not.toHaveBeenCalled();
    expect(cancel).toHaveBeenCalledOnce();
    expect(setup.reportFailure).toHaveBeenCalledWith(
      "This source requires a visual editing capability.",
    );
  });

  it("serializes rapid edits and publishes each confirmed operation", async () => {
    const firstResponse = deferred<LinkedComponentActionResult>();
    const secondResponse = deferred<LinkedComponentActionResult>();
    const firstCall = deferred<LinkedComponentEditPayload>();
    const secondCall = deferred<LinkedComponentEditPayload>();
    const setup = queueArgs({
      invokeAction: vi.fn((payload: LinkedComponentEditPayload) => {
        if (payload.edit.kind === "textContent") {
          firstCall.resolve(payload);
          return firstResponse.promise;
        }
        secondCall.resolve(payload);
        return secondResponse.promise;
      }),
    });
    const queue = createLinkedComponentMutationQueue(setup.args);
    const initial = new Map(setup.content);
    const afterFirst = new Map([
      ["file-main", "main-v1"],
      ["file-copy", "copy-v1"],
    ]);
    const afterSecond = new Map([
      ["file-main", "main-v2"],
      ["file-copy", "copy-v2"],
    ]);

    const first = queue.enqueue("file-copy", "copy-root", {
      kind: "textContent",
      value: "First edit",
    });
    const second = queue.enqueue("file-copy", "copy-root", {
      kind: "styleBatch",
      values: {
        "background-color": "rgb(20, 30, 40)",
        "background-image": "linear-gradient(black, white)",
      },
    });

    const firstPayload = await firstCall.promise;
    expect(firstPayload.source.expectedFiles).toEqual(
      [...initial.entries()]
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([fileId, value]) => ({
          fileId,
          versionHash: sourceContentHash(value),
        })),
    );
    firstResponse.resolve(resultFor(initial, afterFirst, "saved-v1"));

    const secondPayload = await secondCall.promise;
    expect(secondPayload.source.expectedFiles).toEqual(
      [...afterFirst.entries()]
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([fileId, value]) => ({
          fileId,
          versionHash: sourceContentHash(value),
        })),
    );
    secondResponse.resolve(resultFor(afterFirst, afterSecond, "saved-v2"));
    await Promise.all([first, second]);

    expect(setup.applyFileContentUpdate).toHaveBeenCalledTimes(4);
    expect(setup.applyFileContentUpdate).toHaveBeenCalledWith(
      "file-copy",
      "copy-v2",
      expect.objectContaining({
        persist: false,
        recordHistory: false,
        historyBeforeContent: "copy-v1",
        updatedAt: "saved-v2",
      }),
    );
    expect(setup.applyFileContentUpdate).toHaveBeenCalledWith(
      "file-main",
      "main-v2",
      expect.objectContaining({
        persist: false,
        recordHistory: false,
        historyBeforeContent: "main-v1",
        updatedAt: "saved-v2",
      }),
    );
    expect(setup.recordContentHistoryEntry).toHaveBeenCalledTimes(2);
    expect(setup.recordContentHistoryEntry).toHaveBeenNthCalledWith(1, {
      changes: [
        { fileId: "file-main", before: "main-v0", after: "main-v1" },
        { fileId: "file-copy", before: "copy-v0", after: "copy-v1" },
      ],
    });
    expect(setup.recordContentHistoryEntry).toHaveBeenNthCalledWith(2, {
      changes: [
        { fileId: "file-main", before: "main-v1", after: "main-v2" },
        { fileId: "file-copy", before: "copy-v1", after: "copy-v2" },
      ],
    });

    const undoSecond = new Map(afterSecond);
    for (const change of setup.recordContentHistoryEntry.mock.calls[1][0]
      .changes) {
      undoSecond.set(change.fileId, change.before);
    }
    expect(undoSecond).toEqual(afterFirst);
    const redoSecond = new Map(undoSecond);
    for (const change of setup.recordContentHistoryEntry.mock.calls[1][0]
      .changes) {
      redoSecond.set(change.fileId, change.after);
    }
    expect(redoSecond).toEqual(afterSecond);
    expect(setup.refreshAfterConflict).not.toHaveBeenCalled();
    expect(setup.reportFailure).not.toHaveBeenCalled();
  });

  it("publishes an earlier confirmed success when a later queued edit fails", async () => {
    const setup = queueArgs();
    const initial = new Map(setup.content);
    const after = new Map([
      ["file-main", "main-v1"],
      ["file-copy", "copy-v1"],
    ]);
    setup.args.invokeAction = vi
      .fn()
      .mockResolvedValueOnce(resultFor(initial, after, "saved-v1"))
      .mockResolvedValueOnce({ conflict: true, error: "peer conflict" });
    const queue = createLinkedComponentMutationQueue(setup.args);
    const first = queue.enqueue("file-copy", "copy-root", {
      kind: "textContent",
      value: "first",
    });
    const second = queue.enqueue("file-copy", "copy-root", {
      kind: "textContent",
      value: "second",
    });
    await Promise.allSettled([first, second]);
    expect(setup.applyFileContentUpdate).toHaveBeenCalledWith(
      "file-copy",
      "copy-v1",
      expect.anything(),
    );
  });

  it("keeps later edits behind an Undo barrier and keeps idle dispatch synchronous", async () => {
    const response = deferred<LinkedComponentActionResult>();
    const called = deferred<void>();
    const setup = queueArgs();
    const events: string[] = [];
    const initial = new Map(setup.content);
    const after = new Map([
      ["file-main", "main-v1"],
      ["file-copy", "copy-v1"],
    ]);
    setup.args.reserveContentHistory = () => {
      events.push("reserve");
      return { commit: vi.fn(), cancel: vi.fn() };
    };
    setup.args.invokeAction = vi
      .fn()
      .mockImplementationOnce(() => {
        called.resolve();
        return response.promise;
      })
      .mockImplementationOnce(() => {
        events.push("later edit");
        expect(setup.content).toEqual(initial);
        return Promise.resolve(resultFor(initial, after, "saved-v2"));
      });
    const queue = createLinkedComponentMutationQueue(setup.args);
    const idle = vi.fn();
    expect(queue.dispatchHistory(idle)).toBeUndefined();
    expect(idle).toHaveBeenCalledOnce();
    const first = queue.enqueue("file-copy", "copy-root", {
      kind: "textContent",
      value: "first",
    });
    await called.promise;
    const undo = queue.dispatchHistory(() => {
      events.push("undo");
      for (const [id, value] of initial) setup.content.set(id, value);
    });
    const later = queue.enqueue("file-copy", "copy-root", {
      kind: "textContent",
      value: "later",
    });
    expect(events).toEqual(["reserve"]);
    response.resolve(resultFor(initial, after, "saved-v1"));
    await Promise.all([first, undo, later]);
    expect(events).toEqual(["reserve", "undo", "reserve", "later edit"]);
  });

  it("waits for deferred host publication before executing Undo", async () => {
    const host = deferred<void>();
    const deferredPublication = deferred<void>();
    const setup = queueArgs();
    const initial = new Map(setup.content);
    const after = new Map([
      ["file-main", "main-v1"],
      ["file-copy", "copy-v1"],
    ]);
    let waitingForHost = false;
    setup.args.invokeAction = vi.fn(async () =>
      resultFor(initial, after, "saved-v1"),
    );
    setup.args.applyFileContentUpdate = vi.fn(
      (
        fileId,
        content,
      ): ReturnType<
        LinkedComponentMutationQueueArgs["applyFileContentUpdate"]
      > => {
        if (fileId === "file-main") {
          waitingForHost = true;
          deferredPublication.resolve();
          return { status: "deferred" };
        }
        setup.content.set(fileId, content);
        return { status: "accepted", content, nodeIdMap: new Map() };
      },
    );
    setup.args.waitForHostWrites = () =>
      waitingForHost ? host.promise : Promise.resolve();
    const queue = createLinkedComponentMutationQueue(setup.args);
    const pending = queue.enqueue("file-copy", "copy-root", {
      kind: "textContent",
      value: "first",
    });
    const undo = vi.fn();
    const undoRequest = queue.dispatchHistory(undo);
    await deferredPublication.promise;
    expect(queue.hasPending()).toBe(true);
    expect(undo).not.toHaveBeenCalled();
    setup.content.set("file-main", "main-v1");
    host.resolve();
    await Promise.all([pending, undoRequest]);
    expect(undo).toHaveBeenCalledOnce();
    expect(queue.hasPending()).toBe(false);
  });

  it("reserves and finalizes a mixed styleTargetsBatch as one operation", async () => {
    const setup = queueArgs();
    const initial = new Map(setup.content);
    const after = new Map([
      ["file-main", "main-v1"],
      ["file-copy", "copy-v1"],
    ]);
    const commit = vi.fn();
    const reserve = vi.fn(() => ({ commit, cancel: vi.fn() }));
    setup.args.reserveContentHistory = reserve;
    setup.args.invokeAction = vi.fn(async () =>
      resultFor(initial, after, "saved-batch"),
    );
    const queue = createLinkedComponentMutationQueue(setup.args);
    const edit = {
      kind: "styleTargetsBatch" as const,
      targets: [
        { fileId: "file-main", nodeId: "main-root", styles: { color: "red" } },
        {
          fileId: "file-copy",
          nodeId: "plain-node",
          styles: { color: "blue" },
        },
      ],
    };
    await queue.enqueue("file-main", "main-root", edit);
    expect(setup.args.invokeAction).toHaveBeenCalledOnce();
    expect(setup.args.invokeAction).toHaveBeenCalledWith(
      expect.objectContaining({ edit }),
    );
    expect(reserve).toHaveBeenCalledOnce();
    expect(commit).toHaveBeenCalledExactlyOnceWith([
      { fileId: "file-main", before: "main-v0", after: "main-v1" },
      { fileId: "file-copy", before: "copy-v0", after: "copy-v1" },
    ]);
  });

  it("does not apply a queued Undo to older history when the linked edit rejects", async () => {
    const setup = queueArgs({
      invokeAction: vi.fn(async () => ({
        conflict: true,
        error: "changed remotely",
      })),
    });
    const queue = createLinkedComponentMutationQueue(setup.args);
    const operation = queue.enqueue("file-copy", "copy-root", {
      kind: "textContent",
      value: "edit",
    });
    const undo = vi.fn();
    const request = queue.dispatchHistory(undo);
    const results = await Promise.allSettled([operation, request]);
    expect(results[0].status).toBe("rejected");
    expect(undo).not.toHaveBeenCalled();
    expect(setup.reportFailure).toHaveBeenCalledOnce();
    queue.dispatchHistory(undo);
    expect(undo).toHaveBeenCalledOnce();
  });

  it("retains confirmed history and allows queued Undo after publication recovery", async () => {
    const setup = queueArgs();
    const initial = new Map(setup.content);
    const after = new Map([
      ["file-main", "main-v1"],
      ["file-copy", "copy-v1"],
    ]);
    setup.args.invokeAction = vi.fn(async () =>
      resultFor(initial, after, "saved-v1"),
    );
    setup.args.applyFileContentUpdate = () => ({ status: "refused" });
    setup.args.refreshAfterConflict = async () => {
      for (const [id, content] of after) setup.content.set(id, content);
    };
    const queue = createLinkedComponentMutationQueue(setup.args);
    const operation = queue.enqueue("file-copy", "copy-root", {
      kind: "textContent",
      value: "edit",
    });
    const undo = vi.fn();
    const request = queue.dispatchHistory(undo);
    await Promise.allSettled([operation, request]);
    expect(setup.recordContentHistoryEntry).toHaveBeenCalledOnce();
    expect(undo).toHaveBeenCalledOnce();
    expect(setup.content).toEqual(after);
  });

  it("does not apply an in-flight response over a newer editor edit", async () => {
    const response = deferred<LinkedComponentActionResult>();
    const actionCall = deferred<LinkedComponentEditPayload>();
    const setup = queueArgs({
      invokeAction: vi.fn((payload: LinkedComponentEditPayload) => {
        actionCall.resolve(payload);
        return response.promise;
      }),
    });
    const queue = createLinkedComponentMutationQueue(setup.args);
    const initial = new Map(setup.content);
    const after = new Map([
      ["file-main", "main-saved"],
      ["file-copy", "copy-saved"],
    ]);
    const first = queue.enqueue("file-copy", "copy-root", {
      kind: "textContent",
      value: "First edit",
    });
    const second = queue.enqueue("file-copy", "copy-root", {
      kind: "style",
      property: "color",
      value: "red",
    });
    await actionCall.promise;
    setup.content.set("file-copy", "newer-unsaved-editor-content");
    response.resolve(resultFor(initial, after, "saved-v1"));

    const settled = await Promise.allSettled([first, second]);
    expect(settled.map((result) => result.status)).toEqual([
      "rejected",
      "rejected",
    ]);
    expect(setup.applyFileContentUpdate).not.toHaveBeenCalled();
    expect(setup.recordContentHistoryEntry).toHaveBeenCalledTimes(1);
    expect(setup.refreshAfterConflict).toHaveBeenCalledTimes(1);
    expect(setup.reportFailure).toHaveBeenCalledTimes(1);
    expect(setup.reportFailure.mock.calls[0][0]).toContain(
      "newer editor change",
    );
  });

  it("accepts its own Yjs echo before the action response arrives", async () => {
    const response = deferred<LinkedComponentActionResult>();
    const actionCall = deferred<LinkedComponentEditPayload>();
    const setup = queueArgs({
      invokeAction: vi.fn((payload: LinkedComponentEditPayload) => {
        actionCall.resolve(payload);
        return response.promise;
      }),
    });
    const queue = createLinkedComponentMutationQueue(setup.args);
    const initial = new Map(setup.content);
    const after = new Map([
      ["file-main", "main-echoed"],
      ["file-copy", "copy-echoed"],
    ]);
    const pending = queue.enqueue("file-copy", "copy-root", {
      kind: "textContent",
      value: "Echoed edit",
    });
    await actionCall.promise;

    for (const [fileId, content] of after) setup.content.set(fileId, content);
    response.resolve(resultFor(initial, after, "saved-echo"));
    await pending;

    expect(setup.recordContentHistoryEntry).toHaveBeenCalledTimes(1);
    expect(setup.applyFileContentUpdate).toHaveBeenCalledTimes(2);
    expect(setup.refreshAfterConflict).not.toHaveBeenCalled();
  });

  it("uses persisted source bytes for CAS when the editor has stamped missing ids", async () => {
    const editorContent = new Map([
      ["file-main", "main-editor"],
      ["file-copy", "copy-editor-stamped"],
    ]);
    const sourceContent = new Map([
      ["file-main", "main-persisted"],
      ["file-copy", "copy-persisted-without-id"],
    ]);
    const initial = new Map(sourceContent);
    const after = new Map([
      ["file-main", "main-persisted"],
      ["file-copy", "copy-persisted-with-style"],
    ]);
    const payload = deferred<LinkedComponentEditPayload>();
    const setup = queueArgs({
      getContent: (fileId) => editorContent.get(fileId) ?? "",
      getSourceBaseContent: (fileId) => sourceContent.get(fileId) ?? "",
      canonicalizeSourceContent: (fileId, content) =>
        fileId === "file-main" && content === "main-persisted"
          ? "main-editor"
          : fileId === "file-copy" && content === "copy-persisted-without-id"
            ? "copy-editor-stamped"
            : content,
      invokeAction: vi.fn((actionPayload: LinkedComponentEditPayload) => {
        payload.resolve(actionPayload);
        return Promise.resolve(resultFor(initial, after, "saved-source"));
      }),
    });
    const queue = createLinkedComponentMutationQueue(setup.args);
    const pending = queue.enqueue("file-copy", "copy-root", {
      kind: "styleBatch",
      values: { color: "red", "background-image": "none" },
    });

    const actionPayload = await payload.promise;
    await pending;

    expect(actionPayload.source.expectedFiles).toEqual(
      [...initial.entries()]
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([fileId, content]) => ({
          fileId,
          versionHash: sourceContentHash(content),
        })),
    );
    expect(
      actionPayload.source.expectedFiles.find(
        ({ fileId }) => fileId === "file-copy",
      )?.versionHash,
    ).toBe(sourceContentHash("copy-persisted-without-id"));
    expect(setup.refreshAfterConflict).not.toHaveBeenCalled();
  });

  it.each([
    { undoCount: 1, selectOther: false, selectAfterUndo: false },
    { undoCount: 2, selectOther: false, selectAfterUndo: false },
    { undoCount: 1, selectOther: true, selectAfterUndo: false },
    { undoCount: 2, selectOther: true, selectAfterUndo: false },
    { undoCount: 2, selectOther: true, selectAfterUndo: true },
  ])(
    "runs $undoCount pending Undo requests, selection: $selectOther, after requested Undo: $selectAfterUndo",
    async ({ undoCount, selectOther, selectAfterUndo }) => {
      const response = deferred<LinkedComponentActionResult>();
      const actionCall = deferred<LinkedComponentEditPayload>();
      const setup = queueArgs({
        invokeAction: vi.fn((payload: LinkedComponentEditPayload) => {
          actionCall.resolve(payload);
          return response.promise;
        }),
      });
      const queue = createLinkedComponentMutationQueue(setup.args);
      const initial = new Map(setup.content);
      const after = new Map([
        ["file-main", "main-linked-saved"],
        ["file-copy", "copy-linked-saved"],
      ]);
      const undoArgs = {
        activeEditorDragRef: { current: false },
        activeFile: { id: "file-copy" },
        applyFileContentUpdate: vi.fn((fileId: string, content: string) => {
          setup.content.set(fileId, content);
          return {
            status: "accepted" as const,
            content,
            nodeIdMap: new Map(),
          };
        }),
        applyLocalContentUpdate: vi.fn((content: string) => {
          setup.content.set("file-copy", content);
          return {
            status: "accepted" as const,
            content,
            nodeIdMap: new Map(),
          };
        }),
        canEditDesign: true,
        clipboardPasteRedoStackRef: { current: [] },
        clipboardPasteUndoStackRef: { current: [] },
        contentHistorySelectionAfterRef: { current: new WeakMap() },
        contentRedoSelectionStackRef: { current: [] },
        contentRedoStackRef: { current: [] },
        contentUndoSelectionStackRef: { current: [undefined] },
        contentUndoStackRef: {
          current: [
            {
              changes: [
                {
                  fileId: "file-copy",
                  before: "copy-before-previous-commit",
                  after: "copy-v0",
                },
              ],
            },
          ],
        },
        fileHistoryMutationPendingRef: { current: false },
        files: [{ id: "file-main" }, { id: "file-copy" }],
        getFreshActiveContent: () => setup.content.get("file-copy") ?? "",
        getScreenContent: (fileId: string) => setup.content.get(fileId) ?? "",
        historyOrderRef: { current: ["file-content"] },
        id: "design-1",
        isSynced: false,
        liveScreenSnapshotsById: {},
        lastLocalContentRef: { current: null },
        latestClipboardMutationContentRef: { current: new Map() },
        localContentRedoStackRef: { current: [] },
        localContentUndoStackRef: { current: [] },
        markPendingLocalFileContent: vi.fn(),
        pendingLiveNonStyleEditsRef: { current: [] },
        pendingLiveNonStyleRedoStackRef: { current: [] },
        pendingLiveNonStyleUndoStackRef: { current: [] },
        pendingLocalFileContentsRef: { current: new Map() },
        pendingVisualStyleEditsRef: { current: [] },
        pendingVisualStyleRedoStackRef: { current: [] },
        pendingVisualStyleUndoStackRef: { current: [] },
        redoOrderRef: { current: [] },
        restoreSelectionSnapshot: vi.fn(),
        setActiveFileId: vi.fn(),
        setContentRenderRevision: vi.fn(),
        setHoveredElement: vi.fn(),
        setOverviewSelectedScreenIds: vi.fn(),
        setPendingLiveNonStyleEdits: vi.fn(),
        setPendingVisualStyleEdits: vi.fn(),
        setSelectedElement: vi.fn(),
        setSelectedLayerIdsState: vi.fn(),
        suppressContentHistoryRef: { current: false },
        syncUndoRedoState: vi.fn(),
        undoManagerRef: { current: null },
        updateLiveScreenSnapshotContent: vi.fn(),
        viewModeRef: { current: "overview" },
      } as unknown as Parameters<typeof runUndo>[0];
      setup.args.reserveContentHistory = () =>
        reserveLinkedComponentContentHistory({
          stack: undoArgs.contentUndoStackRef,
          selections: undoArgs.contentUndoSelectionStackRef,
          order: undoArgs.historyOrderRef,
          selection: {
            activeFileId: "file-copy",
            selectedLayerIds: [],
            overviewSelectedScreenIds: [],
          },
        });
      const pending = queue.enqueue("file-copy", "copy-root", {
        kind: "textContent",
        value: "Linked edit in flight",
      });

      await actionCall.promise;
      const registerSelection = () => {
        undoArgs.selectionUndoStackRef = {
          current: [
            {
              before: {
                activeFileId: "file-copy",
                selectedLayerIds: ["file-copy"],
                overviewSelectedScreenIds: ["file-copy"],
              },
              after: {
                activeFileId: "file-main",
                selectedLayerIds: ["file-main"],
                overviewSelectedScreenIds: ["file-main"],
              },
            },
          ],
        };
        undoArgs.selectionRedoStackRef = { current: [] };
        undoArgs.historyOrderRef.current.push("selection");
      };
      if (selectOther && !selectAfterUndo) registerSelection();
      const sourceAfterUndo: string[] = [];
      const undos = Array.from({ length: undoCount }, (_, index) => {
        if (
          selectAfterUndo &&
          index === 1 &&
          !queue.deferHistoryChange?.(registerSelection)
        )
          registerSelection();
        return queue.dispatchHistory(() => {
          runUndo(undoArgs);
          sourceAfterUndo.push(setup.content.get("file-copy")!);
        });
      });
      expect(setup.content.get("file-copy")).toBe("copy-v0");
      response.resolve(resultFor(initial, after, "saved-after-undo"));
      await Promise.all([pending, ...undos]);
      const expected = new Map(
        selectOther && undoCount === 1 ? after : initial,
      );
      if (!selectOther && undoCount === 2)
        expected.set("file-copy", "copy-before-previous-commit");
      expect(setup.content).toEqual(expected);
      expect(undoArgs.contentUndoStackRef.current).toHaveLength(
        2 - undoCount + (selectOther ? 1 : 0),
      );
      if (selectAfterUndo)
        expect(sourceAfterUndo).toEqual(["copy-v0", "copy-v0"]);
      if (selectOther) {
        expect(undoArgs.restoreSelectionSnapshot).toHaveBeenNthCalledWith(
          selectAfterUndo ? 2 : 1,
          expect.objectContaining({
            activeFileId: "file-copy",
            selectedLayerIds: ["file-copy"],
            overviewSelectedScreenIds: ["file-copy"],
          }),
        );
        if (undoCount === 1)
          expect(undoArgs.applyLocalContentUpdate).not.toHaveBeenCalled();
      }
      expect(setup.applyFileContentUpdate).toHaveBeenCalledTimes(2);
      expect(setup.refreshAfterConflict).not.toHaveBeenCalled();
    },
  );
});
