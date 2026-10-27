import { describe, expect, it, vi } from "vitest";

import type { ApplyFileContentUpdateResult } from "./apply-file-content-update";
import type {
  SelectionColorChangeArgs,
  SelectionColorPreviewHistoryEntry,
} from "./selection-color-change";
import { runSelectionColorChange } from "./selection-color-change";

describe("runSelectionColorChange", () => {
  it("starts the next preview and commit from fresh bytes after a stale cancel", () => {
    const previewHistoryRef = {
      current: new Map<string, SelectionColorPreviewHistoryEntry>([
        ["screen", { before: "old source", after: "old preview" }],
      ]),
    };
    const applyFileContentUpdate = vi.fn(
      (): ApplyFileContentUpdateResult => ({
        status: "accepted",
        content: "",
        nodeIdMap: new Map(),
      }),
    );
    const freshContent = '<main><div style="background:#f97316"></div></main>';
    const freshScope = {
      fileId: "screen",
      content: freshContent,
      wholeDocument: true,
    };
    const commandArgs: SelectionColorChangeArgs = {
      activeFileId: "screen",
      applyFileContentUpdate,
      canEditDesign: true,
      recordContentHistoryEntry: vi.fn(),
      previewHistoryRef,
      pickerSessionRef: { current: new Map() },
      scopes: [freshScope],
    };
    expect(
      runSelectionColorChange(commandArgs, "#f97316", "#f97316", {
        phase: "cancel",
      }),
    ).toEqual({ status: "applied" });
    expect(previewHistoryRef.current.has("screen")).toBe(false);
    expect(applyFileContentUpdate).not.toHaveBeenCalled();
    expect(
      runSelectionColorChange(commandArgs, "#f97316", "#3b82f6", {
        phase: "preview",
      }),
    ).toEqual({ status: "applied" });
    const freshPreview = previewHistoryRef.current.get("screen");
    expect(freshPreview?.before).toBe(freshContent);
    expect(freshPreview?.after).toContain("#3b82f6");

    expect(
      runSelectionColorChange(
        {
          ...commandArgs,
          scopes: [{ ...freshScope, content: freshPreview!.after }],
        },
        "#f97316",
        "#3b82f6",
        { phase: "commit" },
      ),
    ).toEqual({ status: "applied" });
    expect(applyFileContentUpdate).toHaveBeenNthCalledWith(
      2,
      "screen",
      freshPreview!.after,
      expect.objectContaining({
        historyBeforeContent: freshContent,
        persist: true,
      }),
    );
  });
});
