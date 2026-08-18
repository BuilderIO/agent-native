// @vitest-environment node

import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({
  dialog: {},
  ipcMain: { handle: vi.fn() },
}));

import { requestMcpHost, type McpHost } from "./chat-first-mcp.js";

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
