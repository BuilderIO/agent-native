import { describe, expect, it } from "vitest";

import {
  clearCompletedTweakSave,
  createQueuedTweakSave,
  rebaseTweakSaveForSend,
  retainLatestFailedTweakSave,
} from "./tweak-save";

describe("tweak save ordering", () => {
  it("keeps the first persisted base across a debounced knob gesture", () => {
    const first = createQueuedTweakSave(
      { density: "compact" },
      1,
      "base-a",
      null,
    );
    const second = createQueuedTweakSave(
      { density: "comfortable" },
      2,
      "base-b",
      first,
    );

    expect(second.expectedSelectionsHash).toBe("base-a");
  });

  it("rebases only when a serialized request reaches the send boundary", () => {
    const queued = createQueuedTweakSave(
      { density: "compact" },
      2,
      "old-base",
      null,
    );

    expect(rebaseTweakSaveForSend(queued, "verified-predecessor")).toMatchObject(
      { expectedSelectionsHash: "verified-predecessor", revision: 2 },
    );
  });

  it("retains a failed latest edit but never replaces a newer queued snapshot", () => {
    const failed = createQueuedTweakSave(
      { density: "compact" },
      1,
      "base",
      null,
    );
    const newer = createQueuedTweakSave(
      { density: "comfortable" },
      2,
      "base",
      null,
    );

    expect(retainLatestFailedTweakSave(null, failed)).toBe(failed);
    expect(retainLatestFailedTweakSave(newer, failed)).toBe(newer);
    expect(clearCompletedTweakSave(newer, 1)).toBe(newer);
    expect(clearCompletedTweakSave(newer, 2)).toBeNull();
  });
});
