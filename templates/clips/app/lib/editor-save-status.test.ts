import { describe, expect, it } from "vitest";

import {
  beginEditorSave,
  createEditorSaveLedger,
  finishEditorSave,
} from "./editor-save-status";

describe("editor save status", () => {
  it("reports when timeline edits are saved", () => {
    const ledger = createEditorSaveLedger();
    const generation = beginEditorSave(ledger, "trims");

    expect(finishEditorSave(ledger, "trims", generation, true)).toBe("saved");
  });

  it("keeps a failed trim visible when overlays save successfully", () => {
    const ledger = createEditorSaveLedger();
    const trimGeneration = beginEditorSave(ledger, "trims");
    const overlayGeneration = beginEditorSave(ledger, "overlays");

    expect(finishEditorSave(ledger, "trims", trimGeneration, false)).toBe(
      "saving",
    );
    expect(finishEditorSave(ledger, "overlays", overlayGeneration, true)).toBe(
      "error",
    );
  });

  it("clears a failure after a newer save replaces that edit kind", () => {
    const ledger = createEditorSaveLedger();
    const failedGeneration = beginEditorSave(ledger, "trims");
    finishEditorSave(ledger, "trims", failedGeneration, false);

    const retryGeneration = beginEditorSave(ledger, "trims");
    expect(finishEditorSave(ledger, "trims", retryGeneration, true)).toBe(
      "saved",
    );
  });

  it("does not let an older failed request override a newer successful save", () => {
    const ledger = createEditorSaveLedger();
    const olderGeneration = beginEditorSave(ledger, "trims");
    const newerGeneration = beginEditorSave(ledger, "trims");

    expect(finishEditorSave(ledger, "trims", newerGeneration, true)).toBe(
      "saving",
    );
    expect(finishEditorSave(ledger, "trims", olderGeneration, false)).toBe(
      "saved",
    );
  });

  it("keeps an older success from hiding a newer failed request", () => {
    const ledger = createEditorSaveLedger();
    const olderGeneration = beginEditorSave(ledger, "overlays");
    const newerGeneration = beginEditorSave(ledger, "overlays");

    expect(finishEditorSave(ledger, "overlays", newerGeneration, false)).toBe(
      "saving",
    );
    expect(finishEditorSave(ledger, "overlays", olderGeneration, true)).toBe(
      "error",
    );
  });
});
