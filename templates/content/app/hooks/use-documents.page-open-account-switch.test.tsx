// @vitest-environment happy-dom

import type { Document } from "@shared/api";
import {
  QueryClient,
  QueryClientProvider,
  useQuery,
} from "@tanstack/react-query";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The head scripts read the session and the page with A's cookies. While the
// app code is still downloading, another tab signs in as B and broadcasts the
// session invalidation, before anything in this tab listens for it. The app
// code then arrives inside the head reads' freshness window. Nothing A's
// cookies read may be shown: not the session, the page, the draft, or the
// collection the page opens.

const SESSION_PATH = "/_agent-native/auth/session";
const PAGE_READ_URL = "/_agent-native/actions/get-page-open-read";
const INVALIDATION_KEY = "agent-native:session-invalidated";

const server = vi.hoisted(() => ({
  // The account the browser's cookies name when a request goes out.
  account: "a",
  sessionReads: [] as string[],
  calls: [] as Array<{ name: string; account: string }>,
}));

vi.mock("@agent-native/core/client/agent-chat", () => ({
  isOpenAiMcpAppHost: () => false,
}));
vi.mock("@agent-native/core/client/host", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@agent-native/core/client/host")>()),
  isEmbedMcpChatBridgeActive: () => false,
}));
const tableQuery = {
  search: "",
  filters: [],
  sorts: [],
  filterMode: "and" as const,
};

// The collection page as an account reads it.
function collectionFor(account: string) {
  const owner = `${account}'s collection`;
  return {
    database: { owner, items: [{ id: `${account}-row` }], properties: [] },
    personalView: { databaseId: "db-1", overrides: null, owner },
    rows: { tableQuery, page: { owner, items: [{ id: `${account}-row` }] } },
  };
}

vi.mock("@agent-native/core/client/hooks", () => {
  const callAction = (
    name: string,
    params: { id?: string; includePreviewDraft?: boolean },
  ): Promise<unknown> => {
    const account = server.account;
    server.calls.push({ name, account });
    if (name === "get-preview-document-draft") {
      return Promise.resolve({ editable: true, draft: `${account}'s draft` });
    }
    const page = { id: params.id, title: `${account}'s page`, canEdit: true };
    if (name === "get-page-open-read") {
      // The reader's draft comes back only when the read asks for it.
      return Promise.resolve({
        document: params.includePreviewDraft
          ? {
              ...page,
              previewDraft: { editable: true, draft: `${account}'s draft` },
            }
          : page,
        collection: collectionFor(account),
      });
    }
    if (name === "get-document") return Promise.resolve(page);
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

// Answers as whichever account the cookies name when the request goes out.
async function serverFetch(input: RequestInfo | URL): Promise<Response> {
  const url = String(input instanceof Request ? input.url : input);
  const account = server.account;
  if (url.includes(SESSION_PATH)) {
    server.sessionReads.push(account);
    return json({ email: `${account}@example.test`, userId: account });
  }
  if (url.includes(PAGE_READ_URL)) {
    return json({
      document: {
        id: "doc-1",
        title: `${account}'s page`,
        canEdit: true,
        previewDraft: { editable: true, draft: `${account}'s draft` },
      },
      collection: collectionFor(account),
    });
  }
  return json({});
}

type Shown = {
  account: string | undefined;
  title: string | undefined;
  draft: unknown;
};

describe("an account switch in another tab while the app code downloads", () => {
  let container: HTMLDivElement;
  let root: Root | null;

  beforeEach(() => {
    (
      globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    server.account = "a";
    server.sessionReads = [];
    server.calls = [];
    window.history.replaceState(null, "", "/page/doc-1");
    document.cookie = "an_session_hint=1; path=/";
    window.localStorage.setItem(INVALIDATION_KEY, "earlier-sign-in");
    vi.stubGlobal("fetch", vi.fn(serverFetch));
    container = document.createElement("div");
    document.body.append(container);
    root = null;
  });

  afterEach(() => {
    const mounted = root;
    if (mounted) act(() => mounted.unmount());
    container.remove();
    delete (window as { __agentNativeSessionBootstrap?: unknown })
      .__agentNativeSessionBootstrap;
    delete (window as { __contentStartupPageRead?: unknown })
      .__contentStartupPageRead;
    window.localStorage.removeItem(INVALIDATION_KEY);
    document.cookie = "an_session_hint=; path=/; max-age=0";
    vi.unstubAllGlobals();
  });

  it("rejects A's session, page, draft and collection, and reads them again as B", async () => {
    // The shell renders the head scripts; their source is generated on the
    // server, so take it and then start the client modules from scratch.
    const { getSsrSessionBootstrapScriptBody } =
      await import("@agent-native/core/shared/ssr-session-bootstrap");
    const { startupPageReadScript } = await import("../lib/page-open-reads");
    const headScripts = [
      getSsrSessionBootstrapScriptBody(SESSION_PATH),
      startupPageReadScript(PAGE_READ_URL),
    ];
    vi.resetModules();

    // The document head: both reads go out, and answer, with A's cookies.
    for (const script of headScripts) new Function(script)();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(server.sessionReads).toEqual(["a"]);

    // Another tab signs in as B and broadcasts. Nothing here listens yet.
    server.account = "b";
    window.localStorage.setItem(INVALIDATION_KEY, "signed-in-as-b");
    window.dispatchEvent(
      new StorageEvent("storage", {
        key: INVALIDATION_KEY,
        newValue: "signed-in-as-b",
      }),
    );

    // The app code arrives, well inside the head reads' freshness window.
    const { useSession } =
      await import("@agent-native/core/client/use-session");
    const { RequireSession } = await import("@agent-native/toolkit/app/auth");
    const { openingDatabaseQueryKey } =
      await import("../lib/page-open-collection");
    const {
      startPageOpenDocumentReads,
      usePageOpenDocument,
      usePreviewDocumentDraft,
    } = await import("./use-documents");

    const queryClient = new QueryClient();
    const cached: string[] = [];
    queryClient.getQueryCache().subscribe(() => {
      for (const query of queryClient.getQueryCache().getAll()) {
        cached.push(JSON.stringify(query.state.data ?? null));
      }
    });
    const shown: Shown[] = [];
    function Page() {
      const { session } = useSession();
      const { query } = usePageOpenDocument("doc-1", {});
      const drafts = usePreviewDocumentDraft("doc-1");
      shown.push({
        account: session?.userId,
        title: (query.data as Document | undefined)?.title,
        draft: (drafts.data as { draft?: unknown } | undefined)?.draft,
      });
      return null;
    }

    // What the load does when the app code runs, then the real session gate.
    startPageOpenDocumentReads(
      queryClient,
      "doc-1",
      {},
      { beforeSession: true },
    );
    const app = createRoot(container);
    root = app;
    await act(async () => {
      app.render(
        <QueryClientProvider client={queryClient}>
          <RequireSession redirect={false}>
            <Page />
          </RequireSession>
        </QueryClientProvider>,
      );
    });

    await vi.waitFor(() =>
      expect(shown[shown.length - 1]).toEqual({
        account: "b",
        title: "b's page",
        draft: "b's draft",
      }),
    );
    // The session the gate accepted is B's, read again after the broadcast.
    expect(server.sessionReads).toEqual(["a", "b"]);
    expect(shown.some((entry) => entry.account === "a")).toBe(false);
    expect(cached.join("\n")).not.toContain("a's");
    // The page and its draft come from one fresh read made as B.
    // Every page read since the switch went out as B.
    const pageReads = server.calls.filter(
      (call) =>
        call.name === "get-page-open-read" || call.name === "get-document",
    );
    expect(pageReads.length).toBeGreaterThan(0);
    expect(pageReads.every((call) => call.account === "b")).toBe(true);
    // None of A's collection is where the collection's table looks for it.
    for (const queryKey of [
      openingDatabaseQueryKey("doc-1"),
      ["action", "get-content-database-personal-view", { databaseId: "db-1" }],
      [
        "action",
        "query-content-database-items",
        { documentId: "doc-1", limit: 100, tableQuery },
      ],
    ]) {
      expect(
        JSON.stringify(queryClient.getQueryData(queryKey) ?? null),
      ).not.toContain("a's");
    }
    queryClient.clear();
  });
});
