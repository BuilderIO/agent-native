import { afterEach, describe, expect, it, vi } from "vitest";

import {
  settleMobileSessionStorageRead,
  shouldShowMobileSessionLoadError,
} from "./mobile-session-bootstrap";

afterEach(() => {
  vi.useRealTimers();
});

describe("mobile session bootstrap", () => {
  it("keeps an already-open app after a refresh storage failure", () => {
    expect(shouldShowMobileSessionLoadError(true)).toBe(false);
  });

  it("shows retry after the initial session read fails", () => {
    expect(shouldShowMobileSessionLoadError(false)).toBe(true);
  });

  it("returns stored session data when the read completes", async () => {
    await expect(
      settleMobileSessionStorageRead(async () => ({ token: "parent-token" })),
    ).resolves.toEqual({
      status: "ready",
      value: { token: "parent-token" },
    });
  });

  it("reports read failures without treating them as a signed-out result", async () => {
    await expect(
      settleMobileSessionStorageRead(async () => {
        throw new Error("storage unavailable");
      }),
    ).resolves.toEqual({ status: "error", reason: "read-failed" });
  });

  it("returns a timeout result when the read never settles", async () => {
    vi.useFakeTimers();
    const result = settleMobileSessionStorageRead(
      () => new Promise<never>(() => {}),
      100,
    );

    await vi.advanceTimersByTimeAsync(100);

    await expect(result).resolves.toEqual({
      status: "error",
      reason: "timeout",
    });
  });
});
