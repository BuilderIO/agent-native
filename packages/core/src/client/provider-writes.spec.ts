import { afterEach, expect, it, vi } from "vitest";

import {
  ProviderWriteFailedError,
  ProviderWritePendingError,
  ProviderWriteUncertainError,
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

it.each(["queued", "running"] as const)(
  "polls an ordinary %s write without a resume time until the action result arrives",
  async (status) => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const resume = vi.fn(async () => ({ id: "event-a" }));
    const pending = waitForProviderWriteResult<unknown>(
      {
        _providerWrite: { ...progress, status, reason: null, resumeAt: null },
      },
      { resume, maxWaitMs: 2_000 },
    );
    const settled = pending.then(
      (value) => ({ status: "fulfilled", value }),
      (error: unknown) => ({ status: "rejected", error }),
    );
    await vi.advanceTimersByTimeAsync(1_000);
    expect(await settled).toEqual({
      status: "fulfilled",
      value: { id: "event-a" },
    });
    expect(resume).toHaveBeenCalledWith(progress.id);
  },
);

it.each([
  ["failed", ProviderWriteFailedError, "provider_write_failed"],
  ["uncertain", ProviderWriteUncertainError, "provider_write_uncertain"],
] as const)(
  "reports a %s write as its distinct terminal error without polling it again",
  async (status, ErrorType, errorCode) => {
    const resume = vi.fn();
    const pending = waitForProviderWriteResult(
      { _providerWrite: { ...progress, status } },
      { resume },
    );
    await expect(pending).rejects.toBeInstanceOf(ErrorType);
    await expect(pending).rejects.toMatchObject({ errorCode });
    expect(resume).not.toHaveBeenCalled();
  },
);

it("keeps an indefinite operator hold pending without claiming failure or completion", async () => {
  const resume = vi.fn();
  await expect(
    waitForProviderWriteResult(
      { _providerWrite: { ...progress, reason: "operator", resumeAt: null } },
      { resume },
    ),
  ).rejects.toBeInstanceOf(ProviderWritePendingError);
  expect(resume).not.toHaveBeenCalled();
});

it("distinguishes an applied write with an unavailable result from an unconfirmed effect", async () => {
  const pending = waitForProviderWriteResult(
    {
      _providerWrite: {
        ...progress,
        status: "uncertain",
        reason: "result_unavailable",
      },
    },
    { resume: vi.fn() },
  );
  await expect(pending).rejects.toMatchObject({
    errorCode: "provider_write_uncertain",
    progress: { reason: "result_unavailable" },
    message: expect.stringContaining("applied the write"),
  });
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
