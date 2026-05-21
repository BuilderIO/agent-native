// @vitest-environment happy-dom

import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  EMBED_TARGET_HEADER,
  EMBED_TOKEN_QUERY_PARAM,
} from "../shared/embed-auth.js";

const STORAGE_KEY = "agent-native:embed-auth-token";

async function loadEmbedAuth() {
  vi.resetModules();
  return import("./embed-auth.js");
}

describe("embed auth client", () => {
  beforeEach(() => {
    sessionStorage.clear();
    window.history.replaceState(null, "", "/");
    Object.defineProperty(window, "fetch", {
      configurable: true,
      writable: true,
      value: vi.fn(async () => new Response("ok")),
    });
  });

  it("persists the URL token before stripping it from browser-visible history", async () => {
    window.history.replaceState(
      null,
      "",
      `/inbox?embedded=1&${EMBED_TOKEN_QUERY_PARAM}=signed-token#message`,
    );

    const first = await loadEmbedAuth();
    first.ensureEmbedAuthFetchInterceptor();

    expect(window.location.search).toBe("?embedded=1");
    expect(window.location.hash).toBe("#message");
    expect(sessionStorage.getItem(STORAGE_KEY)).toBe("signed-token");

    const reloadedModule = await loadEmbedAuth();
    expect(reloadedModule.getEmbedAuthToken()).toBe("signed-token");
  });

  it("adds the stored embed bearer token and target header to same-origin fetches", async () => {
    window.history.replaceState(null, "", "/inbox?embedded=1");
    sessionStorage.setItem(STORAGE_KEY, "stored-token");
    const originalFetch = vi.fn(async () => new Response("ok"));
    Object.defineProperty(window, "fetch", {
      configurable: true,
      writable: true,
      value: originalFetch,
    });

    const { ensureEmbedAuthFetchInterceptor } = await loadEmbedAuth();
    ensureEmbedAuthFetchInterceptor();

    await window.fetch("/api/emails?view=inbox", {
      headers: { "Content-Type": "application/json" },
    });

    expect(originalFetch).toHaveBeenCalledTimes(1);
    const [, init] = originalFetch.mock.calls[0]!;
    const headers = new Headers(init?.headers);
    expect(headers.get("Authorization")).toBe("Bearer stored-token");
    expect(headers.get(EMBED_TARGET_HEADER)).toBe("/inbox?embedded=1");
  });

  it("does not add embed credentials to cross-origin fetches", async () => {
    window.history.replaceState(null, "", "/inbox?embedded=1");
    sessionStorage.setItem(STORAGE_KEY, "stored-token");
    const originalFetch = vi.fn(async () => new Response("ok"));
    Object.defineProperty(window, "fetch", {
      configurable: true,
      writable: true,
      value: originalFetch,
    });

    const { ensureEmbedAuthFetchInterceptor } = await loadEmbedAuth();
    ensureEmbedAuthFetchInterceptor();

    await window.fetch("https://example.com/api/emails");

    expect(originalFetch).toHaveBeenCalledTimes(1);
    const [, init] = originalFetch.mock.calls[0]!;
    const headers = new Headers(init?.headers);
    expect(headers.has("Authorization")).toBe(false);
    expect(headers.has(EMBED_TARGET_HEADER)).toBe(false);
  });
});
