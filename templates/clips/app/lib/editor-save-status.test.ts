import { describe, expect, it } from "vitest";

import {
  beginEditorSave,
  beginRecordingEditorOperation,
  createEditorSaveLedger,
  createEditorSaveQueue,
  enqueueEditorSave,
  enqueueRecordingEditorSave,
  finishEditorSave,
  hasPendingRecordingEditorSaves,
  isLatestEditorSave,
  refreshAfterRecordingEditorSaves,
  removeEditorHistoryEntry,
} from "./editor-save-status";

function deferred() {
  let resolve!: () => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<void>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
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

  it("rejects dependent saves after a failure and recovers for a new batch", async () => {
    const queue = createEditorSaveQueue();
    const failure = new Error("save failed");
    const firstStarted = deferred();
    const finishFirst = deferred();
    let persisted: string[] = [];

    const failed = enqueueEditorSave(queue, async () => {
      firstStarted.resolve();
      await finishFirst.promise;
      throw failure;
    });
    const dependent = enqueueEditorSave(queue, async () => {
      persisted = ["failed edit", "newer edit"];
    });
    const secondDependent = enqueueEditorSave(queue, async () => {
      persisted = ["failed edit", "newer edit", "latest edit"];
    });

    await firstStarted.promise;
    finishFirst.reject(failure);
    await expect(failed).rejects.toBe(failure);
    await expect(dependent).rejects.toBe(failure);
    await expect(secondDependent).rejects.toBe(failure);
    expect(persisted).toEqual([]);

    const nextBatch = enqueueEditorSave(queue, async () => {
      persisted = ["new edit"];
      return "saved";
    });

    await expect(nextBatch).resolves.toBe("saved");
    expect(persisted).toEqual(["new edit"]);
  });

  it("shares an in-flight queue across editor mounts for the same recording", async () => {
    const firstStarted = deferred();
    const finishFirst = deferred();
    const writes: string[] = [];

    const older = enqueueRecordingEditorSave(
      "recording-queue-test",
      "trims",
      async () => {
        firstStarted.resolve();
        await finishFirst.promise;
        writes.push("older editor");
      },
    );
    await firstStarted.promise;

    const newer = enqueueRecordingEditorSave(
      "recording-queue-test",
      "trims",
      async () => {
        writes.push("reopened editor");
      },
    );
    const otherRecording = enqueueRecordingEditorSave(
      "another-recording-queue-test",
      "trims",
      async () => {
        writes.push("other recording");
      },
    );
    const otherKind = enqueueRecordingEditorSave(
      "recording-queue-test",
      "overlays",
      async () => {
        writes.push("independent overlays");
      },
    );

    await Promise.all([otherRecording, otherKind]);
    expect(writes).toEqual(["other recording", "independent overlays"]);

    finishFirst.resolve();
    await Promise.all([older, newer]);
    expect(writes).toEqual([
      "other recording",
      "independent overlays",
      "older editor",
      "reopened editor",
    ]);
  });

  it("waits for prior recording saves before refreshing resumed editor data", async () => {
    const recordingId = "recording-resume-test";
    const trimStarted = deferred();
    const overlayStarted = deferred();
    const finishTrim = deferred();
    const finishOverlay = deferred();
    const persisted = { trims: [] as string[], overlays: [] as string[] };
    let refreshedTrims: string[] | null = null;
    let refreshedOverlays: string[] | null = null;

    const priorTrimSave = enqueueRecordingEditorSave(
      recordingId,
      "trims",
      async () => {
        trimStarted.resolve();
        await finishTrim.promise;
        persisted.trims = ["prior trim"];
      },
    );
    const priorOverlaySave = enqueueRecordingEditorSave(
      recordingId,
      "overlays",
      async () => {
        overlayStarted.resolve();
        await finishOverlay.promise;
        persisted.overlays = ["prior overlay"];
      },
    );
    await Promise.all([trimStarted.promise, overlayStarted.promise]);
    expect(hasPendingRecordingEditorSaves(recordingId)).toBe(true);

    const resume = refreshAfterRecordingEditorSaves(recordingId, async () => {
      refreshedTrims = [...persisted.trims];
      refreshedOverlays = [...persisted.overlays];
    });
    await Promise.resolve();
    expect(refreshedTrims).toBeNull();
    expect(refreshedOverlays).toBeNull();

    finishTrim.resolve();
    finishOverlay.resolve();
    await Promise.all([priorTrimSave, priorOverlaySave, resume]);
    expect(refreshedTrims).toEqual(["prior trim"]);
    expect(refreshedOverlays).toEqual(["prior overlay"]);
    expect(hasPendingRecordingEditorSaves(recordingId)).toBe(false);

    await enqueueRecordingEditorSave(recordingId, "trims", async () => {
      persisted.trims = [...(refreshedTrims ?? []), "reopened trim"];
    });
    expect(persisted.trims).toEqual(["prior trim", "reopened trim"]);

    const refreshError = new Error("refresh failed");
    await expect(
      refreshAfterRecordingEditorSaves(recordingId, async () => {
        throw refreshError;
      }),
    ).rejects.toBe(refreshError);
  });

  it("waits for a composite history operation to enqueue its later save", async () => {
    const recordingId = "recording-history-resume-test";
    const finishTrim = deferred();
    const persisted = { trims: [] as string[], overlays: [] as string[] };
    let refreshed: typeof persisted | null = null;
    const finishOperation = beginRecordingEditorOperation(recordingId);
    const priorTrimSave = enqueueRecordingEditorSave(
      recordingId,
      "trims",
      async () => {
        await finishTrim.promise;
        persisted.trims = ["undo trim"];
      },
    );

    const resume = refreshAfterRecordingEditorSaves(recordingId, async () => {
      refreshed = {
        trims: [...persisted.trims],
        overlays: [...persisted.overlays],
      };
    });

    finishTrim.resolve();
    await priorTrimSave;
    expect(hasPendingRecordingEditorSaves(recordingId)).toBe(true);
    expect(refreshed).toBeNull();

    const priorOverlaySave = enqueueRecordingEditorSave(
      recordingId,
      "overlays",
      async () => {
        persisted.overlays = ["undo overlay"];
      },
    );
    await priorOverlaySave;
    finishOperation();
    await resume;

    expect(refreshed).toEqual({
      trims: ["undo trim"],
      overlays: ["undo overlay"],
    });
    expect(hasPendingRecordingEditorSaves(recordingId)).toBe(false);
  });
});
