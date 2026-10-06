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
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const server = vi.hoisted(() => ({
  calls: [] as Array<{ name: string; params: unknown }>,
  draftResponse: { editable: true, draft: null } as unknown,
  mutate: vi.fn(),
}));

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
    useSession: () => ({
      session: { email: "writer@example.test", orgId: "org" },
    }),
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
vi.mock("react-router", () => ({ useNavigate: () => vi.fn() }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/components/QueryErrorState", () => ({
  QueryErrorState: () => createElement("div", { "data-testid": "error" }),
}));
vi.mock("./DocumentEditorSkeleton", () => ({
  DocumentEditorSkeleton: () =>
    createElement("div", { "data-testid": "editor-skeleton" }),
}));

import { contentSyncInvalidatePredicate } from "@/hooks/use-db-sync";
import { startPageOpenDocumentReads } from "@/hooks/use-documents";

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

describe("Page draft recovery on a page open", () => {
  let queryClient: QueryClient;
  let container: HTMLDivElement;
  let root: Root;

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
    localStorage.clear();
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
});
