import { sourceContentHash } from "@shared/source-workspace";
import { describe, expect, it, vi } from "vitest";

import { runUndo } from "@/pages/design-editor/commands/undo";
import type { FileContentSaveRequest } from "@/pages/design-editor/editor-state";
import { reserveLinkedComponentContentHistory } from "@/pages/design-editor/history";

import {
  createLinkedComponentMutationQueue,
  projectLinkedComponentPropertyEdit,
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
    getPendingSave: (fileId) => pendingFileSavesRef.current[fileId],
    fileSaveChainsRef,
    pendingFileSavesRef,
    invokeAction: vi.fn(async () => ({ persisted: false })),
    applyFileContentUpdate,
    getCurrentSelection: () => ({
      activeFileId: "file-copy",
      selectedLayerIds: ["copy-root"],
      overviewSelectedScreenIds: [],
      sourceContentByFileId: Object.fromEntries(content),
    }),
    reserveContentHistory: () => ({
      commit: (changes, selectionAfter) =>
        recordContentHistoryEntry({
          changes,
          ...(selectionAfter ? { selectionAfter } : {}),
        }),
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
  it("projects a mixed linked and plain target batch with the server transform", () => {
    const mainContent =
      '<section data-agent-native-node-id="main-root" data-agent-native-component="Button" data-agent-native-component-id="button"><span data-agent-native-node-id="main-label" style="color: blue">Play</span></section><div data-agent-native-node-id="plain-target" style="color: black">Plain</div>';
    const copyContent =
      '<section data-agent-native-node-id="copy-root" data-agent-native-component-ref="button"><span data-agent-native-node-id="copy-label" data-agent-native-component-source-node-id="main-label" style="color: blue">Play</span></section>';
    const projected = projectLinkedComponentPropertyEdit({
      documents: [
        {
          source: {
            kind: "design-file",
            designId: "design-1",
            fileId: "main-file",
            filename: "main.html",
          },
          content: mainContent,
        },
        {
          source: {
            kind: "design-file",
            designId: "design-1",
            fileId: "copy-file",
            filename: "copy.html",
          },
          content: copyContent,
        },
      ],
      fileId: "main-file",
      nodeId: "main-label",
      edit: {
        kind: "styleTargetsBatch",
        targets: [
          {
            fileId: "main-file",
            nodeId: "main-label",
            styles: { color: "orange" },
          },
          {
            fileId: "main-file",
            nodeId: "plain-target",
            styles: { opacity: "0.5" },
          },
        ],
      },
    });

    expect(projected?.get("main-file")).toContain(
      'style="color: black; opacity: 0.5"',
    );
    expect(projected?.get("copy-file")).toContain('style="color: orange"');
  });

  it("projects component structure through the shared structure transform", () => {
    const main =
      '<section data-agent-native-node-id="main-root" data-agent-native-component="Button" data-agent-native-component-id="button"><span data-agent-native-node-id="main-label">Play</span></section>';
    const copy =
      '<section data-agent-native-node-id="copy-root" data-agent-native-component-ref="button"><span data-agent-native-node-id="copy-label" data-agent-native-component-source-node-id="main-label">Play</span></section>';
    const after = main.replace(
      "</section>",
      '<em data-agent-native-node-id="main-badge">New</em></section>',
    );
    const projected = projectLinkedComponentPropertyEdit({
      documents: [
        {
          source: {
            kind: "design-file",
            designId: "design-1",
            fileId: "main-file",
            filename: "main.html",
          },
          content: main,
        },
        {
          source: {
            kind: "design-file",
            designId: "design-1",
            fileId: "copy-file",
            filename: "copy.html",
          },
          content: copy,
        },
      ],
      fileId: "main-file",
      nodeId: "main-root",
      edit: { kind: "structure", before: main, after },
    });

    expect(projected?.get("main-file")).toContain("main-badge");
    expect(projected?.get("copy-file")).toContain("New");
    expect(projected?.get("copy-file")).toContain(
      'data-agent-native-component-source-node-id="main-badge"',
    );
  });

  it("projects a main-component structure intent through the server dispatcher", () => {
    const main =
      '<section data-agent-native-node-id="main-root" data-agent-native-component="Button" data-agent-native-component-id="button"><span data-agent-native-node-id="main-label">Play</span></section>';
    const copy =
      '<section data-agent-native-node-id="copy-root" data-agent-native-component-ref="button"><span data-agent-native-node-id="copy-label" data-agent-native-component-source-node-id="main-label">Play</span></section>';
    const source = (fileId: string, filename: string) => ({
      kind: "design-file" as const,
      designId: "design-1",
      fileId,
      filename,
    });
    const projected = projectLinkedComponentPropertyEdit({
      documents: [
        { source: source("main-file", "main.html"), content: main },
        { source: source("copy-file", "copy.html"), content: copy },
      ],
      fileId: "main-file",
      nodeId: "main-root",
      edit: {
        kind: "structure",
        intents: [{ kind: "deleteNode", target: { nodeId: "main-label" } }],
      },
    });

    expect(projected?.get("main-file")).not.toContain("main-label");
    expect(projected?.get("copy-file")).not.toContain("copy-label");
  });

  it("projects reset overrides through the shared reset transform", () => {
    const overrides = encodeURIComponent(
      JSON.stringify([{ sourceNodeId: "main-label", property: "textContent" }]),
    );
    const main =
      '<section data-agent-native-node-id="main-root" data-agent-native-component="Button" data-agent-native-component-id="button"><span data-agent-native-node-id="main-label">Play</span></section>';
    const copy = `<section data-agent-native-node-id="copy-root" data-agent-native-component-ref="button"><span data-agent-native-node-id="copy-label" data-agent-native-component-source-node-id="main-label" data-agent-native-component-overrides="${overrides}">Pause</span></section>`;
    const projected = projectLinkedComponentPropertyEdit({
      documents: [
        {
          source: {
            kind: "design-file",
            designId: "design-1",
            fileId: "main-file",
            filename: "main.html",
          },
          content: main,
        },
        {
          source: {
            kind: "design-file",
            designId: "design-1",
            fileId: "copy-file",
            filename: "copy.html",
          },
          content: copy,
        },
      ],
      fileId: "copy-file",
      nodeId: "copy-root",
      edit: { kind: "resetOverrides" },
    });

    expect(projected?.get("copy-file")).toContain(">Play</span>");
    expect(projected?.get("copy-file")).not.toContain(
      "data-agent-native-component-overrides",
    );
  });

  it("runs a one-file source mutation through the shared save gate", async () => {
    const before = "main-v0";
    const after = `${before}-created`;
    const setup = queueArgs();
    const change = {
      fileId: "file-main",
      before,
      after,
      beforeVersionHash: sourceContentHash(before),
      afterVersionHash: sourceContentHash(after),
      updatedAt: "saved-create",
    };
    const result: LinkedComponentActionResult = {
      persisted: true,
      changes: [change],
      sourceBases: [
        {
          fileId: change.fileId,
          versionHash: change.afterVersionHash,
          updatedAt: change.updatedAt,
        },
      ],
    };
    const run = vi.fn(
      async (source: { content: string; versionHash: string }) => {
        expect(source).toEqual({
          content: before,
          versionHash: sourceContentHash(before),
        });
        return result;
      },
    );
    const validate = vi.fn(
      (received: LinkedComponentActionResult, source: { fileId: string }) => {
        expect(received).toBe(result);
        expect(source.fileId).toBe("file-main");
        return received.changes?.[0] ?? null;
      },
    );
    const queue = createLinkedComponentMutationQueue(setup.args);

    const outcome = await queue.enqueueSourceMutation({
      fileId: "file-main",
      run,
      validate,
    });

    expect(outcome).toMatchObject({
      result,
      historyRecorded: true,
      change,
      hostSync: "accepted",
    });
    expect(validate).toHaveBeenCalledWith(
      result,
      expect.objectContaining({
        fileId: "file-main",
        content: before,
        versionHash: sourceContentHash(before),
      }),
    );
    expect(setup.applyFileContentUpdate).toHaveBeenCalledWith(
      "file-main",
      after,
      expect.objectContaining({
        persist: false,
        recordHistory: false,
        historyBeforeContent: before,
        sourceBaseContent: before,
        updatedAt: "saved-create",
      }),
    );
    expect(setup.recordContentHistoryEntry).toHaveBeenCalledOnce();
  });

  it("cancels a source mutation reservation when the action declines", async () => {
    const setup = queueArgs({
      invokeAction: vi.fn(async () => ({
        ctaRequired: true,
        ctaMessage: "Bridge write required.",
      })),
    });
    const commit = vi.fn();
    const cancel = vi.fn();
    setup.args.reserveContentHistory = vi.fn(() => ({ commit, cancel }));
    const queue = createLinkedComponentMutationQueue(setup.args);
    const run = vi.fn(async () => ({
      persisted: false,
      ctaRequired: true,
    }));
    const validate = vi.fn(() => null);

    const outcome = await queue.enqueueSourceMutation({
      fileId: "file-main",
      run,
      validate,
    });

    expect(outcome).toMatchObject({
      historyRecorded: false,
      hostSync: "skipped",
      result: { ctaRequired: true },
    });
    expect(cancel).toHaveBeenCalledOnce();
    expect(commit).not.toHaveBeenCalled();
    expect(setup.applyFileContentUpdate).not.toHaveBeenCalled();
    expect(setup.reportFailure).not.toHaveBeenCalled();
  });

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

  it("keeps a local edit composed from two projected linked actions", async () => {
    const firstResponse = deferred<LinkedComponentActionResult>();
    const secondResponse = deferred<LinkedComponentActionResult>();
    const firstCall = deferred<LinkedComponentEditPayload>();
    const secondCall = deferred<LinkedComponentEditPayload>();
    const initial = new Map([
      ["file-main", "main-v0"],
      ["file-copy", "copy-v0"],
    ]);
    const afterFirst = new Map([
      ["file-main", "main-v1"],
      ["file-copy", "copy-v1"],
    ]);
    const afterSecond = new Map([
      ["file-main", "main-v2"],
      ["file-copy", "copy-v2"],
    ]);
    const setup = queueArgs({
      projectEdit: (_fileId, _nodeId, edit) =>
        edit.kind === "textContent" ? afterFirst : afterSecond,
      invokeAction: vi.fn((payload: LinkedComponentEditPayload) => {
        if (payload.edit.kind === "textContent") {
          firstCall.resolve(payload);
          return firstResponse.promise;
        }
        secondCall.resolve(payload);
        return secondResponse.promise;
      }),
    });
    let pendingSave: FileContentSaveRequest | undefined;
    setup.args.getPendingSave = (fileId) =>
      pendingSave?.id === fileId ? pendingSave : undefined;
    setup.args.hasPendingSave = (fileId) => pendingSave?.id === fileId;
    const queue = createLinkedComponentMutationQueue(setup.args);

    const first = queue.enqueue("file-copy", "copy-root", {
      kind: "textContent",
      value: "First edit",
    });
    const second = queue.enqueue("file-copy", "copy-root", {
      kind: "style",
      property: "inset-inline-end",
      value: "10px",
    });
    await firstCall.promise;
    expect(queue.getProjectedContent("file-copy")).toBe("copy-v2");
    setup.content.set("file-copy", "copy-v2+Metadata");
    pendingSave = {
      id: "file-copy",
      content: "copy-v2+Metadata",
      syncCollab: true,
      operationSource: "tab-1",
      operationRevision: 1,
      expectedVersionHash: sourceContentHash("copy-v2"),
    };
    firstResponse.resolve(resultFor(initial, afterFirst, "saved-v1"));
    await secondCall.promise;
    secondResponse.resolve(resultFor(afterFirst, afterSecond, "saved-v2"));
    await Promise.all([first, second]);

    expect(setup.content.get("file-copy")).toBe("copy-v2+Metadata");
    expect(setup.content.get("file-main")).toBe("main-v2");
    expect(
      setup.applyFileContentUpdate.mock.calls.filter(
        ([fileId]) => fileId === "file-copy",
      ),
    ).toHaveLength(0);
    expect(queue.getProjectedContent("file-copy")).toBeUndefined();
    expect(setup.reportFailure).not.toHaveBeenCalled();
  });

  it("retains an unchanged file projection until every queued action settles", async () => {
    const firstResponse = deferred<LinkedComponentActionResult>();
    const secondResponse = deferred<LinkedComponentActionResult>();
    const firstCall = deferred<LinkedComponentEditPayload>();
    const secondCall = deferred<LinkedComponentEditPayload>();
    const initial = new Map([
      ["file-main", "main-v0"],
      ["file-copy", "copy-v0"],
    ]);
    const afterFirst = new Map([
      ["file-main", "main-v0"],
      ["file-copy", "copy-v1"],
    ]);
    const afterSecond = new Map([
      ["file-main", "main-v2"],
      ["file-copy", "copy-v1"],
    ]);
    const setup = queueArgs({
      projectEdit: (_fileId, _nodeId, edit) =>
        edit.kind === "textContent" ? afterFirst : afterSecond,
      invokeAction: vi.fn((payload: LinkedComponentEditPayload) => {
        if (payload.edit.kind === "textContent") {
          firstCall.resolve(payload);
          return firstResponse.promise;
        }
        secondCall.resolve(payload);
        return secondResponse.promise;
      }),
    });
    let pendingSave: FileContentSaveRequest | undefined;
    setup.args.getPendingSave = (fileId) =>
      pendingSave?.id === fileId ? pendingSave : undefined;
    setup.args.hasPendingSave = (fileId) => pendingSave?.id === fileId;
    const queue = createLinkedComponentMutationQueue(setup.args);

    const first = queue.enqueue("file-copy", "copy-root", {
      kind: "textContent",
      value: "First edit",
    });
    const second = queue.enqueue("file-main", "main-root", {
      kind: "style",
      property: "color",
      value: "red",
    });
    await firstCall.promise;
    setup.content.set("file-copy", "copy-v1+Metadata");
    pendingSave = {
      id: "file-copy",
      content: "copy-v1+Metadata",
      syncCollab: true,
      operationSource: "tab-1",
      operationRevision: 1,
      expectedVersionHash: sourceContentHash("copy-v1"),
    };
    const firstResult = resultFor(initial, afterFirst, "saved-v1");
    firstResult.changes = firstResult.changes?.filter(
      ({ fileId }) => fileId === "file-copy",
    );
    firstResponse.resolve(firstResult);
    await secondCall.promise;
    expect(queue.getProjectedContent("file-copy")).toBe("copy-v1");
    const secondResult = resultFor(afterFirst, afterSecond, "saved-v2");
    secondResult.changes = secondResult.changes?.filter(
      ({ fileId }) => fileId === "file-main",
    );
    secondResponse.resolve(secondResult);
    await Promise.all([first, second]);

    expect(setup.content.get("file-copy")).toBe("copy-v1+Metadata");
    expect(setup.content.get("file-main")).toBe("main-v2");
    expect(setup.reportFailure).not.toHaveBeenCalled();
  });

  it("refuses a local edit that was not based on the projected linked action", async () => {
    const response = deferred<LinkedComponentActionResult>();
    const actionCall = deferred<LinkedComponentEditPayload>();
    const initial = new Map([
      ["file-main", "main-v0"],
      ["file-copy", "copy-v0"],
    ]);
    const after = new Map([
      ["file-main", "main-v1"],
      ["file-copy", "copy-v1"],
    ]);
    const setup = queueArgs({
      projectEdit: () => after,
      invokeAction: vi.fn((payload: LinkedComponentEditPayload) => {
        actionCall.resolve(payload);
        return response.promise;
      }),
    });
    let pendingSave: FileContentSaveRequest | undefined;
    setup.args.getPendingSave = (fileId) =>
      pendingSave?.id === fileId ? pendingSave : undefined;
    setup.args.hasPendingSave = (fileId) => pendingSave?.id === fileId;
    const queue = createLinkedComponentMutationQueue(setup.args);
    const operation = queue.enqueue("file-copy", "copy-root", {
      kind: "style",
      property: "color",
      value: "red",
    });
    await actionCall.promise;
    setup.content.set("file-copy", "stale+Metadata");
    pendingSave = {
      id: "file-copy",
      content: "stale+Metadata",
      syncCollab: true,
      operationSource: "tab-1",
      operationRevision: 1,
      expectedVersionHash: sourceContentHash("copy-v0"),
    };
    response.resolve(resultFor(initial, after, "saved-v1"));

    await expect(operation).rejects.toThrow("newer editor change");
    expect(queue.getProjectedContent("file-copy")).toBeUndefined();
    expect(setup.reportFailure).toHaveBeenCalledOnce();
  });

  it("clears projected content when the linked action refuses", async () => {
    const setup = queueArgs({
      projectEdit: () =>
        new Map([
          ["file-main", "main-projected"],
          ["file-copy", "copy-projected"],
        ]),
      invokeAction: vi.fn(async () => ({
        persisted: false,
        conflict: true,
        error: "stale source",
      })),
    });
    const queue = createLinkedComponentMutationQueue(setup.args);
    const operation = queue.enqueue("file-copy", "copy-root", {
      kind: "style",
      property: "color",
      value: "red",
    });
    expect(queue.getProjectedContent("file-copy")).toBe("copy-projected");

    await expect(operation).rejects.toThrow("stale source");
    expect(queue.getProjectedContent("file-copy")).toBeUndefined();
  });

  it("blocks dependent local source writes while a server-only edit is pending", async () => {
    const response = deferred<LinkedComponentActionResult>();
    const actionCall = deferred<LinkedComponentEditPayload>();
    const setup = queueArgs({
      invokeAction: vi.fn((payload: LinkedComponentEditPayload) => {
        actionCall.resolve(payload);
        return response.promise;
      }),
    });
    const initial = new Map(setup.content);
    const after = new Map([
      ["file-main", "main-restored"],
      ["file-copy", "copy-restored"],
    ]);
    const queue = createLinkedComponentMutationQueue(setup.args);
    const operation = queue.enqueue("file-copy", "copy-root", {
      kind: "restoreMain",
    });

    expect(queue.blocksLocalContentEdits()).toBe(true);
    await actionCall.promise;
    response.resolve(resultFor(initial, after, "saved-restore"));
    await operation;
    expect(queue.blocksLocalContentEdits()).toBe(false);
  });

  it("keeps later linked actions unprojected behind a server-only archive edit", async () => {
    const archiveResponse = deferred<LinkedComponentActionResult>();
    const propertyResponse = deferred<LinkedComponentActionResult>();
    const archiveCall = deferred<LinkedComponentEditPayload>();
    const propertyCall = deferred<LinkedComponentEditPayload>();
    const initial = new Map([
      ["file-main", "main-v0"],
      ["file-copy", "copy-v0"],
    ]);
    const afterArchive = new Map([
      ["file-main", "main-restored"],
      ["file-copy", "copy-restored"],
    ]);
    const afterProperty = new Map([
      ["file-main", "main-styled"],
      ["file-copy", "copy-styled"],
    ]);
    const projectEdit = vi.fn((_fileId, _nodeId, edit) =>
      edit.kind === "restoreMain" ? null : afterProperty,
    );
    const setup = queueArgs({
      projectEdit,
      invokeAction: vi.fn((payload: LinkedComponentEditPayload) => {
        if (payload.edit.kind === "restoreMain") {
          archiveCall.resolve(payload);
          return archiveResponse.promise;
        }
        propertyCall.resolve(payload);
        return propertyResponse.promise;
      }),
    });
    const queue = createLinkedComponentMutationQueue(setup.args);

    const archive = queue.enqueue("file-copy", "copy-root", {
      kind: "restoreMain",
    });
    const property = queue.enqueue("file-copy", "copy-root", {
      kind: "style",
      property: "color",
      value: "red",
    });

    expect(queue.blocksLocalContentEdits()).toBe(true);
    expect(queue.getProjectedContent("file-copy")).toBeUndefined();
    expect(projectEdit).toHaveBeenCalledOnce();
    await archiveCall.promise;
    archiveResponse.resolve(resultFor(initial, afterArchive, "saved-restore"));
    await propertyCall.promise;
    propertyResponse.resolve(
      resultFor(afterArchive, afterProperty, "saved-property"),
    );
    await Promise.all([archive, property]);

    expect(setup.content).toEqual(afterProperty);
    expect(setup.recordContentHistoryEntry).toHaveBeenCalledTimes(2);
    expect(setup.reportFailure).not.toHaveBeenCalled();
    expect(queue.blocksLocalContentEdits()).toBe(false);
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

  it("composes rapid semantic structure edits against the latest source bases", async () => {
    const firstResponse = deferred<LinkedComponentActionResult>();
    const secondResponse = deferred<LinkedComponentActionResult>();
    const firstCall = deferred<LinkedComponentEditPayload>();
    const secondCall = deferred<LinkedComponentEditPayload>();
    const setup = queueArgs();
    let structureCall = 0;
    setup.args.invokeAction = vi.fn((payload: LinkedComponentEditPayload) => {
      structureCall += 1;
      if (structureCall === 1) {
        firstCall.resolve(payload);
        return firstResponse.promise;
      }
      secondCall.resolve(payload);
      return secondResponse.promise;
    });
    const queue = createLinkedComponentMutationQueue(setup.args);
    const initial = new Map(setup.content);
    const afterFirst = new Map([
      ["file-main", "main-structure-v1"],
      ["file-copy", "copy-structure-v1"],
    ]);
    const afterSecond = new Map([
      ["file-main", "main-structure-v2"],
      ["file-copy", "copy-structure-v2"],
    ]);
    const first = queue.enqueue("file-main", "main-root", {
      kind: "structure",
      intents: [
        {
          kind: "wrapNodes",
          targetIds: ["layer-a", "layer-b"],
        },
      ],
    });
    const second = queue.enqueue("file-main", "main-root", {
      kind: "structure",
      intents: [
        {
          kind: "moveNode",
          target: { nodeId: "layer-a" },
          anchor: { nodeId: "layer-b" },
          placement: "after",
        },
      ],
    });
    const firstPayload = await firstCall.promise;
    expect(firstPayload.source.expectedFiles).toEqual(
      [...initial.entries()]
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([fileId, content]) => ({
          fileId,
          versionHash: sourceContentHash(content),
        })),
    );
    firstResponse.resolve(resultFor(initial, afterFirst, "saved-structure-v1"));
    const secondPayload = await secondCall.promise;
    expect(secondPayload.source.expectedFiles).toEqual(
      [...afterFirst.entries()]
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([fileId, content]) => ({
          fileId,
          versionHash: sourceContentHash(content),
        })),
    );
    secondResponse.resolve(
      resultFor(afterFirst, afterSecond, "saved-structure-v2"),
    );
    await Promise.all([first, second]);
    expect(setup.content).toEqual(afterSecond);
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

  it("applies a returned durable selection after replay and updates Redo history", async () => {
    const setup = queueArgs();
    const initial = new Map(setup.content);
    const after = new Map([
      ["file-main", "main-structure-v1"],
      ["file-copy", "copy-structure-v1"],
    ]);
    const events: string[] = [];
    const commit = vi.fn();
    const selectionAfter = {
      activeFileId: "file-main",
      selectedLayerIds: ["wrapper-durable"],
      overviewSelectedScreenIds: [],
      sourceContentByFileId: Object.fromEntries(after),
    };
    setup.args.reserveContentHistory = vi.fn(() => ({
      commit,
      cancel: vi.fn(),
    }));
    setup.args.invokeAction = vi.fn(async () => ({
      ...resultFor(initial, after, "saved-structure"),
      selection: { fileId: "file-main", nodeIds: ["wrapper-durable"] },
    }));
    setup.args.applyFileContentUpdate = vi.fn((fileId, content) => {
      events.push(`replay:${fileId}`);
      setup.content.set(fileId, content);
      return { status: "accepted" as const, content, nodeIdMap: new Map() };
    });
    setup.args.applySelection = vi.fn((selection) => {
      events.push(`selection:${selection.nodeIds.join(",")}`);
      expect(setup.content).toEqual(after);
      return selectionAfter;
    });

    const queue = createLinkedComponentMutationQueue(setup.args);
    await queue.enqueue(
      "file-main",
      "main-root",
      {
        kind: "structure",
        intents: [
          {
            kind: "wrapNodes",
            targetIds: ["layer-a", "layer-b"],
          },
        ],
      },
      undefined,
      () => events.push("applied"),
    );

    expect(events).toEqual([
      "replay:file-main",
      "replay:file-copy",
      "selection:wrapper-durable",
      "applied",
    ]);
    expect(commit).toHaveBeenCalledTimes(2);
    expect(commit).toHaveBeenNthCalledWith(1, [
      { fileId: "file-main", before: "main-v0", after: "main-structure-v1" },
      { fileId: "file-copy", before: "copy-v0", after: "copy-structure-v1" },
    ]);
    expect(commit).toHaveBeenNthCalledWith(
      2,
      [
        {
          fileId: "file-main",
          before: "main-v0",
          after: "main-structure-v1",
        },
        {
          fileId: "file-copy",
          before: "copy-v0",
          after: "copy-structure-v1",
        },
      ],
      selectionAfter,
    );
  });

  it("applies a durable selection when its snapshot captures only the selected owner", async () => {
    const initial = new Map([
      ["file-main", "main-v0"],
      ["file-copy", "copy-v0"],
    ]);
    const after = new Map([
      ["file-main", "main-v1"],
      ["file-copy", "copy-v1"],
    ]);
    const selectionBefore = {
      activeFileId: "file-copy",
      selectedLayerIds: ["copy-root"],
      overviewSelectedScreenIds: [],
      sourceContentByFileId: { "file-main": "main-v0" },
    };
    const selectionAfter = {
      ...selectionBefore,
      selectedLayerIds: ["wrapper-durable"],
      sourceContentByFileId: { "file-main": "main-v1" },
    };
    const setup = queueArgs({
      projectEdit: () => after,
      invokeAction: vi.fn(async () => ({
        ...resultFor(initial, after, "saved-structure"),
        selection: { fileId: "file-main", nodeIds: ["wrapper-durable"] },
      })),
      applySelection: vi.fn(() => selectionAfter),
    });
    setup.args.getCurrentSelection = () => ({
      ...selectionBefore,
      sourceContentByFileId: {
        "file-main": setup.content.get("file-main")!,
      },
    });
    const queue = createLinkedComponentMutationQueue(setup.args);

    await queue.enqueue(
      "file-main",
      "main-root",
      { kind: "structure", before: "main-v0", after: "main-v1" },
      selectionBefore,
    );

    expect(setup.args.applySelection).toHaveBeenCalledOnce();
  });

  it("preserves a newer user selection made during the host-write barrier", async () => {
    const response = deferred<LinkedComponentActionResult>();
    const actionCall = deferred<LinkedComponentEditPayload>();
    const hostWriteStarted = deferred<void>();
    const releaseHostWrite = deferred<void>();
    let hostWriteCalls = 0;
    const initial = new Map([
      ["file-main", "main-v0"],
      ["file-copy", "copy-v0"],
    ]);
    const after = new Map([
      ["file-main", "main-v1"],
      ["file-copy", "copy-v1"],
    ]);
    let currentSelection = {
      activeFileId: "file-copy",
      selectedLayerIds: ["copy-root"],
      overviewSelectedScreenIds: [] as string[],
      sourceContentByFileId: Object.fromEntries(initial),
    };
    let pendingSave: FileContentSaveRequest | undefined;
    const commit = vi.fn();
    const applySelection = vi.fn();
    const setup = queueArgs({
      projectEdit: () => after,
      getCurrentSelection: () => currentSelection,
      getPendingSave: (fileId) =>
        pendingSave?.id === fileId ? pendingSave : undefined,
      hasPendingSave: (fileId) => pendingSave?.id === fileId,
      reserveContentHistory: () => ({ commit, cancel: vi.fn() }),
      applySelection,
      waitForHostWrites: async () => {
        hostWriteCalls += 1;
        if (hostWriteCalls !== 2) return;
        hostWriteStarted.resolve();
        await releaseHostWrite.promise;
      },
      invokeAction: vi.fn((payload: LinkedComponentEditPayload) => {
        actionCall.resolve(payload);
        return response.promise;
      }),
    });
    const queue = createLinkedComponentMutationQueue(setup.args);
    const operation = queue.enqueue("file-main", "main-root", {
      kind: "structure",
      before: "main-v0",
      after: "main-v1",
    });
    await actionCall.promise;

    response.resolve({
      ...resultFor(initial, after, "saved-structure"),
      selection: { fileId: "file-main", nodeIds: ["wrapper-durable"] },
    });
    await hostWriteStarted.promise;
    setup.content.set("file-copy", "copy-v1+Metadata");
    pendingSave = {
      id: "file-copy",
      content: "copy-v1+Metadata",
      syncCollab: true,
      operationSource: "tab-1",
      operationRevision: 1,
      expectedVersionHash: sourceContentHash("copy-v1"),
    };
    currentSelection = {
      activeFileId: "file-copy",
      selectedLayerIds: ["user-selected-e"],
      overviewSelectedScreenIds: [],
      sourceContentByFileId: {
        "file-main": "main-v0",
        "file-copy": "copy-v1+Metadata",
      },
    };
    releaseHostWrite.resolve();
    await operation;

    expect(applySelection).not.toHaveBeenCalled();
    expect(setup.content.get("file-copy")).toBe("copy-v1+Metadata");
    expect(commit).toHaveBeenCalledOnce();
    expect(setup.reportFailure).not.toHaveBeenCalled();
  });

  it("keeps confirmed history when the action returns malformed selection metadata", async () => {
    const setup = queueArgs();
    const initial = new Map(setup.content);
    const after = new Map([
      ["file-main", "main-v1"],
      ["file-copy", "copy-v1"],
    ]);
    const commit = vi.fn();
    const cancel = vi.fn();
    const onApplied = vi.fn();
    setup.args.reserveContentHistory = vi.fn(() => ({ commit, cancel }));
    setup.args.invokeAction = vi.fn(async () => ({
      ...resultFor(initial, after, "saved-v1"),
      selection: { fileId: "file-main", nodeIds: ["", ""] },
    }));
    const queue = createLinkedComponentMutationQueue(setup.args);
    const result = await Promise.allSettled([
      queue.enqueue(
        "file-main",
        "main-root",
        {
          kind: "structure",
          intents: [
            {
              kind: "deleteNode",
              target: { nodeId: "layer-a" },
            },
          ],
        },
        undefined,
        onApplied,
      ),
    ]);

    expect(result[0]?.status).toBe("rejected");
    expect(commit).toHaveBeenCalledOnce();
    expect(cancel).not.toHaveBeenCalled();
    expect(onApplied).not.toHaveBeenCalled();
    expect(setup.applyFileContentUpdate).not.toHaveBeenCalled();
    expect(setup.refreshAfterConflict).toHaveBeenCalledOnce();
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
