import { afterEach, expect, it, vi } from "vitest";

import { runInIdleSlices } from "./idle-slices";

afterEach(() => {
  vi.useRealTimers();
});

it("keeps slicing until the step reports done", () => {
  vi.useFakeTimers();
  const deadlines: number[] = [];
  runInIdleSlices((deadline) => {
    deadlines.push(deadline);
    return deadlines.length === 3;
  });

  expect(deadlines).toHaveLength(0);
  vi.runAllTimers();
  expect(deadlines).toHaveLength(3);
});

it("stops scheduling once cancelled", () => {
  vi.useFakeTimers();
  const step = vi.fn(() => false);
  const cancel = runInIdleSlices(step);

  vi.advanceTimersToNextTimer();
  cancel();
  vi.runAllTimers();

  expect(step).toHaveBeenCalledTimes(1);
});
