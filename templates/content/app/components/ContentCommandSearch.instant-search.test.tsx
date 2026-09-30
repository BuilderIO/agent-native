// @vitest-environment happy-dom

import { buildTitleSearchIndex } from "@shared/search-title-ranking";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@agent-native/core/client/i18n", async (importOriginal) => ({
  ...(await importOriginal()),
  useT: () => (key: string) => key,
}));
vi.mock("react-router", async (importOriginal) => ({
  ...(await importOriginal()),
  useNavigate: () => vi.fn(),
}));
// `CommandMenu.Group`/`.Item` normally require the real `<CommandMenu>`'s
// internal context (dialog chrome, changelog, agent fallback — none of it
// relevant here). Stand in with plain elements that keep the same children,
// so assertions can read rendered titles and order without mounting that.
vi.mock("@agent-native/toolkit/app/shared", async (importOriginal) => ({
  ...(await importOriginal()),
  CommandMenu: {
    Group: ({ children }: { children?: ReactNode; heading?: ReactNode }) => (
      <div data-testid="command-group">{children}</div>
    ),
    Item: ({
      children,
      onSelect,
    }: {
      children?: ReactNode;
      onSelect?: () => void;
    }) => (
      <div data-testid="command-item" onClick={() => onSelect?.()}>
        {children}
      </div>
    ),
  },
}));

import type { CommandSearchDocumentResult } from "@/lib/content-command-search";

import { SearchPage } from "./ContentCommandSearch";

// These tests exercise `SearchPage` directly (rather than the full
// `ContentCommandSearchResults` tree) because it is the layer that owns the
// `useActionQuery("search-documents", ...)` calls and therefore the layer
// responsible for the two rules under test:
//   1. Never show a previous query's server results as though they answered
//      the current query (docs/command-menu-architecture.md ~L111-112).
//   2. Once the server answers the current query, its order wins for the
//      items it returns; browser-only matches are appended after.

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

function searchDocumentsResponse(
  documents: Array<{ id: string; title: string }>,
) {
  return {
    documents: documents.map((doc) => ({
      id: doc.id,
      parentId: null,
      parentTitle: null,
      description: "",
      documentType: "page" as const,
      sourceKind: null,
      sourceUpdatedAt: null,
      title: doc.title,
      icon: null,
      snippet: "",
      contentLength: 0,
      hideFromSearch: false,
      updatedAt: "2026-01-01T00:00:00.000Z",
    })),
    pagination: {
      offset: 0,
      limit: 20,
      totalItems: documents.length,
      returnedItems: documents.length,
      hasMore: false,
      nextOffset: null,
    },
  };
}

function queryParam(url: string): string | null {
  return new URL(url, "http://localhost").searchParams.get("query");
}

// The fetch mock resolving is only the first of several microtask/macrotask
// hops (response body read, JSON parse, React Query cache write, re-render)
// before the DOM reflects it. Poll with real timers instead of guessing how
// many `await`s that chain needs.
async function waitFor(predicate: () => boolean, timeoutMs = 2000) {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) {
      throw new Error("waitFor: condition was not met in time");
    }
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
  }
}

describe("SearchPage: instant lane + server convergence", () => {
  let container: HTMLDivElement;
  let root: Root;

  afterEach(async () => {
    if (root) await act(async () => root.unmount());
    container?.remove();
    vi.unstubAllGlobals();
  });

  function candidate(id: string, title: string): CommandSearchDocumentResult {
    return {
      id,
      parentId: null,
      parentTitle: null,
      description: "",
      documentType: "page",
      sourceKind: null,
      sourceUpdatedAt: null,
      title,
      icon: null,
      snippet: "",
      contentLength: 0,
      hideFromSearch: false,
      updatedAt: "2026-01-01T00:00:00.000Z",
    };
  }

  it("never shows a previous query's server results for the current query, and converges on the server's order once it answers", async () => {
    const alpha = deferred<Response>();
    const beta = deferred<Response>();
    const queryClient = new QueryClient();

    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();
      const query = queryParam(url);
      if (query === "alpha") return alpha.promise;
      if (query === "beta") return beta.promise;
      return Promise.resolve(jsonResponse(searchDocumentsResponse([])));
    });
    vi.stubGlobal("fetch", fetchMock);

    const titleIndex = buildTitleSearchIndex([
      candidate("instant-alpha", "Alpha Local"),
      candidate("instant-beta", "Beta Local"),
    ]);

    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () =>
      root.render(
        <QueryClientProvider client={queryClient}>
          <SearchPage
            liveQuery="alpha"
            debouncedQuery="alpha"
            needles={[]}
            searchFields="all"
            onOpenChange={() => {}}
            renderList={(results?: ReactNode) => results}
            staticItems={null}
            titleIndex={titleIndex}
          />
        </QueryClientProvider>,
      ),
    );

    // Before the server answers: instant match for "alpha" only, no server
    // titles, list not blanked (SO-01), a loading affordance is present.
    expect(container.textContent).toContain("Alpha Local");
    expect(container.textContent).not.toContain("Beta Local");
    expect(container.textContent).not.toContain("Server Alpha");
    expect(container.querySelector('[role="status"]')).not.toBeNull();

    // Server answers "alpha": its order wins; the instant-only guess is
    // appended after it (rule 2).
    alpha.resolve(
      jsonResponse(
        searchDocumentsResponse([
          { id: "server-alpha", title: "Server Alpha" },
        ]),
      ),
    );
    await waitFor(() => container.textContent!.includes("Server Alpha"));
    expect(container.textContent).toContain("Alpha Local");
    const serverIndex = container.textContent!.indexOf("Server Alpha");
    const instantIndex = container.textContent!.indexOf("Alpha Local");
    expect(serverIndex).toBeGreaterThanOrEqual(0);
    expect(serverIndex).toBeLessThan(instantIndex);

    // User types "beta" but the debounce hasn't fired yet: the server lane
    // still holds the answer for "alpha", which must not be shown as a
    // result for "beta" (rule 1). Only the instant lane shows.
    await act(async () =>
      root.render(
        <QueryClientProvider client={queryClient}>
          <SearchPage
            liveQuery="beta"
            debouncedQuery="alpha"
            needles={[]}
            searchFields="all"
            onOpenChange={() => {}}
            renderList={(results?: ReactNode) => results}
            staticItems={null}
            titleIndex={titleIndex}
          />
        </QueryClientProvider>,
      ),
    );
    expect(container.textContent).not.toContain("Server Alpha");
    expect(container.textContent).not.toContain("Alpha Local");
    expect(container.textContent).toContain("Beta Local");
    expect(container.querySelector('[role="status"]')).not.toBeNull();

    // Debounce settles on "beta" before its server request resolves; the
    // "alpha" response must still never be attributed to "beta" (rule 1).
    await act(async () =>
      root.render(
        <QueryClientProvider client={queryClient}>
          <SearchPage
            liveQuery="beta"
            debouncedQuery="beta"
            needles={[]}
            searchFields="all"
            onOpenChange={() => {}}
            renderList={(results?: ReactNode) => results}
            staticItems={null}
            titleIndex={titleIndex}
          />
        </QueryClientProvider>,
      ),
    );

    expect(container.textContent).not.toContain("Server Alpha");
    expect(container.textContent).not.toContain("Alpha Local");
    expect(container.textContent).toContain("Beta Local");
    expect(container.querySelector('[role="status"]')).not.toBeNull();

    // Now "beta" answers: its order wins over the instant guess again.
    beta.resolve(
      jsonResponse(
        searchDocumentsResponse([{ id: "server-beta", title: "Server Beta" }]),
      ),
    );
    await waitFor(() => container.textContent!.includes("Server Beta"));
    expect(container.textContent).toContain("Beta Local");
    expect(container.textContent).not.toContain("Server Alpha");
    expect(container.textContent).not.toContain("Alpha Local");
    const serverBetaIndex = container.textContent!.indexOf("Server Beta");
    const instantBetaIndex = container.textContent!.indexOf("Beta Local");
    expect(serverBetaIndex).toBeLessThan(instantBetaIndex);
  });
});
