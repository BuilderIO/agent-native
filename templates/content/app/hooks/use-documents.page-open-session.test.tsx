// @vitest-environment happy-dom

import type { Document } from "@shared/api";
import {
  QueryClient,
  QueryClientProvider,
  useQuery,
} from "@tanstack/react-query";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// A load starts its page read before the session is known, and the editor
// mounts (hidden behind the session gate) while the session read is still out.
// These cover what the editor may treat as its page in that window.

const server = vi.hoisted(() => ({
  calls: [] as Array<{ name: string; params: unknown }>,
  account: "a",
}));

const session = vi.hoisted(() => {
  type Answer = "pending" | "first-read" | "replaced";
  const listeners = new Set<() => void>();
  let answer: Answer = "pending";
  return {
    listeners,
    get: () => answer,
    set(next: Answer) {
      answer = next;
      for (const listener of [...listeners]) listener();
    },
    reset() {
      answer = "pending";
      listeners.clear();
    },
  };
});

vi.mock("@agent-native/core/client/use-session", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("@agent-native/core/client/use-session")
  >()),
  firstSessionReadAnswer: () => session.get(),
  subscribeFirstSessionReadAnswer: (listener: () => void) => {
    session.listeners.add(listener);
    return () => session.listeners.delete(listener);
  },
}));
vi.mock("@agent-native/core/client/agent-chat", () => ({
  isOpenAiMcpAppHost: () => false,
}));
vi.mock("@agent-native/core/client/host", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@agent-native/core/client/host")>()),
  isEmbedMcpChatBridgeActive: () => false,
}));
vi.mock("@agent-native/core/client/hooks", () => {
  // Answers as whichever account the cookies name when the request goes out.
  const callAction = (
    name: string,
    params: { id?: string },
  ): Promise<unknown> => {
    server.calls.push({ name, params });
    const account = server.account;
    if (name === "get-preview-document-draft") {
      return Promise.resolve({ editable: true, draft: `${account}'s draft` });
    }
    const page = { id: params.id, title: `${account}'s page`, canEdit: true };
    if (name === "get-page-open-read") {
      return Promise.resolve({
        document: {
          ...page,
          previewDraft: { editable: true, draft: `${account}'s draft` },
        },
      });
    }
    if (name !== "get-document") return Promise.resolve({ account });
    return Promise.resolve(page);
  };
  return {
    callAction,
    getBrowserTabId: () => "tab-1",
    useDbSync: vi.fn(),
    useActionQuery: (
      name: string,
      params: Parameters<typeof callAction>[1],
      options: object,
    ) =>
      useQuery({
        queryKey: ["action", name, params],
        queryFn: () => callAction(name, params),
        ...options,
      }),
  };
});
vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string) => key,
}));

import {
  startupPageReadScript,
  takeStartupPageRead,
} from "../lib/page-open-reads";
import {
  startPageOpenDocumentReads,
  usePageOpenDocument,
  usePreviewDocumentDraft,
} from "./use-documents";

const reads = (name: string) =>
  server.calls.filter((call) => call.name === name).length;

describe("a page read sent before the session is known", () => {
  let queryClient: QueryClient;
  let container: HTMLDivElement;
  let root: Root;
  let last: {
    fetchedForThisOpen: boolean;
    readsStartedEarly: boolean;
    title: string | undefined;
    draft: unknown;
  } | null;

  function Page() {
    const { query, fetchedForThisOpen, readsStartedEarly } =
      usePageOpenDocument("doc-1", {});
    const drafts = usePreviewDocumentDraft("doc-1");
    last = {
      fetchedForThisOpen,
      readsStartedEarly,
      title: (query.data as Document | undefined)?.title,
      draft: (drafts.data as { draft?: unknown } | undefined)?.draft,
    };
    return null;
  }

  async function loadAndMount() {
    startPageOpenDocumentReads(
      queryClient,
      "doc-1",
      {},
      { beforeSession: true },
    );
    await act(async () => {
      root.render(
        createElement(
          QueryClientProvider,
          { client: queryClient },
          createElement(Page),
        ),
      );
    });
    await vi.waitFor(() => expect(last?.title).toBe("a's page"));
  }

  beforeEach(() => {
    (
      globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    server.calls = [];
    server.account = "a";
    session.reset();
    last = null;
    queryClient = new QueryClient();
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    queryClient.clear();
  });

  it("is the editor's page once the load's own session read answers, with no second read", async () => {
    await loadAndMount();

    expect(last).toMatchObject({
      fetchedForThisOpen: false,
      readsStartedEarly: true,
    });
    expect(reads("list-comments")).toBe(0);

    await act(async () => session.set("first-read"));

    expect(last).toMatchObject({
      fetchedForThisOpen: true,
      title: "a's page",
      draft: "a's draft",
    });
    expect(reads("get-page-open-read")).toBe(1);
    expect(reads("get-document")).toBe(0);
    expect(reads("get-preview-document-draft")).toBe(0);
    // Comments and suggestions wait for the session, then start at once.
    expect(reads("list-comments")).toBe(1);
    expect(reads("list-resource-suggestions")).toBe(1);
  });

  it("is never shown when another account's session answers; the page and draft are read again", async () => {
    await loadAndMount();
    server.account = "b";

    await act(async () => session.set("replaced"));

    await vi.waitFor(() =>
      expect(last).toMatchObject({
        fetchedForThisOpen: true,
        title: "b's page",
        draft: "b's draft",
      }),
    );
    expect(reads("list-comments")).toBe(0);
  });

  describe("sent by the document head", () => {
    beforeEach(() => {
      window.history.replaceState(null, "", "/page/doc-1");
      document.cookie = "an_session_hint=1; path=/";
      vi.stubGlobal(
        "fetch",
        vi.fn(
          async () =>
            new Response(
              JSON.stringify({
                document: {
                  id: "doc-1",
                  title: "a's page",
                  canEdit: true,
                  previewDraft: { editable: true, draft: "a's draft" },
                },
              }),
              { status: 200, headers: { "content-type": "application/json" } },
            ),
        ),
      );
      new Function(
        startupPageReadScript("/_agent-native/actions/get-page-open-read"),
      )();
    });

    afterEach(() => {
      void takeStartupPageRead("", {});
      document.cookie = "an_session_hint=; path=/; max-age=0";
      vi.unstubAllGlobals();
    });

    it("is the editor's page and draft, with no read of its own", async () => {
      await loadAndMount();
      await act(async () => session.set("first-read"));

      expect(last).toMatchObject({
        fetchedForThisOpen: true,
        title: "a's page",
        draft: "a's draft",
      });
      expect(reads("get-page-open-read")).toBe(0);
      expect(reads("get-document")).toBe(0);
      expect(reads("get-preview-document-draft")).toBe(0);
    });

    it("is dropped like any read sent before the session when another account answers", async () => {
      await loadAndMount();
      server.account = "b";

      await act(async () => session.set("replaced"));

      await vi.waitFor(() =>
        expect(last).toMatchObject({
          fetchedForThisOpen: true,
          title: "b's page",
          draft: "b's draft",
        }),
      );
    });
  });

  it("never reaches the editor between the drop and the new read", async () => {
    await loadAndMount();
    server.account = "b";
    const titles: Array<string | undefined> = [];
    const unsubscribe = queryClient.getQueryCache().subscribe(() => {
      const page = queryClient.getQueryData<Document>([
        "action",
        "get-document",
        { id: "doc-1" },
      ]);
      titles.push(page?.title);
    });

    session.set("replaced");
    // In the task that answered, before React re-renders behind the gate.
    expect(
      queryClient.getQueryData(["action", "get-document", { id: "doc-1" }]),
    ).toBeUndefined();
    await vi.waitFor(() => expect(last?.title).toBe("b's page"));
    expect(titles.slice(titles.indexOf(undefined))).not.toContain("a's page");
    unsubscribe();
  });
});
