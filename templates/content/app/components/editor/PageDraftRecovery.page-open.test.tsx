// @vitest-environment happy-dom
//
// Runs recovery against the real draft reads a page open starts, with only the
// network faked, so adoption and fallback reads are exercised end to end.
import type { Document } from "@shared/api";
import {
  QueryClient,
  QueryClientProvider,
  useQuery,
} from "@tanstack/react-query";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter, Route, Routes } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const openAiHost = vi.hoisted(() => ({
  isOpenAiMcpAppHost: vi.fn(() => false),
  isOpenAiMcpDirectoryWidgetHost: vi.fn(() => false),
}));

const server = vi.hoisted(() => ({
  calls: [] as Array<{ name: string; params: unknown }>,
  draftResponse: { editable: true, draft: null } as unknown,
  mutate: vi.fn(),
  session: { email: "writer@example.test", orgId: "org" } as {
    email: string;
    orgId: string;
  } | null,
}));

vi.mock("@agent-native/core/client/agent-chat", async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import("@agent-native/core/client/agent-chat")
    >();
  return { ...actual, isOpenAiMcpAppHost: openAiHost.isOpenAiMcpAppHost };
});
vi.mock("@agent-native/core/client/mcp-app-host", async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import("@agent-native/core/client/mcp-app-host")
    >();
  return { ...actual, ...openAiHost };
});
vi.mock("@agent-native/core/client/hooks", () => {
  const callAction = (name: string, params: unknown) => {
    server.calls.push({ name, params });
    return Promise.resolve(
      name === "get-preview-document-draft"
        ? server.draftResponse
        : { id: "page", title: "Saved", content: "Saved body", canEdit: true },
    );
  };
  return {
    callAction,
    getBrowserTabId: () => "tab-1",
    useDbSync: vi.fn(),
    useSession: () => ({ session: server.session }),
    setClientAppState: vi.fn(() => Promise.resolve()),
    useActionMutation: () => ({ mutate: vi.fn(), mutateAsync: server.mutate }),
    useActionQuery: (name: string, params: unknown, options: object) =>
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
vi.mock("react-router", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-router")>();
  return { ...actual, useNavigate: () => vi.fn() };
});
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/components/editor/DocumentEditor", async () => {
  const React = await import("react");
  const { TooltipProvider } = await import("@/components/ui/tooltip");
  const { VisualEditor } = await import("./VisualEditor");
  const { usePageOpenDocument } = await import("@/hooks/use-documents");
  const { PageDraftRecovery } = await import("./PageDraftRecovery");
  return {
    DocumentEditor: ({ documentId }: { documentId: string }) => {
      const { query } = usePageOpenDocument(documentId, {});
      const document = query.data;
      if (!document) return null;
      return React.createElement(PageDraftRecovery, {
        document,
        children: React.createElement(
          TooltipProvider,
          null,
          React.createElement(VisualEditor, {
            content: document.content,
            editable: false,
            onChange: () => {},
          }),
        ),
      });
    },
  };
});
vi.mock("@/components/QueryErrorState", () => ({
  QueryErrorState: () => createElement("div", { "data-testid": "error" }),
}));
vi.mock("./DocumentEditorSkeleton", () => ({
  DocumentEditorSkeleton: () =>
    createElement("div", { "data-testid": "editor-skeleton" }),
}));

import { contentSyncInvalidatePredicate } from "@/hooks/use-db-sync";
import { startPageOpenDocumentReads } from "@/hooks/use-documents";

import DocumentPage from "../../routes/_app.page.$id";
import { PageDraftRecovery } from "./PageDraftRecovery";

const page = {
  id: "page",
  title: "Saved",
  content: "Saved body",
  updatedAt: "v2",
  revision: "saved-body-revision",
  canEdit: true,
} as Document;

const draftQueryKey = [
  "action",
  "get-preview-document-draft",
  { documentId: "page" },
] as const;

const draftReads = () =>
  server.calls.filter((call) => call.name === "get-preview-document-draft")
    .length;

function createMemoryStorage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() {
      return values.size;
    },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => values.delete(key),
    setItem: (key, value) => values.set(key, String(value)),
  };
}

describe("Page draft recovery on a page open", () => {
  let queryClient: QueryClient;
  let container: HTMLDivElement;
  let root: Root;
  let originalWindowStorage: PropertyDescriptor | undefined;

  const render = async () => {
    await act(async () => {
      root.render(
        createElement(
          QueryClientProvider,
          { client: queryClient },
          createElement(PageDraftRecovery, {
            document: page,
            children: createElement("textarea", {
              defaultValue: "Live editor",
            }),
          }),
        ),
      );
    });
  };

  const earlyDraftReadLanded = () =>
    vi.waitFor(() =>
      expect(queryClient.getQueryState(draftQueryKey)?.status).toBe("success"),
    );

  beforeEach(() => {
    (
      globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    server.calls = [];
    server.draftResponse = { editable: true, draft: null };
    server.mutate.mockReset();
    server.mutate.mockReturnValue(new Promise(() => {}));
    server.session = { email: "writer@example.test", orgId: "org" };
    openAiHost.isOpenAiMcpAppHost.mockReturnValue(false);
    openAiHost.isOpenAiMcpDirectoryWidgetHost.mockReturnValue(false);
    originalWindowStorage = Object.getOwnPropertyDescriptor(
      window,
      "localStorage",
    );
    const storage = createMemoryStorage();
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      value: storage,
    });
    vi.stubGlobal("localStorage", storage);
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response("{}", {
            status: 200,
            headers: { "content-type": "application/json" },
          }),
      ),
    );
    // Mirrors the app's query client, whose reads stay fresh for 30s.
    queryClient = new QueryClient({
      defaultOptions: { queries: { staleTime: 30_000 } },
    });
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    queryClient.clear();
    vi.unstubAllGlobals();
    if (originalWindowStorage) {
      Object.defineProperty(window, "localStorage", originalWindowStorage);
    } else {
      Reflect.deleteProperty(window, "localStorage");
    }
  });

  it("releases the editor on the draft read started with the page", async () => {
    startPageOpenDocumentReads(queryClient, "page");
    await earlyDraftReadLanded();

    await render();

    await vi.waitFor(() =>
      expect(container.querySelector("textarea")).not.toBeNull(),
    );
    expect(draftReads()).toBe(1);
  });

  it("reads the draft once itself when the page open started no read", async () => {
    await render();

    await vi.waitFor(() =>
      expect(container.querySelector("textarea")).not.toBeNull(),
    );
    expect(draftReads()).toBe(1);
  });

  it("does not release the editor when the reader can no longer edit", async () => {
    server.draftResponse = { editable: false, draft: null };
    startPageOpenDocumentReads(queryClient, "page");
    await earlyDraftReadLanded();

    await render();

    await vi.waitFor(() =>
      expect(container.querySelector('[data-testid="error"]')).not.toBeNull(),
    );
    expect(container.querySelector("textarea")).toBeNull();
  });

  it("recovers a draft another tab wrote after the early read instead of releasing on the stale read", async () => {
    startPageOpenDocumentReads(queryClient, "page");
    await earlyDraftReadLanded();
    server.draftResponse = {
      editable: true,
      draft: {
        documentId: "page",
        title: "Saved",
        content: "Unsaved words",
        baseDocumentUpdatedAt: "v2",
        loadedContentWasEmpty: 0,
        deferredReason: "conflict",
        editorSessionId: "tab:other",
        editGeneration: 3,
        version: 1,
        updatedAt: "v3",
      },
    };
    const predicate = contentSyncInvalidatePredicate(queryClient, "/home");
    await queryClient.invalidateQueries(
      {
        predicate: (query) =>
          predicate(query, [
            { source: "action", key: "update-preview-document-draft" },
          ]),
      },
      { cancelRefetch: false },
    );

    await render();

    await vi.waitFor(() => expect(server.mutate).toHaveBeenCalled());
    expect(server.mutate).toHaveBeenCalledWith(
      expect.objectContaining({ id: "page", content: "Unsaved words" }),
    );
    expect(container.querySelector("textarea")).toBeNull();
    expect(draftReads()).toBe(2);
  });

  it("paints the scoped document body on /page/:id without a cookie session", async () => {
    openAiHost.isOpenAiMcpDirectoryWidgetHost.mockReturnValue(true);
    openAiHost.isOpenAiMcpAppHost.mockReturnValue(true);
    server.session = null;
    startPageOpenDocumentReads(queryClient, "page");

    await act(async () => {
      root.render(
        createElement(
          QueryClientProvider,
          { client: queryClient },
          createElement(
            MemoryRouter,
            {
              initialEntries: [
                "/page/page?__an_mcp_chat_bridge=1&embedded=1&__an_embed_token=scoped-ticket&__an_mcp_directory_widget=1",
              ],
            },
            createElement(
              Routes,
              null,
              createElement(Route, {
                path: "/page/:id",
                element: createElement(DocumentPage),
              }),
            ),
          ),
        ),
      );
    });

    await vi.waitFor(() =>
      expect(container.querySelector(".ProseMirror")?.textContent).toBe(
        "Saved body",
      ),
    );
    expect(
      container.querySelector('[data-testid="editor-skeleton"]'),
    ).toBeNull();
    expect(server.session).toBeNull();
    expect(server.calls).toContainEqual({
      name: "get-document",
      params: { id: "page" },
    });
    expect(draftReads()).toBe(0);
  });
});
