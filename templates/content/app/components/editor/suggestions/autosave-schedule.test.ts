import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  createSuggestionAutosave,
  markSuggestionAutosaveSaved,
  queueSuggestionAutosave,
  retrySuggestionAutosave,
} from "./autosave-schedule";

describe("suggestion autosave schedule", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("saves after a pause in typing", () => {
    const autosave = createSuggestionAutosave();
    const save = vi.fn();

    queueSuggestionAutosave(autosave, save);
    vi.advanceTimersByTime(500);
    queueSuggestionAutosave(autosave, save);
    vi.advanceTimersByTime(999);
    expect(save).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(save).toHaveBeenCalledTimes(1);
  });

  it("saves continuous typing at least every five seconds", () => {
    const autosave = createSuggestionAutosave();
    const save = vi.fn();

    for (let elapsed = 0; elapsed < 5_000; elapsed += 500) {
      queueSuggestionAutosave(autosave, save);
      vi.advanceTimersByTime(500);
    }

    expect(save).toHaveBeenCalledTimes(1);
  });

  it("does not let typing pull a retry earlier", () => {
    const autosave = createSuggestionAutosave();
    const save = vi.fn();

    retrySuggestionAutosave(autosave, save);
    vi.advanceTimersByTime(1_500);
    queueSuggestionAutosave(autosave, save);
    vi.advanceTimersByTime(499);
    expect(save).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(save).toHaveBeenCalledTimes(1);
  });

  it("waits out the backoff when typing queued a save during the failed one", () => {
    const autosave = createSuggestionAutosave();
    const save = vi.fn();

    // The author types while a save is in flight, then that save fails.
    queueSuggestionAutosave(autosave, save);
    vi.advanceTimersByTime(300);
    retrySuggestionAutosave(autosave, save);

    vi.advanceTimersByTime(1_999);
    expect(save).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(save).toHaveBeenCalledTimes(1);
  });

  it("keeps backing off once the max-wait deadline has passed", () => {
    const autosave = createSuggestionAutosave();
    const save = vi.fn();
    autosave.dirtySince = Date.now() - 60_000;

    retrySuggestionAutosave(autosave, save);
    vi.advanceTimersByTime(1_999);
    expect(save).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(save).toHaveBeenCalledTimes(1);

    retrySuggestionAutosave(autosave, save);
    vi.advanceTimersByTime(3_999);
    expect(save).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1);
    expect(save).toHaveBeenCalledTimes(2);
  });

  it("tells the caller when no timer will run the save after unmount", () => {
    const autosave = createSuggestionAutosave();
    const save = vi.fn();

    expect(queueSuggestionAutosave(autosave, save)).toBe(true);
    retrySuggestionAutosave(autosave, save);
    expect(queueSuggestionAutosave(autosave, save)).toBe(true);

    autosave.disposed = true;
    expect(queueSuggestionAutosave(autosave, save)).toBe(false);
  });

  it("returns to the typing debounce after a successful save", () => {
    const autosave = createSuggestionAutosave();
    const save = vi.fn();

    retrySuggestionAutosave(autosave, save);
    vi.advanceTimersByTime(2_000);
    markSuggestionAutosaveSaved(autosave, true);
    queueSuggestionAutosave(autosave, save);
    vi.advanceTimersByTime(1_000);

    expect(save).toHaveBeenCalledTimes(2);
  });
});
