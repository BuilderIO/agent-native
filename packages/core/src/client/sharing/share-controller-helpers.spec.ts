// @vitest-environment happy-dom

import { QueryClient } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createShareQueryKey,
  notifyShareChanged,
  optimisticallyUpdateShareVisibility,
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
