// @vitest-environment happy-dom

import type { Document } from "@shared/api";
import { QueryClient, useQuery } from "@tanstack/react-query";
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// A page open reads its page before the session is known, from several
// places. Whichever place sent it, and whenever another account takes over,
// nothing read as account A may be used once the tab's session is B's. Each
// cell runs the real session store, session gate and action cache gate, with
// a server that answers as whoever the request was sent as: the account the
// cookies name, or B for a request carrying B's embed token. Until a read is
// handed to the page, its recorded identity decides; after that, the cache
// gate's rebind on B's answer does, so the cells need both.

const SESSION_PATH = "/_agent-native/auth/session";
const PAGE_READ_URL = "/_agent-native/actions/get-page-open-read";
const INVALIDATION_KEY = "agent-native:session-invalidated";
const TRANSPORT_CHANGED_EVENT = "agent-native:fetch-transport-changed";

const server = vi.hoisted(() => ({
  // The account the browser's cookies name when a request goes out.
  account: "a",
  // Whether the page is a collection's, whose read brings its table's first
  // reads along.
  collectionPage: false,
  // A fetch that sends B's embed token and no cookies, like the MCP host's
  // embed runtime.
  bearerFetch: null as typeof fetch | null,
  holdSessionAnswers: false,
  heldSessionAnswers: [] as Array<() => void>,
}));

// Whom a request sent now is answered for. The app wraps the page's fetch
// and its wrappers name the fetch they send on, so follow them down to it.
const TRANSPORT = Symbol.for("agent-native.fetch.transport");
function sentAs(fetcher: unknown): string {
  let current = fetcher;
  for (let depth = 0; depth < 16 && typeof current === "function"; depth++) {
    if (current === server.bearerFetch) return "b";
    const next = (current as { [TRANSPORT]?: () => unknown })[TRANSPORT];
    if (typeof next !== "function") break;
    current = next();
  }
  return server.account;
}

const tableQuery = {
  search: "",
  filters: [],
  sorts: [],
  filterMode: "and" as const,
};
const rowsParams = { documentId: "doc-1", limit: 100, tableQuery };

// The page as an account reads it, with its collection's parts when it has
// one.
function pageReadFor(account: string, includePreviewDraft = true) {
  const page = { id: "doc-1", title: `${account}'s page`, canEdit: true };
  const owner = `${account}'s collection`;
  return {
    document: includePreviewDraft
      ? {
          ...page,
          previewDraft: { editable: true, draft: `${account}'s draft` },
        }
      : page,
    ...(server.collectionPage
      ? {
          collection: {
            database: { owner, items: [], properties: [] },
            personalView: { databaseId: "db-1", overrides: null, owner },
            rows: { tableQuery, page: { owner, items: [] } },
          },
        }
      : {}),
  };
}

vi.mock("@agent-native/core/client/agent-chat", () => ({
  isOpenAiMcpAppHost: () => false,
}));
vi.mock("@agent-native/core/client/host", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@agent-native/core/client/host")>()),
  isEmbedMcpChatBridgeActive: () => false,
}));
vi.mock("@agent-native/core/client/hooks", () => {
  const callAction = (
    name: string,
    params: { id?: string; includePreviewDraft?: boolean },
  ): Promise<unknown> => {
    const account = sentAs(globalThis.fetch);
    if (name === "get-preview-document-draft") {
      return Promise.resolve({ editable: true, draft: `${account}'s draft` });
    }
    if (name === "get-page-open-read") {
      return Promise.resolve(
        pageReadFor(account, params.includePreviewDraft === true),
      );
    }
    if (name === "get-document") {
      return Promise.resolve(pageReadFor(account, false).document);
    }
    if (name === "query-content-database-items") {
      return Promise.resolve({ owner: `${account}'s collection`, items: [] });
    }
    return Promise.resolve(null);
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

function json(value: unknown) {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

function answer(url: string, account: string): Promise<Response> {
  if (url.includes(SESSION_PATH)) {
    const response = json({
      email: `${account}@example.test`,
      userId: account,
    });
    if (!server.holdSessionAnswers) return Promise.resolve(response);
    return new Promise((resolve) =>
      server.heldSessionAnswers.push(() => resolve(response)),
    );
  }
  if (url.includes(PAGE_READ_URL)) {
    return Promise.resolve(json(pageReadFor(account)));
  }
  return Promise.resolve(json({}));
}

const cookieFetch = (input: RequestInfo | URL) =>
  answer(String(input instanceof Request ? input.url : input), server.account);

type ReadKind =
  | "head read"
  | "app read"
  | "home-page prefetch"
  | "collection seed";
type Switch =
  | "before the app code loads"
  | "while the session read is out"
  | "after the session read answered"
  | "to B's embed token before the session read"
  | "on a routine reread that discovers B"
  | "to B's embed token with no session fetch";

type Shown = {
  account: string | undefined;
  title: string | undefined;
  draft: unknown;
  fetched: boolean;
};

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("a page-open read sent as A is never used once the session is B's", () => {
  let container: HTMLDivElement;
  let root: Root | null;
  let queryClient: QueryClient | null;

  beforeEach(() => {
    (
      globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    server.account = "a";
    server.collectionPage = false;
    server.holdSessionAnswers = false;
    server.heldSessionAnswers = [];
    window.history.replaceState(null, "", "/page/doc-1");
    document.cookie = "an_session_hint=1; path=/";
    window.localStorage.setItem(INVALIDATION_KEY, "earlier-sign-in");
    const pageFetch = vi.fn(cookieFetch) as unknown as typeof fetch;
    server.bearerFetch = ((input: RequestInfo | URL) =>
      answer(
        String(input instanceof Request ? input.url : input),
        "b",
      )) as typeof fetch;
    vi.stubGlobal("fetch", pageFetch);
    container = document.createElement("div");
    document.body.append(container);
    root = null;
    queryClient = null;
  });

  afterEach(() => {
    const mounted = root;
    if (mounted) act(() => mounted.unmount());
    queryClient?.clear();
    container.remove();
    delete (window as { __agentNativeSessionBootstrap?: unknown })
      .__agentNativeSessionBootstrap;
    delete (window as { __agentNativeSessionBootstrapTransport?: unknown })
      .__agentNativeSessionBootstrapTransport;
    delete (window as { __contentStartupPageRead?: unknown })
      .__contentStartupPageRead;
    window.localStorage.clear();
    document.cookie = "an_session_hint=; path=/; max-age=0";
    vi.unstubAllGlobals();
  });

  // Another tab signs in as B and tells every tab.
  function signInElsewhereAsB() {
    server.account = "b";
    window.localStorage.setItem(INVALIDATION_KEY, "signed-in-as-b");
    window.dispatchEvent(
      new StorageEvent("storage", {
        key: INVALIDATION_KEY,
        newValue: "signed-in-as-b",
      }),
    );
  }

  async function openPage(kind: ReadKind, change: Switch) {
    // The shell renders the head scripts; take their source, then start the
    // client modules from scratch as a fresh load does.
    const { getSsrSessionBootstrapScriptBody } =
      await import("@agent-native/core/shared/ssr-session-bootstrap");
    const { startupPageReadScript } = await import("../lib/page-open-reads");
    const headScripts = [getSsrSessionBootstrapScriptBody(SESSION_PATH)];
    if (kind === "head read") {
      headScripts.push(startupPageReadScript(PAGE_READ_URL));
    }
    vi.resetModules();

    // The document head, with A's cookies.
    server.collectionPage = kind === "collection seed";
    server.holdSessionAnswers = change === "while the session read is out";
    for (const script of headScripts) new Function(script)();
    await tick();
    if (change === "before the app code loads") signInElsewhereAsB();

    // The app code arrives.
    const { useSession } =
      await import("@agent-native/core/client/use-session");
    const { ActionQueryCacheGate, setActionQueryCacheStorage } =
      await import("@agent-native/core/client/action-query-cache");
    const { RequireSession } = await import("@agent-native/toolkit/app/auth");
    const { QueryClientProvider } = await import("@tanstack/react-query");
    const { useActionQuery } = await import("@agent-native/core/client/hooks");
    const {
      startPageOpenDocumentReads,
      usePageOpenDocument,
      usePreviewDocumentDraft,
    } = await import("./use-documents");
    const records = new Map<string, unknown>();
    setActionQueryCacheStorage({
      get: async (key) => records.get(key) as never,
      set: async (key, value) => void records.set(key, value),
      del: async (key) => void records.delete(key),
      keys: async () => [...records.keys()],
      clear: async () => records.clear(),
    });

    const client = new QueryClient();
    queryClient = client;
    const shown: Shown[] = [];
    const sessions: Array<string | undefined> = [];
    // The collection's table takes what is in the cache for as long as it
    // stays there, so a seed of A's that was kept would show.
    const table: Array<{ account: string | undefined; rows: unknown }> = [];
    function Table() {
      const { session } = useSession();
      const rows = useActionQuery("query-content-database-items", rowsParams, {
        staleTime: Infinity,
      });
      table.push({
        account: session?.userId,
        rows: (rows.data as { owner?: unknown } | undefined)?.owner,
      });
      return null;
    }
    function Page() {
      const { session } = useSession();
      const { query, fetchedForThisOpen } = usePageOpenDocument("doc-1", {});
      const drafts = usePreviewDocumentDraft("doc-1");
      shown.push({
        account: session?.userId,
        title: (query.data as Document | undefined)?.title,
        draft: (drafts.data as { draft?: unknown } | undefined)?.draft,
        fetched: !query.isError && fetchedForThisOpen,
      });
      return kind === "collection seed" ? <Table /> : null;
    }
    // On a routine reread the page opens only once the session is A's, while
    // the reread is out. Kept outside the tree, which the cache gate remounts
    // when the account changes.
    const routineReread = change === "on a routine reread that discovers B";
    let pageOpen = !routineReread;
    let openPageNow = () => {};
    function Shell() {
      const { session } = useSession();
      const [, rerender] = useState(0);
      openPageNow = () => {
        pageOpen = true;
        rerender((count) => count + 1);
      };
      sessions.push(session?.userId);
      return pageOpen ? <Page /> : null;
    }

    // The page's reads start: the load's own, or the home page's prefetch of
    // the page it likely reopens, which runs in the tree mounted hidden
    // behind the session gate.
    const startReads = () => {
      if (kind === "home-page prefetch") {
        startPageOpenDocumentReads(client, "doc-1", {});
      } else {
        startPageOpenDocumentReads(client, "doc-1", {}, { fromLoad: true });
      }
    };
    if (!routineReread) startReads();
    // The embed token arrives: from here every request is sent as B.
    if (change === "to B's embed token before the session read") {
      vi.stubGlobal("fetch", server.bearerFetch);
    }

    const app = createRoot(container);
    root = app;
    await act(async () => {
      app.render(
        <QueryClientProvider client={client}>
          <ActionQueryCacheGate>
            <RequireSession redirect={false}>
              <Shell />
            </RequireSession>
          </ActionQueryCacheGate>
        </QueryClientProvider>,
      );
    });

    if (change === "while the session read is out") {
      await act(async () => {
        await tick();
        signInElsewhereAsB();
        await tick();
        server.holdSessionAnswers = false;
        for (const release of server.heldSessionAnswers.splice(0)) release();
      });
    }
    if (change === "after the session read answered") {
      // A's page is A's to see.
      await vi.waitFor(() =>
        expect(shown[shown.length - 1]).toEqual({
          account: "a",
          title: "a's page",
          draft: "a's draft",
          fetched: true,
        }),
      );
      await act(async () => signInElsewhereAsB());
    }
    if (routineReread) {
      await vi.waitFor(() => expect(sessions[sessions.length - 1]).toBe("a"));
      // The cookies now name B, and nothing says so. The tab comes back into
      // focus after A's answer has expired and reads the session again.
      server.account = "b";
      server.holdSessionAnswers = true;
      const realNow = Date.now();
      const clock = vi.spyOn(Date, "now").mockReturnValue(realNow + 60_000);
      await act(async () => window.dispatchEvent(new Event("focus")));
      clock.mockRestore();
      expect(server.heldSessionAnswers).toHaveLength(1);
      // The page's reads go out while that reread is out.
      await act(async () => {
        startReads();
        openPageNow();
        await tick();
      });
      await act(async () => {
        server.holdSessionAnswers = false;
        for (const release of server.heldSessionAnswers.splice(0)) release();
        await tick();
      });
    }
    if (change === "to B's embed token with no session fetch") {
      await vi.waitFor(() =>
        expect(shown[shown.length - 1]).toEqual({
          account: "a",
          title: "a's page",
          draft: "a's draft",
          fetched: true,
        }),
      );
      // The embed runtime signs the page's requests from now on and says so;
      // nothing asks for the session.
      await act(async () => {
        vi.stubGlobal("fetch", server.bearerFetch);
        window.dispatchEvent(new Event(TRANSPORT_CHANGED_EVENT));
        await tick();
      });
    }

    await vi.waitFor(() => {
      expect(shown[shown.length - 1]).toEqual({
        account: "b",
        title: "b's page",
        draft: "b's draft",
        fetched: true,
      });
      if (kind === "collection seed") {
        expect(table[table.length - 1]).toEqual({
          account: "b",
          rows: "b's collection",
        });
      }
    });
    return { shown, table, client };
  }

  const kinds: ReadKind[] = [
    "head read",
    "app read",
    "home-page prefetch",
    "collection seed",
  ];
  const changes: Switch[] = [
    "before the app code loads",
    "while the session read is out",
    "after the session read answered",
    "to B's embed token before the session read",
    "on a routine reread that discovers B",
    "to B's embed token with no session fetch",
  ];
  const cells = kinds.flatMap((kind) =>
    changes.map((change) => [kind, change] as const),
  );

  it.each(cells)("%s, switching %s", async (kind, change) => {
    const { shown, table, client } = await openPage(kind, change);

    // Under B's session, nothing A's is shown.
    for (const entry of shown.filter((each) => each.account === "b")) {
      expect(`${entry.title} ${String(entry.draft)}`).not.toContain("a's");
    }
    for (const entry of table.filter((each) => each.account === "b")) {
      expect(String(entry.rows)).not.toContain("a's");
    }
    // A's page never counts as the page this open fetched under B, nor B's
    // under A.
    for (const entry of shown) {
      if (entry.fetched && entry.title === "a's page") {
        expect(entry.account).not.toBe("b");
      }
      if (entry.fetched && entry.title === "b's page") {
        expect(entry.account).not.toBe("a");
      }
    }
    // Nothing A's is left where B's app reads.
    for (const query of client.getQueryCache().getAll()) {
      expect(JSON.stringify(query.state.data ?? null)).not.toContain("a's");
    }
  });
});
