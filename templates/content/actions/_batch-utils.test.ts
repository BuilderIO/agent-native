import { describe, expect, it } from "vitest";

import { processWithConcurrency } from "./_batch-utils.js";

describe("processWithConcurrency", () => {
  it("starts the next item as soon as one worker becomes available", async () => {
    const releases = new Map<number, () => void>();
    const started: number[] = [];
    const run = processWithConcurrency([1, 2, 3, 4], 2, async (item) => {
      started.push(item);
      await new Promise<void>((resolve) => releases.set(item, resolve));
    });

    await expect.poll(() => started).toEqual([1, 2]);
    releases.get(1)?.();
    await expect.poll(() => started).toEqual([1, 2, 3]);
    releases.get(3)?.();
    await expect.poll(() => started).toEqual([1, 2, 3, 4]);
    releases.get(2)?.();
    releases.get(4)?.();

    await run;
  });
});
