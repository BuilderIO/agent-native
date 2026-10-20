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
  readAppState: vi.fn(),
  compareAppState: vi.fn(),
  onSyncEvent: null as
    | ((event: { source: string; key: string }) => void)
    | null,
}));

vi.mock("@agent-native/core/client/application-state", () => ({
  readClientAppState: fixture.readAppState,
  compareAndSetClientAppState: fixture.compareAppState,
}));

vi.mock("@agent-native/core/client/hooks", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@agent-native/core/client/hooks")>()),
  useSession: () => ({
    session: { email: "writer@example.test", orgId: "org" },
  }),
  useDbSync: (options: { onEvent?: typeof fixture.onSyncEvent }) => {
    if (options.onEvent) fixture.onSyncEvent = options.onEvent;
  },
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
    ydoc: fixture.awareness?.doc ?? null,
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
vi.mock("@/hooks/use-content-database", async (original) => ({
  ...(await original<typeof import("@/hooks/use-content-database")>()),
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

import { createBlockFieldSaveController } from "./blockFieldSaveController";
import {
  acquireBlockFieldSaveController,
  __resetBlockFieldSaveRegistry,
} from "./blockFieldSaveRegistry";
import { PageEditorSurface } from "./DocumentEditor";

let root: Root;
let container: HTMLDivElement;
let queryClient: QueryClient;
let ydoc: Y.Doc;

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, options?: RequestInit) => {
      if (String(url).includes("/_agent-native/application-state/")) {
        if (options?.method === "PATCH") {
          const { expected, next } = JSON.parse(options.body as string);
          const changed = await fixture.compareAppState(
            String(url).split("/").pop(),
            expected,
            next,
          );
          return new Response(JSON.stringify({ changed }));
        }
        return new Response(
          JSON.stringify(
            await fixture.readAppState(String(url).split("/").pop()),
          ),
        );
      }
      return new Response("{}");
    }),
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
  fixture.readAppState.mockReset().mockResolvedValue(null);
  fixture.compareAppState.mockReset().mockResolvedValue(true);
  fixture.onSyncEvent = null;
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
  __resetBlockFieldSaveRegistry();
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

function flushRequest(
  phase: "prepare" | "verify",
  prepareToken = "prepare-one",
  propertyId?: string,
) {
  const state = fixture.awareness!.getLocalState()!;
  return {
    protocol: 2,
    id: fixture.page!.id,
    requestId: "fresh-request",
    phase,
    phaseToken: phase === "prepare" ? prepareToken : "verify-after-capture",
    prepareToken,
    ...(propertyId ? { propertyId } : {}),
    expiresAt: Date.now() + 4000,
    targets: [
      {
        clientId: fixture.awareness!.clientID,
        editorSessionId: state.editorSessionId,
      },
    ],
  };
}

async function deliver(request: ReturnType<typeof flushRequest>) {
  fixture.readAppState.mockResolvedValue(request);
  await act(async () => {
    fixture.onSyncEvent!({
      source: "app-state",
      key: `flush-request-${fixture.page!.id}`,
    });
  });
}

function publishedAcks() {
  return fixture.compareAppState.mock.calls
    .filter(([key, , next]) => key.startsWith("flush-ack-") && next !== null)
    .map((call) => call[2]);
}

function acknowledgeCurrentSaves() {
  fixture.save.mockImplementation(async (input) => {
    fixture.page = {
      ...fixture.page!,
      title: input.title ?? fixture.page!.title,
      content: input.content ?? fixture.page!.content,
      revision: "r2",
      updatedAt: "2026-10-19T12:00:01.000Z",
    };
    return fixture.page;
  });
}

it("prepares and verifies a previously edited settled editor with its persistence controller registered", async () => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  acknowledgeCurrentSaves();
  await act(async () => renderEditor());
  act(() => fixture.editor!.onChange("Edited and saved body"));
  await act(async () => vi.advanceTimersByTimeAsync(500));
  expect(fixture.page!.content).toBe("Edited and saved body");
  expect(fixture.awareness!.getLocalState()?.unsavedEdits).toBe(false);
  const flushLatest = vi.fn(
    async () =>
      (await fixture.editor!.onSaveContent!("Edited and saved body")) !==
      "failed",
  );
  act(() =>
    fixture.editor!.onPersistenceControllerChange!({
      flushLatest,
      version: {},
    }),
  );
  await deliver(flushRequest("prepare", "settled-prepare"));
  expect(publishedAcks()[0]).toMatchObject({
    status: "prepared",
    claim: { kind: "document", save: { revision: "r2" } },
  });
  await deliver(flushRequest("verify", "settled-prepare"));
  expect(publishedAcks()[1]).toMatchObject({
    status: "verified",
    stabilityToken: publishedAcks()[0].stabilityToken,
  });
  expect(flushLatest).toHaveBeenCalledOnce();
});

it("flushes un-emitted visual input, changes the first prepare, then prepares and verifies a stable retry", async () => {
  acknowledgeCurrentSaves();
  await act(async () => renderEditor());
  const flushLatest = vi.fn(
    async () =>
      (await fixture.editor!.onSaveContent!("Not yet emitted visual body")) !==
      "failed",
  );
  act(() =>
    fixture.editor!.onPersistenceControllerChange!({
      flushLatest,
      version: {},
    }),
  );
  await deliver(flushRequest("prepare", "changed-first"));
  expect(publishedAcks()[0]).toHaveProperty("status", "changed");
  expect(fixture.page!.content).toBe("Not yet emitted visual body");
  expect(fixture.awareness!.getLocalState()?.unsavedEdits).toBe(false);
  await deliver(flushRequest("prepare", "stable-retry"));
  expect(publishedAcks()[1]).toHaveProperty("status", "prepared");
  await deliver(flushRequest("verify", "stable-retry"));
  expect(publishedAcks()[2]).toMatchObject({
    status: "verified",
    stabilityToken: publishedAcks()[1].stabilityToken,
  });
  expect(flushLatest).toHaveBeenCalledTimes(2);
});

it("publishes a fresh per-client prepare and verify for an unchanged mounted editor", async () => {
  await act(async () => renderEditor());
  const request = flushRequest("prepare");
  await deliver(request);
  expect(publishedAcks()).toHaveLength(1);
  expect(publishedAcks()[0]).toMatchObject({
    status: "prepared",
    clientId: fixture.awareness!.clientID,
    editorSessionId: request.targets[0]!.editorSessionId,
    claim: {
      kind: "document",
      save: { revision: fixture.page!.revision, title: fixture.page!.title },
    },
  });
  await deliver(flushRequest("verify"));
  expect(publishedAcks()).toHaveLength(2);
  expect(publishedAcks()[1]).toMatchObject({
    status: "verified",
    stabilityToken: publishedAcks()[0].stabilityToken,
    phaseToken: "verify-after-capture",
  });
});

it("refuses stale success when second body and title edits arrive across a mounted save await", async () => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  let acknowledge!: (document: Document) => void;
  fixture.save.mockReturnValue(
    new Promise<Document>((resolve) => {
      acknowledge = resolve;
    }),
  );
  await act(async () => renderEditor());
  act(() => fixture.editor!.onChange("First input"));
  await deliver(flushRequest("prepare"));
  expect(fixture.save).toHaveBeenCalledOnce();
  act(() => fixture.editor!.onChange("Later input during save"));
  act(() => {
    const title = container.querySelector<HTMLTextAreaElement>(
      'textarea[aria-label="editor.documentTitle"]',
    )!;
    title.setSelectionRange(0, title.value.length);
    const paste = new Event("paste", { bubbles: true, cancelable: true });
    Object.defineProperty(paste, "clipboardData", {
      value: { getData: () => "Later title during save" },
    });
    title.dispatchEvent(paste);
  });
  expect(container.querySelector<HTMLTextAreaElement>("textarea")!.value).toBe(
    "Later title during save",
  );
  await act(async () =>
    acknowledge({
      ...fixture.page!,
      content: "First input",
      revision: "r2",
      updatedAt: "2026-10-19T12:00:01.000Z",
    }),
  );
  expect(publishedAcks().every((ack) => ack.status !== "prepared")).toBe(true);
  expect(
    fixture.compareAppState.mock.calls.some(
      ([, , next]) => next?.status === "success",
    ),
  ).toBe(false);
  expect(fixture.awareness!.getLocalState()?.unsavedEdits).toBe(true);
  await act(async () => vi.advanceTimersByTimeAsync(500));
  expect(fixture.save).toHaveBeenLastCalledWith(
    expect.objectContaining({
      content: "Later input during save",
      title: "Later title during save",
    }),
  );
});

it("rejects post-capture verification when local input follows its prepare acknowledgment", async () => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  await act(async () => renderEditor());
  await deliver(flushRequest("prepare"));
  expect(publishedAcks()[0]).toHaveProperty("status", "prepared");
  act(() => fixture.editor!.onChange("Input before verify"));
  await deliver(flushRequest("verify"));
  expect(publishedAcks()[publishedAcks().length - 1]).toHaveProperty(
    "status",
    "changed",
  );
  expect(fixture.awareness!.getLocalState()?.unsavedEdits).toBe(true);
});

it("cannot promote a held save into a prepared claim before expiry", async () => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  fixture.save.mockReturnValue(new Promise(() => {}));
  await act(async () => renderEditor());
  act(() => fixture.editor!.onChange("Held input"));
  await deliver(flushRequest("prepare"));
  expect(fixture.save).toHaveBeenCalledOnce();
  expect(publishedAcks()).toHaveLength(0);
  await act(async () => vi.advanceTimersByTimeAsync(4000));
  expect(publishedAcks()).toHaveLength(0);
  expect(fixture.awareness!.getLocalState()?.unsavedEdits).toBe(true);
});

it("confirms an exact additional field independently of a dirty primary body and invalidates later field input", async () => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  await act(async () => renderEditor());
  const fieldSave = vi.fn(async () => {});
  const controller = acquireBlockFieldSaveController(
    `${fixture.page!.id}:notes`,
    () =>
      createBlockFieldSaveController({
        initialContent: "Saved additional field",
        save: fieldSave,
      }),
  );
  act(() => fixture.editor!.onChange("Unrelated dirty primary body"));
  await deliver(flushRequest("prepare", "field-prepare", "notes"));
  await act(async () => {
    await vi.waitFor(() => expect(publishedAcks()).toHaveLength(1), {
      interval: 1,
      timeout: 300,
    });
  });
  expect(publishedAcks()[0]).toMatchObject({
    status: "prepared",
    claim: {
      kind: "property",
      propertyId: "notes",
      contentHash: expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
    },
  });
  expect(fixture.save).not.toHaveBeenCalled();
  expect(fieldSave).not.toHaveBeenCalled();
  controller.change("New additional field input");
  await deliver(flushRequest("verify", "field-prepare", "notes"));
  expect(publishedAcks()[publishedAcks().length - 1]).toHaveProperty(
    "status",
    "changed",
  );
  expect(fixture.awareness!.getLocalState()?.unsavedEdits).toBe(true);
  controller.cancel();
});

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
