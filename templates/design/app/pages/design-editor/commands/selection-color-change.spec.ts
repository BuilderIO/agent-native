import { describe, expect, it, vi } from "vitest";

import type { ApplyFileContentUpdateResult } from "./apply-file-content-update";
import type {
  SelectionColorChangeArgs,
  SelectionColorPreviewHistoryEntry,
} from "./selection-color-change";
import {
  restoreSelectionColorPreview,
  runSelectionColorChange,
} from "./selection-color-change";

describe("restoreSelectionColorPreview", () => {
  it("restores a matching live preview without saving or recording history", () => {
    const applyFileContentUpdate = vi.fn(
      (): ApplyFileContentUpdateResult => ({
        status: "accepted",
        content: "before",
        nodeIdMap: new Map(),
      }),
    );
    const previewHistoryRef = {
      current: new Map<string, SelectionColorPreviewHistoryEntry>([
        ["screen", { before: "before", after: "preview" }],
      ]),
    };

    const result = restoreSelectionColorPreview(
      {
        activeFileId: "screen",
        applyFileContentUpdate,
        previewHistoryRef,
      },
      "screen",
      "preview",
    );
    expect(previewHistoryRef.current.has("screen")).toBe(false);
    expect(result).toBe("accepted");
    expect(applyFileContentUpdate).toHaveBeenCalledWith("screen", "before", {
      forcePreviewFullDocument: true,
      persist: false,
      recordHistory: false,
    });
  });

  it("does not restore over content that changed after the preview", () => {
    const applyFileContentUpdate = vi.fn(
      (): ApplyFileContentUpdateResult => ({ status: "refused" }),
    );
    const previewHistoryRef = {
      current: new Map<string, SelectionColorPreviewHistoryEntry>([
        ["screen", { before: "before", after: "preview" }],
      ]),
    };

    const result = restoreSelectionColorPreview(
      {
        activeFileId: "screen",
        applyFileContentUpdate,
        previewHistoryRef,
      },
      "screen",
      "concurrent edit",
    );
    expect(previewHistoryRef.current.has("screen")).toBe(false);
    expect(result).toBe("stale");
    expect(applyFileContentUpdate).not.toHaveBeenCalled();
  });

  it.each(["refused", "deferred"] as const)(
    "retains a matching preview after a $status restore and allows an accepted retry",
    (status) => {
      const failedResult: ApplyFileContentUpdateResult =
        status === "refused" ? { status: "refused" } : { status: "deferred" };
      const entry = { before: "before", after: "preview" };
      const previewHistoryRef = {
        current: new Map<string, SelectionColorPreviewHistoryEntry>([
          ["screen", entry],
        ]),
      };
      const applyFileContentUpdate = vi.fn(
        (): ApplyFileContentUpdateResult => failedResult,
      );
      const args = {
        activeFileId: "screen",
        applyFileContentUpdate,
        previewHistoryRef,
      };

      const result = restoreSelectionColorPreview(args, "screen", "preview");
      expect(previewHistoryRef.current.get("screen")).toBe(entry);
      expect(result).toBe(status);

      const acceptedApply = vi.fn(
        (): ApplyFileContentUpdateResult => ({
          status: "accepted",
          content: "before",
          nodeIdMap: new Map(),
        }),
      );
      expect(
        restoreSelectionColorPreview(
          { ...args, applyFileContentUpdate: acceptedApply },
          "screen",
          "preview",
        ),
      ).toBe("accepted");
      expect(previewHistoryRef.current.has("screen")).toBe(false);
      expect(acceptedApply).toHaveBeenCalledWith("screen", "before", {
        forcePreviewFullDocument: true,
        persist: false,
        recordHistory: false,
      });
    },
  );

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
    const staleResult = restoreSelectionColorPreview(
      {
        activeFileId: "screen",
        applyFileContentUpdate,
        previewHistoryRef,
      },
      "screen",
      "peer source",
    );
    expect(previewHistoryRef.current.has("screen")).toBe(false);
    expect(staleResult).toBe("stale");
    expect(applyFileContentUpdate).not.toHaveBeenCalled();

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
      runSelectionColorChange(
        commandArgs,
        "#f97316",
        "#3b82f6",
        { phase: "preview" },
        "fill-colors",
      ),
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
        "fill-colors",
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
