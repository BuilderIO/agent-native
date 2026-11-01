// @vitest-environment happy-dom

import type { Document } from "@shared/api";
import { QueryClient, useQuery } from "@tanstack/react-query";
import { act } from "react";
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

const server = vi.hoisted(() => ({
  // The account the browser's cookies name when a request goes out.
  account: "a",
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

// The page as an account reads it.
function pageReadFor(account: string, includePreviewDraft = true) {
  const page = { id: "doc-1", title: `${account}'s page`, canEdit: true };
  return {
    document: includePreviewDraft
      ? {
          ...page,
          previewDraft: { editable: true, draft: `${account}'s draft` },
        }
      : page,
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

type ReadKind = "head read" | "app read" | "home-page prefetch";
type Switch =
  | "before the app code loads"
  | "while the session read is out"
  | "after the session read answered"
  | "to B's embed token before the session read";

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
    delete (window as { __agentNativeSessionBootstrapFetch?: unknown })
      .__agentNativeSessionBootstrapFetch;
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
      return null;
    }

    // The page's reads start: the load's own, or the home page's prefetch of
    // the page it likely reopens, which runs in the tree mounted hidden
    // behind the session gate.
    if (kind === "home-page prefetch") {
      startPageOpenDocumentReads(client, "doc-1", {});
    } else {
      startPageOpenDocumentReads(client, "doc-1", {}, { fromLoad: true });
    }
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
              <Page />
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

    await vi.waitFor(() => {
      expect(shown[shown.length - 1]).toEqual({
        account: "b",
        title: "b's page",
        draft: "b's draft",
        fetched: true,
      });
    });
    return { shown, client };
  }

  const kinds: ReadKind[] = ["head read", "app read", "home-page prefetch"];
  const changes: Switch[] = [
    "before the app code loads",
    "while the session read is out",
    "after the session read answered",
    "to B's embed token before the session read",
  ];
  const cells = kinds.flatMap((kind) =>
    changes.map((change) => [kind, change] as const),
  );

  it.each(cells)("%s, switching %s", async (kind, change) => {
    const { shown, client } = await openPage(kind, change);

    // Under B's session, nothing A's is shown.
    for (const entry of shown.filter((each) => each.account === "b")) {
      expect(`${entry.title} ${String(entry.draft)}`).not.toContain("a's");
    }
    // A's page never counts as the page this open fetched under B.
    for (const entry of shown) {
      if (entry.fetched && entry.title === "a's page") {
        expect(entry.account).not.toBe("b");
      }
    }
    // Nothing A's is left where B's app reads.
    for (const query of client.getQueryCache().getAll()) {
      expect(JSON.stringify(query.state.data ?? null)).not.toContain("a's");
    }
  });
});
