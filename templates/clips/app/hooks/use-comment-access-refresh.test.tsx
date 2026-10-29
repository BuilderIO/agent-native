// @vitest-environment happy-dom
import {
  QueryClient,
  QueryClientProvider,
  useQuery,
} from "@tanstack/react-query";
import React, { act, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";

import {
  useCommentAccessRefresh,
  useCommentAccessToken,
} from "./use-comment-access-refresh";

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
it("refreshes password proof before expiry, rotates it, and stops when no longer unlocked", async () => {
  vi.useFakeTimers();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const refresh = vi.fn();
  const container = document.createElement("div");
  const root = createRoot(container);
  function Probe({ token }: { token?: string }) {
    useCommentAccessRefresh(token, refresh);
    return null;
  }
  try {
    act(() => root.render(<Probe token="fake-first-proof" />));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(299_999);
    });
    expect(refresh).not.toHaveBeenCalled();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(refresh).toHaveBeenCalledTimes(1);
    act(() => root.render(<Probe token="fake-rotated-proof" />));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300_000);
    });
    expect(refresh).toHaveBeenCalledTimes(2);
    act(() => root.render(<Probe />));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(600_000);
    });
    expect(refresh).toHaveBeenCalledTimes(2);
  } finally {
    act(() => root.unmount());
  }
  expect(vi.getTimerCount()).toBe(0);
});

it("refreshes when an unlocked tab becomes visible after suspension", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const refresh = vi.fn(async () => {});
  const container = document.createElement("div");
  const root = createRoot(container);
  function Probe() {
    useCommentAccessRefresh("fake-proof", refresh);
    return null;
  }
  try {
    act(() => root.render(<Probe />));
    Object.defineProperty(document, "visibilityState", {
      value: "visible",
      configurable: true,
    });
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(refresh).toHaveBeenCalledTimes(1);
    act(() => root.unmount());
    window.dispatchEvent(new Event("focus"));
    document.dispatchEvent(new Event("visibilitychange"));
    expect(refresh).toHaveBeenCalledTimes(1);
  } finally {
    act(() => root.unmount());
    Reflect.deleteProperty(document, "visibilityState");
  }
});

it("reuses a fresh grant and renews one that is stale, refused, or rejected", async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const shareFetch = vi.fn(async () =>
    shareFetch.mock.calls.length < 4
      ? {
          ok: true,
          status: 200,
          data: {
            recording: {
              commentAccessToken: `fake-proof-${shareFetch.mock.calls.length}`,
            },
          },
        }
      : { ok: false, status: 401, data: { error: "Password required" } },
  );
  let getToken!: (refusedToken?: string | null) => Promise<unknown>;
  let committedToken: unknown;
  const shareKey = ["public-recording", "fake-share"];
  function Probe() {
    const shareQ = useQuery({ queryKey: shareKey, queryFn: shareFetch });
    getToken = useCommentAccessToken(shareQ, shareKey);
    const token = shareQ.data?.data.recording?.commentAccessToken;
    // Declared after the hook, so it runs once the hook has recorded the grant.
    useEffect(() => {
      committedToken = token;
    }, [token]);
    return null;
  }
  // React Query hands new data to React on its own zero-delay timer, which can
  // land after any single flush. vi.waitFor would advance the faked Date.
  const waitForGrant = async (token: string) => {
    for (let turn = 0; committedToken !== token && turn < 100; turn++) {
      await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
    }
    expect(committedToken).toBe(token);
  };
  const root = createRoot(document.createElement("div"));
  try {
    act(() =>
      root.render(
        <QueryClientProvider client={queryClient}>
          <Probe />
        </QueryClientProvider>,
      ),
    );
    await waitForGrant("fake-proof-1");
    expect(shareFetch).toHaveBeenCalledTimes(1);

    vi.setSystemTime(Date.now() + 299_000);
    await expect(getToken()).resolves.toBe("fake-proof-1");
    expect(shareFetch).toHaveBeenCalledTimes(1);

    vi.setSystemTime(Date.now() + 1_000);
    await act(async () => {
      await expect(getToken()).resolves.toBe("fake-proof-2");
    });
    await waitForGrant("fake-proof-2");
    expect(shareFetch).toHaveBeenCalledTimes(2);
    await expect(getToken()).resolves.toBe("fake-proof-2");
    expect(shareFetch).toHaveBeenCalledTimes(2);

    await act(async () => {
      await expect(getToken("fake-proof-2")).resolves.toBe("fake-proof-3");
    });
    await waitForGrant("fake-proof-3");
    expect(shareFetch).toHaveBeenCalledTimes(3);

    await act(async () => {
      await expect(getToken("fake-proof-3")).rejects.toThrow(
        "Password required",
      );
    });
    expect(shareFetch).toHaveBeenCalledTimes(4);
  } finally {
    act(() => root.unmount());
    queryClient.clear();
  }
});

it("rethrows a renewal Error as is and wraps any other failure as its cause", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const renewalError = new Error("fake renewal failure");
  const failures: unknown[] = [renewalError, "fake non-error failure"];
  const shareFetch = vi.fn(() =>
    shareFetch.mock.calls.length === 1
      ? Promise.resolve({
          ok: true,
          status: 200,
          data: { recording: { commentAccessToken: "fake-proof" } },
        })
      : Promise.reject(failures.shift()),
  );
  let getToken!: (refusedToken?: string | null) => Promise<unknown>;
  let committedToken: unknown;
  const shareKey = ["public-recording", "fake-failing-share"];
  function Probe() {
    const shareQ = useQuery({ queryKey: shareKey, queryFn: shareFetch });
    getToken = useCommentAccessToken(shareQ, shareKey);
    const token = shareQ.data?.data.recording.commentAccessToken;
    useEffect(() => {
      committedToken = token;
    }, [token]);
    return null;
  }
  const root = createRoot(document.createElement("div"));
  try {
    act(() =>
      root.render(
        <QueryClientProvider client={queryClient}>
          <Probe />
        </QueryClientProvider>,
      ),
    );
    for (let turn = 0; committedToken !== "fake-proof" && turn < 100; turn++) {
      await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
    }
    expect(committedToken).toBe("fake-proof");

    await act(async () => {
      await expect(getToken("fake-proof")).rejects.toBe(renewalError);
    });
    await act(async () => {
      const failure = getToken("fake-proof");
      await expect(failure).rejects.toBeInstanceOf(Error);
      await expect(failure).rejects.toMatchObject({
        message: "Comment access renewal failed",
        cause: "fake non-error failure",
      });
    });
    expect(shareFetch).toHaveBeenCalledTimes(3);
  } finally {
    act(() => root.unmount());
    queryClient.clear();
  }
});
