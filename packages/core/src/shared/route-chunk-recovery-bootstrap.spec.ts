import { runInNewContext } from "node:vm";

import { describe, expect, it, vi } from "vitest";

import {
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
) {
  let onError: ((event: BootstrapResourceError) => void) | undefined;
  const sessionValues = new Map<string, string>();
  const assign = vi.fn();
  const location = {
    assign,
    href,
    hostname: new URL(href).hostname,
  };

  runInNewContext(ROUTE_CHUNK_RECOVERY_BOOTSTRAP_SCRIPT, {
    Date: { now: () => 2_000_000 },
    URL,
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
      getItem: (key: string) => sessionValues.get(key) ?? null,
      setItem: (key: string, value: string) => sessionValues.set(key, value),
    },
  });

  if (!onError)
    throw new Error("Recovery bootstrap did not install its listener");

  return { assign, location, onError, sessionValues };
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
    expect(retryUrl.pathname).toBe("/apps");
    expect(retryUrl.searchParams.get("tab")).toBe("activity");
    expect(retryUrl.searchParams.get(CHUNK_RECOVERY_QUERY_PARAM)).toBe(
      "2000000",
    );
    expect(retryUrl.hash).toBe("#latest");
    expect(sessionValues.get(STALE_CHUNK_RELOAD_AT_KEY)).toBe("2000000");
    expect(stopImmediatePropagation).toHaveBeenCalledOnce();
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
