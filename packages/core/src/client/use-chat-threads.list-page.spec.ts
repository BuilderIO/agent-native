import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { fetchChatThreadListPage } from "./use-chat-threads.js";

describe.each(["list", "search"] as const)(
  "fetchChatThreadListPage %s pagination",
  (mode) => {
    const query = mode === "search" ? "plan" : undefined;
    const fetchMock = vi.fn();

    beforeEach(() => {
      fetchMock.mockReset();
      fetchMock.mockImplementation(
        async () =>
          new Response(JSON.stringify({ threads: [], hasMore: false }), {
            headers: { "Content-Type": "application/json" },
          }),
      );
      vi.stubGlobal("fetch", fetchMock);
    });

    afterEach(() => vi.unstubAllGlobals());

    it.each([
      ["limit", 0],
      ["limit", -1],
      ["limit", 1.5],
      ["limit", NaN],
      ["limit", Infinity],
      ["limit", -Infinity],
      ["limit", Number.MAX_SAFE_INTEGER + 1],
      ["limit", Number.MAX_SAFE_INTEGER + 2],
      ["offset", -1],
      ["offset", 1.5],
      ["offset", NaN],
      ["offset", Infinity],
      ["offset", -Infinity],
      ["offset", Number.MAX_SAFE_INTEGER + 1],
      ["offset", Number.MAX_SAFE_INTEGER + 2],
    ] as const)(
      "rejects explicit %s=%s before fetching",
      async (parameter, value) => {
        const result = fetchChatThreadListPage({
          apiUrl: "/chat",
          query,
          [parameter]: value,
        });
        await expect(result).rejects.toBeInstanceOf(TypeError);
        await expect(result).rejects.toThrow(parameter);
        expect(fetchMock).not.toHaveBeenCalled();
      },
    );

    it("omits absent pagination so the server selects its defaults", async () => {
      await expect(
        fetchChatThreadListPage({ apiUrl: "/chat", query }),
      ).resolves.toEqual({ threads: [], hasMore: false });
      expect(fetchMock).toHaveBeenCalledOnce();
      const url = new URL(fetchMock.mock.calls[0][0], "http://localhost");
      expect(url.pathname).toBe("/chat/threads");
      expect(url.searchParams.get("q")).toBe(query ?? null);
      expect(url.searchParams.has("limit")).toBe(false);
      expect(url.searchParams.has("offset")).toBe(false);
    });

    it.each([
      [1, 0],
      [5000, 0],
      [Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER],
    ])(
      "accepts limit %s and offset %s without applying the server's cap",
      async (limit, offset) => {
        await expect(
          fetchChatThreadListPage({ apiUrl: "/chat", query, limit, offset }),
        ).resolves.toEqual({ threads: [], hasMore: false });
        expect(fetchMock).toHaveBeenCalledOnce();
        const url = new URL(fetchMock.mock.calls[0][0], "http://localhost");
        expect(url.searchParams.get("q")).toBe(query ?? null);
        expect(url.searchParams.get("limit")).toBe(String(limit));
        expect(url.searchParams.get("offset")).toBe(
          offset === 0 ? null : String(offset),
        );
      },
    );
  },
);
