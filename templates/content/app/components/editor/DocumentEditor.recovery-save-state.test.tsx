// @vitest-environment happy-dom

import { createHash } from "node:crypto";
import { performance as realPerformance } from "node:perf_hooks";
import { setTimeout as realDelay } from "node:timers/promises";

import type { Document, DocumentPropertiesResponse } from "@shared/api";
import { legacyBlocksFieldIdentity } from "@shared/blocks-field-identity";
import { docToNfm, nfmToDoc } from "@shared/nfm";
import {
  QueryClient,
  QueryClientProvider,
  useMutation,
} from "@tanstack/react-query";
import { Editor } from "@tiptap/core";
import { act, createElement, type ComponentProps, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router";
import { toast } from "sonner";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Awareness } from "y-protocols/awareness";
import * as Y from "yjs";

import {
  markDocumentCreationConfirmed,
  markDocumentCreationPending,
} from "@/lib/optimistic-document";

import type { PageEditorSession } from "./DocumentEditor";
import type { DocumentReconcileRecovery } from "./DocumentReconcileRecovery";
import { PageSaveHandedOff } from "./pageSession";
import type { useDocumentReconcileRecovery } from "./useDocumentReconcileRecovery";
import type {
  VisualEditor,
  VisualEditorPersistenceController,
} from "./VisualEditor";

const fixture = vi.hoisted(() => ({
  account: null as { email: string; orgId: string | null } | null,
  page: null as Document | null,
  fields: null as DocumentPropertiesResponse | null,
  realAdditionalEditors: false,
  realPrimaryEditor: false,
  realPrimaryCollab: false,
  cachedDocument: false,
  realDocumentMutation: false,
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
  pickIcon: null as ((icon: string | null) => Promise<void>) | null,
  recovery: null as ReturnType<typeof useDocumentReconcileRecovery> | null,
  reconcileChooser: null as ComponentProps<
    typeof DocumentReconcileRecovery
  > | null,
  contentHashStarted: vi.fn(),
  contentHashHold: null as Promise<void> | null,
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
  pageVersion: 0,
  pageSubscribers: new Set<() => void>(),
  // What each page save that did not return threw.
  saveFailures: [] as unknown[],
}));

const barrierStore = vi.hoisted(() => ({
  get: vi.fn(),
  many: vi.fn(),
  compare: vi.fn(),
  awareness: vi.fn(),
  hasCollab: vi.fn(),
  capture: vi.fn(),
}));
vi.mock("@agent-native/core", () => import("@agent-native/core/action"));
vi.mock("@agent-native/core/db", () => ({
  getDbExec: () => {
    throw new Error("The mounted editor tests prohibit database access.");
  },
  createGetDb: () => {
    throw new Error(
      "The mounted editor tests prohibit database initialization.",
    );
  },
}));
vi.mock("@agent-native/core/sharing", async (original) => ({
  ...(await original<typeof import("@agent-native/core/sharing")>()),
  resolveAccess: async () => ({ resource: fixture.page }),
}));
vi.mock("@agent-native/core/server", async (original) => ({
  ...(await original<typeof import("@agent-native/core/server")>()),
  buildDeepLink: () => "https://example.test/page/recovery-page",
}));
vi.mock("../../../actions/_database-utils.js", () => ({
  isSoftDeletedDatabaseDocument: async () => false,
}));
vi.mock("../../../server/db/index.js", () => ({
  getDb: () => {
    throw new Error("The mounted barrier uses its canonical storage fixture.");
  },
  schema: {},
}));
vi.mock("@agent-native/core/application-state", () => ({
  appStateGet: barrierStore.get,
  appStateGetManyEntries: barrierStore.many,
  appStateCompareAndSet: barrierStore.compare,
}));
vi.mock("@agent-native/core/collab", () => ({
  AGENT_CLIENT_ID: 0xffffffff,
  hasCollabState: barrierStore.hasCollab,
  loadAwarenessRowsStrict: barrierStore.awareness,
}));
vi.mock("../../../actions/_document-save-row.js", async (original) => ({
  ...(await original<
    typeof import("../../../actions/_document-save-row.js")
  >()),
  createDocumentFlushCapture: () => barrierStore.capture,
}));
vi.mock("../../../server/lib/live-body-writer.js", async (original) => ({
  ...(await original<
    typeof import("../../../server/lib/live-body-writer.js")
  >()),
  isLiveBodyWriterPage: async () => false,
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
  useSession: () => ({ session: fixture.account }),
  useDbSync: (options: { onEvent?: typeof fixture.onSyncEvent }) => {
    if (options.onEvent) fixture.onSyncEvent = options.onEvent;
  },
  useAvatarUrl: () => undefined,
  useActionMutation: (name: string, options: any) => {
    const mutation = useMutation({ ...options, mutationFn: fixture.save });
    return fixture.realDocumentMutation && name === "update-document"
      ? mutation
      : fixture.mutation;
  },
  callAction: vi.fn(async () => null),
  tryCallActionKeepalive: () => ({ accepted: false }),
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
vi.mock("@/hooks/use-documents", async (importOriginal) => {
  const actualDocuments =
    await importOriginal<typeof import("@/hooks/use-documents")>();
  const { useSyncExternalStore } = await import("react");
  const subscribePage = (notify: () => void) => {
    fixture.pageSubscribers.add(notify);
    return () => {
      fixture.pageSubscribers.delete(notify);
    };
  };
  return {
    ...actualDocuments,
    usePageOpenDocument: () => {
      // The app's update-document success writes the saved page into this
      // read before the save resolves.
      useSyncExternalStore(subscribePage, () => fixture.pageVersion);
      return {
        query: {
          data: fixture.cachedDocument
            ? (queryClient.getQueryData([
                "action",
                "get-document",
                { id: fixture.page!.id },
              ]) ?? fixture.page)
            : fixture.page,
          dataUpdatedAt: 1,
        },
        fetchedForThisOpen: true,
        readsStartedEarly: true,
      };
    },
    useUpdateDocument: (
      ...args: Parameters<typeof actualDocuments.useUpdateDocument>
    ) =>
      fixture.realDocumentMutation
        ? actualDocuments.useUpdateDocument(...args)
        : { mutateAsync: fixture.save },
    useDeleteDocument: () => fixture.mutation,
    useResolvePreviewDocumentDraft: () => fixture.mutation,
    useUpdatePreviewDocumentDraft: () => fixture.mutation,
    useDocuments: () => fixture.emptyQuery,
    useContentNavigationContext: () => fixture.emptyQuery,
  };
});
vi.mock("./pageSession", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./pageSession")>();
  return {
    ...actual,
    savePageWithRecovery: (
      input: Parameters<typeof actual.savePageWithRecovery>[0],
    ) =>
      actual.savePageWithRecovery(input).catch((error: unknown) => {
        fixture.saveFailures.push(error);
        throw error;
      }),
  };
});
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
  preserveCommentComposerEscape: () => {},
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
vi.mock("./EmojiPicker", () => ({
  EmojiPicker: (props: {
    onSelect: (icon: string | null) => Promise<void>;
  }) => {
    fixture.pickIcon = props.onSelect;
    return null;
  },
}));
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
  DocumentReconcileRecovery: (
    props: ComponentProps<typeof DocumentReconcileRecovery>,
  ) => {
    fixture.reconcileChooser = props;
    return null;
  },
}));
vi.mock("@/lib/document-content-hash", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/document-content-hash")>();
  return {
    ...actual,
    documentContentHash: async (content: string) => {
      fixture.contentHashStarted();
      await fixture.contentHashHold;
      return actual.documentContentHash(content);
    },
  };
});
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
      ...(fixture.realPrimaryEditor && !fixture.realPrimaryCollab
        ? { ydoc: null, awareness: null }
        : {}),
      onPersistenceControllerChange: publish,
    });
  }
  function FixtureVisualEditor(props: ComponentProps<typeof VisualEditor>) {
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
  }
  return {
    ...actual,
    VisualEditor: (props: ComponentProps<typeof VisualEditor>) =>
      React.createElement(
        (fixture.realAdditionalEditors && props.localFileMode) ||
          (fixture.realPrimaryEditor && !props.localFileMode)
          ? RealAdditionalEditor
          : FixtureVisualEditor,
        props,
      ),
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
  documentContentHash,
  documentRevisionToken,
} from "../../../server/lib/document-revision";
import {
  __resetBlockFieldSaveRegistry,
  flushAllBlockFieldSaveControllersForDocument,
  peekBlockFieldSaveController,
} from "./blockFieldSaveRegistry";
import { PageEditorSurface } from "./DocumentEditor";
import { createVisualEditorExtensions } from "./VisualEditor";

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
  fixture.account = { email: "writer@example.test", orgId: "org" };
  fixture.saveFailures = [];
  fixture.page = {
    id: "recovery-page",
    title: "Saved title",
    content: "Saved body",
    revision: "r1",
    createdAt: "2026-10-19T11:00:00.000Z",
    updatedAt: "2026-10-19T12:00:00.000Z",
    canEdit: true,
  } as Document;
  fixture.save.mockReset();
  fixture.flushUpdates.mockReset().mockResolvedValue(true);
  fixture.recoverySaveSettled.mockReset();
  fixture.reconcileChooser = null;
  fixture.contentHashStarted.mockReset();
  fixture.contentHashHold = null;
  fixture.finishRecovery = Promise.resolve();
  fixture.mutation.mutateAsync
    .mockReset()
    .mockImplementation(async (input) =>
      input.operation === "upsert"
        ? { status: "saved", draft: { ...input.draft, version: 1 } }
        : { status: "deleted", draft: null },
    );
  fixture.editor = null;
  fixture.pickIcon = null;
  fixture.fields = null;
  fixture.realAdditionalEditors = false;
  fixture.realPrimaryEditor = false;
  fixture.realPrimaryCollab = false;
  fixture.cachedDocument = false;
  fixture.realDocumentMutation = false;
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
    // Unpublished, the editor keeps the page it opened and adopts that older
    // body back over its own acknowledged save.
    fixture.pageVersion += 1;
    for (const notify of fixture.pageSubscribers) notify();
    return fixture.page;
  });
}

function connectBarrierStore(propertyId?: string) {
  const values = new Map<string, any>();
  const requests: any[] = [];
  const captures: any[] = [];
  barrierStore.hasCollab.mockResolvedValue(false);
  barrierStore.awareness.mockImplementation(async () => [
    {
      clientId: fixture.awareness!.clientID,
      state: JSON.stringify(fixture.awareness!.getLocalState()),
      lastSeen: Date.now(),
    },
  ]);
  barrierStore.get.mockImplementation(
    async (_email, key) => values.get(key) ?? null,
  );
  barrierStore.many.mockImplementation(async (_email, keys: string[]) =>
    keys.map((key) => ({ key, value: values.get(key) ?? null })),
  );
  const compare = async (key: string, expected: unknown, next: unknown) => {
    if (JSON.stringify(values.get(key) ?? null) !== JSON.stringify(expected))
      return false;
    if (next === null) values.delete(key);
    else values.set(key, next);
    return true;
  };
  fixture.readAppState.mockImplementation(
    async (key) => values.get(key) ?? null,
  );
  fixture.compareAppState.mockImplementation(compare);
  barrierStore.compare.mockImplementation(
    async (_email, key, expected, next) => {
      const changed = await compare(key, expected, next);
      if (changed && next && key.startsWith("flush-request-")) {
        requests.push(next);
        fixture.onSyncEvent!({ source: "app-state", key });
      }
      return changed;
    },
  );
  barrierStore.capture.mockImplementation(async () => {
    const content = propertyId
      ? (fixture.fields!.properties.find(
          (field) => field.definition.id === propertyId,
        )!.value as string)
      : fixture.page!.content;
    const snapshot = propertyId
      ? {
          kind: "property",
          propertyId,
          content,
          contentHash: documentContentHash(content),
        }
      : {
          kind: "document",
          bodyRevision: fixture.page!.bodyRevision ?? 1,
          content,
          contentHash: documentContentHash(content),
          title: fixture.page!.title,
          updatedAt: fixture.page!.updatedAt,
        };
    captures.push(snapshot);
    return snapshot;
  });
  return { values, requests, captures };
}

async function runConnectedBarrier(propertyId?: string) {
  const { flushOpenDocumentEditorToSql } =
    await import("../../../actions/_document-flush");
  return runConnectedRequest(() =>
    flushOpenDocumentEditorToSql({
      documentId: fixture.page!.id,
      propertyId,
    }),
  );
}

async function runConnectedPull() {
  const { default: pullDocument } =
    await import("../../../actions/pull-document");
  return runConnectedRequest(async () =>
    pullDocument.run({ id: fixture.page!.id, format: "markdown" }),
  );
}

async function runConnectedRequest(request: () => Promise<unknown>) {
  let result: { value?: unknown; error?: unknown } | null = null;
  void request().then(
    (value) => {
      result = { value };
    },
    (error) => {
      result = { error };
    },
  );
  for (let elapsed = 0; result === null && elapsed < 20_200; elapsed += 200) {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(200);
      await realDelay(5);
    });
  }
  expect(result).not.toBeNull();
  return result;
}

it("confirms an actually edited settled VisualEditor through the server barrier without reauthoring its applied save", async () => {
  fixture.realPrimaryEditor = true;
  fixture.page!.revision = documentRevisionToken(0, fixture.page!.content);
  acknowledgeCurrentSaves();
  const acknowledge = fixture.save.getMockImplementation()!;
  fixture.save.mockImplementation(async (input) => {
    const saved = await acknowledge(input);
    fixture.page = {
      ...saved,
      revision: documentRevisionToken(1, saved.content),
    };
    return fixture.page;
  });
  await act(async () => renderEditor());
  vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
  act(() => {
    const editor = fixture.fieldEditor!;
    editor.view.dom.dispatchEvent(
      new InputEvent("beforeinput", {
        bubbles: true,
        inputType: "insertText",
        data: " settled",
      }),
    );
    editor.commands.setTextSelection(editor.state.doc.content.size - 1);
    editor.view.dispatch(editor.state.tr.insertText(" settled"));
  });
  await act(async () => vi.advanceTimersByTimeAsync(500));
  await act(async () => renderEditor());
  await act(async () => vi.advanceTimersByTimeAsync(0));
  expect(fixture.page!.content).toBe("Saved body settled");
  expect(fixture.awareness!.getLocalState()?.savedRevision).toBe(
    fixture.page!.revision,
  );
  expect(fixture.save).toHaveBeenCalledTimes(1);
  const applied = structuredClone(fixture.save.mock.calls[0][0]);
  const store = connectBarrierStore();
  barrierStore.hasCollab.mockResolvedValue(true);
  const result = await runConnectedBarrier();
  expect(result).toMatchObject({
    value: {
      status: "flushed",
      snapshot: { content: "Saved body settled" },
      editors: [
        {
          flush: "answered",
          prepareToken: expect.any(String),
          verifyToken: expect.any(String),
        },
      ],
    },
  });
  expect(store.requests.map((request) => request.phase)).toEqual([
    "prepare",
    "verify",
  ]);
  expect(store.captures).toHaveLength(1);
  expect(fixture.save).toHaveBeenCalledTimes(1);
  expect(fixture.save.mock.calls[0][0]).toEqual(applied);
  expect(publishedAcks().map((ack) => ack.status)).toEqual([
    "prepared",
    "verified",
  ]);
  expect(store.values.size).toBe(0);
});

it.each([false, true])(
  "keeps the original fresh barrier during actual early-delivered typing (continuous: %s)",
  async (continuous) => {
    fixture.realPrimaryEditor = true;
    fixture.page!.revision = documentRevisionToken(0, fixture.page!.content);
    let bodyRevision = 0;
    fixture.save.mockImplementation(async (input) => {
      await new Promise<void>((resolve) => setTimeout(resolve, 120));
      fixture.page = {
        ...fixture.page!,
        title: input.title ?? fixture.page!.title,
        content: input.content ?? fixture.page!.content,
        bodyRevision: ++bodyRevision,
        revision: documentRevisionToken(
          bodyRevision,
          input.content ?? fixture.page!.content,
        ),
        updatedAt: new Date(
          Date.parse("2026-10-19T12:00:00.000Z") + bodyRevision,
        ).toISOString(),
      };
      return fixture.page;
    });
    await act(async () => renderEditor());
    vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
    const type = () => {
      const editor = fixture.fieldEditor!;
      editor.view.dom.dispatchEvent(
        new InputEvent("beforeinput", {
          bubbles: true,
          inputType: "insertText",
          data: "x",
        }),
      );
      editor.commands.setTextSelection(editor.state.doc.content.size - 1);
      editor.view.dispatch(editor.state.tr.insertText("x"));
    };
    const duration = continuous ? 24_000 : 1_600;
    for (let elapsed = 0; elapsed < duration; elapsed += 40)
      setTimeout(type, elapsed);
    await act(async () => vi.advanceTimersByTimeAsync(continuous ? 500 : 400));
    const store = connectBarrierStore();
    const started = Date.now();
    const result = await runConnectedBarrier();
    const prepares = store.requests.filter(
      (request) => request.phase === "prepare",
    );
    expect(
      prepares.every((request) => request.expiresAt === started + 20_000),
    ).toBe(true);
    expect(
      new Set(store.requests.map((request) => request.phaseToken)).size,
    ).toBe(store.requests.length);
    expect(prepares.length).toBeGreaterThan(3);
    if (continuous) {
      expect(result).toMatchObject({
        error: { errorCode: "open_editor_flush_timeout" },
      });
      expect(Date.now() - started).toBeGreaterThanOrEqual(20_000);
      expect(Date.now() - started).toBeLessThanOrEqual(20_200);
      expect(store.captures).toHaveLength(0);
      expect(publishedAcks().some((ack) => ack.status === "verified")).toBe(
        false,
      );
    } else {
      const latest = "Saved body" + "x".repeat(duration / 40);
      expect(fixture.fieldEditor!.getText()).toBe(latest);
      expect(fixture.page!.content).toBe(latest);
      expect(result).toMatchObject({
        value: { status: "flushed", snapshot: { content: latest } },
      });
      expect(Date.now() - started).toBeLessThan(20_000);
      expect(store.captures).toHaveLength(1);
      const final = publishedAcks().slice(-2);
      expect(final.map((ack) => ack.status)).toEqual(["prepared", "verified"]);
      expect(final[1].stabilityToken).toBe(final[0].stabilityToken);
      expect(fixture.awareness!.getLocalState()?.unsavedEdits).toBe(false);
    }
  },
);

it.each([false, true])(
  "settles a real peer update before preparing a never-typed sibling (peer ACK held: %s)",
  async (heldPeer) => {
    fixture.realPrimaryEditor = true;
    fixture.realPrimaryCollab = true;
    fixture.page!.revision = documentRevisionToken(0, fixture.page!.content);
    const peerDoc = new Y.Doc();
    const peerMount = document.createElement("div");
    document.body.append(peerMount);
    const peer = new Editor({
      element: peerMount,
      extensions: createVisualEditorExtensions({ ydoc: peerDoc }),
      content: { type: "doc", content: [{ type: "paragraph" }] },
    });
    peer.commands.setContent(nfmToDoc(fixture.page!.content));
    Y.applyUpdate(ydoc, Y.encodeStateAsUpdate(peerDoc), "peer");
    peerDoc.on("update", (update) => Y.applyUpdate(ydoc, update, "peer"));
    try {
      await act(async () => renderEditor());
      expect(fixture.fieldEditor!.getText()).toBe("Saved body");
      vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
      act(() => peer.view.dispatch(peer.state.tr.insertText("Peer ", 1)));
      expect(fixture.fieldEditor!.getText()).toBe("Peer Saved body");
      fixture.page = {
        ...fixture.page!,
        content: docToNfm(fixture.fieldEditor!.getJSON()),
        revision: documentRevisionToken(1, "Peer Saved body"),
        updatedAt: "2026-10-19T12:00:01.000Z",
      };
      await act(async () => renderEditor());
      expect(fixture.awareness!.getLocalState()?.unsavedEdits).toBe(true);
      const store = connectBarrierStore();
      if (heldPeer) {
        const cleanRow = (await barrierStore.awareness())[0];
        barrierStore.awareness.mockResolvedValue([
          cleanRow,
          {
            ...cleanRow,
            clientId: peerDoc.clientID,
            state: JSON.stringify({
              ...JSON.parse(cleanRow.state),
              editorSessionId: "held-peer",
              unsavedEdits: true,
            }),
          },
        ]);
      }
      const started = Date.now();
      const result = await runConnectedBarrier();
      const prepared = publishedAcks().find((ack) => ack.status === "prepared");
      expect(prepared).toMatchObject({
        clientId: fixture.awareness!.clientID,
        claim: { kind: "document", save: { revision: fixture.page!.revision } },
      });
      expect(Date.now() - started).toBeGreaterThanOrEqual(1_500);
      if (heldPeer) {
        expect(result).toMatchObject({
          error: { errorCode: "open_editor_flush_timeout" },
        });
        expect(Date.now() - started).toBeGreaterThanOrEqual(20_000);
        expect(Date.now() - started).toBeLessThanOrEqual(20_200);
        expect(store.requests[0].targets).toHaveLength(2);
        expect(store.captures).toHaveLength(0);
        expect(publishedAcks().map((ack) => ack.status)).toEqual(["prepared"]);
      } else {
        expect(result).toMatchObject({
          value: {
            status: "flushed",
            snapshot: { content: "Peer Saved body" },
          },
        });
        expect(publishedAcks().map((ack) => ack.status)).toEqual([
          "prepared",
          "verified",
        ]);
        expect(publishedAcks()[1].stabilityToken).toBe(prepared.stabilityToken);
      }
      expect(fixture.save).not.toHaveBeenCalled();
      expect(fixture.mutation.mutateAsync).not.toHaveBeenCalledWith(
        expect.objectContaining({ operation: "upsert" }),
      );
    } finally {
      peer.destroy();
      peerDoc.destroy();
      peerMount.remove();
    }
  },
);

function pasteTitle(value: string) {
  act(() => {
    const title = container.querySelector<HTMLTextAreaElement>("textarea")!;
    title.setSelectionRange(0, title.value.length);
    const paste = new Event("paste", { bubbles: true, cancelable: true });
    Object.defineProperty(paste, "clipboardData", {
      value: { getData: () => value },
    });
    title.dispatchEvent(paste);
  });
}

it.each([false, true])(
  "freshly reads an accepted primary title while preserving an independent failed icon and navigation refusal (reverted: %s)",
  async (reverted) => {
    fixture.realPrimaryEditor = true;
    vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
    fixture.page!.revision = documentRevisionToken(1, fixture.page!.content);
    const failure = new Error("The direct icon and title save failed.");
    let failing = reverted;
    let iconFailed = false;
    fixture.save.mockImplementation(async (input) => {
      if (failing || (input.icon !== undefined && !iconFailed)) {
        if (input.icon !== undefined) iconFailed = true;
        throw failure;
      }
      fixture.page = {
        ...fixture.page!,
        ...(input.title !== undefined ? { title: input.title } : {}),
        ...(input.icon !== undefined ? { icon: input.icon } : {}),
        updatedAt: "2026-10-19T12:00:01.000Z",
      };
      return fixture.page;
    });
    await act(async () => renderEditor());
    pasteTitle("Saved after the icon failure");
    await act(async () => {
      await expect(fixture.pickIcon!("tabler:star")).rejects.toBe(failure);
    });
    expect(fixture.save.mock.calls[0][0]).toMatchObject({
      icon: "tabler:star",
      title: "Saved after the icon failure",
      editorSessionId: undefined,
      editorEditGeneration: undefined,
    });
    if (reverted) {
      await act(async () => vi.advanceTimersByTimeAsync(500));
      pasteTitle("Saved title");
      await act(async () => vi.advanceTimersByTimeAsync(500));
      expect(fixture.save.mock.calls[2][0]).toMatchObject({
        title: "Saved title",
        content: "Saved body",
        editorEditGeneration: 2,
      });
      expect(fixture.awareness!.getLocalState()?.unsavedEdits).toBe(true);
      const refused = connectBarrierStore();
      expect(await runConnectedPull()).toMatchObject({
        error: { errorCode: "open_editor_flush_timeout" },
      });
      expect(refused.captures).toHaveLength(0);
      failing = false;
      pasteTitle("Saved title");
    }
    await act(async () => vi.advanceTimersByTimeAsync(500));
    await act(async () => renderEditor());
    const acceptedTitle = reverted
      ? "Saved title"
      : "Saved after the icon failure";
    expect(fixture.page!.title).toBe(acceptedTitle);
    const acceptedCount = reverted ? 4 : 2;
    expect(fixture.save).toHaveBeenCalledTimes(acceptedCount);
    expect(fixture.save.mock.calls[acceptedCount - 1][0]).toMatchObject({
      title: acceptedTitle,
      editorSessionId: fixture.awareness!.getLocalState()!.editorSessionId,
      editorEditGeneration: reverted ? 3 : 1,
    });
    expect(
      fixture.save.mock.calls
        .slice(1)
        .every(([input]) => input.icon === undefined),
    ).toBe(true);
    const store = connectBarrierStore();
    const ackStart = publishedAcks().length;
    expect(await runConnectedPull()).toMatchObject({
      value: {
        title: acceptedTitle,
        content: "Saved body",
        editorFlush: {
          status: "flushed",
          editors: [
            {
              clientId: fixture.awareness!.clientID,
              editorSessionId:
                fixture.awareness!.getLocalState()!.editorSessionId,
              flush: "answered",
              prepareToken: expect.any(String),
              verifyToken: expect.any(String),
            },
          ],
        },
      },
    });
    expect(store.requests.map((request) => request.phase)).toEqual([
      "prepare",
      "verify",
    ]);
    expect(store.captures).toEqual([
      expect.objectContaining({ title: acceptedTitle, content: "Saved body" }),
    ]);
    expect(
      publishedAcks()
        .slice(ackStart)
        .map((answer) => answer.status),
    ).toEqual(["prepared", "verified"]);
    expect(store.requests[0].phaseToken).not.toBe(store.requests[1].phaseToken);
    expect(store.values.size).toBe(0);
    expect(fixture.save).toHaveBeenCalledTimes(acceptedCount);
    await act(async () => {
      await expect(fixture.session!.flush()).rejects.toThrow(
        "editor.pageSaveBeforeNavigationFailed",
      );
    });
    expect(fixture.save).toHaveBeenCalledTimes(acceptedCount + 1);
    expect(fixture.save.mock.calls[acceptedCount][0]).toMatchObject({
      title: acceptedTitle,
      content: "Saved body",
    });
    await act(async () => {
      await fixture.pickIcon!("tabler:star");
    });
    expect(fixture.save.mock.calls[acceptedCount + 1][0]).toMatchObject({
      icon: "tabler:star",
    });
    expect(fixture.save.mock.calls[acceptedCount + 1][0]).not.toHaveProperty(
      "title",
    );
    await act(async () => {
      await expect(fixture.session!.flush()).resolves.toBeUndefined();
    });
  },
);

it.each(["title", "body"] as const)(
  "preserves attestation and retained recovery for reverted primary %s input until an accepted retry",
  async (field) => {
    vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
    fixture.page!.revision = documentRevisionToken(1, fixture.page!.content);
    const failure = new Error("Primary save failed before revert.");
    fixture.save.mockRejectedValue(failure);
    await act(async () => renderEditor());
    if (field === "title") pasteTitle("Failed title");
    else act(() => fixture.editor!.onChange("Failed body"));
    await act(async () => vi.advanceTimersByTimeAsync(500));
    expect(fixture.save).toHaveBeenCalledOnce();
    expect(fixture.awareness!.getLocalState()?.unsavedEdits).toBe(true);
    if (field === "title") pasteTitle("Saved title");
    else act(() => fixture.editor!.onChange("Saved body"));
    let rejectAttestation!: (error: Error) => void;
    fixture.save.mockImplementation(
      () =>
        new Promise((_resolve, reject) => {
          rejectAttestation = reject;
        }),
    );
    await act(async () => vi.advanceTimersByTimeAsync(500));
    expect(fixture.save).toHaveBeenCalledTimes(2);
    expect(fixture.save.mock.calls[1][0]).toMatchObject({
      title: "Saved title",
      content: "Saved body",
      editorSessionId: fixture.awareness!.getLocalState()!.editorSessionId,
      editorEditGeneration: 2,
    });
    expect(fixture.awareness!.getLocalState()?.unsavedEdits).toBe(true);
    await act(async () =>
      rejectAttestation(new Error("Revert attestation unavailable.")),
    );
    await act(async () => renderEditor());
    expect(fixture.awareness!.getLocalState()?.unsavedEdits).toBe(true);
    const refused = connectBarrierStore();
    const started = Date.now();
    expect(await runConnectedBarrier()).toMatchObject({
      error: { errorCode: "open_editor_flush_timeout" },
    });
    expect(Date.now() - started).toBeGreaterThanOrEqual(20_000);
    expect(Date.now() - started).toBeLessThanOrEqual(20_200);
    expect(refused.captures).toHaveLength(0);
    expect(fixture.save).toHaveBeenCalledTimes(2);
    fixture.save.mockResolvedValue(fixture.page!);
    pasteTitle("Saved title");
    await act(async () => vi.advanceTimersByTimeAsync(500));
    await act(async () => renderEditor());
    expect(fixture.save).toHaveBeenCalledTimes(3);
    expect(fixture.save.mock.calls[2][0]).toMatchObject({
      title: "Saved title",
      content: "Saved body",
      editorEditGeneration: 3,
    });
    expect(fixture.awareness!.getLocalState()?.unsavedEdits).toBe(false);
    const store = connectBarrierStore();
    expect(await runConnectedBarrier()).toMatchObject({
      value: {
        status: "flushed",
        snapshot: { title: "Saved title", content: "Saved body" },
      },
    });
    expect(store.requests.map((request) => request.phase)).toEqual([
      "prepare",
      "verify",
    ]);
    expect(
      publishedAcks()
        .slice(-2)
        .map((ack) => ack.status),
    ).toEqual(["prepared", "verified"]);
    expect(fixture.save).toHaveBeenCalledTimes(3);
  },
);

it("confirms a title-only save and adopts a newer peer rename once clean", async () => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  fixture.cachedDocument = true;
  const key = ["action", "get-document", { id: fixture.page!.id }];
  queryClient.setQueryData(key, fixture.page);
  let acknowledge!: (document: Document) => void;
  fixture.save.mockImplementation(
    () =>
      new Promise((resolve) => {
        acknowledge = resolve;
      }),
  );
  await act(async () => renderEditor());
  pasteTitle("My title-only rename");
  await act(async () => vi.advanceTimersByTimeAsync(500));
  await act(async () => renderEditor());
  expect(fixture.save).toHaveBeenCalledOnce();
  expect(fixture.save.mock.calls[0][0]).toMatchObject({
    title: "My title-only rename",
    baseTitle: "Saved title",
  });
  expect(fixture.save.mock.calls[0][0]).not.toHaveProperty("content");
  await act(async () => {
    queryClient.setQueryData(key, fixture.page);
    renderEditor();
  });
  expect(container.querySelector<HTMLTextAreaElement>("textarea")!.value).toBe(
    "My title-only rename",
  );
  const saved = {
    ...fixture.page!,
    title: "My title-only rename",
    updatedAt: "2026-10-19T12:00:01.000Z",
  };
  await act(async () => acknowledge(saved));
  await act(async () => {
    queryClient.setQueryData(key, saved);
    renderEditor();
  });
  expect(fixture.awareness!.getLocalState()).toMatchObject({
    unsavedEdits: false,
    savedTitle: saved.title,
  });
  const peer = {
    ...saved,
    title: "Newer peer rename",
    updatedAt: "2026-10-19T12:00:02.000Z",
  };
  await act(async () => {
    queryClient.setQueryData(key, peer);
    renderEditor();
  });
  expect(container.querySelector<HTMLTextAreaElement>("textarea")!.value).toBe(
    peer.title,
  );
  expect(fixture.awareness!.getLocalState()).toMatchObject({
    unsavedEdits: false,
    savedTitle: peer.title,
  });
  expect(fixture.save).toHaveBeenCalledOnce();
});

async function observeTitleSave(predicate: () => boolean) {
  const deadline = realPerformance.now() + 2_000;
  while (!predicate() && realPerformance.now() < deadline) {
    await act(async () => {
      await realDelay(10);
      renderEditor();
    });
  }
  expect(predicate()).toBe(true);
}

it("settles an accepted matching canonical winner into clean receipts and a fresh barrier without another write", async () => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  fixture.cachedDocument = true;
  const key = ["action", "get-document", { id: fixture.page!.id }];
  queryClient.setQueryData(key, fixture.page);
  let finish!: (value: unknown) => void;
  fixture.save.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  await act(async () => renderEditor());
  await act(async () => {
    pasteTitle("Matching canonical title");
    renderEditor();
  });
  act(() => fixture.editor!.onChange("Matching canonical body"));
  await act(async () => vi.advanceTimersByTimeAsync(500));
  const winner = {
    ...fixture.page!,
    title: "Matching canonical title",
    content: "Matching canonical body",
    revision: "r2",
    updatedAt: "2026-10-19T12:00:01.000Z",
  };
  await act(async () => {
    queryClient.setQueryData(key, winner);
    renderEditor();
    finish({ conflict: true, document: winner });
  });
  await observeTitleSave(
    () => fixture.awareness!.getLocalState()?.unsavedEdits === false,
  );
  expect(fixture.awareness!.getLocalState()).toMatchObject({
    unsavedEdits: false,
    savedTitle: winner.title,
    savedRevision: winner.revision,
  });
  expect(fixture.recovery!.state).toBeNull();
  expect(fixture.mutation.mutateAsync).not.toHaveBeenCalled();
  await deliver(flushRequest("prepare"));
  await observeTitleSave(() =>
    publishedAcks().some((ack) => ack.status === "prepared"),
  );
  expect(publishedAcks()[publishedAcks().length - 1]).toMatchObject({
    status: "prepared",
  });
  expect(fixture.save).toHaveBeenCalledOnce();
});

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

it.each([
  ["Error", new Error("Synthetic persistence detail")],
  ["opaque", { syntheticFailure: true }],
])(
  "publishes only a typed failure when the mounted controller rejects with an %s value",
  async (_kind, failure) => {
    await act(async () => renderEditor());
    const flushLatest = vi.fn().mockRejectedValue(failure);
    act(() =>
      fixture.editor!.onPersistenceControllerChange!({
        version: {},
        flushLatest,
      }),
    );
    const request = flushRequest("prepare", "typed-failure");
    await deliver(request);
    expect(publishedAcks()).toEqual([
      {
        protocol: request.protocol,
        id: request.id,
        requestId: request.requestId,
        phase: request.phase,
        phaseToken: request.phaseToken,
        ...request.targets[0],
        status: "error",
        errorCode: "editor_flush_failed",
      },
    ]);
    expect(flushLatest).toHaveBeenCalledOnce();
    expect(fixture.save).not.toHaveBeenCalled();
    await deliver(flushRequest("verify", "typed-failure"));
    expect(publishedAcks().map((ack) => ack.status)).toEqual([
      "error",
      "changed",
    ]);
  },
);

it.each(["mailbox", "wildcard"] as const)(
  "wakes the current mounted participant from a shared-sync %s event without waiting for a poll",
  async (key) => {
    vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
    await act(async () => renderEditor());
    const notify = fixture.onSyncEvent!;
    fixture.readAppState.mockClear();
    fixture.page = { ...fixture.page!, updatedAt: "2026-10-19T12:00:01.000Z" };
    await act(async () => renderEditor());
    expect(fixture.readAppState).not.toHaveBeenCalled();
    const request = flushRequest("prepare", "shared-sync");
    fixture.readAppState.mockResolvedValue(request);
    await act(async () => {
      notify({ source: "document", key: `flush-request-${fixture.page!.id}` });
      notify({ source: "app-state", key: "flush-request-another-page" });
    });
    await act(async () => vi.advanceTimersByTimeAsync(1800));
    expect(fixture.readAppState).not.toHaveBeenCalled();
    expect(publishedAcks()).toEqual([]);
    const started = Date.now();
    await act(async () =>
      notify({
        source: "app-state",
        key: key === "mailbox" ? `flush-request-${fixture.page!.id}` : "*",
      }),
    );
    expect(Date.now()).toBe(started);
    expect(fixture.readAppState).toHaveBeenCalledWith(
      `flush-request-${fixture.page!.id}`,
    );
    expect(fixture.visualFlush).toHaveBeenCalledOnce();
    expect(publishedAcks()).toEqual([
      {
        protocol: request.protocol,
        id: request.id,
        requestId: request.requestId,
        phase: request.phase,
        phaseToken: request.phaseToken,
        ...request.targets[0],
        status: "prepared",
        stabilityToken: expect.any(String),
        claim: {
          kind: "document",
          save: {
            revision: fixture.page!.revision,
            title: fixture.page!.title,
            titleUpdatedAt: fixture.page!.updatedAt,
          },
        },
      },
    ]);
    expect(fixture.save).not.toHaveBeenCalled();
  },
);

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

it("ends a pending recovery save when another page takes over its id", async () => {
  fixture.page = { ...fixture.page!, createdAt: "2026-10-19T11:00:00.000Z" };
  let finish!: (value: unknown) => void;
  fixture.save.mockReturnValue(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  await act(async () => renderEditor());

  act(() => fixture.recovery!.report("conflict", "Prior page edit"));
  act(() => fixture.editor!.onChange("Prior page edit"));
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

  // The page was deleted for good and a new one created under its id.
  const replacement = {
    ...fixture.page!,
    title: "Replacement title",
    content: "Replacement body",
    revision: "r9",
    createdAt: "2026-10-19T13:00:00.000Z",
    updatedAt: "2026-10-19T13:00:00.000Z",
  };
  fixture.page = replacement;
  await act(async () => renderEditor());
  const upserts = () =>
    fixture.mutation.mutateAsync.mock.calls.filter(
      ([input]) => input.operation === "upsert",
    );
  const upsertsBefore = upserts().length;
  await act(async () => {
    finish({ conflict: true, document: replacement });
    await resolved;
  });

  expect(await resolved).toBe(false);
  expect(fixture.save).toHaveBeenCalledOnce();
  // The refused save's recovery belonged to the page it was written on, so
  // the new page under its id keeps nothing of it.
  expect(upserts().slice(upsertsBefore)).toEqual([]);
  expect(fixture.recovery!.state).toBeNull();
});

it("keeps a pending recovery save while an optimistic page's creation is confirmed", async () => {
  fixture.page = { ...fixture.page!, createdAt: "2026-10-19T11:59:58.000Z" };
  markDocumentCreationPending(queryClient, fixture.page!);
  let finish!: (value: unknown) => void;
  fixture.save.mockReturnValue(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  await act(async () => renderEditor());
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
  // Until the server confirms the page, its creation time is not known, so
  // the save waits rather than write for a page that may turn out to be
  // another one.
  expect(fixture.save).not.toHaveBeenCalled();

  // The server's creation time replaces the client's clock once it answers.
  fixture.page = { ...fixture.page!, createdAt: "2026-10-19T11:59:59.000Z" };
  markDocumentCreationConfirmed(queryClient, fixture.page!);
  await act(async () => renderEditor());
  expect(fixture.save).toHaveBeenCalledOnce();
  await act(async () => {
    finish({
      ...fixture.page!,
      content: "Recovered body",
      revision: "r2",
      updatedAt: "2026-10-19T12:00:01.000Z",
    });
    await resolved;
  });

  expect(await resolved).toBe(true);
  expect(fixture.recovery!.state).toBeNull();
});

describe("a recovery save while the page's creation time is not shown", () => {
  const createdAt = "2026-10-19T11:00:00.000Z";
  const withoutCreationTime = () =>
    ({ ...fixture.page!, createdAt: undefined }) as unknown as Document;
  async function resolveRecovery() {
    let finish!: (value: unknown) => void;
    fixture.save.mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    await act(async () => renderEditor());
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
    const confirm = async () => {
      await act(async () => {
        finish({
          ...fixture.page!,
          content: "Recovered body",
          revision: "r2",
          updatedAt: "2026-10-19T12:00:01.000Z",
        });
        await resolved;
      });
      return resolved;
    };
    return confirm;
  }

  it("waits for the first read that shows it, then saves for the same page", async () => {
    fixture.page = withoutCreationTime();
    const confirm = await resolveRecovery();
    expect(fixture.save).not.toHaveBeenCalled();

    fixture.page = { ...fixture.page!, createdAt };
    await act(async () => renderEditor());
    expect(fixture.save).toHaveBeenCalledOnce();

    expect(await confirm()).toBe(true);
    expect(fixture.recovery!.state).toBeNull();
  });

  it("keeps a save in flight while a read briefly lacks it, for the same page", async () => {
    const confirm = await resolveRecovery();
    expect(fixture.save).toHaveBeenCalledOnce();

    fixture.page = withoutCreationTime();
    await act(async () => renderEditor());
    fixture.page = { ...fixture.page!, createdAt };
    await act(async () => renderEditor());

    expect(await confirm()).toBe(true);
    expect(fixture.save).toHaveBeenCalledOnce();
    expect(fixture.recovery!.state).toBeNull();
  });
});

describe("an editor that left while its save was in flight", () => {
  async function typeAndSave() {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const toastError = vi.spyOn(toast, "error");
    let settle!: {
      resolve: (value: unknown) => void;
      reject: (error: Error) => void;
    };
    fixture.save.mockImplementation(
      () =>
        new Promise((resolve, reject) => {
          settle = { resolve, reject };
        }),
    );
    await act(async () => renderEditor());
    act(() => fixture.editor!.onChange("Typed before leaving"));
    await act(async () => vi.advanceTimersByTimeAsync(500));
    expect(fixture.save).toHaveBeenCalledOnce();
    return { toastError, settle };
  }
  async function leaveDuringSave() {
    const pending = await typeAndSave();
    await act(async () => root.unmount());
    return pending;
  }
  async function answer(settle: () => void) {
    await act(async () => {
      settle();
      await realDelay(20);
    });
  }
  // A refused save merges onto the page that won and tries again, so every
  // try is refused for the save to end refused.
  async function refuse(settle: { resolve: (value: unknown) => void }) {
    const refusal = { conflict: true, document: fixture.page! };
    fixture.save.mockResolvedValue(refusal);
    await answer(() => settle.resolve(refusal));
  }
  const savesAfterTimers = async () => {
    const saves = fixture.save.mock.calls.length;
    await act(async () => vi.advanceTimersByTimeAsync(30_000));
    return fixture.save.mock.calls.length - saves;
  };
  const upserts = () =>
    fixture.mutation.mutateAsync.mock.calls.filter(
      ([input]) => input.operation === "upsert",
    );
  const journaled = () =>
    Object.keys(localStorage)
      .filter((key) => key.startsWith("content-page-draft-journal-v1:"))
      .map((key) => JSON.parse(localStorage.getItem(key)!).snapshot.content);
  const confirmation = () => ({
    ...fixture.page!,
    content: "Typed before leaving",
    revision: "r2",
    updatedAt: "2026-10-19T12:00:01.000Z",
  });
  // A peer saved over the same paragraph, so the edit cannot merge onto it.
  const displacing = () => ({
    conflict: true,
    document: {
      ...fixture.page!,
      content: "Peer body",
      revision: "r-peer",
      updatedAt: "2026-10-19T12:00:02.000Z",
    },
  });
  const unhandled: unknown[] = [];
  const onUnhandled = (reason: unknown) => unhandled.push(reason);
  beforeEach(() => {
    unhandled.length = 0;
    process.on("unhandledRejection", onUnhandled);
  });
  afterEach(() => {
    process.off("unhandledRejection", onUnhandled);
  });

  it.each([
    [
      "it left",
      async () => {
        await act(async () => root.unmount());
      },
    ],
    [
      "its account changed",
      async () => {
        fixture.account = { email: "reader@example.test", orgId: "org" };
        await act(async () => renderEditor());
      },
    ],
    [
      "another page took over its id",
      async () => {
        fixture.page = {
          ...fixture.page!,
          createdAt: "2026-10-19T13:00:00.000Z",
        };
        await act(async () => renderEditor());
      },
    ],
  ])(
    "leaves its journal entry for the page's next open when its confirmation arrives after %s",
    async (_, end) => {
      const { toastError, settle } = await typeAndSave();
      expect(journaled()).toEqual(["Typed before leaving"]);

      await end();
      await answer(() => settle.resolve(confirmation()));

      expect(journaled()).toEqual(["Typed before leaving"]);
      expect(upserts()).toEqual([]);
      expect(toastError).not.toHaveBeenCalled();
      expect(unhandled).toEqual([]);
      expect(fixture.saveFailures).toEqual([
        expect.objectContaining({
          handoff: {
            during: "save",
            answer: {
              status: "fulfilled",
              value: expect.objectContaining({
                content: "Typed before leaving",
                revision: "r2",
              }),
            },
          },
        }),
      ]);
      expect(fixture.saveFailures[0]).toBeInstanceOf(PageSaveHandedOff);
    },
  );

  it("keeps nothing and reports nothing when a displacing answer arrives after it left", async () => {
    const { toastError, settle } = await leaveDuringSave();
    await answer(() => settle.resolve(displacing()));

    expect(await savesAfterTimers()).toBe(0);
    expect(upserts()).toEqual([]);
    expect(toastError).not.toHaveBeenCalled();
    expect(unhandled).toEqual([]);
    expect(fixture.saveFailures).toEqual([
      expect.objectContaining({
        handoff: {
          during: "save",
          answer: {
            status: "fulfilled",
            value: expect.objectContaining({ conflict: true }),
          },
        },
      }),
    ]);
  });

  it("stops after its displaced text is kept when it leaves during that write", async () => {
    let kept!: () => void;
    fixture.mutation.mutateAsync.mockImplementation(async (input) => {
      if (input.operation !== "upsert")
        return { status: "deleted", draft: null };
      await new Promise<void>((resolve) => {
        kept = resolve;
      });
      return { status: "saved", draft: { ...input.draft, version: 1 } };
    });
    const { toastError, settle } = await typeAndSave();
    await answer(() => settle.resolve(displacing()));
    expect(upserts()).toHaveLength(1);
    expect(upserts()[0][0]).toMatchObject({
      draft: { content: "Typed before leaving" },
    });

    await act(async () => root.unmount());
    await answer(() => kept());

    expect(await savesAfterTimers()).toBe(0);
    expect(upserts()).toHaveLength(1);
    expect(journaled()).toEqual(["Typed before leaving"]);
    expect(toastError).not.toHaveBeenCalled();
    expect(unhandled).toEqual([]);
    // The request's own answer, not the retention write's.
    expect(fixture.saveFailures).toEqual([
      expect.objectContaining({
        handoff: {
          during: "save",
          answer: {
            status: "fulfilled",
            value: expect.objectContaining({
              status: "displaced",
              localDraft: "Typed before leaving",
            }),
          },
        },
      }),
    ]);
  });

  it("reports a displaced text it could not keep while it stays", async () => {
    fixture.mutation.mutateAsync.mockImplementation(async (input) => {
      if (input.operation !== "upsert")
        return { status: "deleted", draft: null };
      throw new Error("Draft store down");
    });
    const { toastError, settle } = await typeAndSave();
    await answer(() => settle.resolve(displacing()));

    expect(toastError).toHaveBeenCalled();
    expect(journaled()).toEqual(["Typed before leaving"]);
  });

  it("lets its late confirmation end quietly without clearing the next editor's draft", async () => {
    const { toastError, settle } = await leaveDuringSave();
    await answer(() =>
      settle.resolve({
        ...fixture.page!,
        content: "Typed before leaving",
        revision: "r2",
        updatedAt: "2026-10-19T12:00:01.000Z",
      }),
    );
    expect(await savesAfterTimers()).toBe(0);
    expect(toastError).not.toHaveBeenCalled();
    expect(fixture.mutation.mutateAsync).not.toHaveBeenCalled();
  });

  it("keeps nothing and retries nothing when its late refusal arrives", async () => {
    const { toastError, settle } = await leaveDuringSave();
    await refuse(settle);
    expect(await savesAfterTimers()).toBe(0);
    expect(toastError).not.toHaveBeenCalled();
    expect(fixture.mutation.mutateAsync).not.toHaveBeenCalled();
  });

  it("still reports a save that failed after it left", async () => {
    const { toastError, settle } = await leaveDuringSave();
    await answer(() => settle.reject(new Error("Network down")));
    expect(await savesAfterTimers()).toBe(0);
    expect(toastError).toHaveBeenCalledExactlyOnceWith("empty.genericError", {
      description: "Network down",
    });
    expect(fixture.mutation.mutateAsync).not.toHaveBeenCalled();
  });

  it("keeps a refused edit for review while it stays", async () => {
    const { toastError, settle } = await typeAndSave();
    await refuse(settle);
    expect(toastError).not.toHaveBeenCalled();
    expect(upserts()[0]?.[0]).toMatchObject({
      draft: { content: "Typed before leaving" },
    });
  });

  it("reports a failed save and keeps its edit while it stays", async () => {
    const { toastError, settle } = await typeAndSave();
    await answer(() => settle.reject(new Error("Network down")));
    expect(toastError).toHaveBeenCalledExactlyOnceWith("empty.genericError", {
      description: "Network down",
    });
    expect(upserts()[0]?.[0]).toMatchObject({
      draft: { content: "Typed before leaving" },
    });
  });
});

describe("a peer title adopted while a recovery draft is retained", () => {
  const JOURNAL_PREFIX = "content-page-draft-journal-v1:";
  const peerTitle = "Peer title";
  function journalTitles() {
    const titles: { title: string; baseTitle: string; content: string }[] = [];
    for (let index = 0; index < localStorage.length; index++) {
      const key = localStorage.key(index)!;
      if (!key.startsWith(JOURNAL_PREFIX)) continue;
      const { title, baseTitle, content } = JSON.parse(
        localStorage.getItem(key)!,
      ).snapshot;
      titles.push({ title, baseTitle, content });
    }
    return titles;
  }
  // Poll in real time: vi.waitFor advances the fake clock, which would run the
  // 800 ms save retry and re-retain the draft through a new save instead.
  async function untilReal(predicate: () => boolean) {
    const deadline = realPerformance.now() + 2_000;
    while (!predicate() && realPerformance.now() < deadline) {
      await act(async () => {
        await realDelay(10);
      });
    }
  }
  function upserts() {
    return fixture.mutation.mutateAsync.mock.calls
      .map(([input]) => input)
      .filter((input) => input.operation === "upsert");
  }
  function held() {
    let release!: () => void;
    const promise = new Promise<void>((resolve) => {
      release = resolve;
    });
    return { promise, release };
  }
  // happy-dom binds Storage methods onto the instance, so only an instance
  // override reaches the editor's writes.
  function failNextJournalWrite() {
    const setItem = localStorage.setItem;
    let failedWrites = 0;
    Object.defineProperty(localStorage, "setItem", {
      configurable: true,
      writable: true,
      value: (key: string, value: string) => {
        if (failedWrites === 0 && key.startsWith(JOURNAL_PREFIX)) {
          failedWrites++;
          throw new DOMException("Journal storage full", "QuotaExceededError");
        }
        setItem(key, value);
      },
    });
    return {
      failedWrites: () => failedWrites,
      restore: () =>
        Object.defineProperty(localStorage, "setItem", {
          configurable: true,
          writable: true,
          value: setItem,
        }),
    };
  }
  async function retainBodyEdit({
    beforeUpsert,
    rename,
  }: {
    beforeUpsert?: (upsert: number) => Promise<void> | void;
    rename?: string;
  } = {}) {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    fixture.flushUpdates.mockResolvedValueOnce(false);
    const journalAtUpsert: ReturnType<typeof journalTitles>[] = [];
    fixture.mutation.mutateAsync.mockImplementation(async (input) => {
      if (input.operation !== "upsert")
        return { status: "deleted", draft: null };
      journalAtUpsert.push(journalTitles());
      await beforeUpsert?.(journalAtUpsert.length);
      return {
        status: "saved",
        draft: {
          ...input.draft,
          id: "retained-row",
          version: (input.expectedVersion ?? 0) + 1,
        },
      };
    });
    await act(async () => renderEditor());
    if (rename) pasteTitle(rename);
    act(() => fixture.editor!.onChange("Local body"));
    await act(async () => vi.advanceTimersByTimeAsync(500));
    await untilReal(() => upserts().length === 1);
    expect(upserts()).toHaveLength(1);
    expect(upserts()[0]).toMatchObject({
      expectedVersion: null,
      draft: {
        title: rename ?? "Saved title",
        baseTitle: "Saved title",
        content: "Local body",
      },
    });
    return journalAtUpsert;
  }
  function renamePeerPage(
    title = peerTitle,
    updatedAt = "2026-10-19T12:00:02.000Z",
  ) {
    act(() => {
      fixture.page = { ...fixture.page!, title, updatedAt };
      fixture.pageVersion += 1;
      for (const notify of fixture.pageSubscribers) notify();
    });
    expect(
      container.querySelector<HTMLTextAreaElement>("textarea")!.value,
    ).toBe(title);
  }
  function bodyBase(upsert: number) {
    const { baseDocumentUpdatedAt, baseContentHash } = upserts()[upsert]!.draft;
    return { baseDocumentUpdatedAt, baseContentHash };
  }

  it.each([false, true])(
    "re-titles the body-only draft journal-first under the adopted title (journal write fails: %s)",
    async (journalWriteFails) => {
      const toastError = vi.spyOn(toast, "error");
      const journalAtUpsert = await retainBodyEdit();
      const failure = journalWriteFails ? failNextJournalWrite() : null;
      try {
        renamePeerPage();
        await untilReal(() => upserts().length === 2);
      } finally {
        failure?.restore();
      }
      expect(failure?.failedWrites() ?? 0).toBe(journalWriteFails ? 1 : 0);
      expect(upserts()).toHaveLength(2);
      expect(upserts()[1]).toMatchObject({
        expectedVersion: 1,
        expectedDraftId: "retained-row",
        draft: {
          title: peerTitle,
          baseTitle: peerTitle,
          content: "Local body",
        },
      });
      expect(bodyBase(1)).toEqual(bodyBase(0));
      const journal = journalWriteFails
        ? { title: "Saved title", baseTitle: "Saved title" }
        : { title: peerTitle, baseTitle: peerTitle };
      expect(journalAtUpsert[1]).toEqual([
        expect.objectContaining({ ...journal, content: "Local body" }),
      ]);
      await act(async () => realDelay(20));
      expect(journalTitles()).toEqual([
        expect.objectContaining({ ...journal, content: "Local body" }),
      ]);
      if (journalWriteFails)
        expect(toastError).toHaveBeenCalledExactlyOnceWith(
          "editor.pageSaveBeforeNavigationFailed",
        );
      else expect(toastError).not.toHaveBeenCalled();
      expect(fixture.save).not.toHaveBeenCalled();
    },
  );

  it("does not re-title the draft after the editor's recovery scope ended", async () => {
    const toastError = vi.spyOn(toast, "error");
    const retention = held();
    await retainBodyEdit({
      beforeUpsert: (upsert) => (upsert === 1 ? retention.promise : undefined),
    });
    renamePeerPage();
    await act(async () => root.unmount());
    await act(async () => {
      retention.release();
      await realDelay(20);
    });
    expect(upserts()).toHaveLength(1);
    expect(toastError).not.toHaveBeenCalled();
    expect(fixture.save).not.toHaveBeenCalled();
  });

  it("leaves the re-titled journal as written when the editor leaves while its re-title is in flight", async () => {
    const toastError = vi.spyOn(toast, "error");
    const retitle = held();
    const journalAtUpsert = await retainBodyEdit({
      beforeUpsert: (upsert) => (upsert === 2 ? retitle.promise : undefined),
    });
    renamePeerPage();
    await untilReal(() => upserts().length === 2);
    const retitled = expect.objectContaining({
      title: peerTitle,
      baseTitle: peerTitle,
      content: "Local body",
    });
    expect(journalAtUpsert[1]).toEqual([retitled]);
    await act(async () => root.unmount());
    // The server applies the re-title after the editor has left.
    await act(async () => {
      retitle.release();
      await realDelay(20);
    });
    expect(upserts()).toHaveLength(2);
    expect(journalTitles()).toEqual([retitled]);
    expect(toastError).not.toHaveBeenCalled();
    expect(fixture.save).not.toHaveBeenCalled();
  });

  it("restores the journal when the re-title it wrote first fails to persist", async () => {
    const toastError = vi.spyOn(toast, "error");
    const journalAtUpsert = await retainBodyEdit({
      beforeUpsert: (upsert) => {
        if (upsert === 2) throw new Error("SQL unavailable");
      },
    });
    renamePeerPage();
    await untilReal(() => toastError.mock.calls.length > 0);
    expect(upserts()).toHaveLength(2);
    expect(journalAtUpsert[1]).toEqual([
      expect.objectContaining({ title: peerTitle, baseTitle: peerTitle }),
    ]);
    expect(journalTitles()).toEqual([
      expect.objectContaining({
        title: "Saved title",
        baseTitle: "Saved title",
        content: "Local body",
      }),
    ]);
    expect(toastError).toHaveBeenCalledExactlyOnceWith(
      "editor.pageSaveBeforeNavigationFailed",
    );
    expect(fixture.save).not.toHaveBeenCalled();
  });

  it.each([false, true])(
    "re-titles a queued body-only retention journal-first when the editor adopts a title before it starts (journal write fails: %s)",
    async (journalWriteFails) => {
      const toastError = vi.spyOn(toast, "error");
      const retitle = held();
      const journalAtUpsert = await retainBodyEdit({
        beforeUpsert: (upsert) => (upsert === 2 ? retitle.promise : undefined),
      });
      renamePeerPage();
      await untilReal(() => upserts().length === 2);
      // A second body edit whose save fails queues its body-only retention
      // behind the held re-title.
      fixture.flushUpdates.mockResolvedValueOnce(false);
      act(() => fixture.editor!.onChange("Second body"));
      await act(async () => vi.advanceTimersByTimeAsync(500));
      await untilReal(() => fixture.flushUpdates.mock.calls.length === 2);
      await act(async () => realDelay(20));
      expect(upserts()).toHaveLength(2);
      const queuedUnder = expect.objectContaining({
        title: peerTitle,
        baseTitle: peerTitle,
        content: "Second body",
      });
      expect(journalTitles()).toEqual([queuedUnder]);
      // The editor adopts a newer peer title before that retention starts.
      renamePeerPage("Newest peer title", "2026-10-19T12:00:03.000Z");
      const failure = journalWriteFails ? failNextJournalWrite() : null;
      try {
        retitle.release();
        await untilReal(() => upserts().length === 3);
        await act(async () => realDelay(20));
      } finally {
        failure?.restore();
      }
      expect(failure?.failedWrites() ?? 0).toBe(journalWriteFails ? 1 : 0);
      expect(upserts()).toHaveLength(3);
      expect(upserts()[2]).toMatchObject({
        expectedVersion: 2,
        expectedDraftId: "retained-row",
        draft: {
          title: "Newest peer title",
          baseTitle: "Newest peer title",
          content: "Second body",
        },
      });
      const journal = journalWriteFails
        ? queuedUnder
        : expect.objectContaining({
            title: "Newest peer title",
            baseTitle: "Newest peer title",
            content: "Second body",
          });
      expect(journalAtUpsert[2]).toEqual([journal]);
      expect(journalTitles()).toEqual([journal]);
      if (journalWriteFails)
        expect(toastError).toHaveBeenCalledExactlyOnceWith(
          "editor.pageSaveBeforeNavigationFailed",
        );
      else expect(toastError).not.toHaveBeenCalled();
      expect(fixture.save).not.toHaveBeenCalled();
    },
  );

  it("keeps a retained rename's own title when the editor adopts a newer peer title", async () => {
    const toastError = vi.spyOn(toast, "error");
    await retainBodyEdit({ rename: "My rename" });
    renamePeerPage();
    await act(async () => realDelay(50));
    expect(upserts()).toHaveLength(1);
    expect(journalTitles()).toEqual([
      expect.objectContaining({
        title: "My rename",
        baseTitle: "Saved title",
        content: "Local body",
      }),
    ]);
    expect(toastError).not.toHaveBeenCalled();
    expect(fixture.save).not.toHaveBeenCalled();
  });

  it("checks the delete of a draft its save made obsolete for the page that asked, before a render queued behind the answer hands the editor to another", async () => {
    const createdAt = fixture.page!.createdAt;
    await retainBodyEdit();
    const deletion = held();
    let endedBeforeCheck: boolean | null = null;
    let ended = false;
    fixture.mutation.mutateAsync.mockImplementation(async (input) => {
      if (input.operation !== "delete")
        throw new Error(`Unexpected ${input.operation}`);
      await deletion.promise;
      return {
        get status() {
          endedBeforeCheck = ended;
          return "deleted";
        },
        draft: null,
      };
    });
    fixture.save.mockImplementation(async () => ({
      ...fixture.page!,
      content: "Local body",
      revision: "r2",
      updatedAt: "2026-10-19T12:00:01.000Z",
    }));
    const deletes = () =>
      fixture.mutation.mutateAsync.mock.calls.filter(
        ([input]) => input.operation === "delete",
      );
    await act(async () => vi.advanceTimersByTimeAsync(800));
    await untilReal(() => deletes().length === 1);
    expect(deletes()[0]![0]).toMatchObject({ expectedDraftId: "retained-row" });

    // An account change remounts the editor, so the page's creation time is
    // the fact this editor can briefly not know.
    fixture.page = {
      ...fixture.page!,
      createdAt: undefined,
    } as unknown as Document;
    act(() => renderEditor());
    await act(async () => {
      deletion.release();
      await realDelay(20);
    });
    expect(endedBeforeCheck).toBeNull();

    act(() => {
      fixture.page = { ...fixture.page!, createdAt };
      renderEditor();
    });
    // Queued behind the admitted answer, as React queues a synchronous render,
    // and outside any act scope so that render commits in its own turn.
    queueMicrotask(() => {
      ended = true;
      fixture.page = {
        ...fixture.page!,
        createdAt: "2026-10-19T13:00:00.000Z",
      };
      act(() => renderEditor());
    });
    await realDelay(20);
    await act(async () => {});

    expect(endedBeforeCheck).toBe(false);
    expect(fixture.saveFailures).toEqual([
      expect.objectContaining({
        handoff: {
          during: "recovery",
          result: expect.objectContaining({ contentPersisted: true }),
        },
      }),
    ]);
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
  // The retained draft waits on a real content hash. Wait in real time: the
  // fake clock still has to measure the 800 ms retry exactly.
  const deadline = realPerformance.now() + 2_000;
  while (
    !fixture.mutation.mutateAsync.mock.calls.some(
      ([input]) => input.operation === "upsert",
    ) &&
    realPerformance.now() < deadline
  ) {
    await act(async () => {
      await realDelay(10);
    });
  }
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

it("binds a repeated recovery draft retention to the row it last saved", async () => {
  fixture.flushUpdates
    .mockResolvedValueOnce(false)
    .mockResolvedValueOnce(false);
  fixture.mutation.mutateAsync.mockImplementation(async (input) =>
    input.operation === "upsert"
      ? {
          status: "saved",
          draft: {
            ...input.draft,
            id: "retained-row",
            version: (input.expectedVersion ?? 0) + 1,
          },
        }
      : { status: "deleted", draft: null },
  );
  await act(async () => renderEditor());

  act(() => fixture.editor!.onChange("First retained edit"));
  await vi.waitFor(
    () => expect(fixture.mutation.mutateAsync).toHaveBeenCalledOnce(),
    { timeout: 3_000 },
  );
  act(() => fixture.editor!.onChange("Second retained edit"));
  await vi.waitFor(
    () => expect(fixture.mutation.mutateAsync).toHaveBeenCalledTimes(2),
    { timeout: 3_000 },
  );

  const [[created], [updated]] = fixture.mutation.mutateAsync.mock.calls;
  expect(created).toMatchObject({
    operation: "upsert",
    expectedVersion: null,
    draft: { content: "First retained edit" },
  });
  expect(created).not.toHaveProperty("expectedDraftId");
  expect(updated).toMatchObject({
    operation: "upsert",
    expectedVersion: 1,
    expectedDraftId: "retained-row",
    draft: { content: "Second retained edit" },
  });
  expect(fixture.save).not.toHaveBeenCalled();
});

it("does not adopt a same-text replacement as the recovery draft it retains", async () => {
  fixture.flushUpdates
    .mockResolvedValueOnce(false)
    .mockResolvedValueOnce(false)
    .mockResolvedValueOnce(false);
  fixture.mutation.mutateAsync.mockImplementation(async (input) => {
    if (input.operation !== "upsert") return { status: "deleted", draft: null };
    // The server's row is a replacement from this same editor session that
    // already holds the second edit; the editor never saved that row.
    if (input.draft.content === "Second retained edit")
      return {
        status: "conflict",
        draft: { ...input.draft, id: "replacement-row", version: 1 },
      };
    return {
      status: "saved",
      draft: {
        ...input.draft,
        id: "retained-row",
        version: (input.expectedVersion ?? 0) + 1,
      },
    };
  });
  const upserts = () =>
    fixture.mutation.mutateAsync.mock.calls
      .map(([input]) => input)
      .filter((input) => input.operation === "upsert");
  await act(async () => renderEditor());

  for (const [index, content] of [
    "First retained edit",
    "Second retained edit",
    "Third retained edit",
  ].entries()) {
    act(() => fixture.editor!.onChange(content));
    await vi.waitFor(() => expect(upserts()).toHaveLength(index + 1), {
      timeout: 3_000,
    });
  }

  expect(upserts()).toMatchObject([
    { expectedVersion: null, draft: { content: "First retained edit" } },
    {
      expectedVersion: 1,
      expectedDraftId: "retained-row",
      draft: { content: "Second retained edit" },
    },
    {
      expectedVersion: 1,
      expectedDraftId: "retained-row",
      draft: { content: "Third retained edit" },
    },
  ]);
});

it("keeps a retention bound to its row when a chosen recovery clears it mid-hash", async () => {
  let finishChoice!: (result: unknown) => void;
  fixture.mutation.mutateAsync.mockImplementation(async (input) => {
    if (input.operation === "upsert")
      return {
        status: "saved",
        draft: {
          ...input.draft,
          id: "chosen-row",
          version: (input.expectedVersion ?? 0) + 1,
        },
      };
    if (input.choice)
      return new Promise((resolve) => {
        finishChoice = resolve;
      });
    return { status: "deleted", draft: null };
  });
  const upserts = () =>
    fixture.mutation.mutateAsync.mock.calls
      .map(([input]) => input)
      .filter((input) => input.operation === "upsert");
  await act(async () => renderEditor());
  act(() => fixture.editor!.onChange("Local edit"));
  act(() => fixture.recovery!.report("conflict", "Local edit"));
  expect(fixture.reconcileChooser).not.toBeNull();

  let chosen!: Promise<boolean>;
  act(() => {
    chosen = fixture.reconcileChooser!.onUseSaved({
      title: fixture.page!.title,
      content: fixture.page!.content,
      updatedAt: fixture.page!.updatedAt,
      revision: fixture.page!.revision,
    });
  });
  await vi.waitFor(
    () =>
      expect(fixture.mutation.mutateAsync).toHaveBeenCalledWith(
        expect.objectContaining({ choice: "use_saved" }),
      ),
    { timeout: 3_000 },
  );
  expect(upserts()).toHaveLength(1);

  let releaseHash!: () => void;
  fixture.contentHashHold = new Promise((resolve) => {
    releaseHash = resolve;
  });
  fixture.contentHashStarted.mockClear();
  fixture.flushUpdates.mockResolvedValueOnce(false);
  act(() => fixture.editor!.onChange("Edit during the choice"));
  await vi.waitFor(
    () => expect(fixture.contentHashStarted).toHaveBeenCalledOnce(),
    { timeout: 3_000 },
  );
  // The resolved choice clears the editor's draft at once, but its follow-up
  // waits behind the held retention, so the hash is released first.
  await act(async () => {
    finishChoice({ status: "resolved" });
    await realDelay(10);
  });
  await act(async () => releaseHash());
  // Later retries queue behind the held retention, so it is the second write.
  await vi.waitFor(() => expect(upserts().length).toBeGreaterThanOrEqual(2), {
    timeout: 3_000,
  });
  await act(async () => {
    await chosen;
  });

  expect(upserts()[1]).toMatchObject({
    expectedVersion: 1,
    expectedDraftId: "chosen-row",
    draft: { content: "Edit during the choice" },
  });
});

describe("a retried save whose edit a peer's save already stored", () => {
  const edited = "Saved body, edited in this tab";
  const stored = `${edited}, and in another`;

  function journalKeys() {
    return Object.keys(localStorage).filter((key) =>
      key.startsWith("content-page-draft-journal-v1:"),
    );
  }

  async function retryAfterPeerStoredEdit() {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    fixture.flushUpdates.mockResolvedValueOnce(false);
    await act(async () => renderEditor());

    act(() => fixture.editor!.onChange(edited));
    await act(async () => vi.advanceTimersByTimeAsync(500));
    expect(fixture.save).not.toHaveBeenCalled();
    expect(journalKeys()).toHaveLength(1);

    act(() => fixture.editor!.onRemoteSnapshotChange!(stored));
    fixture.page = {
      ...fixture.page!,
      content: stored,
      revision: "r2",
      updatedAt: "2026-10-19T12:00:01.000Z",
    };
    await act(async () => renderEditor());
    await act(async () => vi.advanceTimersByTimeAsync(800));
    expect(fixture.save).toHaveBeenCalledOnce();
    expect(fixture.save.mock.calls[0][0]).toMatchObject({
      title: fixture.page.title,
      content: stored,
      baseRevision: "r2",
    });
  }

  it("clears the journal once the server confirms it holds the edit", async () => {
    fixture.save.mockImplementation(async () => fixture.page);
    await retryAfterPeerStoredEdit();
    expect(journalKeys()).toEqual([]);
  });

  it("keeps the journal when the server refuses the confirmation", async () => {
    fixture.save.mockImplementation(async () => ({
      conflict: true,
      document: fixture.page,
    }));
    await retryAfterPeerStoredEdit();
    expect(journalKeys()).toHaveLength(1);
  });

  it("clears the journal as the confirmation is admitted for the page that asked, before a render queued behind it hands the editor to another", async () => {
    const createdAt = fixture.page!.createdAt;
    let confirm!: () => void;
    fixture.save.mockImplementation(
      () =>
        new Promise((resolve) => {
          confirm = () => resolve(fixture.page);
        }),
    );
    await retryAfterPeerStoredEdit();

    fixture.page = {
      ...fixture.page!,
      createdAt: undefined,
    } as unknown as Document;
    act(() => renderEditor());
    await act(async () => {
      confirm();
      await realDelay(20);
    });
    expect(journalKeys()).toHaveLength(1);

    let journalAtEnd: string[] | null = null;
    act(() => {
      fixture.page = { ...fixture.page!, createdAt };
      renderEditor();
    });
    queueMicrotask(() => {
      journalAtEnd = journalKeys();
      fixture.page = {
        ...fixture.page!,
        createdAt: "2026-10-19T13:00:00.000Z",
      };
      act(() => renderEditor());
    });
    await realDelay(20);
    await act(async () => {});

    expect(journalAtEnd).toEqual([]);
    expect(journalKeys()).toEqual([]);
    expect(fixture.saveFailures).toEqual([
      expect.objectContaining({
        handoff: {
          during: "recovery",
          result: { contentPersisted: true },
        },
      }),
    ]);
  });
});

describe("actual additional field freshness", () => {
  async function mountField(fakeDate = false) {
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
    vi.useFakeTimers({
      toFake: fakeDate
        ? ["Date", "setTimeout", "clearTimeout"]
        : ["setTimeout", "clearTimeout"],
    });
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
  async function fieldAcks(count: number, timeoutMs = 2_000) {
    const deadline = realPerformance.now() + timeoutMs;
    // Native time lets WebCrypto finish without advancing debounce or request expiry.
    while (publishedAcks().length < count && realPerformance.now() < deadline)
      await act(async () => {
        await realDelay(10);
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

  it("discovers an empty-primary page's live field editor and captures its real un-emitted input through the server barrier", async () => {
    fixture.page!.content = "";
    await mountField(true);
    fieldInput(" fresh");
    expect(fieldState().pending).toBe("Additional body");
    const store = connectBarrierStore("notes");
    const result = await runConnectedBarrier("notes");
    expect(result).toMatchObject({
      value: {
        status: "flushed",
        snapshot: {
          kind: "property",
          propertyId: "notes",
          content: "Additional body fresh",
        },
        editors: [{ flush: "answered" }],
      },
    });
    expect(fixture.fieldSave).toHaveBeenCalledTimes(1);
    expect(store.requests[0].phase).toBe("prepare");
    expect(store.requests[store.requests.length - 1].phase).toBe("verify");
    expect(store.captures.length).toBeGreaterThan(0);
    expect(
      store.captures.every(
        (snapshot) => snapshot.content === "Additional body fresh",
      ),
    ).toBe(true);
    const acks = publishedAcks();
    expect(acks[acks.length - 1]).toHaveProperty("status", "verified");
    expect(store.values.size).toBe(0);
  });

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

  it("requires fresh confirmation before flushing a reverted failed field under suggestion lock", async () => {
    await mountField();
    const failure = new Error("Blocks field revision conflict");
    fixture.fieldSave.mockRejectedValue(failure);
    fieldInput(" rejected edit");
    await act(async () => {
      expect(await fixture.fieldController!.flushLatest()).toBe(false);
    });
    expect(fieldState().pending).toBe("Additional body rejected edit");
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
    await act(async () => vi.advanceTimersByTimeAsync(0));
    expect(fieldState().pending).toBe("Additional body");
    expect(fieldState().lastError).toBe(failure);
    fixture.lockAdditionalForSuggestions = true;
    await act(async () => renderEditor());
    expect(fixture.fieldEditor!.isEditable).toBe(false);
    await act(async () => {
      await expect(fixture.session!.flush()).rejects.toThrow(
        "editor.pageSaveBeforeNavigationFailed",
      );
    });
    expect(fieldState().isClean).toBe(false);
    expect(fixture.fieldSave).toHaveBeenCalledOnce();
    // A newer authoritative field read confirms the reverted value.
    fixture.fields = {
      ...fixture.fields!,
      properties: fixture.fields!.properties.map((field) =>
        field.definition.id === "notes"
          ? {
              ...field,
              blocksField: {
                ...field.blocksField!,
                revision: field.blocksField!.revision + 1,
              },
            }
          : field,
      ),
    };
    await act(async () => renderEditor());
    await act(async () => {
      await expect(fixture.session!.flush()).resolves.toBeUndefined();
    });
    expect(fieldState().lastError).toBeNull();
    expect(fieldState().isClean).toBe(true);
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

  it("waits for a held native field hash and verifies its receipt without advancing editor timers", async () => {
    await mountField(true);
    act(() => fixture.editor!.onChange("Unrelated debounced primary edit"));
    const frozenTime = Date.now();
    const digest = crypto.subtle.digest.bind(crypto.subtle);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const hash = vi
      .spyOn(crypto.subtle, "digest")
      .mockImplementation(async (...args) => {
        await gate;
        return digest(...args);
      });
    await deliver(flushRequest("prepare", "held-hash", "notes"));
    expect(hash).toHaveBeenCalledOnce();
    let settled = false;
    const waiting = fieldAcks(1).then(
      (ack) => {
        settled = true;
        return { ack, error: undefined };
      },
      (error: unknown) => {
        settled = true;
        return { ack: undefined, error };
      },
    );
    await realDelay(50);
    const settledWhileHeld = settled;
    const acksWhileHeld = publishedAcks();
    release();
    const answer = await waiting;
    expect(settledWhileHeld).toBe(false);
    expect(acksWhileHeld).toHaveLength(0);
    expect(answer.error).toBeUndefined();
    expect(answer.ack).toMatchObject({
      status: "prepared",
      claim: {
        kind: "property",
        propertyId: "notes",
        contentHash:
          "sha256:" +
          createHash("sha256").update("Additional body").digest("hex"),
      },
    });
    expect(await fieldPhase("verify", "held-hash", 2)).toMatchObject({
      status: "verified",
      stabilityToken: answer.ack.stabilityToken,
    });
    expect(publishedAcks().map((ack) => ack.status)).toEqual([
      "prepared",
      "verified",
    ]);
    expect(Date.now()).toBe(frozenTime);
    expect(fixture.save).not.toHaveBeenCalled();
    expect(fixture.fieldSave).not.toHaveBeenCalled();
  });

  it("bounds an absent field ACK wait in real time while the fixture clock remains frozen", async () => {
    await mountField(true);
    const frozenTime = Date.now();
    await deliver({
      ...flushRequest("prepare", "already-expired", "notes"),
      expiresAt: frozenTime - 1,
    });
    const started = realPerformance.now();
    await expect(fieldAcks(1, 50)).rejects.toThrow(/length of 1/);
    expect(realPerformance.now() - started).toBeGreaterThanOrEqual(50);
    expect(Date.now()).toBe(frozenTime);
    expect(publishedAcks()).toHaveLength(0);
    expect(fixture.fieldSave).not.toHaveBeenCalled();
  }, 5_000);

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
