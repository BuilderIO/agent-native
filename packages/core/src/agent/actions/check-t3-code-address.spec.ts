import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ActionRunContext } from "../../action.js";

const mockAssertLabEnabled = vi.fn();
const mockFetch = vi.fn();

vi.mock("../../labs/guard.js", () => ({
  assertLabEnabled: (...args: unknown[]) => mockAssertLabEnabled(...args),
}));

vi.mock("../../mcp-client/manager.js", () => ({
  fetchMcpOriginBound: (...args: unknown[]) => mockFetch(...args),
}));

import action from "./check-t3-code-address.js";

const ctx: ActionRunContext = {
  userEmail: "alice@example.test",
  caller: "http",
};

describe("check-t3-code-address", () => {
  beforeEach(() => {
    mockAssertLabEnabled.mockReset().mockResolvedValue(undefined);
    mockFetch.mockReset().mockResolvedValue(new Response("{}"));
  });

  it("stays in the app, off MCP", () => {
    expect(action.mcpTool).toBe(false);
  });

  it("refuses a caller who isn't signed in", async () => {
    await expect(
      action.run({ url: "https://t3.example.test/mcp" }, { caller: "http" }),
    ).rejects.toThrow("Not authenticated.");
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("refuses while the Lab is off", async () => {
    mockAssertLabEnabled.mockRejectedValueOnce(new Error("Lab off"));
    await expect(
      action.run({ url: "https://t3.example.test/mcp" }, ctx),
    ).rejects.toThrow("Lab off");
    expect(mockAssertLabEnabled.mock.calls[0]?.[0]).toMatchObject({
      key: "t3-code-agents",
    });
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("says a plain http address needs https", async () => {
    for (const url of [
      "http://t3.example.test/mcp",
      "HTTP://t3.example.test/mcp",
    ]) {
      await expect(action.run({ url }, ctx)).resolves.toEqual({
        ok: false,
        reason: "http",
      });
    }
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("says an address that isn't one is invalid", async () => {
    for (const url of ["not an address", "ftp://t3.example.test/mcp"]) {
      await expect(action.run({ url }, ctx)).resolves.toEqual({
        ok: false,
        reason: "invalid",
      });
    }
  });

  it("asks for the address that ends in /mcp", async () => {
    await expect(
      action.run({ url: "https://t3.example.test/api" }, ctx),
    ).resolves.toEqual({ ok: false, reason: "not-mcp" });
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("pings the MCP address on its own origin and returns it", async () => {
    await expect(
      action.run({ url: "  https://t3.example.test/mcp/  " }, ctx),
    ).resolves.toEqual({ ok: true, url: "https://t3.example.test/mcp/" });
    const [url, init, origin] = mockFetch.mock.calls[0] ?? [];
    expect(String(url)).toBe("https://t3.example.test/mcp/");
    expect(origin).toBe("https://t3.example.test");
    expect(init).toMatchObject({
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
      },
    });
    expect(JSON.parse(String(init.body))).toEqual({
      jsonrpc: "2.0",
      id: 1,
      method: "ping",
    });
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it("counts any answer below 500 as reachable, since T3 asks for sign-in first", async () => {
    mockFetch.mockResolvedValueOnce(new Response("", { status: 401 }));
    await expect(
      action.run({ url: "https://t3.example.test/mcp" }, ctx),
    ).resolves.toEqual({ ok: true, url: "https://t3.example.test/mcp" });
    mockFetch.mockResolvedValueOnce(new Response("", { status: 499 }));
    await expect(
      action.run({ url: "https://t3.example.test/mcp" }, ctx),
    ).resolves.toMatchObject({ ok: true });
  });

  it("says an address that fails or errors can't be reached", async () => {
    mockFetch.mockResolvedValueOnce(new Response("", { status: 500 }));
    await expect(
      action.run({ url: "https://t3.example.test/mcp" }, ctx),
    ).resolves.toEqual({ ok: false, reason: "unreachable" });
    mockFetch.mockRejectedValueOnce(new Error("connect ECONNREFUSED"));
    await expect(
      action.run({ url: "https://t3.example.test/mcp" }, ctx),
    ).resolves.toEqual({ ok: false, reason: "unreachable" });
  });
});
