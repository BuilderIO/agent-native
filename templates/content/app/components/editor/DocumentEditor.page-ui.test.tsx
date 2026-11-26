// @vitest-environment happy-dom

import type { ResourceSuggestion } from "@agent-native/core/review";
import type { Document } from "@shared/api";
import { canonicalizeNfm } from "@shared/nfm";
import { markdownSuggestionOperations } from "@shared/suggestion-diff";
import type { QueryClient } from "@tanstack/react-query";
import { act, createElement, type ComponentProps, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { CommentThread } from "@/hooks/use-comments";
import type { LocalSourceDocumentReadResult } from "@/lib/local-content-source-files";

import type { VisualEditor } from "./VisualEditor";

type ToolbarProps = {
  documentId: string;
  canEdit?: boolean;
  canUndo?: boolean;
  onSuggestingChange?: (next: boolean) => void;
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
vi.mock("@/lib/local-content-source-files", async (original) => ({
  ...(await original<typeof import("@/lib/local-content-source-files")>()),
  canWriteLinkedLocalSource: (_id: string, source: Document["source"]) =>
    source?.mode === "local-files",
  readDocumentFromLinkedLocalSource: async () => fixture.readLocal,
  watchLinkedLocalSource: async () => ({ ok: false, error: "unwatched" }),
  writeDocumentToLinkedLocalSource: async () => ({
    ok: true,
    revision: "disk-2",
  }),
}));
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
  LinkedLocalDocumentAgentBridge: () => null,
}));
vi.mock("./DocumentReconcileRecovery", () => ({
  DocumentReconcileRecovery: () => null,
}));
vi.mock("./VisualEditor", async (original) => ({
  ...(await original<typeof import("./VisualEditor")>()),
  VisualEditor: (props: ComponentProps<typeof VisualEditor>) => {
    fixture.editors.push(props);
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
}));

import { PageEditorSurface } from "./DocumentEditor";
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
  for (let index = items.length - 1; index >= 0; index -= 1)
    if (match(items[index])) return items[index];
  return undefined;
}

function toolbar(documentId = "page") {
  return present(
    last(fixture.toolbars, (props) => props.documentId === documentId),
  );
}

function selectedThread(documentId = "page") {
  const selected = Array.from(
    owner(documentId).querySelectorAll<HTMLElement>("[data-sidebar-fixture]"),
  ).find((sidebar) => sidebar.dataset.selected);
  return selected?.dataset.selected ?? null;
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
  await click(
    present(owner(documentId).querySelector("[data-comment-thread]")),
  );
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
  it("dismisses only the comment in the editor the key came from", async () => {
    page("peek");
    await render(surface("page", "page"), surface("peek", "preview"));
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
    fixture.readLocal = {
      ok: true,
      document: fixture.pages.page,
      revision: "disk-1",
      updatedAt: fixture.pages.page.updatedAt,
    } as LocalSourceDocumentReadResult;
    await render(surface("page", "page"));

    expect(container.querySelector("[data-local-source-read-only]")).toBe(null);
    expect(toolbar().canEdit).toBe(true);
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
    fixture.readLocal = {
      ok: true,
      document: fixture.pages.page,
      revision: "disk-1",
      updatedAt: fixture.pages.page.updatedAt,
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
