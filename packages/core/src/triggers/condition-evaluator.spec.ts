import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  __clearConditionCache,
  evaluateCondition,
} from "./condition-evaluator.js";

describe("evaluateCondition", () => {
  beforeEach(() => {
    __clearConditionCache();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("bounds the classifier request and aborts it on timeout", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn(
      (_url: string | URL | Request, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener(
            "abort",
            () => reject(new Error("aborted")),
            { once: true },
          );
        }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const evaluation = evaluateCondition(
      "is this important?",
      { messageId: "timeout-case" },
      "test-api-key",
    );
    const rejection = expect(evaluation).rejects.toThrow(
      "Condition evaluation timed out.",
    );
    await vi.advanceTimersByTimeAsync(15_000);

    await rejection;
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock.mock.calls[0]?.[1]?.signal).toBeInstanceOf(AbortSignal);
  });

  it("uses the remaining event deadline when it is shorter than the default timeout", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn(
      (_url: string | URL | Request, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener(
            "abort",
            () => reject(new Error("aborted")),
            { once: true },
          );
        }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const evaluation = evaluateCondition(
      "is this important?",
      { messageId: "deadline-case" },
      "test-api-key",
      { deadlineAt: Date.now() + 1_000 },
    );
    const rejection = expect(evaluation).rejects.toThrow(
      "Condition evaluation timed out.",
    );
    await vi.advanceTimersByTimeAsync(1_000);

    await rejection;
  });

  it("does not start a classifier after the event deadline elapsed", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      evaluateCondition(
        "is this important?",
        { messageId: "expired-deadline" },
        "test-api-key",
        { deadlineAt: Date.now() - 1 },
      ),
    ).rejects.toThrow("Condition evaluation deadline elapsed.");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
