import { describe, expect, it } from "vitest";

import {
  beginEditorSave,
  createEditorSaveLedger,
  createEditorSaveQueue,
  enqueueEditorSave,
  finishEditorSave,
  isLatestEditorSave,
  removeEditorHistoryEntry,
} from "./editor-save-status";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

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

  it("keeps optimistic state owned by the newest save of that kind", () => {
    const ledger = createEditorSaveLedger();
    const older = beginEditorSave(ledger, "trims");
    const newer = beginEditorSave(ledger, "trims");

    expect(isLatestEditorSave(ledger, "trims", older)).toBe(false);
    expect(isLatestEditorSave(ledger, "trims", newer)).toBe(true);
  });

  it("removes only the history snapshot belonging to a failed save", () => {
    const older = { trims: [{ id: "older" }] };
    const newer = { trims: [{ id: "newer" }] };

    const remaining = removeEditorHistoryEntry([older, newer], older);

    expect(remaining).toHaveLength(1);
    expect(remaining[0]).toBe(newer);
  });
});

describe("editor save queue", () => {
  it("persists newer whole-list saves after earlier saves settle", async () => {
    const queue = createEditorSaveQueue();
    const firstStarted = deferred();
    const finishFirst = deferred();
    const writes: string[] = [];
    let secondStarted = false;

    const older = enqueueEditorSave(queue, async () => {
      firstStarted.resolve();
      await finishFirst.promise;
      writes.push("older");
    });
    const newer = enqueueEditorSave(queue, async () => {
      secondStarted = true;
      writes.push("newer");
    });

    await firstStarted.promise;
    expect(secondStarted).toBe(false);
    finishFirst.resolve();
    await Promise.all([older, newer]);

    expect(writes).toEqual(["older", "newer"]);
    expect(writes[writes.length - 1]).toBe("newer");
  });

  it("continues after a failed save while preserving its rejection", async () => {
    const queue = createEditorSaveQueue();
    const failure = new Error("save failed");

    const failed = enqueueEditorSave(queue, async () => {
      throw failure;
    });
    const next = enqueueEditorSave(queue, async () => "saved");

    await expect(failed).rejects.toBe(failure);
    await expect(next).resolves.toBe("saved");
  });
});
