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

it.each([{ progress: 100 }, { progress: { ...progress } }])(
  "leaves an ordinary domain progress field unchanged: %s",
  async (result) => {
    const resume = vi.fn();
    await expect(waitForProviderWriteResult(result, { resume })).resolves.toBe(
      result,
    );
    expect(resume).not.toHaveBeenCalled();
  },
);

it.each([400, 401, 403, 404, 409, 422])(
  "preserves a permanent %s poll rejection instead of reporting pending progress",
  async (status) => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const error = Object.assign(new Error("Progress access rejected"), {
      status,
      errorCode: "progress_rejected",
    });
    const pending = waitForProviderWriteResult<unknown>(
      { _providerWrite: progress },
      {
        resume: async () => {
          throw error;
        },
      },
    );
    const settled = pending.then(
      (value) => ({ value }),
      (error: unknown) => ({ error }),
    );
    await vi.advanceTimersByTimeAsync(1_000);
    expect(await settled).toEqual({ error });
  },
);

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
    { _providerWrite: progress },
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

// oracle-change: an unmarked initial value is domain data; raw server envelopes

it("preserves an unmarked completed-looking domain result without polling", async () => {
  const resume = vi.fn();
  const result = {
    progress: {
      ...progress,
      status: "completed",
      reason: null,
      resumeAt: null,
    },
    result: { id: "event-a" },
  };
  await expect(
    waitForProviderWriteResult<unknown>(result, { resume }),
  ).resolves.toBe(result);
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
    const rejection = pending.then(
      () => undefined,
      (error: unknown) => error,
    );
    await vi.advanceTimersByTimeAsync(1_000);
    expect(await rejection).toMatchObject({
      errorCode: "provider_write_pending",
      progress,
      cause: expect.any(TypeError),
    });
    expect(onProgress).toHaveBeenLastCalledWith(progress);
  },
);

it("rejects an incomplete completed envelope and malformed server progress", async () => {
  const onProgress = vi.fn();
  await expect(
    waitForProviderWriteResult(
      {
        _providerWrite: { ...progress, status: "completed" },
      },
      { resume: vi.fn(), onProgress },
    ),
  ).rejects.toThrow("has no result");
  expect(onProgress).not.toHaveBeenCalled();
  await expect(
    waitForProviderWriteResult({ _providerWrite: {} }, { resume: vi.fn() }),
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
  const rejection = pending.then(
    () => undefined,
    (error: unknown) => error,
  );
  await vi.advanceTimersByTimeAsync(1_000);
  expect(await rejection).toMatchObject({
    errorCode: "provider_write_pending",
    progress,
    cause: expect.objectContaining({
      message: "Provider write progress changed identity.",
    }),
  });
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
      { _providerWrite: { ...progress, status, resumeAt: null } },
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

it("polls recovered queued work with observable lease metadata and no resume time", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(0);
  const recovered = {
    ...progress,
    reason: "lease_expired_before_dispatch",
    resumeAt: null,
  };
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
    { _providerWrite: recovered },
    { resume, onProgress },
  );
  const settled = pending.then(
    (value) => ({ value }),
    (error: unknown) => ({ error }),
  );
  expect(onProgress).toHaveBeenCalledWith(recovered);
  await vi.advanceTimersByTimeAsync(1_000);
  expect(await settled).toEqual({ value: { id: "event-a" } });
  expect(resume).toHaveBeenCalledWith(recovered.id);
});

it("polls a scheduled uncertain reconciliation through its due time until confirmed completion", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(0);
  const reconciling = {
    ...progress,
    status: "uncertain",
    reason: "provider_outcome_unknown",
    resumeAt: 2_000,
  };
  const onProgress = vi.fn();
  const resume = vi
    .fn()
    .mockResolvedValueOnce({ progress: reconciling })
    .mockResolvedValueOnce({
      progress: {
        ...reconciling,
        status: "completed",
        reason: null,
        resumeAt: null,
      },
      result: { id: "event-a" },
    });
  const pending = waitForProviderWriteResult<unknown>(
    { _providerWrite: reconciling },
    { resume, onProgress, maxWaitMs: 4_000 },
  );
  const settled = pending.then(
    (value) => ({ value }),
    (error: unknown) => ({ error }),
  );
  expect(onProgress).toHaveBeenCalledWith(reconciling);
  await vi.advanceTimersByTimeAsync(3_000);
  expect(await settled).toEqual({ value: { id: "event-a" } });
  expect(resume.mock.calls).toEqual([[progress.id], [progress.id]]);
  expect(onProgress).toHaveBeenLastCalledWith(
    expect.objectContaining({ status: "completed" }),
  );
});

it("bounds scheduled reconciliation by the deadline and preserves explicit uncertainty", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(0);
  const reconciling = {
    ...progress,
    status: "uncertain",
    reason: "provider_outcome_unknown",
    resumeAt: 10_000,
  };
  const resume = vi.fn();
  let finished = false;
  const settled = waitForProviderWriteResult<unknown>(
    { _providerWrite: reconciling },
    { resume, maxWaitMs: 1_500 },
  ).then(
    (value) => {
      finished = true;
      return { value };
    },
    (error: unknown) => {
      finished = true;
      return { error };
    },
  );
  await Promise.resolve();
  expect(finished).toBe(false);
  await vi.advanceTimersByTimeAsync(1_500);
  expect(await settled).toMatchObject({
    error: { errorCode: "provider_write_uncertain", progress: reconciling },
  });
  expect(resume).not.toHaveBeenCalled();
  expect(vi.getTimerCount()).toBe(0);
});

it("distinguishes an applied write with an unavailable result from an unconfirmed effect", async () => {
  const pending = waitForProviderWriteResult(
    {
      _providerWrite: {
        ...progress,
        status: "uncertain",
        reason: "result_unavailable",
        resumeAt: null,
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
  const rejection = pending.then(
    () => undefined,
    (error: unknown) => error,
  );
  const abortReason = new Error("caller left");
  controller.abort(abortReason);
  expect(await rejection).toBe(abortReason);
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
  const rejection = pending.then(
    () => undefined,
    (error: unknown) => error,
  );
  await vi.advanceTimersByTimeAsync(1_000);
  const error = await rejection;
  expect(error).toMatchObject({
    errorCode: "provider_write_pending",
    progress,
    cause,
  });
  expect(error).toBeInstanceOf(ProviderWritePendingError);
});

it("reports abandonment as an unconfirmed effect rather than a provider rejection", async () => {
  const pending = waitForProviderWriteResult<unknown>(
    {
      _providerWrite: {
        ...progress,
        status: "failed",
        reason: "outcome_abandoned",
      },
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
  const rejection = pending.then(
    () => undefined,
    (error: unknown) => error,
  );
  await vi.advanceTimersByTimeAsync(1_000);
  expect(await rejection).toBe(abortReason);
  expect(vi.getTimerCount()).toBe(0);
});

it.each([
  null,
  { ...progress, status: "queued" },
  { ...progress, id: "other-write", status: "completed" },
  { ...progress, status: "completed" },
])(
  "rejects a mixed completion envelope with canonical progress %s",
  async (canonicalProgress) => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const pending = waitForProviderWriteResult<unknown>(
      { _providerWrite: progress },
      {
        resume: async () => ({
          _providerWrite: { ...progress, status: "completed" },
          progress: canonicalProgress,
          result: { id: "false-completion" },
        }),
      },
    );
    const settled = pending.then(
      (value) => ({ value }),
      (error: unknown) => ({ error }),
    );
    await vi.advanceTimersByTimeAsync(1_000);
    expect(await settled).toMatchObject({
      error: {
        errorCode: "provider_write_pending",
        progress,
        cause: expect.any(TypeError),
      },
    });
  },
);

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
    const rejection = pending.then(
      () => undefined,
      (error: unknown) => error,
    );
    await vi.advanceTimersByTimeAsync(1_000);
    expect(await rejection).toMatchObject({
      errorCode: "provider_write_pending",
      progress,
      cause: expect.any(TypeError),
    });
    expect(onProgress).toHaveBeenLastCalledWith(progress);
  },
);
