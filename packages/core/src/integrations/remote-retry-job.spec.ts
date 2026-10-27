import { afterEach, describe, expect, it, vi } from "vitest";

const retryMock = vi.hoisted(() =>
  vi.fn(async () => ({ retried: 0, failed: 0 })),
);

vi.mock("./remote-commands-store.js", () => ({
  retryStaleRemoteCommands: retryMock,
}));

async function loadJob() {
  vi.resetModules();
  return import("./remote-retry-job.js");
}

describe("remote command retry job", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("clears the delayed start on stop so later ticks do not run", async () => {
    vi.useFakeTimers();
    const { startRemoteCommandsRetryJob, stopRemoteCommandsRetryJob } =
      await loadJob();

    startRemoteCommandsRetryJob();
    stopRemoteCommandsRetryJob();
    await vi.advanceTimersByTimeAsync(120_000);

    expect(retryMock).not.toHaveBeenCalled();
  });

  it("stops an already-started interval so it cannot keep the process alive", async () => {
    vi.useFakeTimers();
    const { startRemoteCommandsRetryJob, stopRemoteCommandsRetryJob } =
      await loadJob();

    startRemoteCommandsRetryJob();
    await vi.advanceTimersByTimeAsync(10_000);
    await Promise.resolve();
    expect(retryMock).toHaveBeenCalled();

    retryMock.mockClear();
    stopRemoteCommandsRetryJob();
    await vi.advanceTimersByTimeAsync(180_000);
    await Promise.resolve();

    expect(retryMock).not.toHaveBeenCalled();
  });
});
