import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const resolveEngineMock = vi.hoisted(() => vi.fn());
const getStoredModelForEngineMock = vi.hoisted(() =>
  vi.fn(async () => undefined),
);
const normalizeModelForEngineMock = vi.hoisted(() =>
  vi.fn(
    (engine: { defaultModel?: string }, model?: string | null) =>
      model ?? engine.defaultModel,
  ),
);

vi.mock("../agent/engine/index.js", () => ({
  resolveEngine: resolveEngineMock,
  getStoredModelForEngine: getStoredModelForEngineMock,
  normalizeModelForEngine: normalizeModelForEngineMock,
}));

const { __clearConditionCache, evaluateCondition } =
  await import("./condition-evaluator.js");

const IDENTITY = { userEmail: "owner@example.com" };

function fakeEngine(
  streamImpl: (opts: {
    abortSignal: AbortSignal;
  }) => AsyncIterable<{ type: string; text?: string }>,
) {
  return {
    name: "fake-engine",
    label: "Fake",
    defaultModel: "fake-model",
    supportedModels: ["fake-model"],
    capabilities: {},
    stream: streamImpl,
  };
}

/** A stream that never yields and rejects only when its abort signal fires. */
async function* hangingUntilAborted(opts: {
  abortSignal: AbortSignal;
}): AsyncIterable<{ type: string; text?: string }> {
  await new Promise<never>((_resolve, reject) => {
    opts.abortSignal.addEventListener(
      "abort",
      () => reject(new Error("aborted")),
      { once: true },
    );
  });
}

describe("evaluateCondition", () => {
  beforeEach(() => {
    __clearConditionCache();
    resolveEngineMock.mockReset();
    getStoredModelForEngineMock.mockClear();
    normalizeModelForEngineMock.mockClear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("bounds the classifier request and aborts it on timeout", async () => {
    vi.useFakeTimers();
    resolveEngineMock.mockResolvedValue(fakeEngine(hangingUntilAborted));

    const evaluation = evaluateCondition(
      "is this important?",
      { messageId: "timeout-case" },
      IDENTITY,
    );
    const rejection = expect(evaluation).rejects.toThrow(
      "Condition evaluation timed out.",
    );
    await vi.advanceTimersByTimeAsync(15_000);

    await rejection;
    expect(resolveEngineMock).toHaveBeenCalledOnce();
  });

  it("uses the remaining event deadline when it is shorter than the default timeout", async () => {
    vi.useFakeTimers();
    resolveEngineMock.mockResolvedValue(fakeEngine(hangingUntilAborted));

    const evaluation = evaluateCondition(
      "is this important?",
      { messageId: "deadline-case" },
      IDENTITY,
      { deadlineAt: Date.now() + 1_000 },
    );
    const rejection = expect(evaluation).rejects.toThrow(
      "Condition evaluation timed out.",
    );
    await vi.advanceTimersByTimeAsync(1_000);

    await rejection;
  });

  it("does not start a classifier after the event deadline elapsed", async () => {
    resolveEngineMock.mockResolvedValue(fakeEngine(hangingUntilAborted));

    await expect(
      evaluateCondition(
        "is this important?",
        { messageId: "expired-deadline" },
        IDENTITY,
        { deadlineAt: Date.now() - 1 },
      ),
    ).rejects.toThrow("Condition evaluation deadline elapsed.");
    expect(resolveEngineMock).not.toHaveBeenCalled();
  });

  it("resolves the engine using the automation's execution identity", async () => {
    async function* yesStream() {
      yield { type: "text-delta", text: "yes" };
    }
    resolveEngineMock.mockResolvedValue(fakeEngine(yesStream));

    const result = await evaluateCondition(
      "is this urgent?",
      { messageId: "identity-case" },
      { userEmail: "owner@example.com", orgId: "org-1", appId: "mail" },
    );

    expect(result).toBe(true);
    expect(resolveEngineMock).toHaveBeenCalledWith(
      expect.objectContaining({
        credentialIdentity: { userEmail: "owner@example.com", orgId: "org-1" },
        appId: "mail",
      }),
    );
  });

  it("fails closed on an unexpected classifier response", async () => {
    async function* garbledStream() {
      yield { type: "text-delta", text: "maybe" };
    }
    resolveEngineMock.mockResolvedValue(fakeEngine(garbledStream));

    await expect(
      evaluateCondition(
        "is this urgent?",
        { messageId: "garbled-case" },
        IDENTITY,
      ),
    ).rejects.toThrow(/unexpected classifier response/);
  });

  it("surfaces a model stream error", async () => {
    async function* errorStream() {
      yield {
        type: "stop",
        reason: "error",
        error: "rate limited",
      } as { type: string; text?: string };
    }
    resolveEngineMock.mockResolvedValue(fakeEngine(errorStream));

    await expect(
      evaluateCondition(
        "is this urgent?",
        { messageId: "error-case" },
        IDENTITY,
      ),
    ).rejects.toThrow("Condition evaluation failed: rate limited");
  });
});
