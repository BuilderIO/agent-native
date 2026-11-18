import { afterEach, expect, it, vi } from "vitest";

import {
  ProviderWriteFailedError,
  ProviderWriteAbandonedError,
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
  const resume = vi.fn(async () => ({
    progress: {
      ...progress,
      status: "completed",
      reason: null,
      resumeAt: null,
    },
    result: { id: "event-a" },
  }));
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

it("polls the server's queued and running envelopes and unwraps only its completed result", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(0);
  const running = {
    ...progress,
    status: "running",
    reason: null,
    resumeAt: null,
  };
  const completed = { ...running, status: "completed" };
  const onProgress = vi.fn();
  const resume = vi
    .fn()
    .mockResolvedValueOnce({ progress: running })
    .mockResolvedValueOnce({ progress: completed, result: { id: "event-a" } });
  const pending = waitForProviderWriteResult<unknown>(
    { progress },
    { resume, onProgress },
  );
  await vi.advanceTimersByTimeAsync(1_000);
  expect(onProgress).toHaveBeenLastCalledWith(running);
  expect(resume).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(1_000);
  expect(await pending).toEqual({ id: "event-a" });
  expect(onProgress).toHaveBeenLastCalledWith(completed);
  expect(resume.mock.calls).toEqual([[progress.id], [progress.id]]);
});

it("unwraps an already completed server envelope without polling", async () => {
  const resume = vi.fn();
  await expect(
    waitForProviderWriteResult<unknown>(
      {
        progress: {
          ...progress,
          status: "completed",
          reason: null,
          resumeAt: null,
        },
        result: { id: "event-a" },
      },
      { resume },
    ),
  ).resolves.toEqual({ id: "event-a" });
  expect(resume).not.toHaveBeenCalled();
});

it.each([
  null,
  undefined,
  {},
  { ok: true },
  { id: "event-a" },
  "ok",
  42,
  false,
])(
  "keeps a malformed resume response (%s) pending instead of claiming completion",
  async (response) => {
    const onProgress = vi.fn();
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const pending = waitForProviderWriteResult<unknown>(
      { _providerWrite: progress },
      { resume: async () => response, onProgress },
    );
    const assertion = expect(pending).rejects.toMatchObject({
      errorCode: "provider_write_pending",
      progress,
      cause: expect.any(TypeError),
    });
    await vi.advanceTimersByTimeAsync(1_000);
    await assertion;
    expect(onProgress).toHaveBeenLastCalledWith(progress);
  },
);

it("rejects an incomplete completed envelope and malformed server progress", async () => {
  const onProgress = vi.fn();
  await expect(
    waitForProviderWriteResult(
      {
        progress: { ...progress, status: "completed" },
      },
      { resume: vi.fn(), onProgress },
    ),
  ).rejects.toThrow("has no result");
  expect(onProgress).not.toHaveBeenCalled();
  await expect(
    waitForProviderWriteResult({ progress: {} }, { resume: vi.fn() }),
  ).rejects.toThrow("Unreadable");
});

it("keeps write identity stable across adapter and server envelopes", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(0);
  const pending = waitForProviderWriteResult<unknown>(
    { _providerWrite: progress },
    {
      resume: async () => ({ progress: { ...progress, id: "other-write" } }),
    },
  );
  const assertion = expect(pending).rejects.toMatchObject({
    errorCode: "provider_write_pending",
    progress,
    cause: expect.objectContaining({
      message: "Provider write progress changed identity.",
    }),
  });
  await vi.advanceTimersByTimeAsync(1_000);
  await assertion;
});

it.each(["queued", "running"] as const)(
  "polls an ordinary %s write without a resume time until the action result arrives",
  async (status) => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const resume = vi.fn(async () => ({
      progress: {
        ...progress,
        status: "completed",
        reason: null,
        resumeAt: null,
      },
      result: { id: "event-a" },
    }));
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

it("returns an initial immediate domain result without polling", async () => {
  const resume = vi.fn();
  await expect(
    waitForProviderWriteResult({ ok: true }, { resume }),
  ).resolves.toEqual({ ok: true });
  expect(resume).not.toHaveBeenCalled();
});

it("preserves the known write and transport cause when a resume request fails", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(0);
  const cause = new Error("network unavailable");
  const pending = waitForProviderWriteResult<unknown>(
    { _providerWrite: progress },
    {
      resume: async () => {
        throw cause;
      },
    },
  );
  const assertion = expect(pending).rejects.toMatchObject({
    errorCode: "provider_write_pending",
    progress,
    cause,
  });
  await vi.advanceTimersByTimeAsync(1_000);
  await assertion;
  await expect(pending).rejects.toBeInstanceOf(ProviderWritePendingError);
});

it("reports abandonment as an unconfirmed effect rather than a provider rejection", async () => {
  const pending = waitForProviderWriteResult<unknown>(
    {
      progress: { ...progress, status: "failed", reason: "outcome_abandoned" },
    },
    { resume: vi.fn() },
  );
  await expect(pending).rejects.toBeInstanceOf(ProviderWriteAbandonedError);
  await expect(pending).rejects.toBeInstanceOf(ProviderWriteUncertainError);
  await expect(pending).rejects.toMatchObject({
    errorCode: "provider_write_abandoned",
    message: expect.stringContaining("may have been applied"),
    progress: { reason: "outcome_abandoned" },
  });
});

it("preserves a caller's abort reason during a failing resume request", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(0);
  const controller = new AbortController();
  const abortReason = new Error("caller left");
  const pending = waitForProviderWriteResult<unknown>(
    { _providerWrite: progress },
    {
      signal: controller.signal,
      resume: async () => {
        controller.abort(abortReason);
        throw new Error("request aborted");
      },
    },
  );
  const assertion = expect(pending).rejects.toBe(abortReason);
  await vi.advanceTimersByTimeAsync(1_000);
  await assertion;
  expect(vi.getTimerCount()).toBe(0);
});

it.each([
  { progress: {} },
  { progress: { ...progress, attempts: Number.NaN } },
  { progress: { ...progress, resumeAt: Number.POSITIVE_INFINITY } },
  {
    _providerWrite: { ...progress, status: "completed" },
    result: { ok: true },
  },
  { progress: { ...progress, status: "completed" } },
])(
  "keeps an unreadable or incomplete poll envelope pending: %s",
  async (response) => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const onProgress = vi.fn();
    const pending = waitForProviderWriteResult<unknown>(
      { _providerWrite: progress },
      {
        resume: async () => response,
        onProgress,
      },
    );
    const assertion = expect(pending).rejects.toMatchObject({
      errorCode: "provider_write_pending",
      progress,
      cause: expect.any(TypeError),
    });
    await vi.advanceTimersByTimeAsync(1_000);
    await assertion;
    expect(onProgress).toHaveBeenLastCalledWith(progress);
  },
);
