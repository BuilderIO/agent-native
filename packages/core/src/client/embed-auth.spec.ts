// @vitest-environment happy-dom

import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  EMBED_TARGET_HEADER,
  EMBED_TOKEN_QUERY_PARAM,
  MCP_APP_CHAT_BRIDGE_QUERY_PARAM,
} from "../shared/embed-auth.js";

const STORAGE_KEY = "agent-native:embed-auth-token";
const BRIDGE_STORAGE_KEY = "agent-native:mcp-chat-bridge";

async function loadEmbedAuth() {
  vi.resetModules();
  return import("./embed-auth.js");
}

describe("embed auth client", () => {
  beforeEach(() => {
    vi.resetModules();
    sessionStorage.clear();
    window.history.replaceState(null, "", "/");
    Object.defineProperty(window, "fetch", {
      configurable: true,
      writable: true,
      value: vi.fn(async () => new Response("ok")),
    });
    delete (window as Window & { openai?: unknown }).openai;
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

  it("persists the MCP chat bridge flag when stripping the URL token", async () => {
    window.history.replaceState(
      null,
      "",
      `/inbox?embedded=1&${MCP_APP_CHAT_BRIDGE_QUERY_PARAM}=1&${EMBED_TOKEN_QUERY_PARAM}=signed-token`,
    );

    const first = await loadEmbedAuth();
    first.ensureEmbedAuthFetchInterceptor();

    expect(window.location.search).toBe(
      `?embedded=1&${MCP_APP_CHAT_BRIDGE_QUERY_PARAM}=1`,
    );
    expect(sessionStorage.getItem(BRIDGE_STORAGE_KEY)).toBe("signed-token");

    window.history.replaceState(null, "", "/inbox?embedded=1");
    const reloadedModule = await loadEmbedAuth();
    expect(reloadedModule.isEmbedMcpChatBridgeActive()).toBe(true);
  });

  it("keeps MCP chat bridge mode in memory when sessionStorage is unavailable", async () => {
    const setItem = vi
      .spyOn(Storage.prototype, "setItem")
      .mockImplementation(() => {
        throw new Error("blocked");
      });
    const getItem = vi
      .spyOn(Storage.prototype, "getItem")
      .mockImplementation(() => {
        throw new Error("blocked");
      });
    const removeItem = vi
      .spyOn(Storage.prototype, "removeItem")
      .mockImplementation(() => {
        throw new Error("blocked");
      });

    try {
      window.history.replaceState(
        null,
        "",
        `/inbox?embedded=1&${MCP_APP_CHAT_BRIDGE_QUERY_PARAM}=1&${EMBED_TOKEN_QUERY_PARAM}=signed-token`,
      );

      const first = await loadEmbedAuth();
      first.ensureEmbedAuthFetchInterceptor();

      expect(window.location.search).toBe(
        `?embedded=1&${MCP_APP_CHAT_BRIDGE_QUERY_PARAM}=1`,
      );
      expect(first.isEmbedMcpChatBridgeActive()).toBe(true);

      window.history.replaceState(null, "", "/inbox?embedded=1");
      expect(first.isEmbedMcpChatBridgeActive()).toBe(true);
    } finally {
      setItem.mockRestore();
      getItem.mockRestore();
      removeItem.mockRestore();
    }
  });

  it("keeps MCP chat bridge mode active when sessionStorage starts throwing mid-session", async () => {
    // Boot with sessionStorage working so the bridge enrolls normally.
    window.history.replaceState(
      null,
      "",
      `/inbox?embedded=1&${MCP_APP_CHAT_BRIDGE_QUERY_PARAM}=1&${EMBED_TOKEN_QUERY_PARAM}=signed-token`,
    );

    const first = await loadEmbedAuth();
    first.ensureEmbedAuthFetchInterceptor();
    expect(first.isEmbedMcpChatBridgeActive()).toBe(true);

    // Mid-session, sessionStorage starts denying access (e.g. third-party-cookie
    // policy update in a sandboxed iframe, Safari private-browsing throttling).
    const getItem = vi
      .spyOn(Storage.prototype, "getItem")
      .mockImplementation(() => {
        throw new Error("blocked");
      });

    try {
      // The flag should still be true even though sessionStorage now throws,
      // because the in-memory bridge state was already captured.
      expect(first.isEmbedMcpChatBridgeActive()).toBe(true);

      // And it should survive even if the URL token also gets stripped.
      window.history.replaceState(null, "", "/inbox?embedded=1");
      expect(first.isEmbedMcpChatBridgeActive()).toBe(true);
    } finally {
      getItem.mockRestore();
    }
  });

  it("keeps MCP chat bridge mode active after the URL token is stripped", async () => {
    window.history.replaceState(
      null,
      "",
      `/inbox?embedded=1&${MCP_APP_CHAT_BRIDGE_QUERY_PARAM}=1&${EMBED_TOKEN_QUERY_PARAM}=signed-token`,
    );

    const first = await loadEmbedAuth();
    first.ensureEmbedAuthFetchInterceptor();
    expect(first.isEmbedMcpChatBridgeActive()).toBe(true);

    // Mimic a host that strips the bridge flag from the URL too after boot.
    window.history.replaceState(null, "", "/inbox?embedded=1");

    // The in-memory bridge state should still be authoritative.
    expect(first.isEmbedMcpChatBridgeActive()).toBe(true);
  });

  it("clears the MCP chat bridge when the embed token actually changes", async () => {
    window.history.replaceState(
      null,
      "",
      `/inbox?embedded=1&${MCP_APP_CHAT_BRIDGE_QUERY_PARAM}=1&${EMBED_TOKEN_QUERY_PARAM}=token-a`,
    );

    const first = await loadEmbedAuth();
    first.ensureEmbedAuthFetchInterceptor();
    expect(first.isEmbedMcpChatBridgeActive()).toBe(true);

    // A different embed token (e.g. a different user session reusing the same
    // page context) MUST drop the bridge — this is the real de-enrollment
    // signal we still need to honor.
    window.history.replaceState(
      null,
      "",
      `/inbox?embedded=1&${EMBED_TOKEN_QUERY_PARAM}=token-b`,
    );

    expect(first.isEmbedMcpChatBridgeActive()).toBe(false);
  });

  it("clamps MCP chat bridge embeds to a stable viewport height", async () => {
    const notifyIntrinsicHeight = vi.fn();
    Object.defineProperty(window, "openai", {
      configurable: true,
      writable: true,
      value: { notifyIntrinsicHeight },
    });
    window.history.replaceState(
      null,
      "",
      `/inbox?embedded=1&${MCP_APP_CHAT_BRIDGE_QUERY_PARAM}=1&${EMBED_TOKEN_QUERY_PARAM}=signed-token`,
    );

    const first = await loadEmbedAuth();
    first.ensureEmbedAuthFetchInterceptor();

    const style = document.getElementById(
      "agent-native-mcp-chat-bridge-viewport",
    );
    expect(style?.textContent).toContain("height: 560px !important");
    expect(style?.textContent).toContain("overflow: hidden !important");
    expect(notifyIntrinsicHeight).toHaveBeenCalledWith({ height: 560 });
  });

  it("does not leak a stored MCP chat bridge flag to a different embed token", async () => {
    sessionStorage.setItem(STORAGE_KEY, "old-token");
    sessionStorage.setItem(BRIDGE_STORAGE_KEY, "old-token");

    window.history.replaceState(
      null,
      "",
      `/inbox?embedded=1&${EMBED_TOKEN_QUERY_PARAM}=new-token`,
    );

    const reloadedModule = await loadEmbedAuth();

    expect(reloadedModule.isEmbedMcpChatBridgeActive()).toBe(false);
    expect(sessionStorage.getItem(STORAGE_KEY)).toBe("new-token");
    expect(sessionStorage.getItem(BRIDGE_STORAGE_KEY)).toBeNull();
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

  it("uses location.href as the app origin when the sandbox origin is opaque", async () => {
    window.history.replaceState(null, "", "/inbox?embedded=1");
    sessionStorage.setItem(STORAGE_KEY, "stored-token");
    const originalOrigin = Object.getOwnPropertyDescriptor(
      window.location,
      "origin",
    );
    Object.defineProperty(window.location, "origin", {
      configurable: true,
      get: () => "null",
    });
    const originalFetch = vi.fn(async () => new Response("ok"));
    Object.defineProperty(window, "fetch", {
      configurable: true,
      writable: true,
      value: originalFetch,
    });

    try {
      const { ensureEmbedAuthFetchInterceptor } = await loadEmbedAuth();
      ensureEmbedAuthFetchInterceptor();

      await window.fetch("/api/emails?view=inbox");

      const [, init] = originalFetch.mock.calls[0]!;
      const headers = new Headers(init?.headers);
      expect(headers.get("Authorization")).toBe("Bearer stored-token");
      expect(headers.get(EMBED_TARGET_HEADER)).toBe("/inbox?embedded=1");
    } finally {
      if (originalOrigin) {
        Object.defineProperty(window.location, "origin", originalOrigin);
      } else {
        delete (window.location as unknown as { origin?: string }).origin;
      }
    }
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
