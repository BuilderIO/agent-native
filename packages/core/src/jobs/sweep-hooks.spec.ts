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

    await expect(runRecurringSweepHandlers()).resolves.toEqual({
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
    await runRecurringSweepHandlers();
    expect(first).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledOnce();
    disposeNext();
    expect(hasRecurringSweepHandler("calendar")).toBe(false);
  });
});
