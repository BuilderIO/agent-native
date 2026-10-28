import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@react-native-async-storage/async-storage", () => ({
  default: {
    getItem: vi.fn(async () => null),
    removeItem: vi.fn(async () => {}),
    setItem: vi.fn(async () => {}),
  },
}));
vi.mock("expo-secure-store", () => ({
  AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY: 1,
  deleteItemAsync: vi.fn(async () => {}),
  getItemAsync: vi.fn(async () => null),
  setItemAsync: vi.fn(async () => {}),
}));
vi.mock("expo-web-browser", () => ({
  dismissBrowser: vi.fn(),
  openAuthSessionAsync: vi.fn(),
}));
vi.mock("react-native", () => ({ Platform: { OS: "ios" } }));

const fetchMock = vi.fn();
vi.stubGlobal("fetch", fetchMock);

import {
  clearNativeSessionCheckCache,
  inspectNativeSessionShared,
  NATIVE_SESSION_CHECK_TIMEOUT_MS,
} from "./native-auth";

const BASE = "https://dispatch.example.com";

function sessionResponse(email: string): Response {
  return {
    json: async () => ({ email }),
    ok: true,
    status: 200,
  } as unknown as Response;
}

beforeEach(() => {
  fetchMock.mockReset();
  clearNativeSessionCheckCache();
});

describe("inspectNativeSessionShared", () => {
  it("asks once for a token every mounted tab is validating at the same time", async () => {
    fetchMock.mockResolvedValue(sessionResponse("steve@builder.io"));

    const results = await Promise.all([
      inspectNativeSessionShared("token-a", BASE),
      inspectNativeSessionShared("token-a", BASE),
      inspectNativeSessionShared("token-a", BASE),
    ]);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    for (const result of results) expect(result.status).toBe("valid");
  });

  it("serves a valid answer from cache inside the window and re-asks after it", async () => {
    fetchMock.mockResolvedValue(sessionResponse("steve@builder.io"));

    await inspectNativeSessionShared("token-a", BASE, 1_000);
    await inspectNativeSessionShared("token-a", BASE, 30_000);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await inspectNativeSessionShared("token-a", BASE, 1_000 + 60_000);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("never caches a rejection, so a fresh sign-in is visible immediately", async () => {
    fetchMock.mockResolvedValue({
      json: async () => ({}),
      ok: false,
      status: 401,
    } as unknown as Response);
    const invalid = await inspectNativeSessionShared("token-a", BASE, 1_000);
    expect(invalid.status).toBe("invalid");

    fetchMock.mockResolvedValue(sessionResponse("steve@builder.io"));
    const revalidated = await inspectNativeSessionShared(
      "token-a",
      BASE,
      1_500,
    );
    expect(revalidated.status).toBe("valid");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("does not answer for a different token or a different host", async () => {
    fetchMock.mockResolvedValue(sessionResponse("steve@builder.io"));

    await inspectNativeSessionShared("token-a", BASE, 1_000);
    await inspectNativeSessionShared("token-b", BASE, 1_000);
    await inspectNativeSessionShared(
      "token-a",
      "https://other.example.com",
      1_000,
    );

    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("aborts a stalled parent-session check and reports it unavailable", async () => {
    vi.useFakeTimers();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const requestSignals: AbortSignal[] = [];
    fetchMock.mockImplementation(
      (_url: string, options: RequestInit) =>
        new Promise((_resolve, reject) => {
          const signal = options.signal;
          if (signal) {
            requestSignals.push(signal);
            signal.addEventListener(
              "abort",
              () => reject(new Error("aborted")),
              { once: true },
            );
          }
        }),
    );

    try {
      const checking = inspectNativeSessionShared("token-a", BASE);
      await vi.advanceTimersByTimeAsync(NATIVE_SESSION_CHECK_TIMEOUT_MS);

      await expect(checking).resolves.toEqual({
        reason: "network",
        status: "unavailable",
      });
      expect(requestSignals[0]?.aborted).toBe(true);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    } finally {
      warn.mockRestore();
      vi.useRealTimers();
    }
  });

  it("keeps the timeout active until the parent-session body is read", async () => {
    vi.useFakeTimers();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const requestSignals: AbortSignal[] = [];
    fetchMock.mockImplementation((_url: string, options: RequestInit) => {
      const signal = options.signal;
      if (signal) requestSignals.push(signal);
      return Promise.resolve({
        json: () =>
          new Promise((_resolve, reject) => {
            signal?.addEventListener(
              "abort",
              () => reject(new Error("aborted")),
              { once: true },
            );
          }),
        ok: true,
        status: 200,
      } as unknown as Response);
    });

    try {
      const checking = inspectNativeSessionShared("token-a", BASE);
      await vi.advanceTimersByTimeAsync(NATIVE_SESSION_CHECK_TIMEOUT_MS);

      await expect(checking).resolves.toEqual({
        reason: "network",
        status: "unavailable",
      });
      expect(requestSignals[0]?.aborted).toBe(true);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    } finally {
      warn.mockRestore();
      vi.useRealTimers();
    }
  });
});
