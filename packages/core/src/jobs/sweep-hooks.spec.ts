import { afterEach, describe, expect, it, vi } from "vitest";

import {
  hasRecurringSweepHandler,
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
    const good = vi.fn(async () => {});
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
      expect(first).toHaveBeenCalledWith(context);
      expect(second).toHaveBeenCalledWith(context);
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
});
