import { afterEach, describe, expect, it, vi } from "vitest";

import {
  hasRecurringSweepHandler,
  nextRecurringSweepHandlerDueAt,
  registerRecurringSweepHandler,
  runRecurringSweepHandlers,
} from "./sweep-hooks.js";

describe("recurring sweep hooks", () => {
  const disposers: Array<() => void> = [];
  afterEach(() => {
    disposers.splice(0).forEach((dispose) => dispose());
    vi.restoreAllMocks();
  });

  it("runs registered handlers and reports failures without skipping peers", async () => {
    const good = vi.fn(async (_context: { signal?: AbortSignal }) => {});
    const bad = vi.fn(async () => {
      throw new Error("failed");
    });
    disposers.push(registerRecurringSweepHandler("calendar", bad));
    disposers.push(registerRecurringSweepHandler("mail", good));
    vi.spyOn(console, "error").mockImplementation(() => {});
    const context = { deadlineAt: Date.now() + 60_000 };

    await expect(runRecurringSweepHandlers(context)).resolves.toEqual({
      registered: 2,
      failed: ["calendar"],
    });
    expect(good).toHaveBeenCalledOnce();
    expect(good.mock.calls[0]?.[0].signal).toBeInstanceOf(AbortSignal);
  });

  it("replaces a repeated registration and unregisters only its own callback", async () => {
    const first = vi.fn(async () => {});
    const next = vi.fn(async () => {});
    const disposeFirst = registerRecurringSweepHandler("calendar", first);
    const disposeNext = registerRecurringSweepHandler("calendar", next);
    disposers.push(disposeFirst, disposeNext);
    expect(hasRecurringSweepHandler("calendar")).toBe(true);
    disposeFirst();
    expect(hasRecurringSweepHandler("calendar")).toBe(true);
    await runRecurringSweepHandlers({ deadlineAt: Date.now() + 60_000 });
    expect(first).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledOnce();
    disposeNext();
    expect(hasRecurringSweepHandler("calendar")).toBe(false);
  });

  it("reports the earliest due time across handlers that declare one", async () => {
    const run = async () => {};
    disposers.push(
      registerRecurringSweepHandler("mail", run, {
        nextDueAt: async () => 9_000,
      }),
    );
    disposers.push(
      registerRecurringSweepHandler("snooze", run, {
        nextDueAt: async () => 4_000,
      }),
    );
    disposers.push(
      registerRecurringSweepHandler("idle", run, {
        nextDueAt: async () => null,
      }),
    );
    disposers.push(registerRecurringSweepHandler("cleanup", run));

    await expect(nextRecurringSweepHandlerDueAt()).resolves.toBe(4_000);
  });

  it("forgets a handler's due time when it is replaced or unregistered", async () => {
    const run = async () => {};
    const dispose = registerRecurringSweepHandler("mail", async () => {}, {
      nextDueAt: async () => 4_000,
    });
    disposers.push(registerRecurringSweepHandler("mail", run));
    await expect(nextRecurringSweepHandlerDueAt()).resolves.toBeNull();

    disposers.push(
      registerRecurringSweepHandler("calendar", run, {
        nextDueAt: async () => 6_000,
      }),
    );
    dispose();
    await expect(nextRecurringSweepHandlerDueAt()).resolves.toBe(6_000);
  });

  it("keeps a re-registration of the same callback when the old one is disposed", async () => {
    const run = async () => {};
    const disposeOld = registerRecurringSweepHandler("mail", run, {
      nextDueAt: async () => 4_000,
    });
    disposers.push(
      registerRecurringSweepHandler("mail", run, {
        nextDueAt: async () => 7_000,
      }),
    );

    disposeOld();

    expect(hasRecurringSweepHandler("mail")).toBe(true);
    await expect(nextRecurringSweepHandlerDueAt()).resolves.toBe(7_000);
  });

  it("treats a due time that is not a finite time as due now", async () => {
    disposers.push(
      registerRecurringSweepHandler("mail", async () => {}, {
        nextDueAt: async () => Number.NaN,
      }),
    );

    await expect(nextRecurringSweepHandlerDueAt(12_000)).resolves.toBe(12_000);
  });

  it("fails the due time when a reader throws, so the sweep keeps its cadence", async () => {
    disposers.push(
      registerRecurringSweepHandler("mail", async () => {}, {
        nextDueAt: async () => {
          throw new Error("database asleep");
        },
      }),
    );

    await expect(nextRecurringSweepHandlerDueAt()).rejects.toThrow(
      "database asleep",
    );
  });

  it("passes one deadline to concurrent handlers and awaits every result", async () => {
    let finishFirst!: () => void;
    const firstGate = new Promise<void>((resolve) => {
      finishFirst = resolve;
    });
    const context = { deadlineAt: Date.now() + 60_000 };
    const first = vi.fn(async (_context: typeof context) => firstGate);
    const second = vi.fn(async (_context: typeof context) => {});
    disposers.push(registerRecurringSweepHandler("first", first));
    disposers.push(registerRecurringSweepHandler("second", second));

    const running = runRecurringSweepHandlers(context);
    await vi.waitFor(() => {
      expect(first).toHaveBeenCalledWith(
        expect.objectContaining({ deadlineAt: context.deadlineAt }),
      );
      expect(second).toHaveBeenCalledWith(
        expect.objectContaining({ deadlineAt: context.deadlineAt }),
      );
    });
    finishFirst();
    await expect(running).resolves.toEqual({ registered: 2, failed: [] });
  });

  it("reports handlers that were not started before the shared deadline", async () => {
    const handler = vi.fn(async () => {});
    disposers.push(registerRecurringSweepHandler("expired", handler));
    vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(
      runRecurringSweepHandlers({ deadlineAt: Date.now() - 1 }),
    ).resolves.toEqual({ registered: 1, failed: ["expired"] });
    expect(handler).not.toHaveBeenCalled();
  });

  it("aborts and returns when a handler outlives the shared deadline", async () => {
    let signal: AbortSignal | undefined;
    const handler = vi.fn(async (context: { signal?: AbortSignal }) => {
      signal = context.signal;
      return new Promise<void>(() => {});
    });
    disposers.push(registerRecurringSweepHandler("stalled", handler));
    vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(
      runRecurringSweepHandlers({ deadlineAt: Date.now() + 20 }),
    ).resolves.toEqual({ registered: 1, failed: ["stalled"] });
    expect(signal?.aborted).toBe(true);
  });
});
