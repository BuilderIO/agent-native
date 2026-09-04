import { afterEach, describe, expect, it, vi } from "vitest";

import { createWebSearchToolEntry } from "./web-search-tool.js";

describe("createWebSearchToolEntry", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("uses Builder-managed web search when no BYOK backend is configured", async () => {
    const fetchMock = vi.fn(async () => {
      return new Response(
        JSON.stringify({
          text: "Builder found current docs at https://example.com/docs.",
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    const tool = createWebSearchToolEntry({
      resolveSecret: vi.fn().mockResolvedValue(null),
      resolveBuilderCredentials: vi.fn().mockResolvedValue({
        privateKey: "bpk-builder",
        publicKey: "space-123",
        userId: "user-123",
      }),
      getBuilderWebSearchBaseUrl: () =>
        "https://builder.test/agent-native/web-search/v1",
      getBuilderRequestHeaders: () => ({
        "x-client-name": "@agent-native/core",
        "x-client-version": "test",
      }),
    })["web-search"];

    const result = await tool.run({ query: "current docs", count: "3" });

    expect(result).toContain("backend: Builder.io");
    expect(result).toContain("Builder found current docs");
    expect(fetchMock).toHaveBeenCalledWith(
      "https://builder.test/agent-native/web-search/v1/search",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          Authorization: "Bearer bpk-builder",
          "x-builder-api-key": "space-123",
          "x-builder-user-id": "user-123",
          "x-client-name": "@agent-native/core",
        }),
      }),
    );
    expect(
      JSON.parse(String((fetchMock.mock.calls[0][1] as RequestInit).body)),
    ).toEqual(
      expect.objectContaining({
        query: "current docs",
        count: 3,
        source: {
          appId: "agent-native",
          feature: "web-search-tool",
        },
      }),
    );
  });

  it("keeps manual Brave search ahead of Builder-managed search", async () => {
    const resolveSecret = vi.fn(async (key: string) =>
      key === "BRAVE_SEARCH_API_KEY" ? "brave-key" : null,
    );
    const fetchMock = vi.fn(async () => {
      return new Response(
        JSON.stringify({
          web: {
            results: [
              {
                title: "Brave result",
                url: "https://example.com/brave",
                description: "Result from Brave",
              },
            ],
          },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    const tool = createWebSearchToolEntry({
      resolveSecret,
      resolveBuilderCredentials: vi.fn().mockResolvedValue({
        privateKey: "bpk-builder",
        publicKey: "space-123",
      }),
      getBuilderWebSearchBaseUrl: () =>
        "https://builder.test/agent-native/web-search/v1",
    })["web-search"];

    const result = await tool.run({ query: "current docs" });

    expect(result).toContain("backend: Brave Search");
    expect(result).toContain("Brave result");
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(String(fetchMock.mock.calls[0][0])).toContain(
      "https://api.search.brave.com/res/v1/web/search",
    );
  });

  it("uses Firecrawl when it is the only configured BYOK key", async () => {
    const resolveSecret = vi.fn(async (key: string) =>
      key === "FIRECRAWL_API_KEY" ? "fc-key" : null,
    );
    const fetchMock = vi.fn(async () => {
      return new Response(
        JSON.stringify({
          success: true,
          data: {
            web: [
              {
                title: "Firecrawl result",
                url: "https://example.com/firecrawl",
                description: "Result from Firecrawl",
              },
            ],
          },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    const tool = createWebSearchToolEntry({
      resolveSecret,
      resolveBuilderCredentials: vi.fn().mockResolvedValue({
        privateKey: "bpk-builder",
        publicKey: "space-123",
      }),
      getBuilderWebSearchBaseUrl: () =>
        "https://builder.test/agent-native/web-search/v1",
    })["web-search"];

    const result = await tool.run({ query: "current docs", count: "3" });

    expect(result).toContain("backend: Firecrawl");
    expect(result).toContain("Firecrawl result");
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(String(fetchMock.mock.calls[0][0])).toBe(
      "https://api.firecrawl.dev/v2/search",
    );
    expect(
      JSON.parse(String((fetchMock.mock.calls[0][1] as RequestInit).body)),
    ).toEqual(expect.objectContaining({ query: "current docs", limit: 3 }));
  });

  it("suggests Builder Connect when no backend is configured", async () => {
    const tool = createWebSearchToolEntry({
      resolveSecret: vi.fn().mockResolvedValue(null),
      resolveBuilderCredentials: vi.fn().mockResolvedValue({
        privateKey: null,
        publicKey: null,
      }),
    })["web-search"];

    const result = await tool.run({ query: "current docs" });

    expect(result).toContain("No web-search backend configured");
    expect(result).toContain("Connect Builder.io");
    expect(result).toContain("BRAVE_SEARCH_API_KEY");
  });

  it("does not bypass resolveSecret policy with raw env fallback", async () => {
    vi.stubEnv("BRAVE_SEARCH_API_KEY", "env-brave-key");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const tool = createWebSearchToolEntry({
      resolveSecret: vi.fn().mockResolvedValue(null),
      resolveBuilderCredentials: vi.fn().mockResolvedValue({
        privateKey: null,
        publicKey: null,
      }),
    })["web-search"];

    const result = await tool.run({ query: "current docs" });

    expect(result).toContain("No web-search backend configured");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
