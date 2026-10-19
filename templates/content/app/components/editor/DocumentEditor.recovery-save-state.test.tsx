// @vitest-environment happy-dom

import type { Document } from "@shared/api";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, createElement, type ComponentProps, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { Awareness } from "y-protocols/awareness";
import * as Y from "yjs";

import type { useDocumentReconcileRecovery } from "./useDocumentReconcileRecovery";
import type { VisualEditor } from "./VisualEditor";

const fixture = vi.hoisted(() => ({
  page: null as Document | null,
  awareness: null as Awareness | null,
  editor: null as ComponentProps<typeof VisualEditor> | null,
  recovery: null as ReturnType<typeof useDocumentReconcileRecovery> | null,
  save: vi.fn(),
  flushUpdates: vi.fn(),
  recoverySaveSettled: vi.fn(),
  finishRecovery: Promise.resolve(),
  t: (key: string) => key,
  mutation: { mutate: vi.fn(), mutateAsync: vi.fn() },
  emptyQuery: { data: undefined, isFetching: false, isError: false },
}));

vi.mock("@agent-native/core/client/hooks", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@agent-native/core/client/hooks")>()),
  useSession: () => ({
    session: { email: "writer@example.test", orgId: "org" },
  }),
  useDbSync: () => {},
  useAvatarUrl: () => undefined,
  callAction: vi.fn(async () => null),
  setClientAppState: vi.fn(async () => {}),
}));
vi.mock("@agent-native/core/client/i18n", () => ({ useT: () => fixture.t }));
vi.mock("@agent-native/core/client/feature-flags", () => ({
  useFeatureFlag: () => false,
}));
vi.mock("@agent-native/core/client/collab", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("@agent-native/core/client/collab")
  >()),
  useCollaborativeDoc: () => ({
    ydoc: null,
    awareness: fixture.awareness,
    isSynced: true,
    initialization: { status: "ready" },
    activeUsers: [],
    requestSync: vi.fn(),
    flushUpdates: fixture.flushUpdates,
  }),
}));
vi.mock("@agent-native/core/client/review", () => ({
  useResourceSuggestions: () => fixture.emptyQuery,
  useCreateResourceSuggestionProposal: () => fixture.mutation,
  useDecideResourceSuggestion: () => fixture.mutation,
  useDecideResourceSuggestionProposal: () => fixture.mutation,
  useUpdateResourceSuggestion: () => fixture.mutation,
}));
vi.mock("@agent-native/core/client/agent-chat", () => ({
  generateTabId: () => "recovery-tab",
}));
vi.mock("@agent-native/toolkit/app/blocks", () => ({
  BlockRegistryProvider: ({ children }: { children: ReactNode }) => children,
}));
vi.mock("@/blocks/contentBlockRegistry", () => ({
  contentBlockRegistry: {},
  createContentBlockRenderContext: () => ({}),
}));
vi.mock("@/hooks/use-documents", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/hooks/use-documents")>()),
  usePageOpenDocument: () => ({
    query: { data: fixture.page, dataUpdatedAt: 1 },
    fetchedForThisOpen: true,
    readsStartedEarly: true,
  }),
  useUpdateDocument: () => ({ mutateAsync: fixture.save }),
  useDeleteDocument: () => fixture.mutation,
  useResolvePreviewDocumentDraft: () => fixture.mutation,
  useUpdatePreviewDocumentDraft: () => fixture.mutation,
  useDocuments: () => fixture.emptyQuery,
  useContentNavigationContext: () => fixture.emptyQuery,
}));
vi.mock("@/hooks/use-content-spaces", () => ({
  useContentSpaces: () => fixture.emptyQuery,
}));
vi.mock("@/hooks/use-content-database", () => ({
  useDeleteContentDatabase: () => fixture.mutation,
  useProcessBuilderBodyHydration: () => fixture.mutation,
}));
vi.mock("@/hooks/use-content-recent", () => ({
  useRecordContentVisit: () => {},
}));
vi.mock("@/hooks/use-notion", () => ({
  useDocumentSyncStatus: () => fixture.emptyQuery,
  usePushDocumentToNotion: () => fixture.mutation,
  documentSyncStatusQueryKey: () => ["sync-status"],
}));
vi.mock("@/hooks/use-comments", () => ({
  useComments: () => fixture.emptyQuery,
}));
vi.mock("./comment-ai", () => ({
  useCommentAiRequests: () => ({ freshResolutions: new Map() }),
  isCommentAiWorkingOn: () => false,
}));
vi.mock("./CommentsSidebar", () => ({
  CommentsSidebar: () => null,
  preserveCommentReplyEscape: () => {},
  useCommentReplyDrafts: () => ({
    setOpenReply: vi.fn(),
    focus: { current: null },
  }),
  usePendingCommentDraft: () => ({ setPendingComment: vi.fn() }),
}));
vi.mock("./PageDraftRecovery", () => ({
  PageDraftRecovery: ({ children }: { children: ReactNode }) => children,
}));
vi.mock("./DocumentToolbar", () => ({ DocumentToolbar: () => null }));
vi.mock("./ContentImportDialog", () => ({ ContentImportDialog: () => null }));
vi.mock("./NotionConflictBanner", () => ({ NotionConflictBanner: () => null }));
vi.mock("./EmojiPicker", () => ({ EmojiPicker: () => null }));
vi.mock("./DocumentProperties", () => ({ DocumentProperties: () => null }));
vi.mock("./DocumentBlockFields", () => ({ DocumentBlockFields: () => null }));
vi.mock("./DocumentDatabase", () => ({ DocumentDatabase: () => null }));
vi.mock("./DocumentInfoPanel", () => ({ DocumentInfoPanel: () => null }));
vi.mock("./LinkedLocalDocumentAgentBridge", () => ({
  LinkedLocalDocumentAgentBridge: () => null,
}));
vi.mock("./DocumentReconcileRecovery", () => ({
  DocumentReconcileRecovery: () => null,
}));
vi.mock("./VisualEditor", () => ({
  VisualEditor: (props: ComponentProps<typeof VisualEditor>) => {
    fixture.editor = props;
    return null;
  },
}));
vi.mock("./useDocumentReconcileRecovery", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("./useDocumentReconcileRecovery")>();
  return {
    ...actual,
    useDocumentReconcileRecovery: (
      options: Parameters<typeof actual.useDocumentReconcileRecovery>[0],
    ) => {
      const recovery = actual.useDocumentReconcileRecovery({
        ...options,
        save: async (...args) => {
          const saved = await options.save(...args);
          fixture.recoverySaveSettled(saved);
          // Let acknowledgment-driven editor renders settle before recovery
          // clears, without depending on a later incidental query refresh.
          await fixture.finishRecovery;
          return saved;
        },
      });
      fixture.recovery = recovery;
      return recovery;
    },
  };
});

import { PageEditorSurface } from "./DocumentEditor";

let root: Root;
let container: HTMLDivElement;
let queryClient: QueryClient;
let ydoc: Y.Doc;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response("{}")),
  );
  fixture.page = {
    id: "recovery-page",
    title: "Saved title",
    content: "Saved body",
    revision: "r1",
    updatedAt: "2026-10-19T12:00:00.000Z",
    canEdit: true,
  } as Document;
  fixture.save.mockReset();
  fixture.flushUpdates.mockReset().mockResolvedValue(true);
  fixture.recoverySaveSettled.mockReset();
  fixture.finishRecovery = Promise.resolve();
  fixture.mutation.mutateAsync
    .mockReset()
    .mockImplementation(async (input) =>
      input.operation === "upsert"
        ? { status: "saved", draft: { ...input.draft, version: 1 } }
        : { status: "deleted", draft: null },
    );
  fixture.editor = null;
  fixture.recovery = null;
  ydoc = new Y.Doc();
  fixture.awareness = new Awareness(ydoc);
  fixture.awareness.setLocalState({ user: { email: "writer@example.test" } });
  queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  fixture.awareness!.destroy();
  ydoc.destroy();
  queryClient.clear();
  container.remove();
  vi.restoreAllMocks();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function renderEditor() {
  root.render(
    createElement(
      QueryClientProvider,
      { client: queryClient },
      createElement(
        MemoryRouter,
        null,
        createElement(PageEditorSurface, {
          documentId: fixture.page!.id,
          host: "preview",
        }),
      ),
    ),
  );
}

it("republishes an acknowledged save when recovery alone finishes", async () => {
  let acknowledge!: (document: Document) => void;
  fixture.save.mockReturnValue(
    new Promise<Document>((resolve) => {
      acknowledge = resolve;
    }),
  );
  let finishRecovery!: () => void;
  fixture.finishRecovery = new Promise<void>((resolve) => {
    finishRecovery = resolve;
  });
  await act(async () => renderEditor());
  expect(fixture.editor).not.toBeNull();
  expect(fixture.awareness!.getLocalState()?.unsavedEdits).toBe(false);

  act(() => fixture.recovery!.report("conflict", "Recovered body"));
  act(() => fixture.editor!.onChange("Recovered body"));
  let resolved!: Promise<boolean>;
  await act(async () => {
    resolved = fixture.recovery!.resolve({
      title: fixture.page!.title,
      content: fixture.page!.content,
      updatedAt: fixture.page!.updatedAt,
      revision: fixture.page!.revision,
    });
  });
  expect(fixture.save).toHaveBeenCalledOnce();
  expect(fixture.awareness!.getLocalState()).toMatchObject({
    unsavedEdits: true,
    savedRevision: null,
    savedTitle: null,
    savedTitleAt: null,
  });

  const acknowledged = {
    ...fixture.page!,
    content: "Recovered body",
    revision: "r2",
    updatedAt: "2026-10-19T12:00:01.000Z",
  };
  await act(async () => {
    acknowledge(acknowledged);
  });
  expect(fixture.recoverySaveSettled).toHaveBeenCalledWith(true);
  fixture.page = acknowledged;
  await act(async () => renderEditor());
  expect(fixture.recovery!.state?.saving).toBe(true);
  expect(fixture.awareness!.getLocalState()?.unsavedEdits).toBe(true);

  await act(async () => {
    finishRecovery();
    await resolved;
  });
  expect(await resolved).toBe(true);
  expect(fixture.recovery!.state).toBeNull();
  expect(fixture.awareness!.getLocalState()).toMatchObject({
    unsavedEdits: false,
    savedRevision: acknowledged.revision,
    savedTitle: acknowledged.title,
    savedTitleAt: acknowledged.updatedAt,
    user: { email: "writer@example.test" },
  });
});

it("republishes a newer acknowledged save when an obsolete retry is consumed", async () => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  fixture.flushUpdates.mockResolvedValueOnce(false);
  let acknowledge!: (document: Document) => void;
  fixture.save.mockReturnValue(
    new Promise<Document>((resolve) => {
      acknowledge = resolve;
    }),
  );
  await act(async () => renderEditor());
  const publish = vi.spyOn(fixture.awareness!, "setLocalState");
  const dirty = {
    unsavedEdits: true,
    savedRevision: null,
    savedTitle: null,
    savedTitleAt: null,
  };

  act(() => fixture.editor!.onChange("Old edit"));
  await act(async () => vi.advanceTimersByTimeAsync(500));
  expect(fixture.flushUpdates).toHaveBeenCalledOnce();
  expect(fixture.save).not.toHaveBeenCalled();
  expect(fixture.mutation.mutateAsync).toHaveBeenCalledWith(
    expect.objectContaining({
      operation: "upsert",
      draft: expect.objectContaining({
        content: "Old edit",
        deferredReason: null,
      }),
    }),
  );
  expect(fixture.awareness!.getLocalState()).toMatchObject(dirty);

  act(() => fixture.editor!.onChange("New acknowledged edit"));
  await act(async () => vi.advanceTimersByTimeAsync(500));
  expect(fixture.flushUpdates).toHaveBeenCalledTimes(2);
  expect(fixture.save).toHaveBeenCalledOnce();
  expect(fixture.awareness!.getLocalState()).toMatchObject(dirty);

  const acknowledged = {
    ...fixture.page!,
    content: "New acknowledged edit",
    revision: "r2",
    updatedAt: "2026-10-19T12:00:01.000Z",
  };
  await act(async () => acknowledge(acknowledged));
  fixture.page = acknowledged;
  await act(async () => renderEditor());
  expect(fixture.mutation.mutateAsync).toHaveBeenCalledWith(
    expect.objectContaining({ operation: "delete" }),
  );
  expect(fixture.recovery!.state).toBeNull();
  expect(fixture.awareness!.getLocalState()).toMatchObject(dirty);

  await act(async () => vi.advanceTimersByTimeAsync(299));
  expect(fixture.awareness!.getLocalState()).toMatchObject(dirty);
  expect(
    publish.mock.calls.every(([state]) => state?.unsavedEdits === true),
  ).toBe(true);
  publish.mockClear();
  await act(async () => vi.advanceTimersByTimeAsync(1));
  expect(fixture.flushUpdates).toHaveBeenCalledTimes(2);
  expect(fixture.save).toHaveBeenCalledOnce();
  expect(fixture.awareness!.getLocalState()).toMatchObject({
    unsavedEdits: false,
    savedRevision: acknowledged.revision,
    savedTitle: acknowledged.title,
    savedTitleAt: acknowledged.updatedAt,
    user: { email: "writer@example.test" },
  });
  expect(publish).toHaveBeenCalledOnce();
  publish.mockRestore();
});
