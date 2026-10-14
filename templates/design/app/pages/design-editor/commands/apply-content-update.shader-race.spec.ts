// @vitest-environment happy-dom

const shaderState = vi.hoisted(() => ({
  inFlight: false,
}));

vi.mock("@/components/design/inspector/GlslShaderPanel", () => ({
  isShaderWriteInFlight: () => shaderState.inFlight,
}));
vi.mock("sonner", () => ({ toast: { error: vi.fn() } }));

import { QueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as Y from "yjs";

import { getPersistedContentHostSyncOptions } from "../editor-state";
import { mergeLocalContentHistoryFallback } from "../history";
import type { ApplyFileContentUpdateArgs } from "./apply-file-content-update";
import { runApplyFileContentUpdate } from "./apply-file-content-update";
import type { ApplyLocalContentUpdateArgs } from "./apply-local-content-update";
import { runApplyLocalContentUpdate } from "./apply-local-content-update";

const BASE = `<!doctype html><html><body><main data-agent-native-node-id="root">Base</main></body></html>`;
const PERSISTED_BASE = `<!doctype html><html data-agent-native-node-id="html-root"><body data-agent-native-node-id="body-root"><main data-agent-native-node-id="root">Base</main></body></html>`;
const PERSISTED_SHADER_SOURCE = PERSISTED_BASE.replace(
  "Base",
  "Shader settled",
);
const STALE_EDIT = BASE.replace("Base", "Pending edit");

function fileArgs(args: {
  activeFileId: string;
  getScreenContent: (fileId: string) => string;
  queryClient?: QueryClient;
  applyLocalContentUpdate?: ApplyFileContentUpdateArgs["applyLocalContentUpdate"];
}): ApplyFileContentUpdateArgs {
  const activeFile = {
    id: args.activeFileId,
    filename: `${args.activeFileId}.html`,
    fileType: "html",
    content: BASE,
    createdAt: "2026-09-14T00:00:00.000Z",
    updatedAt: "2026-09-14T00:00:00.000Z",
  } as const;
  const screenFile = { ...activeFile, id: "screen" };
  const queryClient = args.queryClient ?? new QueryClient();
  queryClient.setQueryData(["action", "get-design", { id: "design" }], {
    files: [activeFile, screenFile],
  });
  return {
    acknowledgeAuthoritativeClipboardMutation: vi.fn(),
    activeFile,
    applyFileContentUpdate: vi.fn(),
    applyLocalContentUpdate:
      args.applyLocalContentUpdate ??
      vi.fn(() => ({ status: "refused" as const })),
    canEditDesignRef: { current: true },
    cancelQueuedFileContentSave: vi.fn(),
    clearPendingLocalFileContent: vi.fn(),
    files: [activeFile, screenFile],
    getScreenContent: args.getScreenContent,
    id: "design",
    markPendingLocalFileContent: vi.fn(),
    overviewIsSynced: false,
    overviewPresenceFileId: null,
    overviewYdoc: null,
    queryClient,
    queueFileContentSave: vi.fn(),
    recordContentHistoryEntry: vi.fn(),
    suppressContentHistoryRef: { current: false },
    t: (key) => key,
  };
}

function localArgs(
  queryClient = new QueryClient(),
  content = BASE,
): ApplyLocalContentUpdateArgs {
  const activeFile = {
    id: "active",
    filename: "active.html",
    fileType: "html",
    content,
    createdAt: "2026-09-14T00:00:00.000Z",
    updatedAt: "2026-09-14T00:00:00.000Z",
  };
  queryClient.setQueryData(["action", "get-design", { id: "design" }], {
    files: [activeFile],
  });
  return {
    acknowledgeAuthoritativeClipboardMutation: vi.fn(),
    activeFile,
    canEditDesignRef: { current: true },
    cancelQueuedFileContentSave: vi.fn(),
    clearPendingLocalFileContent: vi.fn(),
    collabContentFileIdRef: { current: "active" },
    collabContentRef: { current: content },
    id: "design",
    isSynced: false,
    lastLocalContentRef: { current: content },
    latestActiveContentRef: { current: content },
    markPendingLocalFileContent: vi.fn(),
    queryClient,
    queueFileContentSave: vi.fn(),
    recordContentHistoryEntry: vi.fn(),
    recordLocalContentHistoryChangeFallback: vi.fn(),
    recordLocalContentHistoryEntry: vi.fn(),
    replacePreviewContent: () => "applied",
    setCollabContent: vi.fn(),
    setCollabContentFileId: vi.fn(),
    setContentRenderRevision: vi.fn(),
    suppressContentHistoryRef: { current: false },
    t: (key) => key,
    undoManagerRef: { current: null },
    viewModeRef: { current: "single" },
    ydoc: null,
  };
}

afterEach(() => {
  shaderState.inFlight = false;
  vi.clearAllMocks();
});

describe("shader-locked source publication", () => {
  it.each([
    { path: "non-active file", fileId: "screen", activeFileId: "active" },
    { path: "active file", fileId: "active", activeFileId: "active" },
  ])(
    "refuses a raw whole-document write to the $path",
    ({ fileId, activeFileId }) => {
      shaderState.inFlight = true;
      const args = fileArgs({
        activeFileId,
        getScreenContent: () => BASE,
      });

      const result = runApplyFileContentUpdate(args, fileId, STALE_EDIT, {
        historyBeforeContent: "older undo snapshot",
        sourceBaseContent: BASE,
      });
      expect(result).toEqual({ status: "refused" });

      expect(toast.error).toHaveBeenCalledWith(
        "designEditor.toasts.saveConflict",
        { id: `design-source-shader-conflict:${fileId}` },
      );
      expect(args.applyFileContentUpdate).not.toHaveBeenCalled();
      expect(args.applyLocalContentUpdate).not.toHaveBeenCalled();
      expect(args.queueFileContentSave).not.toHaveBeenCalled();
      expect(args.recordContentHistoryEntry).not.toHaveBeenCalled();
      args.queryClient.clear();
    },
  );

  it("refuses direct local writes while a shader write owns the active source", () => {
    shaderState.inFlight = true;
    const queueFileContentSave = vi.fn();
    const args = {
      activeFile: {
        id: "active",
        filename: "active.html",
        fileType: "html",
        content: BASE,
      },
      canEditDesignRef: { current: true },
      queueFileContentSave,
      t: (key: string) => key,
    } as unknown as ApplyLocalContentUpdateArgs;

    const result = runApplyLocalContentUpdate(args, STALE_EDIT);

    expect(result).toEqual({ status: "refused" });
    expect(toast.error).toHaveBeenCalledWith(
      "designEditor.toasts.saveConflict",
      { id: "design-source-shader-conflict:active" },
    );
    expect(queueFileContentSave).not.toHaveBeenCalled();
  });

  it("lets the shader's own persisted host sync pass through its write lock", () => {
    shaderState.inFlight = true;
    const queryClient = new QueryClient();
    const localWriterArgs = localArgs(queryClient, PERSISTED_BASE);
    const args = fileArgs({
      activeFileId: "active",
      getScreenContent: () => BASE,
      queryClient,
      applyLocalContentUpdate: (content, options) =>
        runApplyLocalContentUpdate(localWriterArgs, content, options),
    });

    const result = runApplyFileContentUpdate(
      args,
      "active",
      PERSISTED_SHADER_SOURCE,
      getPersistedContentHostSyncOptions({
        fileId: "active",
        activeFileId: "active",
        shaderWriteCompletion: true,
        updatedAt: "T2",
      }),
    );

    expect(result.status).toBe("accepted");
    expect(localWriterArgs.collabContentRef.current).toBe(
      PERSISTED_SHADER_SOURCE,
    );
    expect(localWriterArgs.queueFileContentSave).not.toHaveBeenCalled();
    expect(toast.error).not.toHaveBeenCalled();
    queryClient.clear();
  });

  it("does not replay a committed shader insertion into stale collaborative text", () => {
    shaderState.inFlight = true;
    const clientDoc = new Y.Doc();
    clientDoc.getText("content").insert(0, PERSISTED_BASE);
    const serverDoc = new Y.Doc();
    Y.applyUpdate(serverDoc, Y.encodeStateAsUpdate(clientDoc));
    const serverText = serverDoc.getText("content");
    const insertion = PERSISTED_SHADER_SOURCE.indexOf("Shader settled");
    serverText.delete(insertion, "Base".length);
    serverText.insert(insertion, "Shader settled");
    const localWriterArgs = localArgs(new QueryClient(), PERSISTED_BASE);
    localWriterArgs.ydoc = clientDoc;
    localWriterArgs.isSynced = true;
    const args = fileArgs({
      activeFileId: "active",
      getScreenContent: () => PERSISTED_BASE,
      queryClient: localWriterArgs.queryClient,
      applyLocalContentUpdate: (content, options) =>
        runApplyLocalContentUpdate(localWriterArgs, content, options),
    });
    const options = getPersistedContentHostSyncOptions({
      fileId: "active",
      activeFileId: "active",
      shaderWriteCompletion: true,
      updatedAt: "T2",
      beforeContent: PERSISTED_BASE,
    });
    const result = runApplyFileContentUpdate(
      args,
      "active",
      PERSISTED_SHADER_SOURCE,
      options,
    );
    expect(result.status).toBe("accepted");
    expect(clientDoc.getText("content").toString()).toBe(PERSISTED_BASE);
    expect(localWriterArgs.queueFileContentSave).not.toHaveBeenCalled();
    Y.applyUpdate(clientDoc, Y.encodeStateAsUpdate(serverDoc));
    expect(clientDoc.getText("content").toString()).toBe(
      PERSISTED_SHADER_SOURCE,
    );
    clientDoc.destroy();
    serverDoc.destroy();
    localWriterArgs.queryClient.clear();
  });

  it("refuses generic persisted host sync while a shader write owns the file", () => {
    shaderState.inFlight = true;
    const args = fileArgs({
      activeFileId: "active",
      getScreenContent: () => BASE,
    });

    const result = runApplyFileContentUpdate(
      args,
      "active",
      PERSISTED_SHADER_SOURCE,
      getPersistedContentHostSyncOptions({
        fileId: "active",
        activeFileId: "active",
        updatedAt: "T2",
      }),
    );

    expect(result).toEqual({ status: "refused" });
    expect(toast.error).toHaveBeenCalledWith(
      "designEditor.toasts.saveConflict",
      { id: "design-source-shader-conflict:active" },
    );
    expect(args.applyLocalContentUpdate).not.toHaveBeenCalled();
    expect(args.recordContentHistoryEntry).not.toHaveBeenCalled();
    args.queryClient.clear();
  });
});

describe("already-accepted source publication", () => {
  it("keeps successive committed shader actions as separate undo steps", () => {
    const args = localArgs(new QueryClient(), PERSISTED_BASE);
    const doc = new Y.Doc();
    const text = doc.getText("content");
    text.insert(0, PERSISTED_BASE);
    args.ydoc = doc;
    args.isSynced = true;
    const undoManager = new Y.UndoManager(text);
    args.undoManagerRef.current = undoManager;
    const changedParam = PERSISTED_SHADER_SOURCE.replace(
      "Shader settled",
      "Saturation 0",
    );
    for (const [before, after] of [
      [PERSISTED_BASE, PERSISTED_SHADER_SOURCE],
      [PERSISTED_SHADER_SOURCE, changedParam],
    ]) {
      const result = runApplyLocalContentUpdate(
        args,
        after,
        getPersistedContentHostSyncOptions({
          fileId: "active",
          activeFileId: "active",
          shaderWriteCompletion: true,
          beforeContent: before,
          updatedAt: "T2",
        }),
      );
      expect(result.status).toBe("accepted");
      text.delete(0, text.length);
      text.insert(0, after);
    }
    const changes = vi
      .mocked(args.recordLocalContentHistoryChangeFallback)
      .mock.calls.map(([change]) => change);
    expect(changes).toMatchObject([
      {
        before: PERSISTED_BASE,
        after: PERSISTED_SHADER_SOURCE,
        isCheckpoint: true,
      },
      {
        before: PERSISTED_SHADER_SOURCE,
        after: changedParam,
        isCheckpoint: true,
      },
    ]);
    expect(changes.reduce(mergeLocalContentHistoryFallback, [])).toHaveLength(
      2,
    );
    undoManager.destroy();
    doc.destroy();
    args.queryClient.clear();
  });

  it("publishes active accepted content without cancelling or enqueueing a save", () => {
    const accepted = PERSISTED_BASE.replace("Base", "Accepted upload");
    const args = localArgs(new QueryClient(), PERSISTED_BASE);

    const result = runApplyLocalContentUpdate(args, accepted, {
      serverAccepted: true,
      historyBeforeContent: PERSISTED_BASE,
      sourceBaseContent: PERSISTED_BASE,
    });

    expect(result).toMatchObject({ status: "accepted", content: accepted });
    expect(args.queueFileContentSave).not.toHaveBeenCalled();
    expect(args.cancelQueuedFileContentSave).not.toHaveBeenCalled();
    expect(args.collabContentRef.current).toBe(accepted);
    expect(args.latestActiveContentRef.current).toBe(accepted);
    expect(args.recordLocalContentHistoryEntry).toHaveBeenCalledWith(
      expect.objectContaining({
        before: PERSISTED_BASE,
        after: accepted,
      }),
    );
    args.queryClient.clear();
  });

  it("publishes accepted inactive content without starting another save", () => {
    const accepted = PERSISTED_BASE.replace("Base", "Accepted upload");
    const args = fileArgs({
      activeFileId: "active",
      getScreenContent: () => PERSISTED_BASE,
    });

    const result = runApplyFileContentUpdate(args, "screen", accepted, {
      serverAccepted: true,
      historyBeforeContent: PERSISTED_BASE,
      sourceBaseContent: PERSISTED_BASE,
    });

    expect(result).toMatchObject({ status: "accepted", content: accepted });
    expect(args.queueFileContentSave).not.toHaveBeenCalled();
    expect(args.cancelQueuedFileContentSave).not.toHaveBeenCalled();
    expect(args.markPendingLocalFileContent).toHaveBeenCalledWith(
      "screen",
      accepted,
      "2026-09-14T00:00:00.000Z",
      undefined,
    );
    args.queryClient.clear();
  });
});
