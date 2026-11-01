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

// A page is opened, left, and opened again after the session's answer has
// aged out, so the session is read again while the page's reads are out. That
// read finds the same account, but over another transport than the one the
// tab accepted (a fetch wrapper installed since then without a transport
// mark, as the demo-mode wrapper was), so the open's reads are dropped as not
// this session's and read again. The page's component was already watching
// them: the reads made again must still count as this open's, and the page
// shows. (Its comments and suggestions are then read by the editor itself.)

const SESSION_PATH = "/_agent-native/auth/session";
const PAGE_READ_URL = "/_agent-native/actions/get-document";

const server = vi.hoisted(() => ({
  account: "a",
  sessionReads: [] as string[],
  calls: [] as string[],
  heldSessionReads: [] as Array<() => void>,
  holdSessionReads: false,
}));

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
    server.calls.push(name);
    if (name === "get-preview-document-draft") {
      return Promise.resolve({ editable: true, draft: null });
    }
    if (name !== "get-document") return Promise.resolve([]);
    const page = { id: params.id, title: "a's page", canEdit: true };
    return Promise.resolve(
      params.includePreviewDraft
        ? { ...page, previewDraft: { editable: true, draft: null } }
        : page,
    );
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

async function serverFetch(input: RequestInfo | URL): Promise<Response> {
  const url = String(input instanceof Request ? input.url : input);
  if (url.includes(SESSION_PATH)) {
    if (server.holdSessionReads) {
      await new Promise<void>((resolve) =>
        server.heldSessionReads.push(resolve),
      );
    }
    server.sessionReads.push(server.account);
    return json({ email: "a@example.test", userId: server.account });
  }
  if (url.includes(PAGE_READ_URL)) {
    return json({
      id: "doc-1",
      title: "a's page",
      canEdit: true,
      previewDraft: { editable: true, draft: null },
    });
  }
  return json({});
}

const flush = () =>
  act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

describe("an open whose reads are dropped after its page is watching them", () => {
  let container: HTMLDivElement;
  let root: Root | null;

  beforeEach(() => {
    (
      globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    server.account = "a";
    server.sessionReads = [];
    server.calls = [];
    server.heldSessionReads = [];
    server.holdSessionReads = false;
    window.history.replaceState(null, "", "/page/doc-1");
    document.cookie = "an_session_hint=1; path=/";
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
    document.cookie = "an_session_hint=; path=/; max-age=0";
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("shows the page once the reads made again land", async () => {
    const { getSsrSessionBootstrapScriptBody } =
      await import("@agent-native/core/shared/ssr-session-bootstrap");
    const { startupPageReadScript } = await import("../lib/page-open-reads");
    const headScripts = [
      getSsrSessionBootstrapScriptBody(SESSION_PATH),
      startupPageReadScript(PAGE_READ_URL),
    ];
    vi.resetModules();
    for (const script of headScripts) new Function(script)();
    await new Promise((resolve) => setTimeout(resolve, 0));

    const { useSession } =
      await import("@agent-native/core/client/use-session");
    const { RequireSession } = await import("@agent-native/toolkit/app/auth");
    const { startPageOpenDocumentReads, usePageOpenDocument } =
      await import("./use-documents");

    const queryClient = new QueryClient();
    const shown: boolean[] = [];
    const lastShown = () => shown[shown.length - 1];
    function Page() {
      useSession();
      const { query, fetchedForThisOpen } = usePageOpenDocument("doc-1", {});
      const page = query.data as Document | undefined;
      shown.push(Boolean(page) && !query.isError && fetchedForThisOpen);
      return null;
    }
    const app = createRoot(container);
    root = app;
    const renderPage = (open: boolean) =>
      act(async () => {
        app.render(
          <QueryClientProvider client={queryClient}>
            <RequireSession redirect={false}>
              {open ? <Page /> : null}
            </RequireSession>
          </QueryClientProvider>,
        );
      });

    // The load opens the page; it shows.
    startPageOpenDocumentReads(queryClient, "doc-1", {}, { fromLoad: true });
    await renderPage(true);
    await vi.waitFor(() => expect(lastShown()).toBe(true));

    // The page is left. By the time it is opened again the session's answer
    // has aged out, and requests go out through a fetch wrapper the session
    // was not read through.
    await renderPage(false);
    vi.spyOn(Date, "now").mockReturnValue(Date.now() + 60_000);
    const pageFetch = globalThis.fetch;
    vi.stubGlobal("fetch", ((...args: Parameters<typeof fetch>) =>
      pageFetch(...args)) as typeof fetch);
    server.holdSessionReads = true;
    server.calls = [];

    startPageOpenDocumentReads(queryClient, "doc-1", {});
    await renderPage(true);
    await flush();
    await vi.waitFor(() => expect(server.heldSessionReads).toHaveLength(1));
    // Nothing shows, and no review read goes out, until the session answers.
    expect(lastShown()).toBe(false);
    expect(server.calls).not.toContain("list-comments");

    server.holdSessionReads = false;
    await act(async () => {
      server.heldSessionReads.shift()?.();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    await flush();

    expect(server.sessionReads[server.sessionReads.length - 1]).toBe("a");
    await vi.waitFor(() => expect(lastShown()).toBe(true));
    expect(server.calls).toContain("get-document");
    queryClient.clear();
  });
});
