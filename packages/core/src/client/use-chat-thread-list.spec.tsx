// @vitest-environment happy-dom

import React, { Activity, act, useLayoutEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  ChatThreadListConfigError,
  useChatThreadList,
  type UseChatThreadListOptions,
  type UseChatThreadListResult,
} from "./use-chat-thread-list.js";
import {
  CHAT_THREADS_UPDATED_EVENT,
  ChatThreadListError,
  notifyChatThreadsUpdated,
  type ChatThreadListRow,
} from "./use-chat-threads.js";

function row(
  id: string,
  overrides: Partial<ChatThreadListRow> = {},
): ChatThreadListRow {
  return {
    id,
    title: id,
    preview: "",
    messageCount: 1,
    createdAt: 1,
    updatedAt: 1,
    scope: null,
    ownerEmail: "owner@example.com",
    accessBasis: "owner",
    visibility: "private",
    ...overrides,
  };
}

function jsonResponse(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

async function flush() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

describe("useChatThreadList", () => {
  let container: HTMLDivElement;
  let root: Root;
  let latest: UseChatThreadListResult;
  let fetchMock: ReturnType<typeof vi.fn>;
  let renders: UseChatThreadListResult[];
  let onLayout: (() => void) | undefined;

  function Probe(props: UseChatThreadListOptions) {
    latest = useChatThreadList(props);
    renders.push(latest);
    useLayoutEffect(() => onLayout?.(), [props]);
    return null;
  }

  async function mount(options: UseChatThreadListOptions) {
    await act(async () => {
      root.render(<Probe {...options} />);
    });
    await flush();
  }

  const requestedUrls = () =>
    fetchMock.mock.calls.map(([url]) => new URL(String(url), "http://x"));

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    fetchMock = vi.fn();
    renders = [];
    onLayout = undefined;
    vi.stubGlobal("fetch", fetchMock);
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("requests only its own ownership list and reports server hasMore", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ threads: [row("a"), row("b")], hasMore: true }),
    );
    await mount({ ownership: "mine", pageSize: 2, apiUrl: "/api/chat" });

    const url = requestedUrls()[0];
    expect(url.pathname).toBe("/api/chat/threads");
    expect(url.searchParams.get("ownership")).toBe("mine");
    expect(url.searchParams.get("limit")).toBe("2");
    expect(latest.threads.map((t) => t.id)).toEqual(["a", "b"]);
    expect(latest.hasMore).toBe(true);
    expect(latest.loading).toBe(false);
    expect(latest.error).toBeNull();
  });

  it("pages forward by server rows consumed, deduping rows that shifted", async () => {
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse({ threads: [row("a"), row("b")], hasMore: true }),
      )
      // A mutation shifted "b" onto the next page: the page overlaps entirely.
      .mockResolvedValueOnce(
        jsonResponse({ threads: [row("b"), row("a")], hasMore: true }),
      )
      .mockResolvedValueOnce(
        jsonResponse({ threads: [row("c")], hasMore: false }),
      );
    await mount({ ownership: "mine", pageSize: 2, apiUrl: "/api/chat" });

    await act(async () => {
      await latest.loadMore();
    });
    expect(latest.threads.map((t) => t.id)).toEqual(["a", "b"]);
    expect(latest.hasMore).toBe(true);

    await act(async () => {
      await latest.loadMore();
    });
    const offsets = requestedUrls().map((u) => u.searchParams.get("offset"));
    // Not 2 again: the overlapping page still consumed 2 server rows.
    expect(offsets).toEqual([null, "2", "4"]);
    expect(latest.threads.map((t) => t.id)).toEqual(["a", "b", "c"]);
    expect(latest.hasMore).toBe(false);
  });

  it("surfaces a failed first page as an error, not an empty list", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ error: "down" }, 503));
    await mount({ ownership: "mine", apiUrl: "/api/chat" });
    expect(latest.error).toBeInstanceOf(ChatThreadListError);
    expect((latest.error as ChatThreadListError).status).toBe(503);
    expect(latest.threads).toEqual([]);
    expect(latest.loading).toBe(false);
  });

  it("keeps rows and sets error when a later page fails, and stays retryable", async () => {
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse({
          threads: [row("a", { accessBasis: "direct", ownerEmail: "x@y.z" })],
          hasMore: true,
        }),
      )
      .mockResolvedValueOnce(jsonResponse({ error: "boom" }, 500))
      .mockResolvedValueOnce(
        jsonResponse({
          threads: [
            row("b", { accessBasis: "organization", ownerEmail: "x@y.z" }),
          ],
          hasMore: false,
        }),
      );
    await mount({ ownership: "shared", pageSize: 1, apiUrl: "/api/chat" });
    expect(latest.error).toBeNull();

    await act(async () => {
      await latest.loadMore();
    });
    expect(latest.error).toBeInstanceOf(ChatThreadListError);
    expect(latest.threads.map((t) => t.id)).toEqual(["a"]);
    expect(latest.hasMore).toBe(true);

    await act(async () => {
      await latest.loadMore();
    });
    expect(latest.error).toBeNull();
    expect(latest.threads.map((t) => t.id)).toEqual(["a", "b"]);
  });

  it.each([
    ["a row without ownerEmail", { ownerEmail: undefined }],
    ["an unknown accessBasis", { accessBasis: "admin" }],
    ["a missing visibility", { visibility: undefined }],
  ])("rejects %s instead of rendering it", async (_name, broken) => {
    fetchMock.mockResolvedValue(
      jsonResponse({ threads: [row("a", broken as never)], hasMore: false }),
    );
    await mount({ ownership: "all", apiUrl: "/api/chat" });
    expect(latest.error).toBeInstanceOf(ChatThreadListError);
    expect(latest.threads).toEqual([]);
  });

  it("rejects rows on the wrong side of the filter", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        threads: [row("theirs", { accessBasis: "direct" })],
        hasMore: false,
      }),
    );
    await mount({ ownership: "mine", apiUrl: "/api/chat" });
    expect(latest.error?.message).toMatch(/outside the mine list/);
    expect(latest.threads).toEqual([]);

    fetchMock.mockResolvedValue(
      jsonResponse({ threads: [row("mine")], hasMore: false }),
    );
    await mount({ ownership: "shared", apiUrl: "/api/chat" });
    expect(latest.error?.message).toMatch(/outside the shared list/);
    expect(latest.threads).toEqual([]);
  });

  it("treats a response that omits hasMore as an error", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ threads: [row("a")] }));
    await mount({ ownership: "mine", apiUrl: "/api/chat" });
    expect(latest.error?.message).toMatch(/whether more threads exist/);
    expect(latest.threads).toEqual([]);
  });

  it("refetches everything already loaded when a thread mutation is announced", async () => {
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse({ threads: [row("a"), row("b")], hasMore: true }),
      )
      .mockResolvedValueOnce(
        jsonResponse({ threads: [row("c")], hasMore: true }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          threads: [row("a2"), row("b2"), row("c2")],
          hasMore: false,
        }),
      );
    await mount({ ownership: "mine", pageSize: 2, apiUrl: "/api/chat" });
    await act(async () => {
      await latest.loadMore();
    });
    expect(latest.threads).toHaveLength(3);

    await act(async () => {
      notifyChatThreadsUpdated();
    });
    await flush();

    const refresh = requestedUrls()[2];
    expect(refresh.searchParams.get("offset")).toBeNull();
    expect(refresh.searchParams.get("limit")).toBe("3");
    expect(latest.threads.map((t) => t.id)).toEqual(["a2", "b2", "c2"]);
    expect(latest.hasMore).toBe(false);
  });

  it("opts out of thread update events while retaining initial fetch, paging, manual refresh, and errors", async () => {
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse({ threads: [row("a")], hasMore: true }),
      )
      .mockResolvedValueOnce(
        jsonResponse({ threads: [row("b")], hasMore: true }),
      )
      .mockResolvedValueOnce(jsonResponse({ error: "down" }, 503))
      .mockResolvedValueOnce(
        jsonResponse({ threads: [row("a2"), row("b2")], hasMore: false }),
      );
    await mount({
      ownership: "mine",
      pageSize: 1,
      apiUrl: "/api/chat",
      refreshOnThreadUpdates: false,
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(latest.threads.map((thread) => thread.id)).toEqual(["a"]);
    await act(async () => notifyChatThreadsUpdated());
    await flush();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await act(async () => latest.loadMore());
    expect(latest.threads.map((thread) => thread.id)).toEqual(["a", "b"]);
    await act(async () => latest.refresh());
    expect(latest.error).toBeInstanceOf(ChatThreadListError);
    expect((latest.error as ChatThreadListError).status).toBe(503);
    expect(latest.threads.map((thread) => thread.id)).toEqual(["a", "b"]);
    expect(latest.hasMore).toBe(true);
    await act(async () => latest.refresh());
    expect(latest.error).toBeNull();
    expect(latest.threads.map((thread) => thread.id)).toEqual(["a2", "b2"]);
    expect(latest.hasMore).toBe(false);
    expect(
      requestedUrls().map((url) => [
        url.searchParams.get("offset"),
        url.searchParams.get("limit"),
      ]),
    ).toEqual([
      [null, "1"],
      ["1", "1"],
      [null, "2"],
      [null, "2"],
    ]);
  });

  it("toggles event refresh without resetting the list, fetching automatically, or duplicating listeners", async () => {
    const options: UseChatThreadListOptions = {
      ownership: "mine",
      pageSize: 1,
      apiUrl: "/api/chat",
    };
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse({ threads: [row("a")], hasMore: true }),
      )
      .mockResolvedValueOnce(
        jsonResponse({ threads: [row("b")], hasMore: true }),
      )
      .mockImplementation(() =>
        Promise.resolve(
          jsonResponse({ threads: [row("a2"), row("b2")], hasMore: true }),
        ),
      );
    await mount(options);
    await act(async () => latest.loadMore());
    const previous = latest;
    fetchMock.mockClear();
    for (const refreshOnThreadUpdates of [false, true, true, false, true]) {
      renders = [];
      await mount({ ...options, refreshOnThreadUpdates });
      expect(fetchMock).not.toHaveBeenCalled();
      expect(
        renders.every((render) => render.threads === previous.threads),
      ).toBe(true);
      expect(latest.refresh).toBe(previous.refresh);
      expect(latest.loadMore).toBe(previous.loadMore);
      expect(latest.loading).toBe(false);
      expect(latest.hasMore).toBe(true);
    }
    await act(async () => notifyChatThreadsUpdated());
    await flush();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(requestedUrls()[0].searchParams.get("limit")).toBe("2");
    expect(latest.threads.map((thread) => thread.id)).toEqual(["a2", "b2"]);

    await mount({ ...options, refreshOnThreadUpdates: false });
    fetchMock.mockClear();
    await act(async () => notifyChatThreadsUpdated());
    await flush();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("keeps an in-flight refresh current when event refresh is turned off", async () => {
    const options: UseChatThreadListOptions = {
      ownership: "mine",
      apiUrl: "/api/chat",
    };
    let release!: (response: Response) => void;
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse({ threads: [row("a")], hasMore: false }),
      )
      .mockImplementationOnce(
        () =>
          new Promise<Response>((resolve) => {
            release = resolve;
          }),
      );
    await mount(options);
    let refreshing!: Promise<void>;
    await act(async () => {
      refreshing = latest.refresh();
    });
    await mount({ ...options, refreshOnThreadUpdates: false });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await act(async () => {
      release(jsonResponse({ threads: [row("updated")], hasMore: false }));
      await refreshing;
    });
    expect(latest.threads.map((thread) => thread.id)).toEqual(["updated"]);
    expect(latest.error).toBeNull();
  });

  it("does not listen while disabled and removes its restored listener on unmount", async () => {
    const addListener = vi.spyOn(window, "addEventListener");
    const removeListener = vi.spyOn(window, "removeEventListener");
    const threadListeners = () =>
      addListener.mock.calls.filter(
        ([event]) => event === CHAT_THREADS_UPDATED_EVENT,
      );
    const options: UseChatThreadListOptions = {
      ownership: "mine",
      apiUrl: "/api/chat",
    };
    fetchMock.mockImplementation(() =>
      Promise.resolve(jsonResponse({ threads: [row("a")], hasMore: false })),
    );
    await mount({ ...options, enabled: false, refreshOnThreadUpdates: false });
    await mount({ ...options, enabled: false, refreshOnThreadUpdates: true });
    await act(async () => {
      notifyChatThreadsUpdated();
      await latest.refresh();
      await latest.loadMore();
    });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(latest.threads).toEqual([]);
    expect(threadListeners()).toHaveLength(0);
    await mount({ ...options, refreshOnThreadUpdates: false });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(threadListeners()).toHaveLength(0);
    await mount({ ...options, refreshOnThreadUpdates: true });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(threadListeners()).toHaveLength(1);
    await act(async () => notifyChatThreadsUpdated());
    await flush();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const retired = latest;
    act(() => root.unmount());
    expect(removeListener).toHaveBeenCalledWith(
      CHAT_THREADS_UPDATED_EVENT,
      threadListeners()[0][1],
    );
    fetchMock.mockClear();
    await act(async () => {
      notifyChatThreadsUpdated();
      await retired.refresh();
      await retired.loadMore();
    });
    await flush();
    expect(fetchMock).not.toHaveBeenCalled();
    root = createRoot(container);
  });

  it("reloads the loaded window after Activity resumes with event refresh off", async () => {
    const options: UseChatThreadListOptions = {
      ownership: "mine",
      pageSize: 1,
      apiUrl: "/api/chat",
      refreshOnThreadUpdates: false,
    };
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse({ threads: [row("a")], hasMore: true }),
      )
      .mockResolvedValueOnce(
        jsonResponse({ threads: [row("b")], hasMore: true }),
      )
      .mockResolvedValueOnce(
        jsonResponse({ threads: [row("a2"), row("b2")], hasMore: true }),
      )
      .mockResolvedValueOnce(
        jsonResponse({ threads: [row("c2")], hasMore: false }),
      );
    await activity("visible", options);
    await act(async () => latest.loadMore());
    await activity("hidden", options);
    await act(async () => notifyChatThreadsUpdated());
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await activity("visible", options);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(requestedUrls()[2].searchParams.get("limit")).toBe("2");
    expect(latest.threads.map((thread) => thread.id)).toEqual(["a2", "b2"]);
    await act(async () => notifyChatThreadsUpdated());
    await flush();
    expect(fetchMock).toHaveBeenCalledTimes(3);
    await act(async () => latest.loadMore());
    expect(requestedUrls()[3].searchParams.get("offset")).toBe("2");
    expect(latest.threads.map((thread) => thread.id)).toEqual([
      "a2",
      "b2",
      "c2",
    ]);
  });

  describe("lists longer than one server page", () => {
    const TOTAL = 450;
    let version: string;
    let failOffset: number | null;

    const serve = (url: string) => {
      const params = new URL(url, "http://x").searchParams;
      const offset = Number(params.get("offset") ?? 0);
      const limit = Number(params.get("limit"));
      if (failOffset === offset) {
        return Promise.resolve(jsonResponse({ error: "boom" }, 500));
      }
      const end = Math.min(offset + limit, TOTAL);
      return Promise.resolve(
        jsonResponse({
          threads: Array.from({ length: end - offset }, (_, i) =>
            row(`${version}-${offset + i}`),
          ),
          hasMore: end < TOTAL,
        }),
      );
    };

    beforeEach(() => {
      version = "v1";
      failOffset = null;
      fetchMock.mockImplementation(serve);
    });

    async function expandToTwoHundredFold() {
      await mount({ ownership: "mine", pageSize: 200, apiUrl: "/api/chat" });
      await act(async () => {
        await latest.loadMore();
      });
      expect(latest.threads).toHaveLength(400);
      expect(latest.hasMore).toBe(true);
    }

    it("refresh reloads every expanded row across capped pages and swaps them atomically", async () => {
      await expandToTwoHundredFold();
      fetchMock.mockClear();
      version = "v2";

      await act(async () => {
        notifyChatThreadsUpdated();
      });
      await flush();

      expect(
        requestedUrls().map((u) => [
          u.searchParams.get("offset"),
          u.searchParams.get("limit"),
        ]),
      ).toEqual([
        [null, "200"],
        ["200", "200"],
      ]);
      expect(latest.threads).toHaveLength(400);
      expect(latest.threads.every((t) => t.id.startsWith("v2-"))).toBe(true);
      expect(latest.hasMore).toBe(true);

      // Paging continues from the 400 server rows consumed.
      fetchMock.mockClear();
      await act(async () => {
        await latest.loadMore();
      });
      expect(requestedUrls()[0].searchParams.get("offset")).toBe("400");
      expect(latest.threads).toHaveLength(450);
      expect(latest.hasMore).toBe(false);
    });

    it("keeps the previous rows and offset when a later refresh page fails", async () => {
      await expandToTwoHundredFold();
      version = "v2";
      failOffset = 200;

      await act(async () => {
        await latest.refresh();
      });

      expect(latest.error).toBeInstanceOf(ChatThreadListError);
      expect(latest.threads).toHaveLength(400);
      expect(latest.threads.every((t) => t.id.startsWith("v1-"))).toBe(true);
      expect(latest.hasMore).toBe(true);

      failOffset = null;
      fetchMock.mockClear();
      await act(async () => {
        await latest.loadMore();
      });
      expect(requestedUrls()[0].searchParams.get("offset")).toBe("400");
    });

    it("stops fetching pages for a refresh whose list changed or unmounted", async () => {
      await expandToTwoHundredFold();
      fetchMock.mockClear();
      const releaseSecondPage: Array<() => void> = [];
      fetchMock.mockImplementation((url: string) => {
        const offset = new URL(url, "http://x").searchParams.get("offset");
        if (offset === "200") {
          return new Promise<Response>((resolve) => {
            releaseSecondPage.push(() => resolve(serve(url) as never));
          });
        }
        return serve(url);
      });

      let refreshing!: Promise<void>;
      await act(async () => {
        refreshing = latest.refresh();
      });
      expect(fetchMock).toHaveBeenCalledTimes(2);

      act(() => root.unmount());
      await act(async () => {
        releaseSecondPage.forEach((release) => release());
        await refreshing;
      });
      // The stale refresh issued no further request and wrote nothing.
      expect(fetchMock).toHaveBeenCalledTimes(2);
      root = createRoot(container);
    });
  });

  it("rejects a page that reports more rows but returns none", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ threads: [], hasMore: true }));
    await mount({ ownership: "mine", apiUrl: "/api/chat" });
    expect(latest.error?.message).toMatch(/more threads but returned none/);
    expect(latest.hasMore).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("keeps the previous rows when a refresh fails", async () => {
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse({ threads: [row("a")], hasMore: false }),
      )
      .mockResolvedValueOnce(jsonResponse({ error: "down" }, 500));
    await mount({ ownership: "mine", apiUrl: "/api/chat" });
    await act(async () => {
      await latest.refresh();
    });
    expect(latest.error).toBeInstanceOf(ChatThreadListError);
    expect(latest.threads.map((t) => t.id)).toEqual(["a"]);
  });

  it("drops a response for a list that was replaced while it was in flight", async () => {
    let resolveMine: (value: Response) => void = () => {};
    fetchMock.mockImplementation((url: string) => {
      const ownership = new URL(url, "http://x").searchParams.get("ownership");
      if (ownership === "mine") {
        return new Promise<Response>((resolve) => {
          resolveMine = resolve;
        });
      }
      return Promise.resolve(
        jsonResponse({
          threads: [row("shared-1", { accessBasis: "direct" })],
          hasMore: false,
        }),
      );
    });
    await mount({ ownership: "mine", apiUrl: "/api/chat" });
    await mount({ ownership: "shared", apiUrl: "/api/chat" });
    expect(latest.threads.map((t) => t.id)).toEqual(["shared-1"]);

    await act(async () => {
      resolveMine(jsonResponse({ threads: [row("stale")], hasMore: false }));
    });
    await flush();
    expect(latest.threads.map((t) => t.id)).toEqual(["shared-1"]);
  });

  it("does not fetch while disabled", async () => {
    await mount({ ownership: "shared", enabled: false, apiUrl: "/api/chat" });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(latest.loading).toBe(false);
    expect(latest.threads).toEqual([]);
  });

  it.each<[string, Partial<UseChatThreadListOptions>]>([
    ["ownership", { ownership: "all" }],
    ["query", { query: "another search" }],
    ["scope type", { scope: { type: "document", id: "d1" } }],
    ["scope id", { scope: { type: "deck", id: "d2" } }],
    ["API", { apiUrl: "/another/chat" }],
    ["page size", { pageSize: 3 }],
    ["external threads", { includeExternal: true }],
    ["enabled", { enabled: false }],
  ])(
    "returns only the new %s identity on its first render",
    async (_name, change) => {
      const options: UseChatThreadListOptions = {
        ownership: "mine",
        query: "roadmap",
        scope: { type: "deck", id: "d1" },
        pageSize: 2,
        apiUrl: "/api/chat",
      };
      let releaseAppend!: (response: Response) => void;
      fetchMock
        .mockResolvedValueOnce(
          jsonResponse({ threads: [row("old"), row("old-2")], hasMore: true }),
        )
        .mockResolvedValueOnce(jsonResponse({ error: "down" }, 500))
        .mockImplementationOnce(
          () =>
            new Promise<Response>((resolve) => {
              releaseAppend = resolve;
            }),
        );
      await mount(options);
      await act(async () => {
        await latest.refresh();
      });
      expect(latest.error).toBeInstanceOf(ChatThreadListError);
      let appending!: Promise<void>;
      await act(async () => {
        appending = latest.loadMore();
      });
      expect(latest.loadingMore).toBe(true);

      let releaseNew!: (response: Response) => void;
      fetchMock.mockImplementation(
        () =>
          new Promise<Response>((resolve) => {
            releaseNew = resolve;
          }),
      );
      renders = [];
      await mount({ ...options, ...change });
      // Captured during render, before even layout effects can reset state.
      expect(renders[0]).toMatchObject({
        threads: [],
        loading: change.enabled !== false,
        loadingMore: false,
        error: null,
        hasMore: false,
      });
      await act(async () => {
        releaseAppend(
          jsonResponse({ threads: [row("stale")], hasMore: false }),
        );
        await appending;
        if (change.enabled !== false) {
          releaseNew(
            jsonResponse({ threads: [row("current")], hasMore: false }),
          );
        }
      });
      await flush();
      expect(latest.threads.map((thread) => thread.id)).toEqual(
        change.enabled === false ? [] : ["current"],
      );
      expect(latest.loading).toBe(false);
      expect(latest.error).toBeNull();
    },
  );

  it("retires old handlers before passive effects and cannot revive them on returning to a list", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ threads: [row("old")], hasMore: true }),
    );
    await mount({ ownership: "mine", pageSize: 1, apiUrl: "/api/chat" });
    const stale = latest;
    const staleCalls: Promise<void>[] = [];
    onLayout = () => {
      staleCalls.push(stale.refresh(), stale.loadMore());
    };
    fetchMock.mockClear();
    fetchMock.mockImplementation(() =>
      Promise.resolve(
        jsonResponse({ threads: [row("current")], hasMore: false }),
      ),
    );
    await mount({ ownership: "all", pageSize: 1, apiUrl: "/api/chat" });
    await Promise.all(staleCalls);
    expect(
      requestedUrls().map((url) => url.searchParams.get("ownership")),
    ).toEqual([null]);
    onLayout = undefined;
    await mount({ ownership: "mine", pageSize: 1, apiUrl: "/api/chat" });
    fetchMock.mockClear();
    await act(async () => {
      await stale.refresh();
      await stale.loadMore();
    });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(latest.threads.map((thread) => thread.id)).toEqual(["current"]);
  });

  it("keeps the same normalized query, rows, and handlers without refetching", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ threads: [row("current")], hasMore: true }),
    );
    await mount({
      ownership: "mine",
      query: " roadmap ",
      pageSize: 1,
      apiUrl: "/api/chat",
    });
    const previous = latest;
    renders = [];
    await mount({
      ownership: "mine",
      query: "roadmap",
      pageSize: 1,
      apiUrl: "/api/chat",
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(renders[0].threads).toBe(previous.threads);
    expect(latest.refresh).toBe(previous.refresh);
    expect(latest.loadMore).toBe(previous.loadMore);
    expect(latest.loading).toBe(false);
  });

  async function activity(
    mode: "visible" | "hidden",
    options: UseChatThreadListOptions,
  ) {
    await act(async () => {
      root.render(
        <Activity mode={mode}>
          <Probe {...options} />
        </Activity>,
      );
    });
    await flush();
  }

  it("retains the consumed loaded window across Activity hide/show and resumes paging from it", async () => {
    const options: UseChatThreadListOptions = {
      ownership: "mine",
      pageSize: 2,
      apiUrl: "/api/chat",
    };
    let version = "v1";
    let releaseAppend!: (response: Response) => void;
    fetchMock.mockImplementation(async (url: string) => {
      const params = new URL(url, "http://x").searchParams;
      const offset = Number(params.get("offset") ?? 0);
      const limit = Number(params.get("limit"));
      if (version === "v1" && offset === 4) {
        return new Promise<Response>((resolve) => {
          releaseAppend = resolve;
        });
      }
      const ids =
        version === "v1" && offset === 2
          ? ["v1-1", "v1-2"]
          : Array.from(
              { length: limit },
              (_, index) => `${version}-${offset + index}`,
            );
      return jsonResponse({ threads: ids.map((id) => row(id)), hasMore: true });
    });
    await activity("visible", options);
    await act(async () => {
      await latest.loadMore();
    });
    expect(latest.threads.map((thread) => thread.id)).toEqual([
      "v1-0",
      "v1-1",
      "v1-2",
    ]);
    let appending!: Promise<void>;
    await act(async () => {
      appending = latest.loadMore();
    });
    expect(latest.loadingMore).toBe(true);
    await activity("hidden", options);
    fetchMock.mockClear();
    await act(async () => {
      await latest.refresh();
      await latest.loadMore();
    });
    expect(fetchMock).not.toHaveBeenCalled();
    version = "v2";
    await activity("visible", options);
    expect(
      requestedUrls().map((url) => [
        url.searchParams.get("offset"),
        url.searchParams.get("limit"),
      ]),
    ).toEqual([[null, "4"]]);
    expect(latest.threads.map((thread) => thread.id)).toEqual([
      "v2-0",
      "v2-1",
      "v2-2",
      "v2-3",
    ]);
    await act(async () => {
      releaseAppend(
        jsonResponse({ threads: [row("inactive-session")], hasMore: false }),
      );
      await appending;
    });
    expect(latest.threads.map((thread) => thread.id)).toEqual([
      "v2-0",
      "v2-1",
      "v2-2",
      "v2-3",
    ]);
    expect(latest.loadingMore).toBe(false);
    expect(latest.hasMore).toBe(true);
    await act(async () => {
      await latest.loadMore();
    });
    expect(requestedUrls()[1].searchParams.get("offset")).toBe("4");
    expect(latest.threads.map((thread) => thread.id)).toEqual([
      "v2-0",
      "v2-1",
      "v2-2",
      "v2-3",
      "v2-4",
      "v2-5",
    ]);
  });

  it("does not revive an old identity's pending refresh when Activity shows a replacement list", async () => {
    const options: UseChatThreadListOptions = {
      ownership: "mine",
      pageSize: 2,
      apiUrl: "/api/chat",
    };
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse({ threads: [row("a"), row("b")], hasMore: true }),
      )
      .mockResolvedValueOnce(
        jsonResponse({ threads: [row("c"), row("d")], hasMore: true }),
      );
    await activity("visible", options);
    await act(async () => {
      await latest.loadMore();
    });
    expect(latest.threads).toHaveLength(4);
    let releaseOld!: (response: Response) => void;
    fetchMock.mockClear();
    fetchMock.mockImplementationOnce(
      () =>
        new Promise<Response>((resolve) => {
          releaseOld = resolve;
        }),
    );
    let refreshing!: Promise<void>;
    await act(async () => {
      refreshing = latest.refresh();
    });
    await activity("hidden", options);
    const replacement: UseChatThreadListOptions = {
      ...options,
      ownership: "all",
      query: "new",
      pageSize: 1,
    };
    await activity("hidden", replacement);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    fetchMock.mockResolvedValue(
      jsonResponse({ threads: [row("new-only")], hasMore: false }),
    );
    await activity("visible", replacement);
    expect(latest.threads.map((thread) => thread.id)).toEqual(["new-only"]);
    await act(async () => {
      releaseOld(
        jsonResponse({
          threads: [row("stale-1"), row("stale-2")],
          hasMore: true,
        }),
      );
      await refreshing;
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(requestedUrls()[1].searchParams.get("q")).toBe("new");
    expect(requestedUrls()[1].searchParams.get("limit")).toBe("1");
    expect(requestedUrls()[1].searchParams.get("offset")).toBeNull();
    expect(latest.threads.map((thread) => thread.id)).toEqual(["new-only"]);
    expect(latest.error).toBeNull();
    expect(latest.loading).toBe(false);
  });

  it("passes search text and scope through the same endpoint", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ threads: [], hasMore: false }));
    await mount({
      ownership: "shared",
      query: " roadmap ",
      scope: { type: "deck", id: "d1" },
      apiUrl: "/api/chat",
    });
    const url = requestedUrls()[0];
    expect(url.searchParams.get("q")).toBe("roadmap");
    expect(url.searchParams.get("scopeType")).toBe("deck");
    expect(url.searchParams.get("scopeId")).toBe("d1");
  });

  it.each([Number.NaN, 0, -1, 1.5, 201])(
    "throws a typed config error for pageSize %s",
    (pageSize) => {
      const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      expect(() =>
        act(() => {
          root.render(<Probe ownership="mine" pageSize={pageSize} />);
        }),
      ).toThrow(ChatThreadListConfigError);
      errorSpy.mockRestore();
    },
  );
});
