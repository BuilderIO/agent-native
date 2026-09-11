// @vitest-environment node

import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({
  dialog: {},
  ipcMain: { handle: vi.fn() },
}));

import {
  requestMcpHost,
  resolveMcpOAuthUrl,
  resolveMcpOAuthReturnPath,
  type McpHost,
} from "./chat-first-mcp.js";

const getCookies = vi.fn().mockResolvedValue([]);
const host = {
  baseUrl: "https://workspace.example.com",
  session: {
    cookies: {
      get: getCookies,
    },
  },
} as unknown as McpHost;

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("requestMcpHost", () => {
  it("keeps the timeout active while a response body is delayed", async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        text: () => new Promise<string>(() => {}),
      }),
    );

    const request = requestMcpHost(host, "/_agent-native/mcp/servers");
    const rejection = expect(request).rejects.toThrow(
      "MCP settings request timed out after 10 seconds.",
    );
    await vi.advanceTimersByTimeAsync(10_000);

    await rejection;
  });

  it("keeps the timeout active while cookies are unavailable", async () => {
    vi.useFakeTimers();
    getCookies.mockImplementationOnce(() => new Promise<never>(() => {}));
    vi.stubGlobal("fetch", vi.fn());

    const request = requestMcpHost(host, "/_agent-native/mcp/servers");
    const rejection = expect(request).rejects.toThrow(
      "MCP settings request timed out after 10 seconds.",
    );
    await vi.advanceTimersByTimeAsync(10_000);

    await rejection;
    expect(fetch).not.toHaveBeenCalled();
  });

  it("preserves caller cancellation instead of reporting a timeout", async () => {
    const caller = new AbortController();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(() => new Promise(() => {})),
    );

    const request = requestMcpHost(host, "/_agent-native/mcp/servers", {
      signal: caller.signal,
    });
    await Promise.resolve();
    caller.abort();

    await expect(request).rejects.toMatchObject({ name: "AbortError" });
  });
});

describe("resolveMcpOAuthUrl", () => {
  it("keeps OAuth starts inside the authenticated workspace origin", () => {
    expect(
      resolveMcpOAuthUrl(
        "/_agent-native/mcp/servers/oauth/start?name=Notion",
        "https://dispatch.example.com",
      ),
    ).toBe(
      "https://dispatch.example.com/_agent-native/mcp/servers/oauth/start?name=Notion",
    );
    expect(
      resolveMcpOAuthUrl(
        "/_agent-native/mcp/servers/oauth/start?name=Notion&return=%2Fintegrations",
        "https://workspace.example.com/dispatch",
      ),
    ).toBe(
      "https://workspace.example.com/dispatch/_agent-native/mcp/servers/oauth/start?name=Notion&return=%2Fintegrations",
    );
    expect(
      resolveMcpOAuthReturnPath(
        "https://workspace.example.com/dispatch/_agent-native/mcp/servers/oauth/start?return=%2Fintegrations",
        "https://workspace.example.com/dispatch",
      ),
    ).toBe("/dispatch/integrations");
    expect(() =>
      resolveMcpOAuthUrl(
        "https://other.example.com/_agent-native/mcp/servers/oauth/start",
        "https://dispatch.example.com",
      ),
    ).toThrow("signed-in workspace app");
    expect(() =>
      resolveMcpOAuthUrl(
        "/_agent-native/mcp/servers",
        "https://dispatch.example.com",
      ),
    ).toThrow("signed-in workspace app");
  });
});
