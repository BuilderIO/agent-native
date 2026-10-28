import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createCompletionCardActions,
  dismissCompletionCardWindow,
} from "./pill-completion-actions";

afterEach(() => vi.useRealTimers());

function setup() {
  const deps = {
    open: vi.fn().mockResolvedValue(undefined),
    copy: vi.fn().mockResolvedValue(undefined),
    dismiss: vi.fn().mockResolvedValue(undefined),
  };
  return { ...deps, run: createCompletionCardActions(deps) };
}

describe("completion card user actions", () => {
  it.each(["open", "copy"] as const)(
    "dismisses only after %s succeeds",
    async (action) => {
      const s = setup();
      let finish!: () => void;
      s[action].mockImplementation(
        () =>
          new Promise<void>((resolve) => {
            finish = resolve;
          }),
      );
      const result = s.run(action, "https://example.test/share/clip");
      expect(s.dismiss).not.toHaveBeenCalled();
      finish();
      await expect(result).resolves.toEqual({ status: "dismissed" });
      expect(s.dismiss).toHaveBeenCalledOnce();
      expect(s[action]).toHaveBeenCalledExactlyOnceWith(
        "https://example.test/share/clip",
      );
    },
  );

  it.each(["open", "copy"] as const)(
    "keeps the card and identifies a failed %s",
    async (action) => {
      const s = setup();
      const error = new Error("Example action failed");
      s[action].mockRejectedValueOnce(error);
      await expect(
        s.run(action, "https://example.test/share/clip"),
      ).resolves.toEqual({ status: "failed", stage: action, error });
      expect(s.dismiss).not.toHaveBeenCalled();
      await expect(
        s.run(action, "https://example.test/share/clip"),
      ).resolves.toEqual({ status: "dismissed" });
      expect(s[action]).toHaveBeenCalledTimes(2);
    },
  );

  it.each(["open", "copy"] as const)(
    "retries dismissal without repeating successful %s",
    async (action) => {
      const s = setup();
      const error = new Error("Example window close failed");
      s.dismiss.mockRejectedValueOnce(error);
      await expect(
        s.run(action, "https://example.test/share/clip"),
      ).resolves.toEqual({ status: "failed", stage: "dismiss", error });
      await expect(
        s.run(action, "https://example.test/share/clip"),
      ).resolves.toEqual({ status: "dismissed" });
      expect(s[action]).toHaveBeenCalledOnce();
      expect(s.dismiss).toHaveBeenCalledTimes(2);
    },
  );

  it("manual dismissal never triggers Open or Copy", async () => {
    const s = setup();
    await expect(s.run("dismiss")).resolves.toEqual({ status: "dismissed" });
    expect(s.open).not.toHaveBeenCalled();
    expect(s.copy).not.toHaveBeenCalled();
  });

  it("does nothing on initialization or an automatic copied-state update", () => {
    const s = setup();
    expect(s.dismiss).not.toHaveBeenCalled();
    expect(s.open).not.toHaveBeenCalled();
    expect(s.copy).not.toHaveBeenCalled();
  });

  it("ignores competing clicks while an action is pending", async () => {
    const s = setup();
    let finish!: () => void;
    s.copy.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    const first = s.run("copy", "https://example.test/share/clip");
    await expect(
      s.run("open", "https://example.test/share/clip"),
    ).resolves.toEqual({ status: "busy" });
    expect(s.open).not.toHaveBeenCalled();
    finish();
    await first;
    expect(s.dismiss).toHaveBeenCalledOnce();
  });
});

describe("native completion dismissal", () => {
  function deps() {
    return {
      releaseHold: vi.fn().mockResolvedValue(undefined),
      restoreHold: vi.fn().mockResolvedValue(undefined),
      close: vi.fn().mockResolvedValue(undefined),
      onReleaseFailure: vi.fn(),
    };
  }

  it("closes independently of a hung preservation release", async () => {
    const d = deps();
    d.releaseHold.mockImplementation(() => new Promise(() => {}));
    await expect(dismissCompletionCardWindow(d)).resolves.toBeUndefined();
    expect(d.close).toHaveBeenCalledOnce();
  });

  it("still closes when preservation release rejects", async () => {
    const d = deps();
    const error = new Error("Example hold failure");
    d.releaseHold.mockRejectedValue(error);
    await expect(dismissCompletionCardWindow(d)).resolves.toBeUndefined();
    expect(d.onReleaseFailure).toHaveBeenCalledWith(error);
    expect(d.close).toHaveBeenCalledOnce();
  });

  it("surfaces close rejection and restores preservation", async () => {
    const d = deps();
    const error = new Error("Example close failure");
    d.close.mockRejectedValue(error);
    await expect(dismissCompletionCardWindow(d)).rejects.toBe(error);
    expect(d.restoreHold).toHaveBeenCalledOnce();
  });

  it("bounds hung close and consumes its later rejection", async () => {
    vi.useFakeTimers();
    const d = deps();
    let rejectClose!: (error: Error) => void;
    d.close.mockImplementation(
      () =>
        new Promise<void>((_, reject) => {
          rejectClose = reject;
        }),
    );
    const result = expect(dismissCompletionCardWindow(d)).rejects.toThrow(
      "Completion window close timed out",
    );
    await vi.advanceTimersByTimeAsync(3_000);
    await result;
    rejectClose(new Error("Example late failure"));
    await Promise.resolve();
    expect(d.restoreHold).toHaveBeenCalledOnce();
  });
});
