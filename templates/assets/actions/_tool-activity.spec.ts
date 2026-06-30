import { afterEach, describe, expect, it, vi } from "vitest";

import { withToolActivity } from "./_tool-activity.js";

describe("withToolActivity", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("emits initial and periodic activity for agent tool calls", async () => {
    vi.useFakeTimers();
    const send = vi.fn();
    const work = vi.fn(
      () =>
        new Promise<string>((resolve) => {
          setTimeout(() => resolve("done"), 2_500);
        }),
    );

    const resultPromise = withToolActivity(
      {
        caller: "tool",
        actionName: "generate-image",
        send,
      },
      {
        label: "Generating image.",
        ongoingLabel: "Still generating image.",
        intervalMs: 1_000,
      },
      work,
    );

    expect(send).toHaveBeenCalledWith({
      type: "activity",
      label: "Generating image.",
      tool: "generate-image",
    });

    await vi.advanceTimersByTimeAsync(2_500);
    await expect(resultPromise).resolves.toBe("done");

    expect(send).toHaveBeenCalledWith({
      type: "activity",
      label: "Still generating image.",
      tool: "generate-image",
    });
    expect(send).toHaveBeenCalledTimes(3);
  });

  it("does not emit activity for frontend calls", async () => {
    const send = vi.fn();

    await expect(
      withToolActivity(
        {
          caller: "frontend",
          send,
        } as any,
        { label: "Generating image.", intervalMs: 1 },
        async () => "done",
      ),
    ).resolves.toBe("done");

    expect(send).not.toHaveBeenCalled();
  });

  it("emits default progress before chat reconnect can look idle", async () => {
    vi.useFakeTimers();
    const send = vi.fn();
    const resultPromise = withToolActivity(
      {
        caller: "tool",
        actionName: "generate-image",
        send,
      },
      { label: "Generating image." },
      () =>
        new Promise<string>((resolve) => {
          setTimeout(() => resolve("done"), 8_500);
        }),
    );

    await vi.advanceTimersByTimeAsync(7_999);
    expect(send).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1);
    expect(send).toHaveBeenCalledTimes(2);

    await vi.advanceTimersByTimeAsync(500);
    await expect(resultPromise).resolves.toBe("done");
  });

  it("keeps emitting progress after the run signal aborts", async () => {
    vi.useFakeTimers();
    const send = vi.fn();
    const controller = new AbortController();
    const resultPromise = withToolActivity(
      {
        caller: "tool",
        actionName: "generate-image",
        send,
        signal: controller.signal,
      },
      { label: "Generating image.", intervalMs: 1_000 },
      () =>
        new Promise<string>((resolve) => {
          setTimeout(() => resolve("done"), 1_500);
        }),
    );

    controller.abort();
    await vi.advanceTimersByTimeAsync(1_000);

    expect(send).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(500);
    await expect(resultPromise).resolves.toBe("done");
  });
});
