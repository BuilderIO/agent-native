import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createVisualEditSnapshotPublicationState,
  runClearVisualEditSnapshotPublications,
  runInvalidateVisualEditSnapshotPublication,
  runScheduleVisualEditSnapshotPublication,
} from "./publish-visual-edit-snapshot";

describe("visual edit snapshot publication", () => {
  afterEach(() => vi.useRealTimers());

  it("debounces changes and publishes only the latest HTML with a reservation", async () => {
    vi.useFakeTimers();
    const state = createVisualEditSnapshotPublicationState();
    const publish = vi.fn(async () => ({ published: true }));
    const args = {
      canPublish: true,
      designId: "design-1",
      fileId: "screen-1",
      html: "<html>first</html>",
      reservationToken: "8",
      publish,
      setFailed: vi.fn(),
      showError: vi.fn(),
      state,
    };

    runScheduleVisualEditSnapshotPublication(args);
    runScheduleVisualEditSnapshotPublication({
      ...args,
      html: "<html>latest</html>",
      reservationToken: "9",
    });
    await vi.advanceTimersByTimeAsync(250);
    await state.queue;

    expect(publish).toHaveBeenCalledWith({
      designId: "design-1",
      fileId: "screen-1",
      html: "<html>latest</html>",
      reservationToken: "9",
    });
  });

  it("does not cache a snapshot rejected by a newer reservation", async () => {
    vi.useFakeTimers();
    const state = createVisualEditSnapshotPublicationState();
    const publish = vi.fn(async () => ({ published: false }));
    const args = {
      canPublish: true,
      designId: "design-1",
      fileId: "screen-1",
      html: "<html>older</html>",
      reservationToken: "10",
      publish,
      setFailed: vi.fn(),
      showError: vi.fn(),
      state,
    };

    runScheduleVisualEditSnapshotPublication(args);
    await vi.advanceTimersByTimeAsync(250);
    await state.queue;

    expect(state.published.has("screen-1")).toBe(false);
    runScheduleVisualEditSnapshotPublication(args);
    expect(state.timers.has("screen-1")).toBe(true);
  });

  it("uses the reservation issued before the iframe captured the HTML", async () => {
    vi.useFakeTimers();
    const state = createVisualEditSnapshotPublicationState();
    const publish = vi.fn(async () => ({ published: true }));

    runScheduleVisualEditSnapshotPublication({
      canPublish: true,
      designId: "design-1",
      fileId: "screen-1",
      html: "<html>captured</html>",
      reservationToken: "11",
      publish,
      setFailed: vi.fn(),
      showError: vi.fn(),
      state,
    });
    await vi.advanceTimersByTimeAsync(250);
    await state.queue;

    expect(publish).toHaveBeenCalledWith({
      designId: "design-1",
      fileId: "screen-1",
      html: "<html>captured</html>",
      reservationToken: "11",
    });
  });

  it("does not publish when capture reservation failed", async () => {
    vi.useFakeTimers();
    const state = createVisualEditSnapshotPublicationState();
    const publish = vi.fn(async () => ({ published: true }));
    const setFailed = vi.fn();
    const showError = vi.fn();

    runScheduleVisualEditSnapshotPublication({
      canPublish: true,
      designId: "design-1",
      fileId: "screen-1",
      html: "<html>unreserved</html>",
      publish,
      setFailed,
      showError,
      state,
    });
    await vi.advanceTimersByTimeAsync(250);
    await state.queue;

    expect(publish).not.toHaveBeenCalled();
    expect(setFailed).toHaveBeenCalledWith(true);
    expect(showError).toHaveBeenCalledOnce();
  });

  it("clears pending timers and caches when the editor unmounts", () => {
    vi.useFakeTimers();
    const state = createVisualEditSnapshotPublicationState();
    runScheduleVisualEditSnapshotPublication({
      canPublish: true,
      designId: "design-1",
      fileId: "screen-1",
      html: "<html>pending</html>",
      reservationToken: "12",
      publish: vi.fn(),
      setFailed: vi.fn(),
      showError: vi.fn(),
      state,
    });

    runClearVisualEditSnapshotPublications(state);

    expect(state.timers.size).toBe(0);
    expect(state.latest.size).toBe(0);
  });

  it("publishes identical HTML after a source-mode retirement", async () => {
    vi.useFakeTimers();
    const state = createVisualEditSnapshotPublicationState();
    state.published.set("screen-1", "<html>same</html>");
    const publish = vi.fn(async () => ({ published: true }));
    runInvalidateVisualEditSnapshotPublication(state, "screen-1");

    runScheduleVisualEditSnapshotPublication({
      canPublish: true,
      designId: "design-1",
      fileId: "screen-1",
      html: "<html>same</html>",
      reservationToken: "12",
      publish,
      setFailed: vi.fn(),
      showError: vi.fn(),
      state,
    });
    await vi.advanceTimersByTimeAsync(250);
    await state.queue;

    expect(publish).toHaveBeenCalledOnce();
  });

  it("does not restore a retired cache when an old request finishes late", async () => {
    vi.useFakeTimers();
    const state = createVisualEditSnapshotPublicationState();
    let finishPublish!: (result: { published: boolean }) => void;
    const publish = vi.fn(
      () =>
        new Promise<{ published: boolean }>((resolve) => {
          finishPublish = resolve;
        }),
    );

    runScheduleVisualEditSnapshotPublication({
      canPublish: true,
      designId: "design-1",
      fileId: "screen-1",
      html: "<html>same</html>",
      reservationToken: "13",
      publish,
      setFailed: vi.fn(),
      showError: vi.fn(),
      state,
    });
    await vi.advanceTimersByTimeAsync(250);
    expect(publish).toHaveBeenCalledOnce();

    runInvalidateVisualEditSnapshotPublication(state, "screen-1");
    finishPublish({ published: true });
    await state.queue;

    expect(state.published.has("screen-1")).toBe(false);
  });
});
