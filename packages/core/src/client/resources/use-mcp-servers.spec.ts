// @vitest-environment happy-dom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  formatMcpServerError,
  formatMcpServersLoadError,
  getMcpUrlValidationError,
  useReconnectMcpServer,
} from "./use-mcp-servers.js";

describe("MCP server UI helpers", () => {
  const roots: Root[] = [];
  const containers: HTMLDivElement[] = [];

  afterEach(() => {
    for (const root of roots) act(() => root.unmount());
    for (const container of containers) container.remove();
    roots.length = 0;
    containers.length = 0;
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("validates complete MCP URLs before submitting", () => {
    expect(getMcpUrlValidationError("mcp.example.com")).toBe(
      "Enter a full URL, including https://.",
    );
    expect(getMcpUrlValidationError("http://mcp.example.com")).toBe(
      "Use https:// for remote agent integrations. Plain http:// is only allowed for localhost.",
    );
    expect(getMcpUrlValidationError("https://mcp.example.com/mcp")).toBeNull();
  });

  it("converts raw HTML errors into endpoint guidance", () => {
    expect(formatMcpServerError("<html><body>Not MCP</body></html>")).toBe(
      "That URL returned a web page instead of an MCP response. Check that you pasted the Streamable HTTP endpoint, often ending in /mcp.",
    );
  });

  it("turns unauthenticated list failures into a recovery instruction", () => {
    expect(formatMcpServersLoadError(new Error("Failed to load (401)"))).toBe(
      "Sign in to a workspace app, then retry loading agent integrations.",
    );
    expect(
      formatMcpServersLoadError(
        new Error(
          "Open a signed-in workspace app before managing MCP connections.",
        ),
      ),
    ).toBe(
      "Sign in to a workspace app, then retry loading agent integrations.",
    );
  });

  it("posts reconnect requests with credentials and invalidates the list", async () => {
    const requests: Array<{ input: RequestInfo | URL; init?: RequestInit }> =
      [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        requests.push({ input, init });
        return new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }),
    );

    let mutation: ReturnType<typeof useReconnectMcpServer> | undefined;
    function Probe() {
      mutation = useReconnectMcpServer();
      return null;
    }

    const container = document.createElement("div");
    document.body.appendChild(container);
    containers.push(container);
    const root = createRoot(container);
    roots.push(root);
    const queryClient = new QueryClient({
      defaultOptions: { mutations: { retry: false } },
    });
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

    await act(async () => {
      root.render(
        React.createElement(
          QueryClientProvider,
          { client: queryClient },
          React.createElement(Probe),
        ),
      );
    });

    await mutation!.mutateAsync({ id: "server-1", scope: "org" });

    expect(requests).toHaveLength(1);
    expect(String(requests[0]?.input)).toBe(
      "/_agent-native/mcp/servers/server-1/reconnect?scope=org",
    );
    expect(requests[0]?.init).toMatchObject({
      method: "POST",
      credentials: "include",
    });
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: ["mcp-servers"],
    });
  });

  it("surfaces reconnect errors from the server", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        return new Response(
          JSON.stringify({ ok: false, error: "Reconnect denied" }),
          {
            status: 409,
            headers: { "content-type": "application/json" },
          },
        );
      }),
    );

    let mutation: ReturnType<typeof useReconnectMcpServer> | undefined;
    function Probe() {
      mutation = useReconnectMcpServer();
      return null;
    }

    const container = document.createElement("div");
    document.body.appendChild(container);
    containers.push(container);
    const root = createRoot(container);
    roots.push(root);
    const queryClient = new QueryClient({
      defaultOptions: { mutations: { retry: false } },
    });

    await act(async () => {
      root.render(
        React.createElement(
          QueryClientProvider,
          { client: queryClient },
          React.createElement(Probe),
        ),
      );
    });

    await expect(
      mutation!.mutateAsync({ id: "server-2", scope: "user" }),
    ).rejects.toThrow("Reconnect denied");
  });

  it("rejects reconnect responses that do not report ok true", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        return new Response(JSON.stringify({ ok: false }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }),
    );

    let mutation: ReturnType<typeof useReconnectMcpServer> | undefined;
    function Probe() {
      mutation = useReconnectMcpServer();
      return null;
    }

    const container = document.createElement("div");
    document.body.appendChild(container);
    containers.push(container);
    const root = createRoot(container);
    roots.push(root);
    const queryClient = new QueryClient({
      defaultOptions: { mutations: { retry: false } },
    });

    await act(async () => {
      root.render(
        React.createElement(
          QueryClientProvider,
          { client: queryClient },
          React.createElement(Probe),
        ),
      );
    });

    await expect(
      mutation!.mutateAsync({ id: "server-3", scope: "user" }),
    ).rejects.toThrow("Reconnect failed");
  });
});
