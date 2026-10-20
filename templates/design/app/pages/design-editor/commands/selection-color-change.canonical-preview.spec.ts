import { expect, it, vi } from "vitest";

import { runApplyFileContentUpdate } from "@/pages/design-editor/commands/apply-file-content-update";
import type { ApplyFileContentUpdateResult } from "@/pages/design-editor/commands/apply-file-content-update";
import {
  restoreSelectionColorPreview,
  type SelectionColorPreviewHistoryEntry,
} from "@/pages/design-editor/commands/selection-color-change";

const fileId = "screen-a";
const before =
  '<main><div data-agent-native-group="true" class="group"><div style="background:#f97316"></div></div></main>';
const requestedPreview = before.replace("#f97316", "#3b82f6");
const file = {
  id: fileId,
  filename: "screen-a.html",
  fileType: "html",
  content: before,
  createdAt: "2026-09-12T00:00:00.000Z",
  updatedAt: "2026-09-13T00:00:00.000Z",
} as const;

function writeNonactive(currentContent: string, nextContent: string) {
  return runApplyFileContentUpdate(
    {
      acknowledgeAuthoritativeClipboardMutation: () => {},
      activeFile: { ...file, id: "other-screen" },
      applyFileContentUpdate: () => {},
      applyLocalContentUpdate: () => ({ status: "refused" }),
      canEditDesignRef: { current: true },
      cancelQueuedFileContentSave: () => {},
      clearPendingLocalFileContent: () => {},
      files: [file],
      getScreenContent: () => currentContent,
      id: undefined,
      markPendingLocalFileContent: () => {},
      overviewIsSynced: false,
      overviewPresenceFileId: null,
      overviewYdoc: null,
      queryClient: { setQueryData: vi.fn() } as never,
      queueFileContentSave: () => {},
      recordContentHistoryEntry: () => {},
      suppressContentHistoryRef: { current: false },
      t: () => "Save failed",
    } as never,
    fileId,
    nextContent,
    {
      historyBeforeContent: currentContent,
      persist: false,
      recordHistory: false,
    },
  );
}

it("tracks the canonical accepted preview so cancel restores it, but refuses stale rollback", () => {
  const acceptedPreview = writeNonactive(before, requestedPreview);
  expect(acceptedPreview.status).toBe("accepted");
  if (acceptedPreview.status !== "accepted") return;
  expect(acceptedPreview.content).not.toBe(requestedPreview);
  expect(acceptedPreview.content).toContain("#3b82f6");

  let restoredContent: string | undefined;
  const applyFileContentUpdate = vi.fn(
    (targetFileId: string, content: string): ApplyFileContentUpdateResult => {
      const restored = writeNonactive(acceptedPreview.content, content);
      expect(targetFileId).toBe(fileId);
      expect(restored.status).toBe("accepted");
      if (restored.status === "accepted") {
        restoredContent = restored.content;
      }
      return restored;
    },
  );
  const args = {
    activeFileId: fileId,
    applyFileContentUpdate,
    previewHistoryRef: {
      current: new Map<string, SelectionColorPreviewHistoryEntry>([
        [fileId, { before, after: acceptedPreview.content }],
      ]),
    },
  };

  const restoreResult = restoreSelectionColorPreview(
    args,
    fileId,
    acceptedPreview.content,
  );
  expect(args.previewHistoryRef.current.has(fileId)).toBe(false);
  expect(restoreResult).toBe("accepted");
  expect(applyFileContentUpdate).toHaveBeenCalledWith(fileId, before, {
    forcePreviewFullDocument: true,
    persist: false,
    recordHistory: false,
  });
  expect(restoredContent).toContain("#f97316");
  expect(restoredContent).not.toContain("#3b82f6");

  args.previewHistoryRef.current.set(fileId, {
    before,
    after: acceptedPreview.content,
  });
  const staleApply = vi.fn();
  const staleResult = restoreSelectionColorPreview(
    {
      activeFileId: fileId,
      applyFileContentUpdate: staleApply,
      previewHistoryRef: args.previewHistoryRef,
    },
    fileId,
    `${acceptedPreview.content}<p>newer source</p>`,
  );
  expect(args.previewHistoryRef.current.has(fileId)).toBe(false);
  expect(staleResult).toBe("stale");
  expect(staleApply).not.toHaveBeenCalled();
});
