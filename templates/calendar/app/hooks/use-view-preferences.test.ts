import { describe, expect, it, vi } from "vitest";

import {
  enqueueSourcePreferenceMutation,
  shouldApplyPreferencePoll,
} from "./use-view-preferences";

describe("source preference sequencing", () => {
  it("discards a poll that started before a confirmed mutation", () => {
    expect(shouldApplyPreferencePoll(4, 5)).toBe(false);
    expect(shouldApplyPreferencePoll(5, 5)).toBe(true);
  });

  it("sends rapid mutations for one source in invocation order", async () => {
    const chains: Record<string, Promise<unknown>> = {};
    const order: string[] = [];
    let releaseFirst: (() => void) | undefined;
    const first = enqueueSourcePreferenceMutation(
      chains,
      "friends",
      async () => {
        order.push("first-start");
        await new Promise<void>((resolve) => {
          releaseFirst = resolve;
        });
        order.push("first-end");
      },
    );
    const secondRun = vi.fn(async () => order.push("second"));
    const second = enqueueSourcePreferenceMutation(
      chains,
      "friends",
      secondRun,
    );

    await Promise.resolve();
    expect(secondRun).not.toHaveBeenCalled();
    releaseFirst?.();
    await Promise.all([first, second]);
    expect(order).toEqual(["first-start", "first-end", "second"]);
  });
});
