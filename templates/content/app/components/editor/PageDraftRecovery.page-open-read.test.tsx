// @vitest-environment happy-dom
//
// A visited page draws its editor from its cached read at once, so the
// recovery mounts in the same commit as the editor surface. Its draft check
// then starts before the surface's page-open draft read, which replaces the
// read in flight. Real React Query and real draft reads: the check must
// follow the replacement, not report the page as failed.
import type { Document } from "@shared/api";
import {
  QueryClient,
  QueryClientProvider,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { act, useEffect, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const server = vi.hoisted(() => ({
  draftReads: [] as Array<(answer: unknown) => void>,
}));

vi.mock("@agent-native/core/client/agent-chat", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("@agent-native/core/client/agent-chat")
  >()),
  isOpenAiMcpAppHost: () => false,
}));
vi.mock("@agent-native/core/client/host", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@agent-native/core/client/host")>()),
  isEmbedMcpChatBridgeActive: () => false,
}));
vi.mock("@agent-native/core/client/hooks", () => {
  // Each draft read waits for the test to answer it.
  const callAction = (name: string) =>
    name === "get-preview-document-draft"
      ? new Promise((resolve) => server.draftReads.push(resolve))
      : Promise.resolve({});
  return {
    callAction,
    getBrowserTabId: () => "tab-1",
    useDbSync: vi.fn(),
    useSession: () => ({
      session: { email: "writer@example.test", orgId: "org" },
    }),
    useActionMutation: (name: string, options: object = {}) =>
      useMutation({ ...options, mutationFn: () => callAction(name) }),
    useActionQuery: (name: string, params: unknown, options: object) =>
      useQuery({
        queryKey: ["action", name, params],
        queryFn: () => callAction(name),
        ...options,
      }),
  };
});
vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string) => key,
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/components/QueryErrorState", () => ({
  QueryErrorState: () => <div data-testid="query-error" />,
}));
vi.mock("./RecoveryComparison", () => ({ RecoveryComparison: () => null }));
vi.mock("./DocumentEditorSkeleton", () => ({
  DocumentEditorSkeleton: () => <div data-testid="editor-skeleton" />,
}));
vi.mock("./page-draft-journal", () => ({
  liveDraftWriterIds: async () => new Set<string>(),
  readPageDraftJournal: () => null,
  listPageDraftJournal: () => [],
  sweepLegacyRetainedPageDraftMarkers: () => undefined,
  clearPageDraftJournal: () => true,
  writePageDraftJournal: () => undefined,
}));

import { startPreviewDocumentDraftRead } from "@/hooks/use-documents";

import { PageDraftRecovery } from "./PageDraftRecovery";

const page = {
  id: "page",
  title: "Plan",
  content: "Saved body",
  canEdit: true,
  updatedAt: "2026-01-01T00:00:00.000Z",
  createdAt: "2026-01-01T00:00:00.000Z",
} as Document;

// Starts the page-open draft read in its own effect, after its children's, as
// the editor surface does.
function Surface({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  useEffect(() => {
    startPreviewDocumentDraftRead(queryClient, page.id, page);
  }, [queryClient]);
  return children;
}

describe("Page draft recovery on a page drawn from its cached read", () => {
  let root: Root;
  let container: HTMLDivElement;
  let queryClient: QueryClient;

  beforeEach(() => {
    (
      globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    server.draftReads = [];
    queryClient = new QueryClient();
    // The last visit's read found no draft.
    queryClient.setQueryData(
      ["action", "get-preview-document-draft", { documentId: page.id }],
      { editable: true, draft: null },
      { updatedAt: Date.now() - 60_000 },
    );
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    queryClient.clear();
  });

  it("follows the page-open read that replaces its draft check, keeping the editor", async () => {
    await act(async () =>
      root.render(
        <MemoryRouter>
          <QueryClientProvider client={queryClient}>
            <Surface>
              <PageDraftRecovery document={page} documentFresh={false}>
                <textarea defaultValue="Live editor" />
              </PageDraftRecovery>
            </Surface>
          </QueryClientProvider>
        </MemoryRouter>,
      ),
    );
    // The check's read was replaced; the page-open read is the one in flight.
    expect(server.draftReads).toHaveLength(2);
    expect(container.querySelector('[data-testid="query-error"]')).toBeNull();
    expect(container.querySelector("textarea")).not.toBeNull();

    await act(async () =>
      server.draftReads[1]?.({ editable: true, draft: null }),
    );
    expect(container.querySelector('[data-testid="query-error"]')).toBeNull();
    expect(container.querySelector("textarea")).not.toBeNull();
    // No read beyond the replacement: the check took the page-open read.
    expect(server.draftReads).toHaveLength(2);
  });
});
