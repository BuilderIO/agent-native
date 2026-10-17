import { describe, expect, it, vi } from "vitest";

import {
  createPersistedContentHostSyncHandler,
  getPersistedContentHostSyncOptions,
  type PersistedContentHostSyncWriter,
} from "./design-editor/editor-state";

describe("getPersistedContentHostSyncOptions — shader apply host-sync routing", () => {
  it("routes an active-file apply through the in-place full-document replace", () => {
    const options = getPersistedContentHostSyncOptions({
      fileId: "screen-1",
      activeFileId: "screen-1",
      updatedAt: "2026-07-07T00:00:00.000Z",
    });
    expect(options).toStrictEqual({
      forcePreviewFullDocument: true,
      persist: false,
      updatedAt: "2026-07-07T00:00:00.000Z",
    });
  });

  it("NEVER requests refreshPreview — that flag forces the srcdoc rebuild (white flash)", () => {
    for (const activeFileId of ["screen-1", "screen-2", null, undefined]) {
      const options = getPersistedContentHostSyncOptions({
        fileId: "screen-1",
        activeFileId,
        updatedAt: "2026-07-07T00:00:00.000Z",
      });
      expect("refreshPreview" in options).toBe(false);
      expect(Object.keys(options).sort()).toStrictEqual([
        "forcePreviewFullDocument",
        "persist",
        "updatedAt",
      ]);
    }
  });

  it("does not force a preview route for a non-active file (cross-file branch owns its own sync)", () => {
    const options = getPersistedContentHostSyncOptions({
      fileId: "screen-2",
      activeFileId: "screen-1",
      updatedAt: "2026-07-07T00:00:00.000Z",
    });
    expect(options.forcePreviewFullDocument).toBe(false);
  });

  it("never treats a missing active file as a match", () => {
    expect(
      getPersistedContentHostSyncOptions({
        fileId: "screen-1",
        activeFileId: null,
      }).forcePreviewFullDocument,
    ).toBe(false);
    expect(
      getPersistedContentHostSyncOptions({
        fileId: "screen-1",
        activeFileId: undefined,
      }).forcePreviewFullDocument,
    ).toBe(false);
  });

  it("keeps generic persisted host sync out of the shader-lock exception", () => {
    const withStamp = getPersistedContentHostSyncOptions({
      fileId: "screen-1",
      activeFileId: "screen-1",
      updatedAt: "2026-07-07T12:34:56.789Z",
    });
    expect(withStamp.persist).toBe(false);
    expect(withStamp.shaderWriteCompletion).toBeUndefined();
    expect(withStamp.updatedAt).toBe("2026-07-07T12:34:56.789Z");

    const shaderCompletion = getPersistedContentHostSyncOptions({
      fileId: "screen-1",
      activeFileId: "screen-1",
      shaderWriteCompletion: true,
    });
    expect(shaderCompletion.shaderWriteCompletion).toBe(true);

    const withoutStamp = getPersistedContentHostSyncOptions({
      fileId: "screen-1",
      activeFileId: "screen-1",
    });
    expect(withoutStamp.persist).toBe(false);
    expect(withoutStamp.shaderWriteCompletion).toBeUndefined();
    expect(withoutStamp.updatedAt).toBeUndefined();
  });

  it("uses the original target with the current writer after a Screen switch", () => {
    const originalWriter = vi.fn();
    const currentWriter = vi.fn();
    const activeFileIdRef = { current: "screen-a" as string | null };
    const applyFileContentUpdateRef = {
      current: originalWriter as PersistedContentHostSyncWriter,
    };
    const onApplied = createPersistedContentHostSyncHandler({
      activeFileIdRef,
      applyFileContentUpdateRef,
      shaderWriteCompletion: true,
    });

    activeFileIdRef.current = "screen-b";
    applyFileContentUpdateRef.current = currentWriter;
    onApplied("screen-a", "settled source", "T2");

    expect(originalWriter).not.toHaveBeenCalled();
    expect(currentWriter).toHaveBeenCalledWith("screen-a", "settled source", {
      forcePreviewFullDocument: false,
      persist: false,
      shaderWriteCompletion: true,
      updatedAt: "T2",
    });
  });
});
