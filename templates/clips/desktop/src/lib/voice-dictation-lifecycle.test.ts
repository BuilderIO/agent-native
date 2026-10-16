// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createVoiceDictationLifecycle,
  finalizeDictationText,
  isCurrentDictationRun,
  saveDictationHistoryRequest,
} from "./voice-dictation-lifecycle";

afterEach(() => {
  vi.useRealTimers();
});

describe("voice dictation lifecycle", () => {
  it("rejects duplicate starts and ignores stale completions", () => {
    const lifecycle = createVoiceDictationLifecycle();
    const first = lifecycle.begin();

    expect(first).toEqual(expect.any(Number));
    expect(lifecycle.begin()).toBeNull();
    expect(lifecycle.transition(first!, "capturing")).toBe(true);
    expect(isCurrentDictationRun(lifecycle, first!, first)).toBe(true);
    expect(lifecycle.finish(first!, "completed")).toBe(true);
    expect(isCurrentDictationRun(lifecycle, first!, first)).toBe(false);

    const second = lifecycle.begin();
    expect(second).toBeGreaterThan(first!);
    expect(lifecycle.transition(first!, "finalizing")).toBe(false);
    expect(isCurrentDictationRun(lifecycle, second!, first)).toBe(false);
    expect(isCurrentDictationRun(lifecycle, second!, undefined)).toBe(false);
    expect(lifecycle.isActive(second!)).toBe(true);
    expect(lifecycle.snapshot()).toEqual({
      runId: second,
      phase: "initializing",
    });
  });

  it("keeps run ids newer when the lifecycle module is reloaded", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2030-10-16T12:00:00Z"));
    window.sessionStorage.clear();
    vi.resetModules();
    const firstLifecycle = await import("./voice-dictation-lifecycle");
    const firstRunId = firstLifecycle.createVoiceDictationLifecycle().begin()!;

    Reflect.deleteProperty(globalThis, "__clipsVoiceDictationLastRunId");
    vi.resetModules();
    const reloadedLifecycle = await import("./voice-dictation-lifecycle");
    const secondRunId = reloadedLifecycle
      .createVoiceDictationLifecycle()
      .begin()!;

    expect(secondRunId).toBeGreaterThan(firstRunId);
  });

  it("fails closed when run ID storage cannot be read", async () => {
    const originalDescriptor = Object.getOwnPropertyDescriptor(
      window,
      "sessionStorage",
    );
    Object.defineProperty(window, "sessionStorage", {
      configurable: true,
      get: () => {
        throw new Error("storage blocked");
      },
    });
    try {
      vi.resetModules();
      const lifecycleModule = await import("./voice-dictation-lifecycle");

      expect(() =>
        lifecycleModule.createVoiceDictationLifecycle().begin(),
      ).toThrow("Dictation run ID storage is unavailable.");
    } finally {
      if (originalDescriptor) {
        Object.defineProperty(window, "sessionStorage", originalDescriptor);
      } else {
        Reflect.deleteProperty(window, "sessionStorage");
      }
    }
  });

  it("treats an empty provider result as no usable speech", async () => {
    const insert = vi.fn(async () => "inserted" as const);
    const saveHistory = vi.fn(async () => {});

    await expect(
      finalizeDictationText({
        rawText: "  ",
        cancelled: () => false,
        insert,
        copy: vi.fn(async () => {}),
        saveHistory,
        applyBacktrack: (text) => text,
        onStage: vi.fn(),
      }),
    ).resolves.toEqual({ kind: "failed", failure: "no-speech" });
    expect(insert).not.toHaveBeenCalled();
    expect(saveHistory).not.toHaveBeenCalled();
  });

  it("serializes history recovery inside the failed run", () => {
    const lifecycle = createVoiceDictationLifecycle();
    const runId = lifecycle.begin()!;
    expect(lifecycle.transition(runId, "capturing")).toBe(true);
    expect(lifecycle.transition(runId, "finalizing")).toBe(true);
    expect(lifecycle.transition(runId, "inserting")).toBe(true);
    expect(lifecycle.transition(runId, "saving-history")).toBe(true);
    expect(lifecycle.finish(runId, "failed")).toBe(true);

    expect(lifecycle.retryHistory(runId)).toBe(true);
    expect(lifecycle.isBusy()).toBe(true);
    expect(lifecycle.begin()).toBeNull();
    expect(lifecycle.finish(runId, "completed")).toBe(true);
    expect(lifecycle.retryHistory(runId)).toBe(false);
  });

  it("keeps the raw transcript when optional cleanup fails or returns empty text", async () => {
    const insert = vi.fn(async () => "inserted" as const);
    const saveHistory = vi.fn(async () => {});

    const result = await finalizeDictationText({
      rawText: "  keep these words  ",
      cancelled: () => false,
      cleanup: async () => "  ",
      insert,
      copy: vi.fn(async () => {}),
      saveHistory,
      applyBacktrack: (text) => text,
      onStage: vi.fn(),
    });

    expect(result).toEqual({
      kind: "completed",
      insertion: "inserted",
      historySaved: true,
      cleanupFailed: true,
      backtrackFailed: false,
    });
    expect(insert).toHaveBeenCalledWith("keep these words");
    expect(saveHistory).toHaveBeenCalledWith("keep these words", null);
  });

  it("bounds optional cleanup and falls back to the raw transcript", async () => {
    vi.useFakeTimers();
    const insert = vi.fn(async () => "inserted" as const);
    const controller = new AbortController();
    const cleanup = vi.fn(
      (_text: string, signal: AbortSignal) =>
        new Promise<string>((_, reject) => {
          signal.addEventListener("abort", () => reject(new Error("aborted")));
        }),
    );

    const completion = finalizeDictationText({
      rawText: "recognized words",
      cancelled: () => false,
      signal: controller.signal,
      cleanup,
      cleanupTimeoutMs: 100,
      insert,
      copy: vi.fn(async () => {}),
      saveHistory: vi.fn(async () => {}),
      applyBacktrack: (text) => text,
      onStage: vi.fn(),
    });
    await vi.advanceTimersByTimeAsync(100);

    await expect(completion).resolves.toMatchObject({
      kind: "completed",
      cleanupFailed: true,
    });
    expect(cleanup).toHaveBeenCalledOnce();
    expect(insert).toHaveBeenCalledWith("recognized words");
  });

  it("recovers a failed insertion through clipboard and still records history", async () => {
    const copy = vi.fn(async () => {});
    const saveHistory = vi.fn(async () => {});
    const result = await finalizeDictationText({
      rawText: "recognized words",
      cancelled: () => false,
      insert: vi.fn(async () => {
        throw new Error("paste blocked");
      }),
      copy,
      saveHistory,
      applyBacktrack: (text) => text,
      onStage: vi.fn(),
    });

    expect(result).toEqual({
      kind: "completed",
      insertion: "copied",
      historySaved: true,
      cleanupFailed: false,
      backtrackFailed: false,
    });
    expect(copy).toHaveBeenCalledOnce();
    expect(saveHistory).toHaveBeenCalledWith("recognized words", null);
  });

  it("keeps copied outcome through a history retry after insertion falls back", async () => {
    let insertionOutcome: "inserted" | "copied" | undefined;
    const saveHistory = vi
      .fn<(_rawText: string, _cleanedText: string | null) => Promise<void>>()
      .mockRejectedValueOnce(new Error("history endpoint failed"))
      .mockResolvedValueOnce();
    const options = {
      rawText: "recognized words",
      cancelled: () => false,
      insert: vi.fn(async () => {
        throw new Error("paste blocked");
      }),
      copy: vi.fn(async () => {}),
      saveHistory,
      applyBacktrack: (text: string) => text,
      onStage: vi.fn(),
      onInsertion: (insertion: "inserted" | "copied") => {
        insertionOutcome = insertion;
      },
    };

    const result = await finalizeDictationText(options);
    expect(result).toMatchObject({
      kind: "failed",
      failure: "history-save",
      insertion: "copied",
      historySaved: false,
    });
    expect(insertionOutcome).toBe("copied");

    await saveHistory("recognized words", null);
    expect(insertionOutcome).toBe("copied");
    expect(saveHistory).toHaveBeenCalledTimes(2);
  });

  it("reports history failure without claiming it was saved", async () => {
    const result = await finalizeDictationText({
      rawText: "recognized words",
      cancelled: () => false,
      insert: vi.fn(async () => "inserted" as const),
      copy: vi.fn(async () => {}),
      saveHistory: vi.fn(async () => {
        throw new Error("history endpoint failed");
      }),
      applyBacktrack: (text) => text,
      onStage: vi.fn(),
    });

    expect(result).toEqual({
      kind: "failed",
      failure: "history-save",
      insertion: "inserted",
      recoverable: true,
      historySaved: false,
      cleanupFailed: false,
      backtrackFailed: false,
      transcript: "recognized words",
    });
  });

  it("keeps the final processed text recoverable if insertion and copy fail", async () => {
    const copy = vi.fn(async () => {
      throw new Error("clipboard unavailable");
    });
    const saveHistory = vi.fn(async () => {});
    const result = await finalizeDictationText({
      rawText: "  original words  ",
      cancelled: () => false,
      cleanup: async () => "cleaned final words",
      insert: vi.fn(async () => {
        throw new Error("paste blocked");
      }),
      copy,
      saveHistory,
      applyBacktrack: (text) => text,
      onStage: vi.fn(),
    });

    expect(result).toEqual({
      kind: "failed",
      failure: "paste",
      recoverable: true,
      historySaved: true,
      insertion: null,
      cleanupFailed: false,
      backtrackFailed: false,
      transcript: "cleaned final words",
      originalTranscript: "original words",
    });
    expect(copy).toHaveBeenCalledWith("cleaned final words");
    expect(saveHistory).toHaveBeenCalledWith(
      "original words",
      "cleaned final words",
    );
  });

  it("reports a failed backtrack while preserving the recognized text", async () => {
    const insert = vi.fn(async () => "inserted" as const);
    const result = await finalizeDictationText({
      rawText: "recognized words",
      cancelled: () => false,
      insert,
      copy: vi.fn(async () => {}),
      saveHistory: vi.fn(async () => {}),
      applyBacktrack: () => {
        throw new Error("backtrack failed");
      },
      onStage: vi.fn(),
    });

    expect(result).toMatchObject({
      kind: "completed",
      insertion: "inserted",
      backtrackFailed: true,
    });
    expect(insert).toHaveBeenCalledWith("recognized words");
  });

  it("saves history after insertion has crossed the commit point", async () => {
    let cancelled = false;
    const saveHistory = vi.fn(async () => {});
    const result = await finalizeDictationText({
      rawText: "recognized words",
      cancelled: () => cancelled,
      insert: async () => {
        cancelled = true;
        return "inserted";
      },
      copy: vi.fn(async () => {}),
      saveHistory,
      applyBacktrack: (text) => text,
      onStage: vi.fn(),
    });

    expect(result).toMatchObject({ kind: "completed", historySaved: true });
    expect(saveHistory).toHaveBeenCalledOnce();
  });
});

describe("dictation history save contract", () => {
  const request = (
    fetcher: (url: string, init: RequestInit) => Promise<Response>,
  ) =>
    saveDictationHistoryRequest({
      url: "/_agent-native/actions/create-dictation",
      id: "history-stable-id",
      body: { id: "history-stable-id", fullText: "recognized words" },
      fetcher,
    });

  const response = (body: unknown, ok = true, status = 200) =>
    ({
      ok,
      status,
      text: async () => JSON.stringify(body),
    }) as Response;

  it("rejects an HTTP failure and reuses the same id on retry", async () => {
    const fetcher = vi
      .fn<(url: string, init: RequestInit) => Promise<Response>>()
      .mockResolvedValueOnce(response({ error: "server failed" }, false, 500))
      .mockResolvedValueOnce(response({ id: "history-stable-id" }));

    await expect(request(fetcher)).rejects.toThrow("server failed");
    await expect(request(fetcher)).resolves.toBeUndefined();
    expect(JSON.parse(fetcher.mock.calls[0][1].body as string).id).toBe(
      "history-stable-id",
    );
    expect(JSON.parse(fetcher.mock.calls[1][1].body as string).id).toBe(
      "history-stable-id",
    );
  });

  it("rejects malformed and mismatched success responses", async () => {
    await expect(
      request(async () => response({ id: "another-dictation" })),
    ).rejects.toThrow("did not confirm");
    await expect(
      request(
        async () =>
          ({
            ok: true,
            status: 200,
            text: async () => "not-json",
          }) as Response,
      ),
    ).rejects.toThrow("invalid response");
  });

  it("bounds a hanging history request", async () => {
    vi.useFakeTimers();
    const pending = request(() => new Promise<Response>(() => {}));
    const rejection = expect(pending).rejects.toThrow("timed out");
    await vi.advanceTimersByTimeAsync(4_000);
    await rejection;
  });
});
