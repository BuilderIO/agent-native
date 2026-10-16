import { describe, expect, it, vi } from "vitest";

import { runCutSelection } from "./cut-selection";

describe("cut selection", () => {
  it("keeps the selection when the OS clipboard write fails", async () => {
    const deleteSelection = vi.fn();

    await runCutSelection({
      copySelection: async () => ({ copied: true, written: false }),
      deleteSelection,
      getSelectedLayerIds: () => ["layer-1"],
      getSelectionContentKey: () => "content",
    });

    expect(deleteSelection).not.toHaveBeenCalled();
  });

  it("keeps the selection if it changes while the clipboard write is pending", async () => {
    let resolveCopy!: (result: { copied: boolean; written: boolean }) => void;
    let selectedLayerIds = ["layer-1"];
    const deleteSelection = vi.fn();
    const copying = runCutSelection({
      copySelection: () =>
        new Promise((resolve) => {
          resolveCopy = resolve;
        }),
      deleteSelection,
      getSelectedLayerIds: () => selectedLayerIds,
      getSelectionContentKey: () => "content",
    });

    selectedLayerIds = ["layer-2"];
    resolveCopy({ copied: true, written: true });
    await copying;

    expect(deleteSelection).not.toHaveBeenCalled();
  });

  it("keeps the selection if its content changes while the clipboard write is pending", async () => {
    let resolveCopy!: (result: { copied: boolean; written: boolean }) => void;
    let contentKey = "before";
    const deleteSelection = vi.fn();
    const copying = runCutSelection({
      copySelection: () =>
        new Promise((resolve) => {
          resolveCopy = resolve;
        }),
      deleteSelection,
      getSelectedLayerIds: () => ["layer-1"],
      getSelectionContentKey: () => contentKey,
    });

    contentKey = "after";
    resolveCopy({ copied: true, written: true });
    await copying;

    expect(deleteSelection).not.toHaveBeenCalled();
  });

  it("deletes the unchanged selection after a successful clipboard write", async () => {
    const deleteSelection = vi.fn();

    await runCutSelection({
      copySelection: async () => ({ copied: true, written: true }),
      deleteSelection,
      getSelectedLayerIds: () => ["layer-1"],
      getSelectionContentKey: () => "content",
    });

    expect(deleteSelection).toHaveBeenCalledOnce();
  });
});
