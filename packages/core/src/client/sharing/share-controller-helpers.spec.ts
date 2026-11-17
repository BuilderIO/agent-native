// @vitest-environment happy-dom

import { QueryClient } from "@tanstack/react-query";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createShareQueryKey,
  notifyShareChanged,
  optimisticallyUpdateShareVisibility,
  useShareOrgMemberSearch,
  type ShareOrgMemberSearchResult,
} from "./share-controller-helpers.js";

describe("share visibility cache ownership", () => {
  const clients: QueryClient[] = [];
  const key = createShareQueryKey({
    resourceType: "document",
    resourceId: "doc-1",
  });
  const initial: {
    visibility: "private" | "org" | "public";
    shares: string[];
  } = {
    visibility: "private",
    shares: [],
  };
  const client = () => {
    const value = new QueryClient();
    clients.push(value);
    value.setQueryData(key, initial);
    return value;
  };
  afterEach(() => clients.splice(0).forEach((value) => value.clear()));

  it("lets only the newest visibility mutation commit or roll back its cache entry", () => {
    const queryClient = client();
    const older = optimisticallyUpdateShareVisibility<typeof initial>(
      queryClient,
      key,
      "org",
    );
    const newer = optimisticallyUpdateShareVisibility<typeof initial>(
      queryClient,
      key,
      "public",
    );
    older.rollback();
    older.commit("private");
    expect(older.isCurrent()).toBe(false);
    expect(newer.isCurrent()).toBe(true);
    expect(queryClient.getQueryData(key)).toEqual({
      visibility: "public",
      shares: [],
    });
    newer.commit("org");
    expect(queryClient.getQueryData(key)).toEqual({
      visibility: "org",
      shares: [],
    });
  });

  it("does not restore visibility over a replacement query or an unrelated visibility update", () => {
    const queryClient = client();
    const mutation = optimisticallyUpdateShareVisibility<typeof initial>(
      queryClient,
      key,
      "org",
    );
    queryClient.setQueryData(key, {
      visibility: "public",
      shares: ["new-share"],
    });
    mutation.rollback();
    expect(queryClient.getQueryData(key)).toEqual({
      visibility: "public",
      shares: ["new-share"],
    });
    queryClient.removeQueries({ queryKey: key, exact: true });
    queryClient.setQueryData(key, initial);
    mutation.commit("org");
    mutation.rollback();
    expect(mutation.isCurrent()).toBe(false);
    expect(queryClient.getQueryData(key)).toEqual(initial);
  });
});

describe("useShareOrgMemberSearch", () => {
  let root: Root | undefined;
  let container: HTMLDivElement | undefined;

  afterEach(async () => {
    const mounted = root;
    if (mounted) await act(async () => mounted.unmount());
    container?.remove();
    root = undefined;
    container = undefined;
    vi.unstubAllGlobals();
  });

  const page = (emails: string[], nextOffset: number | null) =>
    new Response(
      JSON.stringify({
        members: emails.map((email) => ({ email })),
        hasMore: nextOffset !== null,
        nextOffset,
      }),
      { headers: { "content-type": "application/json" } },
    );

  it("loads more for a new search while a page for the old one was still loading", async () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    const fetchMock = vi
      .fn<(input: string) => Promise<Response>>()
      .mockResolvedValueOnce(page(["ana@example.com"], 1))
      .mockReturnValueOnce(new Promise<Response>(() => {}))
      .mockResolvedValueOnce(page(["bo@example.com"], 1))
      .mockResolvedValueOnce(page(["bea@example.com"], null));
    vi.stubGlobal("fetch", fetchMock);
    let search: ShareOrgMemberSearchResult | undefined;
    function Probe({ query }: { query: string }) {
      search = useShareOrgMemberSearch(query, true, {
        limit: 1,
        debounceMs: 0,
      });
      return null;
    }
    container = document.createElement("div");
    document.body.appendChild(container);
    const mounted = createRoot(container);
    root = mounted;
    await act(async () => mounted.render(createElement(Probe, { query: "" })));
    const current = () => {
      if (!search) throw new Error("Hook didn't render");
      return search;
    };

    // The next page for "" never answers before the search changes.
    await act(async () => current().loadMore());
    expect(current().isLoadingMore).toBe(true);
    await act(async () => mounted.render(createElement(Probe, { query: "b" })));
    expect(current().isLoadingMore).toBe(false);
    expect(current().members.map((member) => member.email)).toEqual([
      "bo@example.com",
    ]);

    await act(async () => current().loadMore());
    expect(fetchMock.mock.calls[3]?.[0]).toContain("search=b");
    expect(current().members.map((member) => member.email)).toEqual([
      "bo@example.com",
      "bea@example.com",
    ]);
  });

  it("lets a later page that failed be loaded again", async () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    const fetchMock = vi
      .fn<(input: string) => Promise<Response>>()
      .mockResolvedValueOnce(page(["ana@example.com"], 1))
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce(page(["bo@example.com"], null));
    vi.stubGlobal("fetch", fetchMock);
    let search: ShareOrgMemberSearchResult | undefined;
    function Probe() {
      search = useShareOrgMemberSearch("", true, { limit: 1 });
      return null;
    }
    container = document.createElement("div");
    document.body.appendChild(container);
    const mounted = createRoot(container);
    root = mounted;
    await act(async () => mounted.render(createElement(Probe)));
    const current = () => {
      if (!search) throw new Error("Hook didn't render");
      return search;
    };
    expect(current().members.map((member) => member.email)).toEqual([
      "ana@example.com",
    ]);

    await act(async () => current().loadMore());
    expect(current().error).toBe(true);
    expect(current().hasMore).toBe(true);
    expect(current().members.map((member) => member.email)).toEqual([
      "ana@example.com",
    ]);

    await act(async () => current().loadMore());
    expect(fetchMock.mock.calls[2]?.[0]).toContain("offset=1");
    expect(current().error).toBe(false);
    expect(current().hasMore).toBe(false);
    expect(current().members.map((member) => member.email)).toEqual([
      "ana@example.com",
      "bo@example.com",
    ]);
  });
});

describe("notifyShareChanged", () => {
  afterEach(() => vi.restoreAllMocks());

  it("tells chat history lists to refetch after a chat share changes", () => {
    const listener = vi.fn();
    window.addEventListener("agent-chat:threads-updated", listener);

    notifyShareChanged("chat_thread");

    expect(listener).toHaveBeenCalledOnce();
    window.removeEventListener("agent-chat:threads-updated", listener);
  });

  it("leaves chat history alone for other resource types", () => {
    const listener = vi.fn();
    window.addEventListener("agent-chat:threads-updated", listener);

    notifyShareChanged("document");

    expect(listener).not.toHaveBeenCalled();
    window.removeEventListener("agent-chat:threads-updated", listener);
  });
});
