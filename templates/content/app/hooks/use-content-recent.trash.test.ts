// @vitest-environment happy-dom

import type { ContentRecentResult } from "@shared/content-personal-navigation";
import {
  QueryClient,
  QueryClientProvider,
  useMutation,
} from "@tanstack/react-query";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  removeTrashedFromCachedRecent,
  useContentRecent,
} from "./use-content-recent";
import {
  DELETE_CONTENT_DATABASE_MUTATION_KEY,
  DELETE_DOCUMENT_MUTATION_KEY,
} from "./use-pending-trash";

vi.mock("@agent-native/core/client/hooks", async () => {
  const { useQuery } = await import("@tanstack/react-query");
  return {
    useActionMutation: vi.fn(),
    // The cache is seeded and never stale, so Recent reads only what the
    // test puts there.
    useActionQuery: (
      action: string,
      args: unknown,
      options?: { enabled?: boolean },
    ) =>
      useQuery({
        queryKey: ["action", action, args],
        queryFn: () => new Promise(() => {}),
        enabled: options?.enabled,
      }),
  };
});

vi.mock("@agent-native/core/client/org", () => ({
  useOrg: () => ({
    data: { email: "user@example.test", orgId: "org-1" },
    isLoading: false,
    isFetching: false,
    isError: false,
    refetch: vi.fn(),
  }),
}));

const scopeKey = JSON.stringify(["user@example.test", "org-1", null]);
const recentQueryKey = ["action", "get-content-recent", { scopeKey }];

function entry(documentId: string, databaseId?: string): ContentRecentResult {
  return {
    target: databaseId ? { documentId, databaseId } : { documentId },
    visitedAt: "2026-11-08T12:00:00.000Z",
    title: documentId,
    icon: null,
    viewName: null,
  };
}

function deferred() {
  let reject!: (error: Error) => void;
  let resolve!: () => void;
  const promise = new Promise<void>((onResolve, onReject) => {
    resolve = onResolve;
    reject = onReject;
  });
  return { promise, resolve, reject };
}

describe("Recent while a page or collection moves to Trash", () => {
  let container: HTMLDivElement;
  let root: Root;
  let queryClient: QueryClient;
  let shown: string[];
  let trashPage: (variables: {
    id: string;
    databaseDocumentId?: string;
  }) => Promise<void>;
  let trashCollection: (variables: { databaseId: string }) => Promise<void>;
  let pending: ReturnType<typeof deferred>;

  function Probe() {
    const recent = useContentRecent();
    shown = recent.data?.entries.map((item) => item.target.documentId) ?? [];
    trashPage = useMutation({
      mutationKey: DELETE_DOCUMENT_MUTATION_KEY,
      mutationFn: (_variables: { id: string; databaseDocumentId?: string }) =>
        pending.promise,
    }).mutateAsync;
    trashCollection = useMutation({
      mutationKey: DELETE_CONTENT_DATABASE_MUTATION_KEY,
      mutationFn: (_variables: { databaseId: string }) => pending.promise,
    }).mutateAsync;
    return null;
  }

  async function flush() {
    await act(async () => {
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    });
  }

  beforeEach(async () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false, staleTime: Infinity } },
    });
    queryClient.setQueryData(recentQueryKey, {
      scopeKey,
      entries: [entry("page-a"), entry("page-b"), entry("table-c", "db-c")],
    });
    pending = deferred();
    act(() =>
      root.render(
        React.createElement(
          QueryClientProvider,
          { client: queryClient },
          React.createElement(Probe),
        ),
      ),
    );
    await flush();
  });

  afterEach(() => {
    act(() => root.unmount());
    queryClient.clear();
    container.remove();
    vi.unstubAllGlobals();
  });

  it("hides a page as soon as its move starts and shows it again when the move fails", async () => {
    expect(shown).toEqual(["page-a", "page-b", "table-c"]);

    let moved!: Promise<void>;
    act(() => {
      moved = trashPage({ id: "page-a" }).catch(() => undefined);
    });
    await flush();
    expect(shown).toEqual(["page-b", "table-c"]);

    pending.reject(new Error("Server refused"));
    await act(async () => moved);
    await flush();
    expect(shown).toEqual(["page-a", "page-b", "table-c"]);
  });

  it("keeps a page hidden once the server confirms and the cached list drops it", async () => {
    let moved!: Promise<void>;
    act(() => {
      moved = trashPage({ id: "page-a" });
    });
    await flush();
    expect(shown).toEqual(["page-b", "table-c"]);

    act(() =>
      removeTrashedFromCachedRecent(queryClient, { documentIds: ["page-a"] }),
    );
    pending.resolve();
    await act(async () => moved);
    await flush();
    expect(shown).toEqual(["page-b", "table-c"]);
  });

  it("hides a collection by its database while its move is pending", async () => {
    act(() => {
      void trashCollection({ databaseId: "db-c" });
    });
    await flush();
    expect(shown).toEqual(["page-a", "page-b"]);
  });

  it("leaves a page in place when the delete only takes it out of a collection", async () => {
    act(() => {
      void trashPage({ id: "page-a", databaseDocumentId: "favorites-doc" });
    });
    await flush();
    expect(shown).toEqual(["page-a", "page-b", "table-c"]);
  });
});
