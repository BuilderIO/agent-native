// @vitest-environment happy-dom

import { createHash } from "node:crypto";

import type { Document, DocumentPropertiesResponse } from "@shared/api";
import { legacyBlocksFieldIdentity } from "@shared/blocks-field-identity";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { Editor } from "@tiptap/core";
import { act, createElement, type ComponentProps, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Awareness } from "y-protocols/awareness";
import * as Y from "yjs";

import type { PageEditorSession } from "./DocumentEditor";
import type { useDocumentReconcileRecovery } from "./useDocumentReconcileRecovery";
import type {
  VisualEditor,
  VisualEditorPersistenceController,
} from "./VisualEditor";

const fixture = vi.hoisted(() => ({
  page: null as Document | null,
  fields: null as DocumentPropertiesResponse | null,
  realAdditionalEditors: false,
  lockAdditionalForSuggestions: false,
  session: null as PageEditorSession | null,
  fieldEditor: null as Editor | null,
  fieldProps: null as ComponentProps<typeof VisualEditor> | null,
  fieldController: null as VisualEditorPersistenceController | null,
  fieldSave: vi.fn(),
  visualFlush: vi.fn(),
  onCollabEvent: null as
    | ((event: { source: string; key: string }) => void)
    | null,
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

vi.mock("./DocumentBlockFields", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./DocumentBlockFields")>();
  const React = await import("react");
  return {
    ...actual,
    DocumentBlockFields: (
      props: ComponentProps<typeof actual.DocumentBlockFields>,
    ) =>
      React.createElement(actual.DocumentBlockFields, {
        ...props,
        suggesting: fixture.lockAdditionalForSuggestions || props.suggesting,
      }),
  };
});

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
  useCollaborativeDoc: (options: {
    onEvent?: typeof fixture.onCollabEvent;
  }) => {
    fixture.onCollabEvent = options.onEvent ?? null;
    return {
      ydoc: fixture.awareness?.doc ?? null,
      awareness: fixture.awareness,
      isSynced: true,
      initialization: { status: "ready" },
      activeUsers: [],
      requestSync: vi.fn(),
      flushUpdates: fixture.flushUpdates,
    };
  },
}));
vi.mock("@agent-native/core/client/review", () => ({
  useResourceSuggestions: () => fixture.emptyQuery,
  useCreateResourceSuggestionProposal: () => fixture.mutation,
  useDecideResourceSuggestion: () => fixture.mutation,
  useDecideResourceSuggestionProposal: () => fixture.mutation,
  useUpdateResourceSuggestion: () => fixture.mutation,
}));
vi.mock("@agent-native/core/client/agent-chat", async (original) => ({
  ...(await original<typeof import("@agent-native/core/client/agent-chat")>()),
  generateTabId: () => "recovery-tab",
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
vi.mock("@/hooks/use-document-properties", async (original) => ({
  ...(await original<typeof import("@/hooks/use-document-properties")>()),
  useDocumentProperties: () => ({
    data: fixture.fields,
    isError: false,
    isRefetching: false,
  }),
  useConfigureDocumentProperty: () => fixture.mutation,
  useDeleteDocumentProperty: () => fixture.mutation,
  useReorderDocumentProperty: () => fixture.mutation,
  useSetDocumentProperty: () => ({ mutateAsync: fixture.fieldSave }),
}));
vi.mock("./DocumentDatabase", () => ({ DocumentDatabase: () => null }));
vi.mock("./DocumentInfoPanel", () => ({ DocumentInfoPanel: () => null }));
vi.mock("./LinkedLocalDocumentAgentBridge", () => ({
  LinkedLocalDocumentAgentBridge: () => null,
}));
vi.mock("./DocumentReconcileRecovery", () => ({
  DocumentReconcileRecovery: () => null,
}));
vi.mock("@tiptap/react", async (original) => {
  const actual = await original<typeof import("@tiptap/react")>();
  return {
    ...actual,
    useEditor: (...args: Parameters<typeof actual.useEditor>) => {
      const editor = actual.useEditor(...args);
      fixture.fieldEditor = editor;
      return editor;
    },
  };
});
vi.mock("./VisualEditor", async (original) => {
  const actual = await original<typeof import("./VisualEditor")>();
  const React = await import("react");
  function RealAdditionalEditor(props: ComponentProps<typeof VisualEditor>) {
    const current = React.useRef(props);
    current.current = props;
    fixture.fieldProps = props;
    const publish = React.useCallback(
      (next: VisualEditorPersistenceController | null) => {
        fixture.fieldController = next;
        current.current.onPersistenceControllerChange?.(next);
      },
      [],
    );
    return React.createElement(actual.VisualEditor, {
      ...props,
      onPersistenceControllerChange: publish,
    });
  }
  return {
    VisualEditor: (props: ComponentProps<typeof VisualEditor>) => {
      if (fixture.realAdditionalEditors && props.localFileMode)
        return React.createElement(RealAdditionalEditor, props);
      const primary = !props.localFileMode;
      const current = React.useRef(props);
      current.current = props;
      const draft = React.useRef(props.content);
      const version = React.useRef({}).current;
      if (primary)
        fixture.editor = {
          ...props,
          onChange: (content) => {
            draft.current = content;
            props.onChange(content);
          },
        };
      React.useEffect(() => {
        if (!props.onPersistenceControllerChange) return;
        props.onPersistenceControllerChange({
          version,
          flushLatest: async () => {
            if (primary) fixture.visualFlush(draft.current);
            const result = await current.current.onSaveContent!(draft.current);
            return result !== false && result !== "failed";
          },
        });
        return () => props.onPersistenceControllerChange!(null);
      }, [props.onPersistenceControllerChange, version]);
      return React.createElement("div", {
        "data-visual-body": primary ? "primary" : "additional",
      });
    },
  };
});
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

import { TooltipProvider } from "@/components/ui/tooltip";

import {
  __resetBlockFieldSaveRegistry,
  flushAllBlockFieldSaveControllersForDocument,
  peekBlockFieldSaveController,
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
  fixture.fields = null;
  fixture.realAdditionalEditors = false;
  fixture.lockAdditionalForSuggestions = false;
  fixture.session = null;
  fixture.fieldEditor = null;
  fixture.fieldProps = null;
  fixture.fieldController = null;
  fixture.fieldSave.mockReset().mockResolvedValue({});
  fixture.visualFlush.mockReset();
  fixture.onCollabEvent = null;
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
  const fieldEditor = fixture.fieldEditor;
  await act(async () => root.unmount());
  if (fieldEditor && !fieldEditor.isDestroyed) fieldEditor.destroy();
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
        createElement(
          TooltipProvider,
          null,
          createElement(PageEditorSurface, {
            documentId: fixture.page!.id,
            host: "preview",
            onSessionChange: (session) => {
              fixture.session = session;
            },
          }),
        ),
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
    expiresAt: Date.now() + 20_000,
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

function collectionFields() {
  fixture.page!.databaseMembership = {
    databaseId: "db-1",
    databaseDocumentId: "db-page",
    databaseTitle: "Collection",
    position: 0,
  };
  fixture.fields = {
    documentId: fixture.page!.id,
    databaseId: "db-1",
    canEditValues: true,
    canManageSchema: false,
    properties: ["content", "notes"].map((id, position) => ({
      definition: {
        id,
        databaseId: "db-1",
        name: id,
        type: "blocks",
        visibility: "always_show",
        options: { blocks: { primary: id === "content" } },
        position,
        createdAt: fixture.page!.updatedAt,
        updatedAt: fixture.page!.updatedAt,
      },
      value: id === "content" ? fixture.page!.content : "Additional body",
      editable: true,
      blocksField: legacyBlocksFieldIdentity({
        documentId: fixture.page!.id,
        propertyId: id,
        markdown: id === "content" ? fixture.page!.content : "Additional body",
      }),
    })),
  };
}

it("drains the current primary controller while another real field tab hides its panel", async () => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  collectionFields();
  acknowledgeCurrentSaves();
  await act(async () => renderEditor());
  act(() => fixture.editor!.onChange("Edited before hiding the primary tab"));
  await act(async () => vi.advanceTimersByTimeAsync(500));
  expect(fixture.page!.content).toBe("Edited before hiding the primary tab");
  const primary = container.querySelector<HTMLElement>(
    "[data-primary-block-field-panel]",
  )!;
  const primaryBody = primary.querySelector('[data-visual-body="primary"]');
  act(() =>
    container
      .querySelector<HTMLButtonElement>(
        '[role="tab"][data-block-field-id="notes"]',
      )!
      .click(),
  );
  expect(primary.hidden).toBe(true);
  expect(primary.querySelector('[data-visual-body="primary"]')).toBe(
    primaryBody,
  );
  await deliver(flushRequest("prepare", "hidden-primary"));
  expect(fixture.visualFlush).toHaveBeenCalledOnce();
  expect(publishedAcks()[0]).toHaveProperty("status", "prepared");
  await deliver(flushRequest("verify", "hidden-primary"));
  expect(publishedAcks()[1]).toHaveProperty("status", "verified");
});

it("refuses a primary prepare when field selection has unmounted its controller despite old clean parent state", async () => {
  collectionFields();
  await act(async () => renderEditor());
  expect(fixture.awareness!.getLocalState()?.unsavedEdits).toBe(false);
  fixture.fields = {
    ...fixture.fields!,
    properties: fixture.fields!.properties.filter(
      (field) => field.definition.id === "notes",
    ),
  };
  await act(async () => renderEditor());
  expect(container.querySelector('[data-visual-body="primary"]')).toBeNull();
  await deliver(flushRequest("prepare", "missing-primary"));
  expect(publishedAcks()[0]).toMatchObject({
    status: "error",
    errorCode: "editor_flush_failed",
  });
  expect(fixture.visualFlush).not.toHaveBeenCalled();
});

it("invalidates verification if the primary persistence controller becomes unavailable", async () => {
  await act(async () => renderEditor());
  await deliver(flushRequest("prepare"));
  expect(publishedAcks()[0]).toHaveProperty("status", "prepared");
  act(() => fixture.editor!.onPersistenceControllerChange!(null));
  await deliver(flushRequest("verify"));
  expect(publishedAcks()[1]).toHaveProperty("status", "changed");
});

it("delivers the identity-specific barrier through the existing collaboration event callback", async () => {
  await act(async () => renderEditor());
  const request = flushRequest("prepare", "collab-delivery");
  fixture.readAppState.mockResolvedValue(request);
  await act(async () =>
    fixture.onCollabEvent!({
      source: "app-state",
      key: `flush-request-${fixture.page!.id}`,
    }),
  );
  expect(publishedAcks()[0]).toMatchObject({
    status: "prepared",
    phaseToken: "collab-delivery",
  });
});

it("refuses stale success when second body and title edits arrive across a mounted save await", async () => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  let acknowledge!: (document: Document) => void;
  fixture.save.mockReturnValue(new Promise<Document>(() => {}));
  fixture.save.mockReturnValueOnce(
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
  await act(async () => vi.advanceTimersByTimeAsync(20_000));
  expect(publishedAcks()).toHaveLength(0);
  expect(fixture.awareness!.getLocalState()?.unsavedEdits).toBe(true);
});

it("confirms an exact additional field independently of a dirty primary body and invalidates later field input", async () => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  collectionFields();
  await act(async () => renderEditor());
  const controller = peekBlockFieldSaveController(`${fixture.page!.id}:notes`)!;
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
  expect(fixture.fieldSave).not.toHaveBeenCalled();
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

describe("actual additional field freshness", () => {
  async function mountField() {
    fixture.realAdditionalEditors = true;
    collectionFields();
    acknowledgeCurrentSaves();
    fixture.fieldSave.mockImplementation(async (input) => {
      fixture.fields = {
        ...fixture.fields!,
        properties: fixture.fields!.properties.map((field) =>
          field.definition.id === input.propertyId
            ? {
                ...field,
                value: input.value,
                blocksField: {
                  ...field.blocksField!,
                  revision: field.blocksField!.revision + 1,
                },
              }
            : field,
        ),
      };
      return fixture.fields;
    });
    await act(async () => renderEditor());
    act(() =>
      container
        .querySelector<HTMLButtonElement>(
          '[role="tab"][data-block-field-id="notes"]',
        )!
        .click(),
    );
    expect(fixture.fieldEditor!.getText()).toBe("Additional body");
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  }
  function fieldInput(text: string) {
    act(() => {
      const editor = fixture.fieldEditor!;
      editor.view.dom.dispatchEvent(
        new InputEvent("beforeinput", {
          bubbles: true,
          inputType: "insertText",
          data: text,
        }),
      );
      editor.commands.setTextSelection(editor.state.doc.content.size - 1);
      editor.view.dispatch(editor.state.tr.insertText(text));
    });
  }
  async function fieldAcks(count: number) {
    for (let i = 0; i < 30 && publishedAcks().length < count; i++)
      await act(async () => {
        await new Promise((resolve) => setImmediate(resolve));
      });
    expect(publishedAcks()).toHaveLength(count);
    return publishedAcks()[count - 1];
  }
  async function fieldPhase(
    phase: "prepare" | "verify",
    token: string,
    count: number,
  ) {
    await deliver(flushRequest(phase, token, "notes"));
    return fieldAcks(count);
  }
  function fieldState() {
    return peekBlockFieldSaveController(`${fixture.page!.id}:notes`)!;
  }

  async function saveThenLockField() {
    await mountField();
    fieldInput(" saved before suggesting");
    await act(async () => {
      expect(await fixture.fieldController!.flushLatest()).toBe(true);
    });
    await act(async () => vi.advanceTimersByTimeAsync(0));
    expect(fieldState().isClean).toBe(true);
    expect(fieldState().lastSaved).toBe(
      "Additional body saved before suggesting",
    );
    expect(fixture.fieldSave).toHaveBeenCalledOnce();
    const editor = fixture.fieldEditor;
    fixture.lockAdditionalForSuggestions = true;
    await act(async () => renderEditor());
    expect(fixture.fieldEditor).toBe(editor);
    expect(editor!.isEditable).toBe(false);
    expect(fieldState().isClean).toBe(true);
  }

  it.each(["field navigation helper", "parent session"] as const)(
    "flushes an acknowledged unchanged suggestion-locked field through the %s without writing again",
    async (path) => {
      await saveThenLockField();
      const version = fieldState().version;
      await act(async () => {
        if (path === "field navigation helper")
          await expect(
            flushAllBlockFieldSaveControllersForDocument(fixture.page!.id),
          ).resolves.toBeUndefined();
        else {
          expect(fixture.session).not.toBeNull();
          await expect(fixture.session!.flush()).resolves.toBeUndefined();
        }
      });
      expect(fieldState().version).toBe(version);
      expect(fixture.fieldSave).toHaveBeenCalledOnce();
    },
  );

  it("refuses a different actual serialization in a clean suggestion-locked field", async () => {
    await saveThenLockField();
    fieldInput(" new locked input");
    expect(fixture.fieldEditor!.getText()).toBe(
      "Additional body saved before suggesting new locked input",
    );
    expect(fieldState().isClean).toBe(true);
    await act(async () => {
      await expect(
        flushAllBlockFieldSaveControllersForDocument(fixture.page!.id),
      ).rejects.toThrow("A Blocks field could not be saved before reading it.");
    });
    expect(fieldState().lastSaved).toBe(
      "Additional body saved before suggesting",
    );
    expect(fixture.fieldSave).toHaveBeenCalledOnce();
  });

  it("refuses an acknowledged-looking locked field after a failed save and real change-back", async () => {
    await mountField();
    const failure = new Error("Blocks field revision conflict");
    fixture.fieldSave.mockRejectedValue(failure);
    fieldInput(" rejected edit");
    await act(async () => {
      expect(await fixture.fieldController!.flushLatest()).toBe(false);
    });
    expect(fieldState().pending).toBe("Additional body");
    expect(fieldState().lastSaved).toBe("Additional body");
    expect(fieldState().lastError).toBe(failure);
    act(() => {
      const editor = fixture.fieldEditor!;
      editor.view.dispatch(
        editor.state.tr.delete(
          "Additional body".length + 1,
          editor.state.doc.content.size - 1,
        ),
      );
    });
    expect(fixture.fieldEditor!.getText()).toBe("Additional body");
    fixture.lockAdditionalForSuggestions = true;
    await act(async () => renderEditor());
    expect(fixture.fieldEditor!.isEditable).toBe(false);
    await act(async () => {
      await expect(fixture.session!.flush()).rejects.toThrow(
        "editor.pageSaveBeforeNavigationFailed",
      );
    });
    expect(fieldState().lastError).toBe(failure);
    expect(fieldState().isClean).toBe(false);
    expect(fixture.fieldSave).toHaveBeenCalledOnce();
  });

  it("drains real un-emitted field input before prepare then confirms a stable retry beside a dirty primary", async () => {
    await mountField();
    act(() => fixture.editor!.onChange("Unrelated dirty primary"));
    fieldInput(" new field input");
    expect(fieldState().pending).toBe("Additional body");
    expect(fixture.fieldEditor!.getText()).toBe(
      "Additional body new field input",
    );
    expect(await fieldPhase("prepare", "first", 1)).toHaveProperty(
      "status",
      "changed",
    );
    expect(fixture.fieldSave).toHaveBeenCalledWith(
      expect.objectContaining({
        propertyId: "notes",
        value: "Additional body new field input",
      }),
    );
    expect(fieldState().lastSaved).toBe("Additional body new field input");
    const prepared = await fieldPhase("prepare", "stable", 2);
    expect(prepared).toMatchObject({
      status: "prepared",
      claim: {
        kind: "property",
        propertyId: "notes",
        contentHash:
          "sha256:" +
          createHash("sha256")
            .update("Additional body new field input")
            .digest("hex"),
      },
    });
    expect(await fieldPhase("verify", "stable", 3)).toMatchObject({
      status: "verified",
      stabilityToken: prepared.stabilityToken,
    });
    expect(fixture.awareness!.getLocalState()?.unsavedEdits).toBe(true);
  });

  it("invalidates verify for real field input before its deferred parent callback", async () => {
    await mountField();
    expect(await fieldPhase("prepare", "before-input", 1)).toHaveProperty(
      "status",
      "prepared",
    );
    fieldInput(" later input");
    expect(fieldState().pending).toBe("Additional body");
    expect(fixture.fieldSave).not.toHaveBeenCalled();
    expect(await fieldPhase("verify", "before-input", 2)).toHaveProperty(
      "status",
      "changed",
    );
    expect(fieldState().pending).toBe("Additional body");
  });

  it("invalidates real visual change-back while both ordinary field callbacks are held", async () => {
    await mountField();
    expect(await fieldPhase("prepare", "change-back", 1)).toHaveProperty(
      "status",
      "prepared",
    );
    fieldInput("x");
    act(() => {
      const editor = fixture.fieldEditor!;
      const end = editor.state.doc.content.size - 1;
      editor.view.dispatch(editor.state.tr.delete(end - 1, end));
    });
    expect(fixture.fieldEditor!.getText()).toBe("Additional body");
    expect(fieldState().pending).toBe("Additional body");
    expect(fixture.fieldSave).not.toHaveBeenCalled();
    expect(await fieldPhase("verify", "change-back", 2)).toHaveProperty(
      "status",
      "changed",
    );
  });

  it("prepares and verifies a previously edited settled field without manufacturing another save version", async () => {
    await mountField();
    fieldInput(" edited and settled");
    await act(async () => {
      expect(await fixture.fieldController!.flushLatest()).toBe(true);
    });
    await act(async () => vi.advanceTimersByTimeAsync(0));
    expect(fieldState().lastSaved).toBe("Additional body edited and settled");
    expect(fixture.fieldSave).toHaveBeenCalledOnce();
    const version = fieldState().version;
    const prepared = await fieldPhase("prepare", "settled", 1);
    expect(prepared).toHaveProperty("status", "prepared");
    expect(await fieldPhase("verify", "settled", 2)).toMatchObject({
      status: "verified",
      stabilityToken: prepared.stabilityToken,
    });
    expect(fieldState().version).toBe(version);
    expect(fixture.fieldSave).toHaveBeenCalledOnce();
  });

  it("keeps a hidden field's same live controller valid through verification", async () => {
    await mountField();
    expect(await fieldPhase("prepare", "hidden", 1)).toHaveProperty(
      "status",
      "prepared",
    );
    const controller = fixture.fieldController;
    const editor = fixture.fieldEditor;
    act(() =>
      container
        .querySelector<HTMLButtonElement>(
          '[role="tab"][data-block-field-id="content"]',
        )!
        .click(),
    );
    expect(
      container.querySelector<HTMLElement>(
        '[role="tabpanel"][data-block-field-id="notes"]',
      )!.hidden,
    ).toBe(true);
    expect(fixture.fieldController).toBe(controller);
    expect(fixture.fieldEditor).toBe(editor);
    expect(await fieldPhase("verify", "hidden", 2)).toHaveProperty(
      "status",
      "verified",
    );
  });

  it.each(["prepare", "verify"] as const)(
    "refuses an unavailable live field controller at %s",
    async (phase) => {
      await mountField();
      if (phase === "verify")
        expect(await fieldPhase("prepare", "missing", 1)).toHaveProperty(
          "status",
          "prepared",
        );
      fixture.fieldProps!.onPersistenceControllerChange!(null);
      const answer = await fieldPhase(
        phase,
        "missing",
        phase === "prepare" ? 1 : 2,
      );
      expect(answer).toMatchObject(
        phase === "prepare"
          ? { status: "error", errorCode: "editor_flush_failed" }
          : { status: "changed" },
      );
      fixture.fieldProps!.onPersistenceControllerChange!(
        fixture.fieldController,
      );
    },
  );

  it("invalidates a prepared interval after an actual field unmount and remount", async () => {
    await mountField();
    expect(await fieldPhase("prepare", "replace", 1)).toHaveProperty(
      "status",
      "prepared",
    );
    const oldEditor = fixture.fieldEditor!;
    const oldController = fixture.fieldController;
    const oldField = fixture.fields!.properties.find(
      (field) => field.definition.id === "notes",
    )!;
    fixture.fields = {
      ...fixture.fields!,
      properties: fixture.fields!.properties.filter(
        (field) => field !== oldField,
      ),
    };
    await act(async () => renderEditor());
    await act(async () => vi.advanceTimersByTimeAsync(2));
    expect(oldEditor.isDestroyed).toBe(true);
    expect(
      peekBlockFieldSaveController(`${fixture.page!.id}:notes`),
    ).toBeUndefined();
    fixture.fields = {
      ...fixture.fields!,
      properties: [...fixture.fields!.properties, oldField],
    };
    await act(async () => renderEditor());
    expect(fixture.fieldEditor).not.toBe(oldEditor);
    expect(fixture.fieldController).not.toBe(oldController);
    expect(await fieldPhase("verify", "replace", 2)).toHaveProperty(
      "status",
      "changed",
    );
  });

  it("invalidates input across a held field save await and then confirms the newer current body", async () => {
    await mountField();
    const persist = fixture.fieldSave.getMockImplementation()!;
    const release: Array<() => Promise<void>> = [];
    fixture.fieldSave.mockImplementation(
      (input) =>
        new Promise((resolve) => {
          release.push(async () => resolve(await persist(input)));
        }),
    );
    fieldInput(" first");
    await deliver(flushRequest("prepare", "held-first", "notes"));
    expect(fixture.fieldSave).toHaveBeenCalledOnce();
    expect(publishedAcks()).toHaveLength(0);
    fieldInput(" second");
    await act(async () => release.shift()!());
    expect(await fieldAcks(1)).toHaveProperty("status", "changed");
    expect(fixture.fieldEditor!.getText()).toBe("Additional body first second");
    await deliver(flushRequest("prepare", "held-second", "notes"));
    expect(fixture.fieldSave).toHaveBeenLastCalledWith(
      expect.objectContaining({ value: "Additional body first second" }),
    );
    expect(publishedAcks()).toHaveLength(1);
    await act(async () => release.shift()!());
    expect(await fieldAcks(2)).toHaveProperty("status", "changed");
    expect(await fieldPhase("prepare", "current", 3)).toHaveProperty(
      "status",
      "prepared",
    );
    expect(await fieldPhase("verify", "current", 4)).toHaveProperty(
      "status",
      "verified",
    );
    expect(fieldState().lastSaved).toBe("Additional body first second");
  });

  it("publishes a typed refusal when actual field persistence keeps failing", async () => {
    await mountField();
    const failure = new Error("field save unavailable");
    fixture.fieldSave.mockRejectedValue(failure);
    fieldInput(" failed input");
    expect(await fieldPhase("prepare", "failed-first", 1)).toHaveProperty(
      "status",
      "changed",
    );
    expect(fieldState().lastError).toBe(failure);
    expect(await fieldPhase("prepare", "failed-retry", 2)).toMatchObject({
      status: "error",
      errorCode: "editor_flush_failed",
    });
    expect(publishedAcks().some((ack) => ack.status === "prepared")).toBe(
      false,
    );
  });

  it("refuses un-emitted field input when the field becomes read-only before prepare", async () => {
    await mountField();
    fieldInput(" before permission changed");
    fixture.fields = { ...fixture.fields!, canEditValues: false };
    await act(async () => renderEditor());
    expect(fixture.fieldEditor!.isEditable).toBe(false);
    expect(fieldState().pending).toBe("Additional body");
    expect(await fieldPhase("prepare", "locked", 1)).toMatchObject({
      status: "error",
      errorCode: "editor_flush_failed",
    });
    expect(fixture.fieldSave).not.toHaveBeenCalled();
  });

  it("cannot acknowledge a field save held past the request deadline", async () => {
    await mountField();
    const persist = fixture.fieldSave.getMockImplementation()!;
    let release!: () => Promise<void>;
    fixture.fieldSave.mockImplementation(
      (input) =>
        new Promise((resolve) => {
          release = async () => resolve(await persist(input));
        }),
    );
    fieldInput(" held input");
    await deliver(flushRequest("prepare", "expired", "notes"));
    expect(fixture.fieldSave).toHaveBeenCalledOnce();
    await act(async () => vi.advanceTimersByTimeAsync(20_000));
    expect(publishedAcks()).toHaveLength(0);
    await act(async () => release());
    expect(publishedAcks()).toHaveLength(0);
    expect(fieldState().lastSaved).toBe("Additional body held input");
  });
});
