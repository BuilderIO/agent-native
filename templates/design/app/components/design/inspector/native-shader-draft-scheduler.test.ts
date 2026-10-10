import { afterEach, expect, it, vi } from "vitest";

import { NativeShaderDraftScheduler } from "./native-shader-draft-scheduler";

afterEach(() => vi.useRealTimers());

it("debounces draft work and publishes only the latest completed request", async () => {
  vi.useFakeTimers();
  const scheduler = new NativeShaderDraftScheduler<string>(250);
  const result = vi.fn();
  const error = vi.fn();
  const first = vi.fn(async () => "first");
  const second = vi.fn(async () => "second");

  scheduler.schedule(first, result, error);
  await vi.advanceTimersByTimeAsync(100);
  scheduler.schedule(second, result, error);
  await vi.advanceTimersByTimeAsync(249);
  expect(first).not.toHaveBeenCalled();
  expect(second).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(1);
  expect(second).toHaveBeenCalledOnce();
  expect(result).toHaveBeenCalledExactlyOnceWith("second");
  expect(error).not.toHaveBeenCalled();
});

it("fences a started older compile after a newer draft wins", async () => {
  vi.useFakeTimers();
  const scheduler = new NativeShaderDraftScheduler<string>(1);
  const result = vi.fn();
  const error = vi.fn();
  let finishOld: (value: string) => void = () => {};
  scheduler.schedule(
    () =>
      new Promise((resolve) => {
        finishOld = resolve;
      }),
    result,
    error,
  );
  await vi.advanceTimersByTimeAsync(1);
  scheduler.schedule(async () => "new", result, error);
  await vi.advanceTimersByTimeAsync(1);
  finishOld("old");
  await Promise.resolve();
  expect(result).toHaveBeenCalledExactlyOnceWith("new");
  expect(error).not.toHaveBeenCalled();
});

it("aborts pending and in-flight work on close", async () => {
  vi.useFakeTimers();
  const scheduler = new NativeShaderDraftScheduler<string>(10);
  const task = vi.fn(async (signal: AbortSignal) => {
    expect(signal.aborted).toBe(false);
    return "done";
  });
  const result = vi.fn();
  scheduler.schedule(task, result, vi.fn());
  scheduler.cancel();
  await vi.advanceTimersByTimeAsync(20);
  expect(task).not.toHaveBeenCalled();
  expect(result).not.toHaveBeenCalled();
});
