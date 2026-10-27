import { afterEach, describe, expect, it, vi } from "vitest";

import {
  COLLAB_FLUSH_BEFORE_SAVE_MS,
  flushBeforeSave,
} from "./collab-flush-before-save";

describe("collaboration flush before a save", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("stops waiting for a flush that stalls", async () => {
    vi.useFakeTimers();
    const waited = flushBeforeSave(() => new Promise<boolean>(() => {}));
    await vi.advanceTimersByTimeAsync(COLLAB_FLUSH_BEFORE_SAVE_MS);
    await expect(waited).resolves.toBe(false);
  });

  it("reports whether a prompt flush delivered", async () => {
    await expect(flushBeforeSave(async () => true)).resolves.toBe(true);
    await expect(flushBeforeSave(async () => false)).resolves.toBe(false);
  });
});
