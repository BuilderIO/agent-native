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

const recordUsageMock = vi.hoisted(() => vi.fn(async () => undefined));

vi.mock("../usage/store.js", () => ({ recordUsage: recordUsageMock }));

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
    recordUsageMock.mockClear();
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

  it("does not reuse a cached classification across owners", async () => {
    let ownerCalls = 0;
    let otherOwnerCalls = 0;
    async function* ownerStream() {
      ownerCalls += 1;
      yield { type: "text-delta", text: "yes" };
    }
    async function* otherOwnerStream() {
      otherOwnerCalls += 1;
      yield { type: "text-delta", text: "no" };
    }
    const ownerEngine = fakeEngine(ownerStream);
    const otherOwnerEngine = fakeEngine(otherOwnerStream);
    resolveEngineMock.mockImplementation(async ({ credentialIdentity }) =>
      credentialIdentity.userEmail === "owner@example.com"
        ? ownerEngine
        : otherOwnerEngine,
    );

    const payload = { messageId: "shared-payload" };
    await expect(
      evaluateCondition("is this urgent?", payload, IDENTITY),
    ).resolves.toBe(true);
    await expect(
      evaluateCondition("is this urgent?", payload, IDENTITY),
    ).resolves.toBe(true);
    await expect(
      evaluateCondition("is this urgent?", payload, {
        userEmail: "other@example.com",
      }),
    ).resolves.toBe(false);

    expect(ownerCalls).toBe(1);
    expect(otherOwnerCalls).toBe(1);
  });

  it("does not reuse a cached classification across models", async () => {
    const models: string[] = [];
    async function* yesStream(opts: { model?: string }) {
      models.push(opts.model ?? "");
      yield { type: "text-delta", text: "yes" };
    }
    resolveEngineMock.mockResolvedValue(fakeEngine(yesStream));
    getStoredModelForEngineMock
      .mockResolvedValueOnce("model-a")
      .mockResolvedValueOnce("model-b");

    const payload = { messageId: "shared-payload" };
    await expect(
      evaluateCondition("is this urgent?", payload, IDENTITY),
    ).resolves.toBe(true);
    await expect(
      evaluateCondition("is this urgent?", payload, IDENTITY),
    ).resolves.toBe(true);

    expect(models).toEqual(["model-a", "model-b"]);
  });

  it("does not cache payloads that cannot be serialized", async () => {
    let calls = 0;
    async function* alternatingStream() {
      calls += 1;
      yield { type: "text-delta", text: calls === 1 ? "yes" : "no" };
    }
    resolveEngineMock.mockResolvedValue(fakeEngine(alternatingStream));
    const payload: Record<string, unknown> = {};
    payload.self = payload;

    await expect(
      evaluateCondition("is this urgent?", payload, IDENTITY),
    ).resolves.toBe(true);
    await expect(
      evaluateCondition("is this urgent?", payload, IDENTITY),
    ).resolves.toBe(false);

    expect(calls).toBe(2);
  });

  it("evaluates payloads when serialization throws a non-Error", async () => {
    let calls = 0;
    async function* alternatingStream() {
      calls += 1;
      yield { type: "text-delta", text: calls === 1 ? "yes" : "no" };
    }
    resolveEngineMock.mockResolvedValue(fakeEngine(alternatingStream));
    const payload = {
      toJSON() {
        throw "unavailable";
      },
    };

    await expect(
      evaluateCondition("is this urgent?", payload, IDENTITY),
    ).resolves.toBe(true);
    await expect(
      evaluateCondition("is this urgent?", payload, IDENTITY),
    ).resolves.toBe(false);

    expect(calls).toBe(2);
  });

  it("uses a background-resolved engine when provided", async () => {
    const models: string[] = [];
    async function* yesStream(opts: { model?: string }) {
      models.push(opts.model ?? "");
      yield { type: "text-delta", text: "yes" };
    }
    const engine = fakeEngine(yesStream);

    await expect(
      evaluateCondition("is this urgent?", { messageId: "engine" }, IDENTITY, {
        engine,
        resolvedModel: "automation-model",
      }),
    ).resolves.toBe(true);

    expect(resolveEngineMock).not.toHaveBeenCalled();
    expect(getStoredModelForEngineMock).not.toHaveBeenCalled();
    expect(models).toEqual(["automation-model"]);
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

  it("saves the check's usage once, under the owner, organization, app and label", async () => {
    async function* meteredStream() {
      yield {
        type: "usage",
        inputTokens: 120,
        outputTokens: 1,
        cacheReadTokens: 20,
        builderCreditsUsed: 0.5,
      } as { type: string; text?: string };
      yield { type: "text-delta", text: "yes" };
      yield { type: "usage", inputTokens: 5, outputTokens: 1 } as {
        type: string;
        text?: string;
      };
    }
    const engine = fakeEngine(meteredStream);
    const identity = {
      userEmail: "owner@example.com",
      orgId: "org-1",
      appId: "mail",
    };
    const evaluate = () =>
      evaluateCondition("is this urgent?", { messageId: "metered" }, identity, {
        engine,
        resolvedModel: "automation-model",
        usageLabel: "automation:triage",
      });

    await expect(evaluate()).resolves.toBe(true);
    // A cached answer costs nothing, so it records nothing.
    await expect(evaluate()).resolves.toBe(true);

    expect(recordUsageMock).toHaveBeenCalledOnce();
    expect(recordUsageMock).toHaveBeenCalledWith({
      ownerEmail: "owner@example.com",
      orgId: "org-1",
      app: "mail",
      label: "automation:triage",
      inputTokens: 125,
      outputTokens: 2,
      cacheReadTokens: 20,
      cacheWriteTokens: 0,
      builderCreditsUsed: 0.5,
      engineName: "fake-engine",
      model: "automation-model",
    });
  });

  it("saves the usage of a check whose answer is unusable", async () => {
    async function* meteredGarbledStream() {
      yield { type: "usage", inputTokens: 80, outputTokens: 3 } as {
        type: string;
        text?: string;
      };
      yield { type: "text-delta", text: "maybe" };
    }
    resolveEngineMock.mockResolvedValue(fakeEngine(meteredGarbledStream));

    await expect(
      evaluateCondition(
        "is this urgent?",
        { messageId: "metered-garbled" },
        IDENTITY,
      ),
    ).rejects.toThrow(/unexpected classifier response/);

    expect(recordUsageMock).toHaveBeenCalledWith(
      expect.objectContaining({
        ownerEmail: "owner@example.com",
        label: "automation-condition",
        inputTokens: 80,
        outputTokens: 3,
      }),
    );
  });

  it("answers within the deadline while saving its usage is slow", async () => {
    vi.useFakeTimers();
    let streams = 0;
    async function* meteredStream() {
      streams += 1;
      yield { type: "usage", inputTokens: 40, outputTokens: 1 } as {
        type: string;
        text?: string;
      };
      yield { type: "text-delta", text: "yes" };
    }
    const engine = fakeEngine(meteredStream);
    let finishWrite!: () => void;
    recordUsageMock.mockReturnValueOnce(
      new Promise<undefined>((resolve) => {
        finishWrite = () => resolve(undefined);
      }),
    );
    const evaluate = () =>
      evaluateCondition(
        "is this urgent?",
        { messageId: "slow-usage-write" },
        IDENTITY,
        { engine, resolvedModel: "automation-model" },
      );

    const evaluation = evaluate();
    // The write is still running when the deadline passes.
    await vi.advanceTimersByTimeAsync(15_000);
    finishWrite();

    await expect(evaluation).resolves.toBe(true);
    // The answer was cached, so asking again costs no second model call.
    await expect(evaluate()).resolves.toBe(true);
    expect(streams).toBe(1);
  });

  it("saves a timed-out check's usage before reporting the timeout", async () => {
    vi.useFakeTimers();
    async function* meteredThenHanging(opts: {
      abortSignal: AbortSignal;
    }): AsyncIterable<{ type: string; text?: string }> {
      yield { type: "usage", inputTokens: 30, outputTokens: 0 } as {
        type: string;
        text?: string;
      };
      yield* hangingUntilAborted(opts);
    }
    resolveEngineMock.mockResolvedValue(fakeEngine(meteredThenHanging));
    let finishWrite!: () => void;
    recordUsageMock.mockReturnValueOnce(
      new Promise<undefined>((resolve) => {
        finishWrite = () => resolve(undefined);
      }),
    );

    let settled = false;
    const evaluation = evaluateCondition(
      "is this urgent?",
      { messageId: "timed-out-metered" },
      IDENTITY,
    ).finally(() => {
      settled = true;
    });
    const rejection = expect(evaluation).rejects.toThrow(
      "Condition evaluation timed out.",
    );
    await vi.advanceTimersByTimeAsync(15_000);
    await vi.waitFor(() =>
      expect(recordUsageMock).toHaveBeenCalledWith(
        expect.objectContaining({ inputTokens: 30 }),
      ),
    );

    // The timeout waits for the write instead of leaving it behind.
    expect(settled).toBe(false);
    finishWrite();
    await rejection;
  });

  it("records nothing when the engine reports no usage", async () => {
    async function* yesStream() {
      yield { type: "text-delta", text: "yes" };
    }
    resolveEngineMock.mockResolvedValue(fakeEngine(yesStream));

    await expect(
      evaluateCondition(
        "is this urgent?",
        { messageId: "unmetered" },
        IDENTITY,
      ),
    ).resolves.toBe(true);

    expect(recordUsageMock).not.toHaveBeenCalled();
  });
});
