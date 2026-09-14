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

import { getPersistedContentHostSyncOptions } from "../editor-state";
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
