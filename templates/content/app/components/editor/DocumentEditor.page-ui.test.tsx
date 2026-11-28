// @vitest-environment happy-dom

import type { ResourceSuggestion } from "@agent-native/core/review";
import type { Document } from "@shared/api";
import { canonicalizeNfm } from "@shared/nfm";
import { sameSourceMarkdown } from "@shared/source-markdown";
import { markdownSuggestionOperations } from "@shared/suggestion-diff";
import type { QueryClient } from "@tanstack/react-query";
import type { Editor } from "@tiptap/core";
import { act, createElement, type ComponentProps, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { CommentThread } from "@/hooks/use-comments";
import {
  rememberLinkedLocalSourceDirectory,
  type LocalSourceDocumentReadResult,
} from "@/lib/local-content-source-files";

import type {
  VisualEditor,
  VisualEditorPersistenceController,
} from "./VisualEditor";

type ToolbarProps = {
  documentId: string;
  canEdit?: boolean;
  canUndo?: boolean;
  onSuggestingChange?: (next: boolean) => void;
};
type AgentBridgeProps = {
  onPersisted: (persisted: Document, revision?: string) => void;
};
type SidebarProps = {
  documentId: string;
  presentation?: "inline" | "history";
  selectedThreadId?: string | null;
  onActivateThread?: (threadId: string) => void;
  pendingComment?: { id: symbol; text: string } | null;
  pendingTargetValid?: boolean;
  onPendingChange?: (id: symbol, change: () => { text: string }) => void;
};

const fixture = vi.hoisted(() => ({
  pages: {} as Record<string, Document>,
  threads: [] as CommentThread[],
  suggestions: [] as ResourceSuggestion[],
  readLocal: null as LocalSourceDocumentReadResult | null,
  localWrites: [] as {
    title: string;
    content: string;
    expectedRevision?: string;
    accepted: boolean;
  }[],
  localFileChanged: null as (() => void) | null,
  realLocalSource: false,
  heldReads: null as (() => void)[] | null,
  heldWrites: null as (() => void)[] | null,
  heldEditorReports: null as (() => void)[] | null,
  unholdable: new Set<string>(),
  agentBridge: null as AgentBridgeProps | null,
  realEditor: false,
  persistence: null as VisualEditorPersistenceController | null,
  reportPersistence: new WeakMap<
    (controller: VisualEditorPersistenceController | null) => void,
    (controller: VisualEditorPersistenceController | null) => void
  >(),
  toolbars: [] as ToolbarProps[],
  sidebars: [] as SidebarProps[],
  properties: [] as { documentId: string; databaseId?: string | null }[],
  editors: [] as ComponentProps<typeof VisualEditor>[],
  t: (key: string) => key,
  mutation: { mutate: vi.fn(), mutateAsync: vi.fn() },
  emptyQuery: { data: undefined, isFetching: false, isError: false },
}));

vi.mock("@agent-native/core/client/application-state", () => ({
  readClientAppState: async () => null,
  compareAndSetClientAppState: async () => true,
  writeClientAppState: async () => {},
}));
vi.mock("@agent-native/core/client/hooks", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@agent-native/core/client/hooks")>()),
  useSession: () => ({
    session: { email: "writer@example.test", orgId: "org" },
  }),
  useDbSync: () => {},
  useAvatarUrl: () => undefined,
  useActionMutation: () => fixture.mutation,
  callAction: async () => null,
  tryCallActionKeepalive: () => ({ accepted: false }),
  setClientAppState: async () => {},
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
    awareness: null,
    isSynced: true,
    initialization: { status: "ready" },
    activeUsers: [],
    requestSync: vi.fn(),
    flushUpdates: async () => true,
  }),
}));
vi.mock("@agent-native/core/client/review", () => ({
  useResourceSuggestions: () => ({
    data: { suggestions: fixture.suggestions },
    isFetching: false,
    isError: false,
    refetch: async () => ({
      data: { suggestions: fixture.suggestions },
      isError: false,
      error: null,
    }),
  }),
  useCreateResourceSuggestionProposal: () => fixture.mutation,
  useDecideResourceSuggestion: () => fixture.mutation,
  useDecideResourceSuggestionProposal: () => fixture.mutation,
  useUpdateResourceSuggestion: () => fixture.mutation,
}));
vi.mock("@/hooks/use-documents", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/hooks/use-documents")>()),
  usePageOpenDocument: (documentId: string) => ({
    query: { data: fixture.pages[documentId], dataUpdatedAt: 1 },
    fetchedForThisOpen: true,
    readsStartedEarly: true,
  }),
  useUpdateDocument: () => fixture.mutation,
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
  useComments: (documentId: string | null) => ({
    ...fixture.emptyQuery,
    data: documentId ? fixture.threads : undefined,
  }),
}));
vi.mock("@/hooks/use-document-properties", async (original) => ({
  ...(await original<typeof import("@/hooks/use-document-properties")>()),
  useDocumentProperties: () => ({
    data: null,
    isError: false,
    isRefetching: false,
  }),
  useConfigureDocumentProperty: () => fixture.mutation,
  useDeleteDocumentProperty: () => fixture.mutation,
  useReorderDocumentProperty: () => fixture.mutation,
  useSetDocumentProperty: () => fixture.mutation,
}));
vi.mock("@/lib/local-content-source-files", async (original) => {
  const actual =
    await original<typeof import("@/lib/local-content-source-files")>();
  const held = (queue: (() => void)[] | null) =>
    queue ? new Promise<void>((resolve) => queue.push(resolve)) : null;
  return {
    ...actual,
    canWriteLinkedLocalSource: (_id: string, source: Document["source"]) =>
      source?.mode === "local-files",
    readDocumentFromLinkedLocalSource: async (
      ...args: Parameters<typeof actual.readDocumentFromLinkedLocalSource>
    ) => {
      if (fixture.realLocalSource) {
        return actual.readDocumentFromLinkedLocalSource(...args);
      }
      const read = fixture.readLocal;
      await held(fixture.heldReads);
      return read;
    },
    watchLinkedLocalSource: async (
      ...args: Parameters<typeof actual.watchLinkedLocalSource>
    ) => {
      if (fixture.realLocalSource)
        return actual.watchLinkedLocalSource(...args);
      const [, onChange] = args;
      fixture.localFileChanged = () =>
        onChange({
          folderId: "notes",
          revision: "",
          changedAt: "",
          sourcePath: "notes/page.md",
        });
      return { ok: true, unsubscribe: () => {} };
    },
    writeDocumentToLinkedLocalSource: async (
      written: Document,
      _source: unknown,
      options: { expectedRevision?: string } = {},
    ) => {
      const disk = fixture.readLocal;
      const accepted = !disk?.ok || options.expectedRevision === disk.revision;
      fixture.localWrites.push({
        title: written.title,
        content: written.content,
        ...(options.expectedRevision !== undefined
          ? { expectedRevision: options.expectedRevision }
          : {}),
        accepted,
      });
      if (!accepted) {
        return {
          ok: false,
          error: "The file changed on disk.",
          conflict: {
            path: "notes/page.md",
            expectedRevision: options.expectedRevision,
          },
        };
      }
      const revision = `written-${fixture.localWrites.length}`;
      if (disk?.ok) {
        fixture.readLocal = {
          ...disk,
          document: {
            ...disk.document,
            title: written.title,
            content: written.content,
          },
          revision,
        };
      }
      await held(fixture.heldWrites);
      return { ok: true, revision };
    },
  };
});
vi.mock("./comment-ai", () => ({
  useCommentAiRequests: () => ({ requests: [], freshResolutions: new Map() }),
  isCommentAiWorkingOn: () => false,
  missingCommentAiReplyIds: () => "",
  noteCommentAiPageChanges: () => false,
}));
vi.mock("./CommentsSidebar", async (original) => ({
  ...(await original<typeof import("./CommentsSidebar")>()),
  CommentsSidebar: (props: SidebarProps) => {
    fixture.sidebars.push(props);
    return [
      createElement("div", {
        key: "sidebar",
        "data-sidebar-fixture": props.presentation ?? "inline",
        "data-selected": props.selectedThreadId ?? "",
      }),
      createPortal(
        createElement("button", { "data-comment-portal-menu": "" }, "Emoji"),
        document.body,
        "menu",
      ),
    ];
  },
}));
vi.mock("./PageDraftRecovery", () => ({
  PageDraftRecovery: ({ children }: { children: ReactNode }) => children,
}));
vi.mock("./DocumentToolbar", () => ({
  DocumentToolbar: (props: ToolbarProps) => {
    fixture.toolbars.push(props);
    return null;
  },
}));
vi.mock("./ContentImportDialog", () => ({ ContentImportDialog: () => null }));
vi.mock("./NotionConflictBanner", () => ({ NotionConflictBanner: () => null }));
vi.mock("./EmojiPicker", () => ({ EmojiPicker: () => null }));
vi.mock("./DocumentProperties", () => ({
  DocumentProperties: (props: (typeof fixture.properties)[number]) => {
    fixture.properties.push(props);
    return null;
  },
}));
vi.mock("./DocumentDatabase", () => ({ DocumentDatabase: () => null }));
vi.mock("./DocumentInfoPanel", () => ({ DocumentInfoPanel: () => null }));
vi.mock("./LinkedLocalDocumentAgentBridge", () => ({
  LinkedLocalDocumentAgentBridge: (props: AgentBridgeProps) => {
    fixture.agentBridge = props;
    return null;
  },
}));
vi.mock("./DocumentReconcileRecovery", () => ({
  DocumentReconcileRecovery: () => null,
}));
vi.mock("./VisualEditor", async (original) => {
  const actual = await original<typeof import("./VisualEditor")>();
  return {
    ...actual,
    VisualEditor: (props: ComponentProps<typeof VisualEditor>) => {
      fixture.editors.push(props);
      if (fixture.realEditor) {
        const report = props.onPersistenceControllerChange;
        let observed = report && fixture.reportPersistence.get(report);
        if (report && !observed) {
          observed = (controller) => {
            fixture.persistence = controller;
            report(controller);
          };
          fixture.reportPersistence.set(report, observed);
        }
        const request = props.externalContent;
        return createElement(actual.VisualEditor, {
          ...props,
          ...(observed ? { onPersistenceControllerChange: observed } : {}),
          onChange: (markdown) => {
            if (!fixture.heldEditorReports) return props.onChange(markdown);
            fixture.heldEditorReports.push(() => props.onChange(markdown));
          },
          externalContent: request
            ? {
                key: request.key,
                merge: (live, canHold) =>
                  request.merge(
                    live,
                    (text) => !fixture.unholdable.has(text) && canHold(text),
                  ),
              }
            : null,
        });
      }
      return createElement(
        "div",
        {
          className: "ProseMirror content-editor",
          tabIndex: 0,
          "data-visual-body": "",
        },
        createElement(
          "p",
          null,
          createElement(
            "span",
            { className: "comment-highlight--pending" },
            "Saved",
          ),
          " ",
          createElement("span", { "data-comment-thread": "t-text" }, "body"),
        ),
      );
    },
  };
});

import { PageEditorSurface } from "./DocumentEditor";
import { runPersistableHistoryCommand } from "./editor-transaction-meta";
import { createPageEditorMount, present } from "./page-editor-test-utils";

let mount: ReturnType<typeof createPageEditorMount>;
let container: HTMLDivElement;
let queryClient: QueryClient;

function page(id: string, extra: Partial<Document> = {}) {
  fixture.pages[id] = {
    id,
    title: "Saved title",
    content: "Saved body",
    revision: "r1",
    updatedAt: "2026-10-19T12:00:00.000Z",
    canEdit: true,
    ...extra,
  } as Document;
}

function thread(threadId: string, quotedText: string | null): CommentThread {
  return {
    threadId,
    quotedText,
    prefix: null,
    suffix: null,
    startOffset: null,
    resolved: false,
    comments: [],
  };
}

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response("{}")),
  );
  fixture.pages = {};
  fixture.threads = [thread("t-text", "body"), thread("t-page", null)];
  fixture.suggestions = [];
  fixture.readLocal = null;
  fixture.localWrites = [];
  fixture.localFileChanged = null;
  fixture.realLocalSource = false;
  fixture.heldReads = null;
  fixture.heldWrites = null;
  fixture.heldEditorReports = null;
  fixture.unholdable = new Set();
  fixture.agentBridge = null;
  fixture.realEditor = false;
  fixture.persistence = null;
  fixture.toolbars = [];
  fixture.sidebars = [];
  fixture.properties = [];
  fixture.editors = [];
  fixture.mutation.mutateAsync.mockReset();
  page("page");
  mount = createPageEditorMount();
  ({ container, queryClient } = mount);
});

afterEach(async () => {
  await mount.unmount();
  mount.discard();
  document.body.innerHTML = "";
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function surface(documentId: string, host: "page" | "preview") {
  return createElement(PageEditorSurface, { documentId, host });
}

async function render(...surfaces: ReturnType<typeof surface>[]) {
  await act(async () => mount.render(surfaces));
}

function last<T>(items: T[], match: (item: T) => unknown = () => true) {
  return [...items].reverse().find((item) => match(item));
}

function toolbar(documentId = "page") {
  return present(
    last(fixture.toolbars, (props) => props.documentId === documentId),
  );
}

function selectedThread(documentId = "page") {
  const selected = own(documentId, "[data-sidebar-fixture]").find(
    (sidebar) => sidebar.dataset.selected,
  );
  return selected?.dataset.selected ?? null;
}

function own(documentId: string, selector: string) {
  const home = owner(documentId).dataset.pageEditorOwner;
  return Array.from(
    owner(documentId).querySelectorAll<HTMLElement>(selector),
  ).filter(
    (element) =>
      element.closest<HTMLElement>("[data-page-editor-owner]")?.dataset
        .pageEditorOwner === home,
  );
}

function owner(documentId = "page") {
  return present(
    Array.from(
      container.querySelectorAll<HTMLElement>("[data-page-editor-owner]"),
    ).find((element) => element.dataset.pageEditorOwner?.includes(documentId)),
  );
}

async function click(target: Element) {
  await act(async () => {
    target.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

async function clickHighlight(documentId = "page") {
  await click(present(own(documentId, "[data-comment-thread]")[0]));
}

describe("comment focus on the page", () => {
  it("keeps an open comment while its portalled menus are used", async () => {
    await render(surface("page", "page"));
    await clickHighlight();
    expect(selectedThread()).toBe("t-text");

    await click(present(document.querySelector("[data-comment-portal-menu]")));
    expect(selectedThread()).toBe("t-text");

    await click(present(owner().querySelector("p")));
    expect(selectedThread()).toBeNull();
  });

  it("keeps the comment through the start of a touch or scroll gesture", async () => {
    await render(surface("page", "page"));
    await clickHighlight();
    await act(async () => {
      present(owner().querySelector("p")).dispatchEvent(
        new PointerEvent("pointerdown", {
          bubbles: true,
          pointerType: "touch",
        }),
      );
    });
    expect(selectedThread()).toBe("t-text");
  });

  it("opens a comment on the whole page in the Discussion panel, selected", async () => {
    await render(surface("page", "page"));
    await clickHighlight();
    expect(
      owner().querySelector('[data-sidebar-fixture="history"]'),
    ).toBeNull();
    const inline = present(
      last(fixture.sidebars, (props) => props.presentation !== "history"),
    );
    await act(async () => present(inline.onActivateThread)("t-page"));

    expect(
      owner().querySelector<HTMLElement>('[data-sidebar-fixture="history"]')
        ?.dataset.selected,
    ).toBe("t-page");
  });
});

describe("Escape across nested page editors", () => {
  it("dismisses only the comment in the editor the key came from, with the preview inside the page", async () => {
    page("peek");
    await render(surface("page", "page"));
    const nest = document.createElement("div");
    owner("page").append(nest);
    await act(async () =>
      mount.render([
        surface("page", "page"),
        createPortal(surface("peek", "preview"), nest),
      ]),
    );
    expect(owner("page").contains(owner("peek"))).toBe(true);
    await clickHighlight("page");
    await clickHighlight("peek");
    expect(selectedThread("page")).toBe("t-text");
    expect(selectedThread("peek")).toBe("t-text");

    await act(async () => {
      present(
        owner("peek").querySelector("[data-comment-thread]"),
      ).dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      );
    });
    expect(selectedThread("peek")).toBeNull();
    expect(selectedThread("page")).toBe("t-text");
  });

  it("dismisses only the focused editor's comment for a key from outside both", async () => {
    page("peek");
    await render(surface("page", "page"), surface("peek", "preview"));
    await clickHighlight("page");
    await clickHighlight("peek");
    act(() =>
      present(owner("peek").querySelector<HTMLElement>(".ProseMirror")).focus(),
    );
    expect(owner("peek").contains(document.activeElement)).toBe(true);

    await act(async () => {
      document.body.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      );
    });
    expect(selectedThread("peek")).toBeNull();
    expect(selectedThread("page")).toBe("t-text");
  });
});

describe("a page read from a local file", () => {
  beforeEach(() => {
    page("page", {
      source: { mode: "local-files", path: "notes/page.md" },
    } as Partial<Document>);
  });

  type ShownEditor = HTMLElement & { editor: Editor };
  const shownEditor = () =>
    present(container.querySelector<ShownEditor>(".ProseMirror"));
  const paragraphs = () => {
    const { doc } = shownEditor().editor.state;
    return Array.from(
      { length: doc.childCount },
      (_, index) => doc.child(index).textContent,
    ).filter(Boolean);
  };

  it("says when the file was deleted and stops editing", async () => {
    fixture.readLocal = {
      ok: false,
      error: "notes/page.md was not found",
    } as LocalSourceDocumentReadResult;
    await render(surface("page", "page"));

    expect(
      container.querySelector("[data-local-source-missing]")?.textContent,
    ).toBe("empty.documentNotFound");
    expect(toolbar().canEdit).toBe(false);
  });

  it("stays read-only, without saying it's deleted, when this client can't reach the file", async () => {
    fixture.readLocal = {
      ok: false,
      error: "The desktop bridge is not available",
    } as LocalSourceDocumentReadResult;
    await render(surface("page", "page"));

    expect(container.querySelector("[data-local-source-read-only]")).not.toBe(
      null,
    );
    expect(container.querySelector("[data-local-source-missing]")).toBeNull();
    expect(toolbar().canEdit).toBe(false);
  });

  it("edits a file this client can read", async () => {
    const onDisk = present(fixture.pages.page);
    fixture.readLocal = {
      ok: true,
      document: onDisk,
      revision: "disk-1",
      updatedAt: onDisk.updatedAt,
    } as LocalSourceDocumentReadResult;
    await render(surface("page", "page"));

    expect(container.querySelector("[data-local-source-read-only]")).toBe(null);
    expect(toolbar().canEdit).toBe(true);
  });

  const putOnDisk = (content: string, revision: string, updatedAt?: string) => {
    const page = present(fixture.pages.page);
    fixture.readLocal = {
      ok: true,
      document: { ...page, content },
      revision,
      updatedAt: updatedAt ?? page.updatedAt,
    } as LocalSourceDocumentReadResult;
  };
  const onDisk = () => {
    const disk = present(fixture.readLocal);
    if (!disk.ok) throw new Error(disk.error);
    return disk;
  };
  const diskHolds = (text: string) =>
    sameSourceMarkdown(onDisk().document.content, text);
  const changeOutside = async (content: string, revision = "outside-1") => {
    putOnDisk(content, revision, new Date(Date.now() + 60_000).toISOString());
    await act(async () => present(fixture.localFileChanged)());
    await act(async () => {});
  };
  const lastWrite = () => fixture.localWrites[fixture.localWrites.length - 1];
  const savesWithout = (text: string, revision = "outside-1") =>
    fixture.localWrites.filter(
      (write) =>
        write.accepted &&
        write.expectedRevision === revision &&
        !write.content.includes(text),
    );
  const settle = () =>
    act(() => new Promise<void>((resolve) => setTimeout(resolve, 0)));
  const type = async (editor: Editor, position: number, text: string) => {
    await act(async () => {
      editor.commands.focus();
      editor.commands.setTextSelection(position);
      editor.view.dispatch(editor.state.tr.insertText(text));
    });
  };
  const holdComposition = (editor: Editor) => {
    let composing = true;
    Object.defineProperty(editor.view, "composing", {
      configurable: true,
      get: () => composing,
    });
    return () => {
      composing = false;
    };
  };
  const typedLongAgo = () => {
    const now = Date.now.bind(Date);
    vi.spyOn(Date, "now").mockImplementation(() => now() + 5_000);
  };
  const countDocChanges = (editor: Editor) => {
    const count = { changes: 0 };
    editor.on("transaction", ({ transaction }) => {
      if (transaction.docChanged) count.changes += 1;
    });
    return count;
  };
  const undo = (editor: Editor) =>
    act(async () => {
      runPersistableHistoryCommand(editor, "undo");
    });
  const useDiskVersionButton = () =>
    present(
      Array.from(container.querySelectorAll("button")).find(
        (button) => button.textContent === "editor.useDiskVersion",
      ),
    );

  it("shows a change made outside Content in place, keeping focus, the cursor and Undo", async () => {
    fixture.realEditor = true;
    putOnDisk("First paragraph\n\nSecond paragraph", "disk-1");
    await render(surface("page", "page"));
    const body = shownEditor();
    const { editor } = body;
    await type(
      editor,
      editor.state.doc.child(0).nodeSize + 1 + "Second paragraph".length,
      " typed",
    );
    await vi.waitFor(() =>
      expect(onDisk().document.content).toContain("Second paragraph typed"),
    );
    const caret = editor.state.selection.from;

    const outside = "This sentence was written outside Content.";
    await changeOutside(`${onDisk().document.content}\n\n${outside}`);

    expect(paragraphs()).toEqual([
      "First paragraph",
      "Second paragraph typed",
      outside,
    ]);
    expect(document.activeElement).toBe(body);
    expect(shownEditor()).toBe(body);
    expect(editor.state.selection.from).toBe(caret);
    expect(editor.state.selection.empty).toBe(true);

    const writes = fixture.localWrites.length;
    await act(async () => {
      await present(fixture.persistence).flushLatest();
    });
    expect(fixture.localWrites.length).toBe(writes);

    await undo(editor);
    expect(paragraphs()).toEqual([
      "First paragraph",
      "Second paragraph",
      outside,
    ]);
    await vi.waitFor(() => expect(onDisk().revision).not.toBe("outside-1"));
    expect(lastWrite()).toMatchObject({
      expectedRevision: "outside-1",
      accepted: true,
    });
    expect(onDisk().document.content).toContain(outside);
    expect(onDisk().document.content).not.toContain("typed");
  });

  it("keeps the cursor and Undo when a change outside Content rewords the paragraph being typed in", async () => {
    fixture.realEditor = true;
    putOnDisk("Hello!", "disk-1");
    await render(surface("page", "page"));
    const body = shownEditor();
    const { editor } = body;
    await type(editor, 1 + "Hello".length, " world");
    await vi.waitFor(() => expect(diskHolds("Hello world!")).toBe(true));

    await changeOutside("Hi world!");

    expect(paragraphs()).toEqual(["Hi world!"]);
    expect(shownEditor()).toBe(body);
    expect(document.activeElement).toBe(body);
    expect(editor.state.selection.from).toBe(1 + "Hi world".length);

    await undo(editor);
    expect(paragraphs()).toEqual(["Hi!"]);
    await vi.waitFor(() => expect(diskHolds("Hi!")).toBe(true));
    expect(lastWrite()).toMatchObject({
      expectedRevision: "outside-1",
      accepted: true,
    });
  });

  it("saves nothing over a change made outside Content while a word is still being composed", async () => {
    fixture.realEditor = true;
    putOnDisk("Saved body", "disk-1");
    await render(surface("page", "page"));
    const { editor } = shownEditor();
    await type(editor, 1 + "Saved body".length, " typed");
    await vi.waitFor(() => expect(diskHolds("Saved body typed")).toBe(true));
    const endComposition = holdComposition(editor);

    const outside = "Written outside.";
    await changeOutside(`Saved body typed\n\n${outside}`);
    expect(paragraphs()).toEqual(["Saved body typed"]);

    await act(async () => {
      await present(fixture.persistence).flushLatest();
    });
    expect(savesWithout(outside)).toEqual([]);
    expect(onDisk().document.content).toContain(outside);

    endComposition();
    await vi.waitFor(() =>
      expect(paragraphs()).toEqual(["Saved body typed", outside]),
    );
    expect(container.querySelector("[data-local-source-conflict]")).toBe(null);
    expect(savesWithout(outside)).toEqual([]);
  });

  it("keeps both a word composed while a change arrives from outside Content and that change", async () => {
    fixture.realEditor = true;
    putOnDisk("Saved body", "disk-1");
    await render(surface("page", "page"));
    const { editor } = shownEditor();
    await type(editor, 1 + "Saved body".length, " typed");
    await vi.waitFor(() => expect(diskHolds("Saved body typed")).toBe(true));
    const endComposition = holdComposition(editor);

    const outside = "Written outside.";
    await changeOutside(`Saved body typed\n\n${outside}`);
    const reports: (() => void)[] = [];
    fixture.heldEditorReports = reports;
    await act(async () => {
      editor.view.dispatch(editor.state.tr.insertText("漢字"));
    });
    endComposition();
    await vi.waitFor(() =>
      expect(container.querySelector("[data-local-source-conflict]")).not.toBe(
        null,
      ),
    );
    expect(
      fixture.localWrites.filter((write) => write.content.includes("漢字")),
    ).toEqual([]);
    fixture.heldEditorReports = null;
    await act(async () => {
      for (const report of reports) report();
    });
    await settle();

    expect(paragraphs()).toEqual(["Saved body typed漢字"]);
    expect(onDisk().document.content).toBe(`Saved body typed\n\n${outside}`);
    expect(savesWithout(outside)).toEqual([]);
  });

  it("waits out a word being composed before showing a change made outside Content, then shows it once", async () => {
    fixture.realEditor = true;
    putOnDisk("Saved body", "disk-1");
    await render(surface("page", "page"));
    const { editor } = shownEditor();
    await type(editor, 1 + "Saved body".length, " typed");
    await vi.waitFor(() => expect(diskHolds("Saved body typed")).toBe(true));
    const endComposition = holdComposition(editor);
    typedLongAgo();

    const outside = "Written outside.";
    await changeOutside(`Saved body typed\n\n${outside}`);
    await settle();
    expect(paragraphs()).toEqual(["Saved body typed"]);

    const count = countDocChanges(editor);
    endComposition();
    await vi.waitFor(() =>
      expect(paragraphs()).toEqual(["Saved body typed", outside]),
    );
    await settle();
    expect(count.changes).toBe(1);
  });

  it("waits out a slash command being typed before showing a change made outside Content, then shows it once", async () => {
    fixture.realEditor = true;
    putOnDisk("Saved body", "disk-1");
    await render(surface("page", "page"));
    const { editor } = shownEditor();
    await act(async () => {
      editor
        .chain()
        .insertContentAt(editor.state.doc.content.size, {
          type: "paragraph",
          content: [{ type: "text", text: "/he" }],
        })
        .focus("end")
        .run();
    });
    typedLongAgo();

    const outside = "Written outside.";
    await changeOutside(`Saved body\n\n${outside}`);
    await settle();
    expect(paragraphs()).toEqual(["Saved body", "/he"]);

    await act(async () => {
      const { doc } = editor.state;
      editor.view.dispatch(
        editor.state.tr.delete(
          doc.content.size - present(doc.lastChild).nodeSize,
          doc.content.size,
        ),
      );
    });
    const count = countDocChanges(editor);
    await vi.waitFor(() =>
      expect(paragraphs()).toEqual(["Saved body", outside]),
    );
    await settle();
    expect(count.changes).toBe(1);
    expect(container.querySelector("[data-local-source-conflict]")).toBe(null);
  });

  it("drops a change from outside Content it hasn't shown yet when the disk version is chosen", async () => {
    fixture.realEditor = true;
    putOnDisk("Saved body", "disk-1");
    await render(surface("page", "page"));
    const { editor } = shownEditor();
    holdComposition(editor);
    const outside = "Written outside.";
    await changeOutside(`Saved body\n\n${outside}`);
    await type(editor, 1 + "Saved body".length, " composed");
    await vi.waitFor(() =>
      expect(lastWrite()).toMatchObject({
        expectedRevision: "disk-1",
        accepted: false,
      }),
    );
    await vi.waitFor(() =>
      expect(container.querySelector("[data-local-source-conflict]")).not.toBe(
        null,
      ),
    );

    await act(async () => useDiskVersionButton().click());
    await settle();

    expect(container.querySelector("[data-local-source-conflict]")).toBe(null);
    expect(paragraphs()).toEqual(["Saved body", outside]);
    expect(onDisk().document.content).toBe(`Saved body\n\n${outside}`);
  });

  it("asks before a change made outside Content replaces unsaved typing", async () => {
    fixture.realEditor = true;
    const onDisk = present(fixture.pages.page);
    fixture.readLocal = {
      ok: true,
      document: onDisk,
      revision: "disk-1",
      updatedAt: onDisk.updatedAt,
    } as LocalSourceDocumentReadResult;
    await render(surface("page", "page"));
    const body = shownEditor();
    await act(async () => {
      body.editor.commands.focus();
      body.editor.commands.setTextSelection(1 + "Saved body".length);
      body.editor.view.dispatch(body.editor.state.tr.insertText(" typed"));
    });
    await vi.waitFor(() =>
      expect(present(last(fixture.editors)).content).toContain(
        "Saved body typed",
      ),
    );

    fixture.readLocal = {
      ok: true,
      document: { ...onDisk, content: "Saved body\n\nWritten outside." },
      revision: "disk-2",
      updatedAt: "2026-10-19T12:05:00.000Z",
    } as LocalSourceDocumentReadResult;
    await act(async () => present(fixture.localFileChanged)());
    await act(async () => {});

    expect(container.querySelector("[data-local-source-conflict]")).not.toBe(
      null,
    );
    expect(paragraphs()).toEqual(["Saved body typed"]);
    expect(document.activeElement).toBe(body);

    const useDisk = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "editor.useDiskVersion",
    );
    await act(async () => present(useDisk).click());
    await act(async () => {});
    expect(container.querySelector("[data-local-source-conflict]")).toBe(null);
    expect(paragraphs()).toEqual(["Saved body", "Written outside."]);
  });

  const conflictShown = () =>
    container.querySelector("[data-local-source-conflict]") !== null;
  const wait = (ms: number) =>
    act(() => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const titleField = () =>
    present(container.querySelector<HTMLTextAreaElement>("textarea"));
  const rename = (title: string) =>
    act(async () => {
      const field = titleField();
      Object.getOwnPropertyDescriptor(
        HTMLTextAreaElement.prototype,
        "value",
      )?.set?.call(field, title);
      field.dispatchEvent(new Event("input", { bubbles: true }));
    });

  it("reads a file in a folder picked in the browser again when the page is shown again, keeping focus and the cursor", async () => {
    fixture.realEditor = true;
    fixture.realLocalSource = true;
    let fileText = '---\ntitle: "Saved title"\n---\n\nFirst paragraph';
    const file = {
      kind: "file",
      name: "page.md",
      getFile: async () =>
        ({
          text: async () => fileText,
          lastModified: Date.parse("2026-10-19T12:00:00.000Z"),
        }) as File,
      createWritable: vi.fn(),
    };
    rememberLinkedLocalSourceDirectory({
      kind: "directory",
      name: "notes",
      values: vi.fn(),
      getDirectoryHandle: vi.fn(),
      getFileHandle: async () => file,
      queryPermission: async () => "granted",
      requestPermission: async () => "granted",
    } as unknown as Parameters<typeof rememberLinkedLocalSourceDirectory>[0]);
    try {
      await render(surface("page", "page"));
      await vi.waitFor(() => expect(paragraphs()).toEqual(["First paragraph"]));
      const body = shownEditor();
      const { editor } = body;
      await act(async () => {
        editor.commands.focus();
        editor.commands.setTextSelection(1 + "First".length);
      });

      fileText += "\n\nWritten in another editor.";
      await act(async () => {
        window.dispatchEvent(new Event("focus"));
      });
      await vi.waitFor(() =>
        expect(paragraphs()).toEqual([
          "First paragraph",
          "Written in another editor.",
        ]),
      );
      expect(shownEditor()).toBe(body);
      expect(document.activeElement).toBe(body);
      expect(editor.state.selection.from).toBe(1 + "First".length);

      fileText += "\n\nWritten while the page was hidden.";
      await act(async () => {
        document.dispatchEvent(new Event("visibilitychange"));
      });
      await vi.waitFor(() =>
        expect(paragraphs()).toEqual([
          "First paragraph",
          "Written in another editor.",
          "Written while the page was hidden.",
        ]),
      );
      expect(shownEditor()).toBe(body);
      expect(document.activeElement).toBe(body);
      expect(editor.state.selection.from).toBe(1 + "First".length);
      expect(file.createWritable).not.toHaveBeenCalled();
    } finally {
      delete (window as { __contentLocalSourceDirectoryHandle?: unknown })
        .__contentLocalSourceDirectoryHandle;
    }
  });

  it("keeps a title renamed while a change made outside Content waits to be shown, and saves it", async () => {
    fixture.realEditor = true;
    putOnDisk("Saved body", "disk-1");
    await render(surface("page", "page"));
    const { editor } = shownEditor();
    const endComposition = holdComposition(editor);
    const outside = "Written outside.";
    await changeOutside(`Saved body\n\n${outside}`);
    await settle();
    expect(paragraphs()).toEqual(["Saved body"]);

    await rename("Renamed");
    endComposition();
    await vi.waitFor(() =>
      expect(paragraphs()).toEqual(["Saved body", outside]),
    );

    expect(titleField().value).toBe("Renamed");
    await vi.waitFor(() => expect(onDisk().document.title).toBe("Renamed"), {
      timeout: 3_000,
    });
    expect(onDisk().document.content).toBe(`Saved body\n\n${outside}`);
    expect(titleField().value).toBe("Renamed");
    expect(conflictShown()).toBe(false);
  });

  it("asks before a change made outside Content renames a page renamed here too", async () => {
    fixture.realEditor = true;
    putOnDisk("Saved body", "disk-1");
    await render(surface("page", "page"));
    const { editor } = shownEditor();
    const endComposition = holdComposition(editor);
    putOnDisk(
      "Saved body\n\nWritten outside.",
      "outside-1",
      new Date(Date.now() + 60_000).toISOString(),
    );
    fixture.readLocal = {
      ...onDisk(),
      document: { ...onDisk().document, title: "Renamed outside" },
    };
    await act(async () => present(fixture.localFileChanged)());
    await settle();

    await rename("Renamed here");
    endComposition();
    await vi.waitFor(() => expect(conflictShown()).toBe(true));

    expect(titleField().value).toBe("Renamed here");
    expect(paragraphs()).toEqual(["Saved body"]);
  });

  it("takes a change made outside Content over a late answer to an earlier save", async () => {
    fixture.realEditor = true;
    putOnDisk("Saved body", "disk-1");
    await render(surface("page", "page"));
    const { editor } = shownEditor();
    let answer = () => {};
    fixture.mutation.mutateAsync.mockImplementation(
      () =>
        new Promise((resolve) => {
          answer = () => resolve(undefined);
        }),
    );
    await type(editor, 1 + "Saved body".length, " typed");
    await vi.waitFor(() => expect(diskHolds("Saved body typed")).toBe(true));

    const outside = "Written outside.";
    await changeOutside(`Saved body typed\n\n${outside}`);
    await vi.waitFor(() =>
      expect(paragraphs()).toEqual(["Saved body typed", outside]),
    );
    await act(async () => answer());
    await settle();

    await act(async () => present(fixture.localFileChanged)());
    await settle();
    expect(conflictShown()).toBe(false);
    expect(paragraphs()).toEqual(["Saved body typed", outside]);
  });

  it("shows the latest read of a file changed outside Content twice, even when an earlier read answers last", async () => {
    fixture.realEditor = true;
    putOnDisk("Saved body", "disk-1");
    await render(surface("page", "page"));
    const reads: (() => void)[] = [];
    fixture.heldReads = reads;
    await changeOutside("Saved body\n\nFirst outside.", "outside-1");
    await changeOutside("Saved body\n\nSecond outside.", "outside-2");
    fixture.heldReads = null;
    const [first, second] = reads;

    await act(async () => present(second)());
    await settle();
    await act(async () => present(first)());
    await settle();

    expect(paragraphs()).toEqual(["Saved body", "Second outside."]);
    expect(conflictShown()).toBe(false);
  });

  it("keeps an agent's edit over a read of the file that started before it", async () => {
    fixture.realEditor = true;
    putOnDisk("Saved body", "disk-1");
    await render(surface("page", "page"));
    const reads: (() => void)[] = [];
    fixture.heldReads = reads;
    await act(async () => present(fixture.localFileChanged)());
    fixture.heldReads = null;
    const [earlierRead] = reads;

    putOnDisk("Saved body\n\nWritten by the agent.", "agent-1");
    await act(async () =>
      present(fixture.agentBridge).onPersisted(onDisk().document, "agent-1"),
    );
    await vi.waitFor(() =>
      expect(paragraphs()).toEqual(["Saved body", "Written by the agent."]),
    );
    await act(async () => present(earlierRead)());
    await settle();

    expect(paragraphs()).toEqual(["Saved body", "Written by the agent."]);
  });

  it("keeps the notice of a change made outside Content while this page's save of the file finishes", async () => {
    fixture.realEditor = true;
    putOnDisk("Saved body", "disk-1");
    await render(surface("page", "page"));
    const { editor } = shownEditor();
    const writes: (() => void)[] = [];
    fixture.heldWrites = writes;
    await type(editor, 1 + "Saved body".length, " typed");
    await vi.waitFor(() => expect(writes).toHaveLength(1));
    fixture.heldWrites = null;

    await changeOutside("Saved body typed\n\nWritten outside.");
    await vi.waitFor(() => expect(conflictShown()).toBe(true));
    await act(async () => present(writes[0])());
    await settle();

    expect(conflictShown()).toBe(true);
  });

  it("drops a change from outside Content it hasn't shown yet once the file can't be read", async () => {
    fixture.realEditor = true;
    putOnDisk("Saved body", "disk-1");
    await render(surface("page", "page"));
    const { editor } = shownEditor();
    const endComposition = holdComposition(editor);
    await changeOutside("Saved body\n\nWritten outside.");
    await settle();

    fixture.readLocal = {
      ok: false,
      error: "Read permission for the folder was withdrawn.",
    };
    await act(async () => present(fixture.localFileChanged)());
    await settle();
    endComposition();
    await wait(400);

    expect(paragraphs()).toEqual(["Saved body"]);
  });

  it("asks before showing a change made outside Content the editor can't hold", async () => {
    fixture.realEditor = true;
    putOnDisk("Saved body", "disk-1");
    await render(surface("page", "page"));
    const body = shownEditor();
    const outside = "Saved body\n\nWritten outside.";
    fixture.unholdable.add(outside);

    await changeOutside(outside);
    await settle();

    expect(conflictShown()).toBe(true);
    expect(shownEditor()).toBe(body);
    expect(paragraphs()).toEqual(["Saved body"]);
  });

  it("saves nothing when the page differs from the file only by an empty last line", async () => {
    fixture.realEditor = true;
    putOnDisk("Saved body", "disk-1");
    await render(surface("page", "page"));
    const { editor } = shownEditor();
    await act(async () => {
      editor
        .chain()
        .insertContentAt(editor.state.doc.content.size, { type: "paragraph" })
        .focus("end")
        .run();
    });
    await wait(700);

    const outside = "Written outside.";
    await changeOutside(`Saved body\n\n${outside}`);
    expect(paragraphs()).toEqual(["Saved body", outside]);
    expect(editor.state.doc.lastChild?.content.size).toBe(0);
    await act(async () => {
      await present(fixture.persistence).flushLatest();
    });

    expect(fixture.localWrites).toEqual([]);
  });
});

describe("the title", () => {
  it("grows to fit its text when its width changes, and only then", async () => {
    const observers = new Map<Element, ResizeObserverCallback>();
    vi.stubGlobal(
      "ResizeObserver",
      class {
        constructor(private callback: ResizeObserverCallback) {}
        observe(element: Element) {
          observers.set(element, this.callback);
        }
        unobserve() {}
        disconnect() {}
      },
    );
    await render(surface("page", "page"));
    const title = present(container.querySelector("textarea"));
    const resized = observers.get(title);
    expect(resized).toBeDefined();
    Object.defineProperty(title, "scrollHeight", { value: 72 });
    const widthChange = (width: number) =>
      act(async () =>
        present(resized)(
          [
            {
              target: title,
              contentRect: { width },
            } as unknown as ResizeObserverEntry,
          ],
          {} as ResizeObserver,
        ),
      );

    title.style.height = "36px";
    await widthChange(0);
    expect(title.style.height).toBe("36px");
    await widthChange(420);
    expect(title.style.height).toBe("72px");
  });
});

describe("undo and redo", () => {
  it("shows the editor's history, and leaves Suggesting's to the editor", async () => {
    page("page", { canComment: true, canSuggest: true } as Partial<Document>);
    await render(surface("page", "page"));
    const editor = () => present(last(fixture.editors));
    await act(async () =>
      present(editor().onHistoryStateChange)({ canUndo: true, canRedo: false }),
    );
    expect(toolbar().canUndo).toBe(true);

    await act(async () => present(toolbar().onSuggestingChange)(true));
    await vi.waitFor(() => expect(editor().suggesting).toBe(true));
    const renders = fixture.toolbars.length;
    await act(async () =>
      present(editor().onHistoryStateChange)({
        canUndo: false,
        canRedo: false,
      }),
    );
    await act(async () =>
      present(editor().onHistoryStateChange)({ canUndo: true, canRedo: false }),
    );
    expect(fixture.toolbars.length).toBe(renders);
  });
});

describe("suggestion anchors", () => {
  it("renders the page again only when the placed suggestions change", async () => {
    await render(surface("page", "page"));
    const editor = () => present(last(fixture.editors));
    await act(async () => present(editor().onSuggestionAnchorsChange)(["s1"]));
    const renders = fixture.editors.length;
    await act(async () => present(editor().onSuggestionAnchorsChange)(["s1"]));
    expect(fixture.editors.length).toBe(renders);
    await act(async () =>
      present(editor().onSuggestionAnchorsChange)(["s1", "s2"]),
    );
    expect(fixture.editors.length).toBeGreaterThan(renders);
  });
});

describe("clicking the page's padding", () => {
  it("focuses the text where the page was scrolled, until the reader scrolls", async () => {
    await render(surface("page", "page"));
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const scroller = present(
      container.querySelector<HTMLElement>("[data-document-print-scroll]"),
    );
    const text = present(owner().querySelector<HTMLElement>(".ProseMirror"));
    const body = present(
      text.closest<HTMLElement>('[data-startup-anchor="body"]'),
    );
    const focus = vi
      .spyOn(text, "focus")
      .mockImplementation(() => {
        scroller.scrollTop = 0;
      })
      .mockImplementationOnce(() => {
        scroller.scrollTop = 0;
        setTimeout(() => (scroller.scrollTop = 0), 10);
      });
    scroller.scrollTop = 120;

    await click(body);
    expect(focus).toHaveBeenCalledWith({ preventScroll: true });
    expect(scroller.scrollTop).toBe(120);
    await act(async () => vi.advanceTimersByTimeAsync(70));
    expect(scroller.scrollTop).toBe(120);

    await click(body);
    await act(async () => {
      scroller.dispatchEvent(new WheelEvent("wheel", { bubbles: true }));
      scroller.scrollTop = 300;
    });
    await act(async () => vi.advanceTimersByTimeAsync(70));
    expect(scroller.scrollTop).toBe(300);
  });
});

describe("a Collection row in a preview", () => {
  it("shows the row's Properties inline", async () => {
    page("row", {
      databaseMembership: {
        databaseId: "database",
        databaseDocumentId: "database-page",
      },
    } as Partial<Document>);
    await render(surface("row", "preview"));
    expect(last(fixture.properties)).toMatchObject({
      documentId: "row",
      databaseId: "database",
    });
  });
});

describe("suggestions in the editor", () => {
  it("draws saved suggestions and the one being typed together", async () => {
    const before = canonicalizeNfm("Saved body");
    page("page", {
      content: before,
      canComment: true,
      canSuggest: true,
    } as Partial<Document>);
    fixture.suggestions = [
      {
        id: "saved",
        proposalId: "proposal",
        revision: 1,
        resourceType: "document",
        resourceId: "page",
        adapterKind: "content.document-markdown",
        adapterVersion: 1,
        threadId: "thread-saved",
        authorEmail: "writer@example.test",
        actorKind: "human",
        baseRevision: "r1",
        status: "pending",
        summary: "editor.toolbar.suggestEdits",
        ownerEmail: "writer@example.test",
        orgId: "org",
        visibility: "private",
        createdAt: "2026-10-19T12:06:00.000Z",
        updatedAt: "2026-10-19T12:06:00.000Z",
        metadata: null,
        operations: markdownSuggestionOperations(
          before,
          canonicalizeNfm("Saved body here"),
        ),
      },
    ];
    await render(surface("page", "page"));
    const editor = () => present(last(fixture.editors));
    const drawn = () =>
      (editor().suggestions ?? []).map((suggestion) =>
        suggestion.id === "saved" ? "saved" : suggestion.presentation,
      );
    expect(drawn()).toEqual(["saved"]);

    await act(async () => present(toolbar().onSuggestingChange)(true));
    await act(async () =>
      editor().onChange(canonicalizeNfm("Typed. Saved body")),
    );
    await vi.waitFor(() => expect(drawn()).toEqual(["saved", "draft"]));
  });
});

describe("the comment margin", () => {
  it("moves its comments beside the text without measuring itself moved", async () => {
    const observed: Element[] = [];
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe(element: Element) {
          observed.push(element);
        }
        unobserve() {}
        disconnect() {}
      },
    );
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
      function (this: HTMLElement) {
        if (this.matches("[data-comments-flow-lane]")) {
          const moved = /translateX\((-?[\d.]+)px\)/.exec(this.style.transform);
          return DOMRect.fromRect({
            x: 1000 + Number(moved?.[1] ?? 0),
            width: 320,
            height: 400,
          });
        }
        if (this.matches(".content-editor"))
          return DOMRect.fromRect({ x: 200, width: 760, height: 400 });
        return DOMRect.fromRect({ width: 1600, height: 900 });
      },
    );
    await render(surface("page", "page"));

    const lane = present(
      container.querySelector<HTMLElement>("aside[data-comments-flow-lane]"),
    );
    expect(lane.style.transform).toBe("");
    expect(lane.firstElementChild).toHaveProperty(
      "style.transform",
      "translateX(-40px)",
    );
    expect(observed.filter((element) => element === lane)).toHaveLength(1);
  });
});

describe("a local file whose page history can't be updated", () => {
  it("keeps the Collection the cached page belongs to", async () => {
    page("page", {
      source: { mode: "local-files", path: "notes/page.md" },
    } as Partial<Document>);
    const onDisk = present(fixture.pages.page);
    fixture.readLocal = {
      ok: true,
      document: onDisk,
      revision: "disk-1",
      updatedAt: onDisk.updatedAt,
    } as LocalSourceDocumentReadResult;
    const cached = ["action", "get-document", { id: "page" }];
    queryClient.setQueryData(cached, {
      ...fixture.pages.page,
      databaseMembership: {
        databaseId: "database",
        databaseDocumentId: "database-page",
      },
    });
    fixture.mutation.mutateAsync.mockRejectedValue(new Error("offline"));
    await render(surface("page", "page"));

    await act(async () => {
      await present(present(last(fixture.editors)).onSaveContent)(
        "Saved body, edited",
      );
    });
    expect(queryClient.getQueryData(cached)).toMatchObject({
      content: "Saved body, edited",
      databaseMembership: { databaseId: "database" },
    });
  });
});

describe("a new comment's quoted text", () => {
  it("checks the page still marks it whenever the comment moves, not as it's written", async () => {
    const frames: FrameRequestCallback[] = [];
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) =>
      frames.push(callback),
    );
    vi.stubGlobal("cancelAnimationFrame", () => {});
    const frame = () =>
      act(async () => {
        for (const callback of frames.splice(0)) callback(0);
      });
    page("page", { canComment: true } as Partial<Document>);
    await render(surface("page", "page"));
    const pending = () =>
      present(last(fixture.sidebars, (props) => props.pendingComment));

    await act(async () =>
      present(present(last(fixture.editors)).onComment)("Gone", 0),
    );
    expect(pending().pendingTargetValid).toBe(false);
    await frame();
    expect(pending().pendingTargetValid).toBe(false);

    await act(async () =>
      present(present(last(fixture.editors)).onComment)("Saved", 0),
    );
    await frame();
    expect(pending().pendingTargetValid).toBe(true);
    await act(async () =>
      present(pending().onPendingChange)(
        present(pending().pendingComment).id,
        () => ({
          text: "Hi",
        }),
      ),
    );
    expect(pending().pendingComment?.text).toBe("Hi");
    expect(pending().pendingTargetValid).toBe(true);
  });
});
