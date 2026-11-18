import { afterEach, expect, it, vi } from "vitest";

import {
  ProviderWritePendingError,
  waitForProviderWriteResult,
} from "./provider-writes.js";

const progress = {
  id: "write-a",
  status: "queued" as const,
  attempts: 1,
  reason: "budget_exhausted",
  resumeAt: 1_000,
};
afterEach(() => vi.useRealTimers());

it("reports queued progress and resolves the original action result only after completion", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(0);
  const onProgress = vi.fn();
  const resume = vi.fn(async () => ({ id: "event-a" }));
  const pending = waitForProviderWriteResult<unknown>(
    { _providerWrite: progress },
    { resume, onProgress },
  );
  expect(onProgress).toHaveBeenCalledWith(progress);
  expect(resume).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(1_000);
  expect(await pending).toEqual({ id: "event-a" });
  expect(onProgress).toHaveBeenLastCalledWith({
    ...progress,
    status: "completed",
    reason: null,
    resumeAt: null,
  });
});

it("never presents uncertain or indefinite operator holds as completed", async () => {
  for (const input of [
    { ...progress, status: "uncertain" },
    { ...progress, reason: "operator", resumeAt: null },
  ]) {
    const resume = vi.fn();
    await expect(
      waitForProviderWriteResult({ _providerWrite: input }, { resume }),
    ).rejects.toBeInstanceOf(ProviderWritePendingError);
    expect(resume).not.toHaveBeenCalled();
  }
});

it("cancels polling when its caller leaves and keeps malformed progress distinct from a result", async () => {
  vi.useFakeTimers();
  const controller = new AbortController();
  const resume = vi.fn();
  const pending = waitForProviderWriteResult(
    { _providerWrite: progress },
    { resume, signal: controller.signal },
  );
  const assertion = expect(pending).rejects.toThrow();
  controller.abort(new Error("caller left"));
  await assertion;
  expect(vi.getTimerCount()).toBe(0);
  expect(resume).not.toHaveBeenCalled();
  await expect(
    waitForProviderWriteResult({ _providerWrite: {} }, { resume }),
  ).rejects.toThrow("Unreadable");
});
