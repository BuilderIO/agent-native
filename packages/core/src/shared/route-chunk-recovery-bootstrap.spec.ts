import { runInNewContext } from "node:vm";

import { describe, expect, it, vi } from "vitest";

import {
  CHUNK_RECOVERY_CACHE_BUSTER_PARAM,
  CHUNK_RECOVERY_ORIGINAL_HASH_PARAM,
  CHUNK_RECOVERY_PATH_SUFFIX,
  CHUNK_RECOVERY_QUERY_PARAM,
  ROUTE_CHUNK_RECOVERY_BOOTSTRAP_SCRIPT,
  ROUTE_WARMUP_PRELOAD_ATTRIBUTE,
  STALE_CHUNK_RELOAD_AT_KEY,
} from "./route-chunk-recovery-bootstrap.js";

type BootstrapResourceTarget = {
  getAttribute?: (name: string) => string | null;
  hasAttribute?: (name: string) => boolean;
  rel?: string;
  tagName: string;
  type?: string;
};

type BootstrapResourceError = {
  stopImmediatePropagation: () => void;
  target: BootstrapResourceTarget;
};

function installBootstrap(
  href = "https://example.test/apps?tab=activity#latest",
  userAgent = "Mozilla/5.0",
  sessionStorageThrows = false,
) {
  let onError: ((event: BootstrapResourceError) => void) | undefined;
  const sessionValues = new Map<string, string>();
  const windowState: Record<string, unknown> = {};
  const assign = vi.fn();
  const location = {
    assign,
    href,
    hostname: new URL(href).hostname,
  };

  runInNewContext(ROUTE_CHUNK_RECOVERY_BOOTSTRAP_SCRIPT, {
    Date: { now: () => 2_000_000 },
    URL,
    URLSearchParams,
    window: windowState,
    document: {
      addEventListener: (
        _type: string,
        listener: (event: BootstrapResourceError) => void,
        _capture: boolean,
      ) => {
        onError = listener;
      },
    },
    location,
    navigator: { userAgent },
    sessionStorage: {
      getItem: (key: string) => {
        if (sessionStorageThrows)
          throw new Error("session storage unavailable");
        return sessionValues.get(key) ?? null;
      },
      setItem: (key: string, value: string) => sessionValues.set(key, value),
    },
  });

  if (!onError)
    throw new Error("Recovery bootstrap did not install its listener");

  return { assign, location, onError, sessionValues, windowState };
}

describe("route chunk recovery bootstrap", () => {
  it("retries required module failures before client handlers can classify them", () => {
    const { assign, onError, sessionValues } = installBootstrap();
    const stopImmediatePropagation = vi.fn();

    onError({
      target: {
        getAttribute: (name) => (name === "rel" ? "modulepreload" : null),
        hasAttribute: () => false,
        rel: "modulepreload",
        tagName: "LINK",
      },
      stopImmediatePropagation,
    });

    expect(assign).toHaveBeenCalledOnce();
    const retryUrl = new URL(assign.mock.calls[0]?.[0]);
    expect(retryUrl.pathname).toBe(`/apps${CHUNK_RECOVERY_PATH_SUFFIX}`);
    expect(retryUrl.searchParams.get("tab")).toBe("activity");
    expect(retryUrl.searchParams.has(CHUNK_RECOVERY_QUERY_PARAM)).toBe(false);
    expect(retryUrl.searchParams.has(CHUNK_RECOVERY_CACHE_BUSTER_PARAM)).toBe(
      false,
    );
    const recoveryHash = new URLSearchParams(retryUrl.hash.slice(1));
    expect(recoveryHash.get(CHUNK_RECOVERY_CACHE_BUSTER_PARAM)).toBeTruthy();
    expect(recoveryHash.get(CHUNK_RECOVERY_ORIGINAL_HASH_PARAM)).toBe(
      "#latest",
    );
    expect(sessionValues.get(STALE_CHUNK_RELOAD_AT_KEY)).toBe("2000000");
    expect(stopImmediatePropagation).toHaveBeenCalledOnce();
  });

  it("replaces legacy arbitrary recovery markers with the fixed recovery path", () => {
    const { assign, onError } = installBootstrap(
      `https://example.test/apps?${CHUNK_RECOVERY_QUERY_PARAM}=arbitrary`,
    );

    onError({
      target: {
        getAttribute: (name) => (name === "rel" ? "modulepreload" : null),
        hasAttribute: () => false,
        rel: "modulepreload",
        tagName: "LINK",
      },
      stopImmediatePropagation: vi.fn(),
    });

    expect(assign).toHaveBeenCalledOnce();
    const recoveryUrl = new URL(assign.mock.calls[0]?.[0]);
    expect(recoveryUrl.pathname).toBe(`/apps${CHUNK_RECOVERY_PATH_SUFFIX}`);
    expect(recoveryUrl.searchParams.has(CHUNK_RECOVERY_QUERY_PARAM)).toBe(
      false,
    );
  });

  it("does not retry a failure while already on the recovery path", () => {
    for (const trailingSlash of ["", "/"]) {
      const { assign, onError } = installBootstrap(
        `https://example.test/apps${CHUNK_RECOVERY_PATH_SUFFIX}${trailingSlash}`,
      );

      onError({
        target: {
          getAttribute: (name) => (name === "rel" ? "modulepreload" : null),
          hasAttribute: () => false,
          rel: "modulepreload",
          tagName: "LINK",
        },
        stopImmediatePropagation: vi.fn(),
      });

      expect(assign).not.toHaveBeenCalled();
    }
  });

  it("keeps the reload cooldown when session storage is unavailable", () => {
    const { assign, onError, windowState } = installBootstrap(
      "https://example.test/apps",
      "Mozilla/5.0",
      true,
    );

    onError({
      target: {
        getAttribute: (name) => (name === "rel" ? "modulepreload" : null),
        hasAttribute: () => false,
        rel: "modulepreload",
        tagName: "LINK",
      },
      stopImmediatePropagation: vi.fn(),
    });

    expect(assign).toHaveBeenCalledOnce();
    expect(windowState[STALE_CHUNK_RELOAD_AT_KEY]).toBe(2_000_000);

    onError({
      target: {
        getAttribute: (name) => (name === "rel" ? "modulepreload" : null),
        hasAttribute: () => false,
        rel: "modulepreload",
        tagName: "LINK",
      },
      stopImmediatePropagation: vi.fn(),
    });

    expect(assign).toHaveBeenCalledOnce();
  });

  it("ignores speculative module preloads", () => {
    const { assign, onError } = installBootstrap();
    const stopImmediatePropagation = vi.fn();

    onError({
      target: {
        getAttribute: (name) => (name === "rel" ? "modulepreload" : null),
        hasAttribute: (name) => name === ROUTE_WARMUP_PRELOAD_ATTRIBUTE,
        rel: "modulepreload",
        tagName: "LINK",
      },
      stopImmediatePropagation,
    });

    expect(assign).not.toHaveBeenCalled();
    expect(stopImmediatePropagation).not.toHaveBeenCalled();
  });

  it("leaves desktop and local development failures to their own recovery paths", () => {
    const desktop = installBootstrap(
      "https://example.test/apps",
      "Mozilla/5.0 AgentNativeDesktop/0.1.7",
    );
    const local = installBootstrap("http://localhost:5173/apps");
    const target = {
      tagName: "SCRIPT",
      type: "module",
    };

    desktop.onError({ target, stopImmediatePropagation: vi.fn() });
    local.onError({ target, stopImmediatePropagation: vi.fn() });

    expect(desktop.assign).not.toHaveBeenCalled();
    expect(local.assign).not.toHaveBeenCalled();
  });
});
