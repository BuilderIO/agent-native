// @vitest-environment happy-dom
import type { Document } from "@shared/api";
import { act, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  entries: [] as Array<{
    scope: {
      accountId: string;
      orgId: string;
      documentId: string;
      writerId: string;
    };
    snapshot: {
      title: string;
      content: string;
      baseTitle: string;
      baseContent: string;
      baseUpdatedAt: string | null;
      baseRevision?: string;
      authoredBaseRevision?: string;
      authoredBaseContent?: string;
      authoredCandidateContent?: string;
      editGeneration: number;
      saveAttemptId?: string;
      priorSaveAttemptIds?: string[];
      equivalentSaveAttemptIds?: string[];
    };
    writtenAt: number;
    recoveryStatus?: "retained_in_history";
  }>,
  receipt: vi.fn(),
  rebase: vi.fn(),
  update: vi.fn(),
  upsert: vi.fn(),
  resolve: vi.fn(),
  refetch: vi.fn(),
  cleared: vi.fn(),
  sweep: vi.fn(),
  draft: null as null | Record<string, unknown>,
  // A query cache holds what its last fetch read; null reads the server live.
  cachedRead: null as null | { draft: null | Record<string, unknown> },
  read: vi.fn(),
  live: vi.fn(),
  verify: vi.fn(),
  session: null as null | { email: string; orgId: string },
}));
vi.mock("@agent-native/core/client/hooks", () => ({
  callAction: state.receipt,
  useSession: () => ({ session: state.session }),
}));
vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string) => key,
}));
vi.mock("react-router", () => ({ useNavigate: () => vi.fn() }));
// One client for the page's lifetime, so creation state can be marked on it.
const queryClient = vi.hoisted(() => ({
  refetchQueries: (...args: unknown[]) => state.refetch(...args),
  getQueryCache: () => ({ findAll: () => [], subscribe: () => () => {} }),
}));
vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => queryClient,
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
import { toast } from "sonner";
vi.mock("@/hooks/use-documents", () => ({
  documentQueryFilter: (id: string) => ({ id }),
  ensurePreviewDocumentDraftRead: (...args: unknown[]) => state.verify(...args),
  isDocumentUpdateConflict: (result: { conflict?: boolean }) =>
    result.conflict === true,
  isDocumentUpdatePreservationRequired: (result: {
    preservationRequired?: boolean;
  }) => result.preservationRequired === true,
  isDocumentUpdateSuperseded: (result: { superseded?: boolean }) =>
    result.superseded === true,
  usePreviewDocumentDraft: () => ({
    data: state.cachedRead ?? { draft: state.draft },
    refetch: state.refetch,
  }),
  useUpdateDocument: () => ({ mutateAsync: state.update }),
  useUpdatePreviewDocumentDraft: () => ({ mutateAsync: state.upsert }),
  useResolvePreviewDocumentDraft: () => ({ mutateAsync: state.resolve }),
}));
vi.mock("./page-draft-journal", () => ({
  holdPageDraftWriter: () => () => {},
  liveDraftWriterIds: state.live,
  readPageDraftJournal: state.read,
  sweepLegacyRetainedPageDraftMarkers: state.sweep,
  writePageDraftJournal: (input: {
    scope: { writerId: string };
    snapshot: (typeof state.entries)[number]["snapshot"];
  }) => {
    const current = state.entries.find(
      (item) => item.scope.writerId === input.scope.writerId,
    );
    if (current) current.snapshot = input.snapshot;
    return { snapshot: input.snapshot };
  },
  clearPageDraftJournal: (
    scope: { writerId: string },
    acknowledged: { editGeneration: number; title: string; content: string },
  ) => {
    const current = state.entries.find(
      (entry) => entry.scope.writerId === scope.writerId,
    );
    if (
      !current ||
      current.snapshot.editGeneration !== acknowledged.editGeneration ||
      current.snapshot.title !== acknowledged.title ||
      current.snapshot.content !== acknowledged.content
    )
      return false;
    state.entries = state.entries.filter(
      (entry) => entry.scope.writerId !== scope.writerId,
    );
    state.cleared(scope.writerId);
    return true;
  },
}));
vi.mock("./document-save-rebase", () => ({
  saveDocumentWithRebase: state.rebase,
}));
vi.mock("./DocumentEditorSkeleton", () => ({
  DocumentEditorSkeleton: () => <div data-testid="editor-skeleton" />,
}));

import {
  clearDocumentCreationConfirmed,
  clearDocumentCreationPending,
  markDocumentCreationConfirmed,
  markDocumentCreationPending,
} from "@/lib/optimistic-document";

import { useRegisterLiveEditorSession } from "./live-editor-session";
import { PageDraftRecovery } from "./PageDraftRecovery";

const page = {
  id: "page",
  title: "Saved",
  content: "Saved body",
  canEdit: true,
  createdAt: "created",
  updatedAt: "v2",
  contentHash: "sha256:saved-body",
} as Document;

function entry(writerId: string, content: string, baseUpdatedAt = "v2") {
  return {
    scope: {
      accountId: "writer@example.test",
      orgId: "org",
      documentId: "page",
      writerId,
    },
    snapshot: {
      title: "Saved",
      content,
      baseTitle: "Saved",
      baseContent: "Saved body",
      baseUpdatedAt,
      editGeneration: 1,
    },
    writtenAt: 1,
  };
}

describe("Page browser journal recovery", () => {
  let root: Root;
  let container: HTMLDivElement;
  const render = (currentPage: Document = page) =>
    root.render(
      <PageDraftRecovery document={currentPage}>
        <textarea defaultValue="Live editor" />
      </PageDraftRecovery>,
    );
  beforeEach(() => {
    (
      globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    vi.clearAllMocks();
    state.resolve.mockReset();
    state.upsert.mockReset();
    state.entries = [];
    state.draft = null;
    state.cachedRead = null;
    state.session = { email: "writer@example.test", orgId: "org" };
    state.read.mockImplementation(
      (
        scope: { accountId: string; orgId: string; documentId: string },
        skip: ReadonlySet<string> = new Set(),
      ) =>
        state.entries.find(
          (entry) =>
            entry.scope.accountId === scope.accountId &&
            entry.scope.orgId === scope.orgId &&
            entry.scope.documentId === scope.documentId &&
            !entry.recoveryStatus &&
            !skip.has(entry.scope.writerId),
        ) ?? null,
    );
    state.live.mockResolvedValue(new Set());
    state.receipt.mockResolvedValue({ found: false });
    state.refetch.mockImplementation(async () => ({
      data: { draft: state.draft },
    }));
    state.verify.mockResolvedValue(undefined);
    state.rebase.mockResolvedValue({ status: "saved", document: page });
    state.upsert.mockImplementation(async ({ draft }) => ({
      status: "saved",
      draft: {
        id: "promoted-draft",
        ...draft,
        editorSessionId: draft.editorSessionId ?? null,
        editGeneration: draft.editGeneration ?? null,
        version: 1,
      },
    }));
    state.resolve.mockResolvedValue({ status: "resolved" });
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });
  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it("drains every writer before mounting the editor", async () => {
    state.entries = [entry("first", "Saved body"), entry("second", "Local")];
    state.rebase.mockResolvedValue({
      status: "saved",
      document: { ...page, content: "Local" },
    });
    await act(async () => render());
    expect(state.entries).toEqual([]);
    expect(state.rebase).toHaveBeenCalledTimes(1);
    expect(container.querySelector("textarea")).not.toBeNull();
  });

  it("leaves an entry whose editor is open in another tab to that tab", async () => {
    state.entries = [entry("other-tab", "Typed in the other tab")];
    state.live.mockResolvedValue(new Set(["other-tab"]));

    await act(async () => render());

    expect(state.rebase).not.toHaveBeenCalled();
    expect(state.update).not.toHaveBeenCalled();
    expect(state.upsert).not.toHaveBeenCalled();
    expect(state.entries).toHaveLength(1);
    expect(toast.success).not.toHaveBeenCalled();
    expect(container.querySelector("textarea")).not.toBeNull();
  });

  it("leaves a SQL draft whose editor is open in another tab to that tab", async () => {
    state.entries = [entry("other-tab", "Typed in the other tab")];
    state.live.mockResolvedValue(new Set(["other-tab"]));
    state.draft = {
      id: "selected-draft",
      version: 1,
      title: "Saved",
      content: "Typed in the other tab",
      baseDocumentUpdatedAt: "v1",
      editorSessionId: "other-tab",
      editGeneration: 1,
    };

    await act(async () => render());

    expect(state.resolve).not.toHaveBeenCalled();
    expect(state.rebase).not.toHaveBeenCalled();
    expect(state.entries).toHaveLength(1);
    expect(container.querySelector("textarea")).not.toBeNull();
  });

  // Its journal write can fail, or its entry be cleared, while the SQL draft
  // stays.
  it.each([
    [
      "leaves a SQL draft with no journal entry to its editor in another tab",
      new Set(["other-tab"]),
      false,
    ],
    [
      "settles a SQL draft with no journal entry once its editor has closed",
      new Set<string>(),
      true,
    ],
  ])("%s", async (_, live, settled) => {
    state.live.mockResolvedValue(live);
    state.draft = {
      id: "selected-draft",
      version: 1,
      title: "Saved",
      baseTitle: "Saved",
      content: "Typed in the other tab",
      baseDocumentUpdatedAt: "v1",
      editorSessionId: "other-tab",
      editGeneration: 1,
    };

    await act(async () => render());

    expect(state.live).toHaveBeenCalled();
    if (settled)
      expect(state.resolve).toHaveBeenCalledWith(
        expect.objectContaining({ choice: "use_saved" }),
      );
    else {
      expect(state.resolve).not.toHaveBeenCalled();
      expect(state.update).not.toHaveBeenCalled();
      expect(container.querySelector("textarea")).not.toBeNull();
    }
  });

  it("holds a closed tab's entry behind a SQL draft whose editor is open in another tab", async () => {
    state.entries = [
      entry("other-tab", "Typed in the other tab"),
      entry("closed-tab", "Typed before closing"),
    ];
    state.live.mockResolvedValue(new Set(["other-tab"]));
    state.draft = {
      id: "selected-draft",
      version: 1,
      title: "Saved",
      content: "Typed in the other tab",
      baseDocumentUpdatedAt: "v1",
      editorSessionId: "other-tab",
      editGeneration: 1,
    };

    await act(async () => render());

    expect(state.resolve).not.toHaveBeenCalled();
    expect(state.rebase).not.toHaveBeenCalled();
    expect(state.upsert).not.toHaveBeenCalled();
    expect(state.entries).toHaveLength(2);
    expect(container.querySelector("textarea")).not.toBeNull();
  });

  it.each([
    ["an older", "v1"],
    ["the current", "v2"],
  ])(
    "holds a closed tab's entry behind an open tab's same-text SQL draft on %s page version",
    async (_, baseDocumentUpdatedAt) => {
      const closed: (typeof state.entries)[number] = entry(
        "closed-tab",
        "Same text in both tabs",
      );
      closed.snapshot.baseUpdatedAt = null;
      closed.snapshot.baseContent = "Earlier body";
      state.entries = [closed];
      state.live.mockResolvedValue(new Set(["open-tab"]));
      state.draft = {
        id: "open-tab-draft",
        version: 1,
        title: "Saved",
        baseTitle: "Saved",
        content: "Same text in both tabs",
        baseDocumentUpdatedAt,
        editorSessionId: "open-tab",
        editGeneration: 1,
      };

      await act(async () => render());

      expect(state.resolve).not.toHaveBeenCalled();
      expect(state.upsert).not.toHaveBeenCalled();
      expect(state.rebase).not.toHaveBeenCalled();
      expect(state.cleared).not.toHaveBeenCalled();
      expect(state.entries).toEqual([closed]);
      expect(container.querySelector("textarea")).not.toBeNull();
    },
  );

  it("replays a closed tab's entry past one whose editor is still open", async () => {
    state.entries = [
      entry("other-tab", "Typed in the other tab"),
      entry("closed-tab", "Typed before closing"),
    ];
    state.live.mockResolvedValue(new Set(["other-tab"]));
    state.rebase.mockResolvedValue({
      status: "saved",
      document: { ...page, content: "Typed before closing" },
    });

    await act(async () => render());

    expect(state.rebase).toHaveBeenCalledOnce();
    expect(state.rebase).toHaveBeenCalledWith(
      expect.objectContaining({ content: "Typed before closing" }),
    );
    expect(state.entries.map((item) => item.scope.writerId)).toEqual([
      "other-tab",
    ]);
  });

  it("asks again which tabs are open before acting on an entry written since", async () => {
    state.entries = [entry("closed-tab", "Saved body")];
    await act(async () => render());
    expect(state.entries).toEqual([]);

    state.entries = [
      { ...entry("new-tab", "Typed in the new tab"), writtenAt: 2 },
    ];
    state.live.mockResolvedValue(new Set(["new-tab"]));
    state.draft = {
      id: "selected-draft",
      version: 1,
      title: "Saved",
      content: "Typed in the new tab",
      baseDocumentUpdatedAt: "v2",
      editorSessionId: "new-tab",
      editGeneration: 1,
    };
    await act(async () => render());

    expect(state.cleared).not.toHaveBeenCalledWith("new-tab");
    expect(state.entries.map((item) => item.scope.writerId)).toEqual([
      "new-tab",
    ]);
  });

  it("shows a failure, not the editor, when open tabs cannot be read", async () => {
    state.entries = [entry("other-tab", "Typed in the other tab")];
    state.live.mockRejectedValue(new Error("lock manager unavailable"));

    await act(async () => render());

    expect(state.rebase).not.toHaveBeenCalled();
    expect(container.querySelector("textarea")).toBeNull();
    expect(
      container.querySelector('[data-testid="editor-skeleton"]'),
    ).toBeNull();
  });

  it("clears a journal generation superseded by Use saved without retaining or replaying it", async () => {
    state.entries = [entry("settled-writer", "Discarded local body")];
    state.rebase.mockResolvedValue({
      status: "superseded",
      document: page,
    });

    await act(async () => render());

    expect(state.rebase).toHaveBeenCalledTimes(1);
    expect(state.update).not.toHaveBeenCalled();
    expect(state.entries).toEqual([]);
    expect(toast.success).not.toHaveBeenCalled();
    expect(container.textContent).not.toContain("editor.previewDraftConflict");
    expect(container.querySelector("textarea")).not.toBeNull();
  });

  it("carries the journal's originating title base and preserves unknown SQL lineage on refusal", async () => {
    const journal: (typeof state.entries)[number] = entry("first", "Local");
    journal.snapshot.baseUpdatedAt = null;
    journal.snapshot.baseContent = "Earlier body";
    state.entries = [journal];
    state.draft = {
      id: "selected-draft",
      documentId: "page",
      title: "Saved",
      content: "Local",
      baseTitle: null,
      baseDocumentUpdatedAt: null,
      loadedContentWasEmpty: 0,
      editorSessionId: null,
      editGeneration: null,
      version: 1,
    };
    state.upsert.mockResolvedValue({ status: "conflict", draft: state.draft });
    await act(async () => render());
    expect(state.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        draft: expect.objectContaining({
          baseTitle: "Saved",
          editorSessionId: "first",
          editGeneration: journal.snapshot.editGeneration,
        }),
      }),
    );
    expect(state.entries).toEqual([journal]);
    expect(state.cleared).not.toHaveBeenCalled();
    expect(state.resolve).not.toHaveBeenCalled();
    expect(container.textContent).toContain("editor.previewDraftTitleUnknown");
  });

  it("adopts a newer SQL title for the exact matching journal generation", async () => {
    const staleJournal = entry("first", "Local");
    staleJournal.snapshot = {
      ...staleJournal.snapshot,
      title: "Earlier title",
      baseTitle: "Earlier title",
    };
    state.entries = [staleJournal];
    state.draft = {
      id: "selected-draft",
      documentId: "page",
      title: "Newer SQL title",
      baseTitle: "Newer SQL title",
      content: "Local",
      baseDocumentUpdatedAt: "v2",
      baseContentHash: "sha256:saved-body",
      loadedContentWasEmpty: 0,
      deferredReason: "conflict",
      editorSessionId: "first",
      editGeneration: 1,
      version: 2,
      updatedAt: "2026-10-07T00:00:00.000Z",
    };
    state.update.mockResolvedValue({
      ...page,
      title: "Newer SQL title",
      content: "Local",
      updatedAt: "v3",
    });

    await act(async () => render({ ...page, revision: "body:v2" } as Document));

    expect(state.cleared).toHaveBeenCalledWith("first");
    expect(state.resolve).toHaveBeenCalledWith(
      expect.objectContaining({
        choice: "keep_mine",
        expectedDraftTitle: "Newer SQL title",
        expectedDraftBaseTitle: "Newer SQL title",
        expectedDocumentTitle: "Saved",
      }),
    );
    expect(state.update).not.toHaveBeenCalled();
    expect(state.rebase).not.toHaveBeenCalled();
    expect(state.upsert).not.toHaveBeenCalled();
    expect(state.draft).toMatchObject({
      title: "Newer SQL title",
      baseTitle: "Newer SQL title",
      content: "Local",
      editorSessionId: "first",
      editGeneration: 1,
    });
  });

  it("clears the stored journal snapshot after promoting its SQL title", async () => {
    const staleJournal = entry("first", "Local");
    staleJournal.snapshot = {
      ...staleJournal.snapshot,
      title: "Earlier title",
      baseTitle: "Earlier title",
      baseUpdatedAt: "",
    };
    state.entries = [staleJournal];
    state.draft = {
      id: "selected-draft",
      documentId: "page",
      title: "Newer SQL title",
      baseTitle: "Newer SQL title",
      content: "Local",
      baseDocumentUpdatedAt: "stale-version",
      loadedContentWasEmpty: 0,
      deferredReason: "conflict",
      editorSessionId: "first",
      editGeneration: 1,
      version: 2,
      updatedAt: "2026-10-07T00:00:00.000Z",
    };

    await act(async () => render());

    expect(state.resolve).toHaveBeenCalledWith(
      expect.objectContaining({
        expectedDraftTitle: "Newer SQL title",
        expectedDraftContent: "Local",
      }),
    );
    expect(state.cleared).toHaveBeenCalledWith("first");
    expect(state.entries).toEqual([]);
    expect(toast.success).toHaveBeenCalledWith(
      "editor.previewDraftSavedToHistory",
    );
  });

  it("preserves a local journal title when a matching SQL draft has a peer title", async () => {
    const localRename = "Local rename";
    const staleJournal = entry("first", "Local");
    staleJournal.snapshot = {
      ...staleJournal.snapshot,
      title: localRename,
    };
    state.entries = [staleJournal];
    state.draft = {
      id: "selected-draft",
      documentId: "page",
      title: "Peer rename",
      baseTitle: "Peer rename",
      content: "Local",
      baseDocumentUpdatedAt: "v2",
      baseContentHash: "sha256:saved-body",
      loadedContentWasEmpty: 0,
      deferredReason: "conflict",
      editorSessionId: "first",
      editGeneration: 1,
      version: 2,
      updatedAt: "2026-10-07T00:00:00.000Z",
    };
    state.upsert.mockResolvedValue({
      status: "saved",
      draft: {
        id: "selected-draft",
        title: localRename,
        baseTitle: "Saved",
        content: "Local",
        editorSessionId: "first",
        editGeneration: 1,
        version: 3,
      },
    });

    await act(async () =>
      render({ ...page, title: "Peer rename" } as Document),
    );

    expect(state.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        expectedVersion: 2,
        expectedDraftId: "selected-draft",
        draft: expect.objectContaining({
          title: localRename,
          content: "Local",
          deferredReason: "conflict",
        }),
      }),
    );
    expect(state.resolve).toHaveBeenCalledWith(
      expect.objectContaining({
        choice: "use_saved",
        expectedDraftTitle: localRename,
        expectedDraftContent: "Local",
      }),
    );
    expect(state.update).not.toHaveBeenCalled();
    expect(state.cleared).toHaveBeenCalledWith("first");
    expect(toast.success).toHaveBeenCalledWith(
      "editor.previewDraftSavedToHistory",
    );
  });

  it.each([
    ["writer", { editorSessionId: "other-writer" }],
    ["generation", { editGeneration: 2 }],
    ["content", { content: "Different body" }],
  ])(
    "does not adopt a SQL title when the journal %s does not match",
    async (_mismatch, mismatch) => {
      const staleJournal = entry("first", "Local");
      staleJournal.snapshot = {
        ...staleJournal.snapshot,
        title: "Earlier title",
      };
      state.entries = [staleJournal];
      state.draft = {
        id: "selected-draft",
        documentId: "page",
        title: "Newer SQL title",
        baseTitle: "Newer SQL title",
        content: "Local",
        baseDocumentUpdatedAt: "v2",
        baseContentHash: "sha256:saved-body",
        loadedContentWasEmpty: 0,
        deferredReason: "conflict",
        editorSessionId: "first",
        editGeneration: 1,
        version: 2,
        updatedAt: "2026-10-07T00:00:00.000Z",
        ...mismatch,
      };

      await act(async () => render());

      expect(state.entries).toHaveLength(1);
      expect(state.update).not.toHaveBeenCalled();
      expect(state.rebase).not.toHaveBeenCalled();
      expect(state.upsert).not.toHaveBeenCalled();
      expect(state.resolve).not.toHaveBeenCalled();
      expect(state.draft).toMatchObject({ title: "Newer SQL title" });
    },
  );

  it.each([
    ["another writer", { editorSessionId: "other-writer" }, false],
    ["another generation of its writer", { editGeneration: 2 }, false],
    ["its own writer and generation", {}, true],
  ])(
    "adopts a same-text draft an upsert conflicts with only when it is %s",
    async (_, identity, adopted) => {
      const journal: (typeof state.entries)[number] = entry(
        "closed-writer",
        "Same text",
      );
      journal.snapshot.baseUpdatedAt = null;
      journal.snapshot.baseContent = "Earlier body";
      state.entries = [journal];
      state.upsert.mockImplementation(async () => {
        state.draft = {
          id: "conflicting-draft",
          version: 3,
          title: "Saved",
          baseTitle: "Saved",
          content: "Same text",
          baseDocumentUpdatedAt: "v1",
          editorSessionId: "closed-writer",
          editGeneration: 1,
          ...identity,
        };
        return { status: "conflict", draft: state.draft };
      });
      state.resolve.mockImplementation(async () => {
        state.draft = null;
        return { status: "resolved", choice: "use_saved" };
      });

      await act(async () => render());

      expect(state.upsert).toHaveBeenCalledWith(
        expect.objectContaining({ expectedVersion: null }),
      );
      if (adopted) {
        expect(state.resolve).toHaveBeenCalledExactlyOnceWith(
          expect.objectContaining({
            choice: "use_saved",
            trigger: "automatic",
            expectedDraftId: "conflicting-draft",
            expectedDraftEditorSessionId: "closed-writer",
            expectedDraftEditGeneration: 1,
            expectedDraftVersion: 3,
          }),
        );
        expect(state.cleared).toHaveBeenCalledWith("closed-writer");
        return;
      }
      expect(state.resolve).not.toHaveBeenCalled();
      expect(state.cleared).not.toHaveBeenCalled();
      expect(state.entries).toEqual([journal]);
      expect(
        container.querySelector("[data-recovery-comparison]"),
      ).not.toBeNull();
    },
  );

  describe("when another writer saves a draft after the page read none", () => {
    const peerDraft = (content: string, baseTitle: string | null) => ({
      id: "peer-draft",
      version: 1,
      title: "Saved",
      baseTitle,
      content,
      baseDocumentUpdatedAt: "v1",
      editorSessionId: "peer-writer",
      editGeneration: 4,
    });
    function closedJournalBehindEmptyRead(
      served: (peer: Record<string, unknown>) => Record<string, unknown> | null,
      peer = peerDraft("Same text", null),
    ) {
      const journal: (typeof state.entries)[number] = entry(
        "closed-writer",
        "Same text",
      );
      journal.snapshot.baseUpdatedAt = null;
      journal.snapshot.baseContent = "Earlier body";
      state.entries = [journal];
      state.cachedRead = { draft: null };
      state.refetch.mockImplementation(async () => {
        state.cachedRead = { draft: state.draft };
        return { data: state.cachedRead };
      });
      state.upsert.mockImplementation(async () => {
        state.draft = served(peer);
        return { status: "conflict", draft: peer };
      });
      return journal;
    }

    it.each([
      [
        "the journal's text and an unknown title base",
        peerDraft("Same text", null),
        (served: Record<string, unknown>) => served,
        "editor.previewDraftTitleUnknown",
        "Same text",
      ],
      [
        "other text",
        peerDraft("Peer text", "Saved"),
        (served: Record<string, unknown>) => served,
        "editor.previewDraftConflict",
        "Peer text",
      ],
      [
        "a newer version by the time it is read",
        peerDraft("Same text", null),
        (served: Record<string, unknown>) => ({
          ...served,
          version: 2,
          content: "Newer peer text",
        }),
        "editor.previewDraftTitleUnknown",
        "Newer peer text",
      ],
    ])(
      "reviews the draft it reads again when another writer's draft holds %s",
      async (_, peer, served, notice, shown) => {
        const journal = closedJournalBehindEmptyRead(served, peer);

        await act(async () => render());

        expect(container.querySelector("textarea")).toBeNull();
        expect(
          container.querySelector("[data-recovery-comparison]"),
        ).not.toBeNull();
        expect(container.textContent).toContain(notice);
        expect(container.textContent).toContain(shown);
        expect(state.refetch).toHaveBeenCalled();
        expect(
          container.querySelector('[data-testid="editor-skeleton"]'),
        ).toBeNull();
        expect(state.upsert).toHaveBeenCalledTimes(1);
        expect(state.resolve).not.toHaveBeenCalled();
        expect(state.cleared).not.toHaveBeenCalled();
        expect(state.entries).toEqual([journal]);
      },
    );

    it.each([
      [
        "that draft is gone by the time it is read",
        { status: "conflict", draft: peerDraft("Same text", null) },
        false,
      ],
      [
        "its generation was settled and no draft holds the page",
        { status: "superseded", draft: null },
        false,
      ],
      [
        "the draft that holds the page cannot be read",
        { status: "superseded", draft: null },
        true,
      ],
    ])(
      "keeps the journal and offers a retry when %s",
      async (_, refused, unreadable) => {
        const journal = closedJournalBehindEmptyRead(() => null);
        state.upsert.mockImplementation(async () => {
          state.draft = null;
          return refused;
        });
        if (unreadable)
          state.refetch.mockRejectedValueOnce(new Error("Drafts unavailable"));

        await act(async () => render());

        expect(container.querySelector("textarea")).toBeNull();
        expect(container.textContent).toContain("empty.genericError");
        expect(
          container.querySelector("[data-recovery-comparison]"),
        ).toBeNull();
        expect(state.refetch).toHaveBeenCalled();
        expect(state.resolve).not.toHaveBeenCalled();
        expect(state.cleared).not.toHaveBeenCalled();
        expect(state.entries).toEqual([journal]);
        expect(toast.success).not.toHaveBeenCalled();

        state.upsert.mockImplementation(async ({ draft }) => ({
          status: "saved",
          draft: { id: "promoted-draft", ...draft, version: 1 },
        }));
        const retry = [...container.querySelectorAll("button")].find(
          (button) => button.textContent === "database.retry",
        )!;
        await act(async () => retry.click());

        expect(state.upsert).toHaveBeenCalledTimes(2);
        expect(state.resolve).toHaveBeenCalledExactlyOnceWith(
          expect.objectContaining({
            choice: "use_saved",
            trigger: "automatic",
            expectedDraftId: "promoted-draft",
            expectedDraftEditorSessionId: "closed-writer",
          }),
        );
        expect(state.cleared).toHaveBeenCalledWith("closed-writer");
      },
    );

    it.each(["unmounts", "changes its account scope"])(
      "presents nothing from that read when the page %s while it runs",
      async (change) => {
        const journal = closedJournalBehindEmptyRead((served) => served);
        let release!: () => void;
        const held = new Promise<void>((resolve) => (release = resolve));
        state.refetch.mockImplementation(async () => {
          await held;
          state.cachedRead = { draft: state.draft };
          return { data: state.cachedRead };
        });

        await act(async () => render());
        expect(state.refetch).toHaveBeenCalledTimes(1);

        if (change === "unmounts") {
          act(() => root.unmount());
          root = createRoot(container);
        } else {
          state.session = { email: "writer@example.test", orgId: "other-org" };
          await act(async () => render());
        }
        await act(async () => {
          release();
          await held;
        });

        expect(
          container.querySelector("[data-recovery-comparison]"),
        ).toBeNull();
        expect(container.textContent).not.toContain("empty.genericError");
        expect(state.resolve).not.toHaveBeenCalled();
        expect(state.cleared).not.toHaveBeenCalled();
        expect(state.entries).toEqual([journal]);
        expect(toast.success).not.toHaveBeenCalled();
      },
    );

    describe("and that draft is settled", () => {
      function settledPeerDraft() {
        const journal = closedJournalBehindEmptyRead((served) => served);
        state.resolve.mockImplementation(async () => {
          state.draft = null;
          return { status: "resolved", choice: "use_saved" };
        });
        return journal;
      }
      function promoteJournal() {
        const upserted: Array<typeof state.entries> = [];
        state.upsert.mockImplementation(async ({ draft }) => {
          upserted.push([...state.entries]);
          state.draft = { id: "promoted-draft", ...draft, version: 1 };
          return { status: "saved", draft: state.draft };
        });
        return upserted;
      }
      const choose = (label: string) =>
        act(async () =>
          [...container.querySelectorAll("button")]
            .find((button) => button.textContent === label)!
            .click(),
        );

      it("runs the journal again and settles it by its own draft", async () => {
        const journal = settledPeerDraft();

        await act(async () => render());
        expect(container.textContent).toContain(
          "editor.previewDraftTitleUnknown",
        );
        await act(async () => render({ ...page }));
        expect(state.upsert).toHaveBeenCalledTimes(1);

        const upserted = promoteJournal();
        await choose("editor.previewDraftUseSaved");

        expect(state.resolve).toHaveBeenNthCalledWith(
          1,
          expect.objectContaining({
            choice: "use_saved",
            trigger: "reviewed",
            expectedDraftId: "peer-draft",
          }),
        );
        expect(state.upsert).toHaveBeenCalledTimes(2);
        expect(state.upsert).toHaveBeenLastCalledWith(
          expect.objectContaining({
            expectedVersion: null,
            draft: expect.objectContaining({
              content: "Same text",
              editorSessionId: "closed-writer",
            }),
          }),
        );
        expect(upserted).toEqual([[journal]]);
        expect(state.resolve).toHaveBeenNthCalledWith(
          2,
          expect.objectContaining({
            choice: "use_saved",
            trigger: "automatic",
            expectedDraftId: "promoted-draft",
            expectedDraftEditorSessionId: "closed-writer",
          }),
        );
        expect(state.cleared).toHaveBeenCalledExactlyOnceWith("closed-writer");
        expect(state.entries).toEqual([]);
        expect(container.querySelector("textarea")).not.toBeNull();
      });

      it("runs the journal again after settling the draft that replaced it", async () => {
        const journal = settledPeerDraft();
        await act(async () => render());

        const replacement = {
          ...peerDraft("Replacement text", "Saved"),
          id: "replacement-draft",
          editorSessionId: "replacing-writer",
          editGeneration: 2,
        };
        state.draft = replacement;
        state.cachedRead = { draft: replacement };
        await act(async () => render({ ...page }));
        expect(container.textContent).toContain("editor.previewDraftConflict");
        expect(container.textContent).toContain("Replacement text");
        expect(state.upsert).toHaveBeenCalledTimes(1);

        const upserted = promoteJournal();
        await choose("editor.previewDraftUseSaved");

        expect(state.resolve).toHaveBeenNthCalledWith(
          1,
          expect.objectContaining({
            trigger: "reviewed",
            expectedDraftId: "replacement-draft",
          }),
        );
        expect(upserted).toEqual([[journal]]);
        expect(state.resolve).toHaveBeenNthCalledWith(
          2,
          expect.objectContaining({
            trigger: "automatic",
            expectedDraftId: "promoted-draft",
          }),
        );
        expect(state.cleared).toHaveBeenCalledExactlyOnceWith("closed-writer");
        expect(state.entries).toEqual([]);
      });

      it.each(["account", "org", "page", "unmount"] as const)(
        "ends the journal's next run when its %s lifetime ends",
        async (change) => {
          const journal = settledPeerDraft();
          await act(async () => render());
          const promoted = held<unknown>();
          state.upsert.mockReturnValueOnce(promoted.promise);
          await choose("editor.previewDraftUseSaved");
          expect(state.upsert).toHaveBeenCalledTimes(2);

          if (change === "account")
            state.session = { email: "other@example.test", orgId: "org" };
          if (change === "org")
            state.session = {
              email: "writer@example.test",
              orgId: "other-org",
            };
          if (change === "unmount")
            await act(async () => {
              root.unmount();
              root = createRoot(container);
            });
          else
            await act(async () =>
              render(change === "page" ? { ...page, id: "other-page" } : page),
            );
          await act(async () =>
            promoted.resolve({
              status: "saved",
              draft: {
                id: "promoted-draft",
                version: 1,
                title: "Saved",
                baseTitle: "Saved",
                content: "Same text",
                baseDocumentUpdatedAt: null,
                editorSessionId: "closed-writer",
                editGeneration: 1,
              },
            }),
          );

          expect(state.resolve).toHaveBeenCalledTimes(1);
          expect(state.cleared).not.toHaveBeenCalled();
          expect(state.entries).toEqual([journal]);
          expect(
            container.querySelector("[data-recovery-comparison]"),
          ).toBeNull();
          expect(container.textContent).not.toContain("empty.genericError");
          expect(toast.success).toHaveBeenCalledTimes(1);
        },
      );
    });
  });

  it("reviews the journal's own draft when its History preservation is refused before the page read it", async () => {
    const journal: (typeof state.entries)[number] = entry(
      "closed-writer",
      "Unsent journal body",
    );
    journal.snapshot.baseUpdatedAt = null;
    journal.snapshot.baseContent = "Earlier body";
    state.entries = [journal];
    state.cachedRead = { draft: null };
    state.refetch.mockImplementation(async () => {
      state.cachedRead = { draft: state.draft };
      return { data: state.cachedRead };
    });
    state.upsert.mockImplementation(async ({ draft }) => {
      state.draft = { id: "promoted-draft", ...draft, version: 1 };
      return { status: "saved", draft: state.draft };
    });
    state.resolve.mockRejectedValueOnce(
      Object.assign(
        new Error(
          "This recovery choice was made for another version of the draft.",
        ),
        { errorCode: "PREVIEW_DRAFT_RECOVERY_CONFLICT", statusCode: 409 },
      ),
    );

    await act(async () => render());

    expect(container.querySelector("textarea")).toBeNull();
    expect(
      container.querySelector("[data-recovery-comparison]"),
    ).not.toBeNull();
    expect(container.textContent).toContain("editor.previewDraftConflict");
    expect(container.textContent).toContain("Unsent journal body");
    expect(state.entries).toEqual([journal]);
    expect(state.cleared).not.toHaveBeenCalled();

    state.resolve.mockImplementation(async () => {
      state.draft = null;
      return { status: "resolved", choice: "use_saved" };
    });
    const useSaved = [...container.querySelectorAll("button")].find(
      (button) => button.textContent === "editor.previewDraftUseSaved",
    )!;
    await act(async () => useSaved.click());

    expect(state.resolve).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        trigger: "reviewed",
        expectedDraftId: "promoted-draft",
      }),
    );
    expect(state.upsert).toHaveBeenCalledTimes(1);
    expect(state.cleared).toHaveBeenCalledExactlyOnceWith("closed-writer");
    expect(state.entries).toEqual([]);
  });

  it("replays a stale same-passage journal with its authored revision and accepts the server merge", async () => {
    state.entries = [
      {
        ...entry("first", "Local", "v1"),
        snapshot: {
          ...entry("first", "Local", "v1").snapshot,
          baseRevision: "body:1:sha256:base",
          authoredBaseRevision: "body:1:sha256:base",
          authoredBaseContent: "Saved body",
          authoredCandidateContent: "Local",
        },
      },
    ];
    state.update.mockResolvedValue({
      ...page,
      content: "Merged canonical",
      bodyIntentOutcome: { status: "applied" },
    });
    state.rebase.mockImplementation(
      async (args: {
        base: { content: string; updatedAt: string; revision?: string };
        content: string;
        persist: (
          content: string,
          base: { content: string; updatedAt: string; revision?: string },
        ) => Promise<Document>;
      }) => ({
        status: "saved",
        document: await args.persist(args.content, args.base),
      }),
    );
    await act(async () => render());
    expect(state.update).toHaveBeenCalledWith(
      expect.objectContaining({
        baseRevision: "body:1:sha256:base",
        authoredBaseRevision: "body:1:sha256:base",
        browserSaveAttemptId: expect.any(String),
        editorSnapshotTitle: "Saved",
      }),
    );
    expect(state.update.mock.calls[0]?.[0]).not.toHaveProperty("title");
    expect(state.update.mock.calls[0]?.[0]).not.toHaveProperty("baseTitle");
    expect(state.entries).toEqual([]);
    expect(container.querySelector("textarea")).not.toBeNull();
  });

  it("retains a peer-extended observation in History without confirming an unlineaged save", async () => {
    state.entries = [
      {
        ...entry("first", "Local Peer"),
        snapshot: {
          ...entry("first", "Local Peer").snapshot,
          baseRevision: "body:1:sha256:base",
          authoredBaseRevision: "body:1:sha256:base",
          authoredBaseContent: "Saved body",
          authoredCandidateContent: "Local",
        },
      },
    ];
    state.update.mockResolvedValue({
      preservationRequired: true,
      document: page,
      reason: "provenance",
      checkpointId: "observed-checkpoint",
    });
    state.rebase.mockImplementation(
      async (args: {
        base: { content: string; updatedAt: string; revision?: string };
        content: string;
        persist: (
          content: string,
          base: { content: string; updatedAt: string; revision?: string },
        ) => Promise<{ checkpointId: string }>;
      }) => {
        const response = await args.persist(args.content, args.base);
        return {
          status: "preservation",
          localDraft: args.content,
          base: args.base,
          checkpointId: response.checkpointId,
        };
      },
    );

    await act(async () => render());
    expect(state.update).toHaveBeenCalledWith(
      expect.objectContaining({ content: "Local Peer" }),
    );
    expect(state.update.mock.calls[0]?.[0]).not.toHaveProperty(
      "authoredCandidateContent",
    );
    expect(state.entries).toEqual([]);
    expect(toast.success).toHaveBeenCalledOnce();
    expect(toast.success).toHaveBeenCalledWith(
      "editor.previewDraftSavedToHistory",
    );
  });

  it("does not clear a newer journal for an older attempt's receipt", async () => {
    state.entries = [
      {
        ...entry("first", "Newer local"),
        snapshot: {
          ...entry("first", "Newer local").snapshot,
          saveAttemptId: "new-attempt",
          priorSaveAttemptIds: ["old-attempt"],
        },
      },
    ];
    state.receipt.mockImplementation(
      async (
        _action: string,
        args: {
          browserSaveAttemptId: string;
        },
      ) => ({ found: args.browserSaveAttemptId === "old-attempt" }),
    );
    state.update.mockResolvedValue({ ...page, content: "Newer local" });
    state.rebase.mockImplementation(
      async (args: {
        base: { content: string; updatedAt: string; revision?: string };
        content: string;
        persist: (
          content: string,
          base: { content: string; updatedAt: string; revision?: string },
        ) => Promise<Document>;
      }) => ({
        status: "saved",
        document: await args.persist(args.content, args.base),
      }),
    );

    await act(async () => render());
    expect(state.receipt).toHaveBeenCalledWith(
      "get-document-save-attempt",
      { id: "page", browserSaveAttemptId: "new-attempt" },
      { method: "GET" },
    );
    expect(state.receipt).not.toHaveBeenCalledWith(
      "get-document-save-attempt",
      { id: "page", browserSaveAttemptId: "old-attempt" },
      { method: "GET" },
    );
    expect(state.update).toHaveBeenCalledWith(
      expect.objectContaining({ content: "Newer local" }),
    );
  });

  it("clears a journal confirmed by an attempt that sent the same draft", async () => {
    // A hidden tab's keepalive copy can land while the flush that replaced its
    // attempt ID never sends. Replaying would reapply a rename that another
    // writer has since reverted.
    state.entries = [
      {
        ...entry("first", "Local"),
        snapshot: {
          ...entry("first", "Local").snapshot,
          saveAttemptId: "flush-attempt",
          equivalentSaveAttemptIds: ["keepalive-attempt"],
        },
      },
    ];
    state.receipt.mockImplementation(
      async (
        _action: string,
        args: {
          browserSaveAttemptId: string;
        },
      ) => ({ found: args.browserSaveAttemptId === "keepalive-attempt" }),
    );

    await act(async () => render());
    expect(state.receipt).toHaveBeenCalledWith(
      "get-document-save-attempt",
      { id: "page", browserSaveAttemptId: "flush-attempt" },
      { method: "GET" },
    );
    expect(state.receipt).toHaveBeenCalledWith(
      "get-document-save-attempt",
      { id: "page", browserSaveAttemptId: "keepalive-attempt" },
      { method: "GET" },
    );
    expect(state.rebase).not.toHaveBeenCalled();
    expect(state.update).not.toHaveBeenCalled();
    expect(state.entries).toEqual([]);
  });

  it("does not inspect local drafts before the current session passes access", async () => {
    state.entries = [entry("first", "Local")];
    state.verify.mockRejectedValue(new Error("access denied"));
    await act(async () => render());
    expect(state.read).not.toHaveBeenCalled();
    expect(state.rebase).not.toHaveBeenCalled();
    expect(container.querySelector("textarea")).toBeNull();
  });

  it("holds the editor until the session is known, then replays the journal", async () => {
    // The session cache expires, so a page opened later can mount before its
    // session read returns. The editor must not show the saved body over a
    // journal it has not replayed.
    state.session = null;
    state.entries = [entry("first", "Local")];
    state.rebase.mockResolvedValue({
      status: "saved",
      document: { ...page, content: "Local" },
    });
    await act(async () => render());
    expect(container.querySelector("textarea")).toBeNull();
    expect(state.read).not.toHaveBeenCalled();

    state.session = { email: "writer@example.test", orgId: "org" };
    await act(async () => render());
    expect(state.rebase).toHaveBeenCalledTimes(1);
    expect(state.entries).toEqual([]);
    expect(container.querySelector("textarea")).not.toBeNull();
  });

  it("checks a confirmed save receipt before replaying a pending attempt", async () => {
    state.entries = [
      {
        ...entry("first", "Local"),
        snapshot: {
          ...entry("first", "Local").snapshot,
          saveAttemptId: "attempt-1",
        },
      },
    ];
    state.receipt.mockResolvedValue({ found: true });
    await act(async () => render());
    expect(state.receipt).toHaveBeenCalledWith(
      "get-document-save-attempt",
      { id: "page", browserSaveAttemptId: "attempt-1" },
      { method: "GET" },
    );
    expect(state.rebase).not.toHaveBeenCalled();
    expect(state.entries).toEqual([]);
  });

  it("toasts once for a preservation receipt without replaying it or leaving a banner", async () => {
    state.entries = [
      {
        ...entry("first", "Local"),
        snapshot: {
          ...entry("first", "Local").snapshot,
          saveAttemptId: "attempt-preserved",
        },
      },
    ];
    state.receipt.mockResolvedValue({
      found: true,
      preservationRequired: {
        reason: "structure",
        checkpointId: "checkpoint-1",
      },
    });
    await act(async () => render());
    expect(state.rebase).not.toHaveBeenCalled();
    expect(state.entries).toEqual([]);
    expect(toast.success).toHaveBeenCalledOnce();
    expect(toast.success).toHaveBeenCalledWith(
      "editor.previewDraftSavedToHistory",
    );
    expect(container.querySelector('[role="status"]')).toBeNull();
  });

  it("keeps an ambiguous edit locally after preserving it in History", async () => {
    state.entries = [entry("first", "Local", "unknown")];
    state.rebase.mockResolvedValue({ status: "conflict" });
    await act(async () => render());
    expect(state.resolve).toHaveBeenCalledWith(
      expect.objectContaining({ choice: "use_saved", documentId: "page" }),
    );
    expect(state.cleared).toHaveBeenCalledWith("first");
    expect(state.entries).toEqual([]);
    expect(toast.success).toHaveBeenCalledOnce();
    expect(container.querySelector("textarea")).not.toBeNull();
    expect(container.querySelector('[role="status"]')).toBeNull();
  });

  function retainJournalDraft() {
    const journal = entry("closed-writer", "Unsent journal body", "unknown");
    state.entries = [journal];
    state.rebase.mockResolvedValue({ status: "conflict" });
    state.upsert.mockImplementation(async ({ draft }) => {
      state.draft = {
        id: "promoted-draft",
        ...draft,
        editorSessionId: draft.editorSessionId ?? null,
        editGeneration: draft.editGeneration ?? null,
        version: 1,
      };
      return { status: "saved", draft: state.draft };
    });
    return journal;
  }

  function held<T>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>((finish) => {
      resolve = finish;
    });
    return { promise, resolve };
  }

  it.each(["account", "org", "page", "unmount"] as const)(
    "ends a held journal workflow when its %s lifetime ends",
    async (change) => {
      const journal = retainJournalDraft();
      const first = held<unknown>();
      state.resolve.mockReturnValueOnce(first.promise);
      await act(async () => render());
      expect(state.resolve).toHaveBeenCalledTimes(1);
      const originalDraft = state.draft;
      state.draft = null;
      if (change === "account")
        state.session = { email: "other@example.test", orgId: "org" };
      if (change === "org")
        state.session = { email: "writer@example.test", orgId: "other-org" };
      if (change === "unmount")
        await act(async () => {
          root.unmount();
          root = createRoot(container);
        });
      else
        await act(async () =>
          render(change === "page" ? { ...page, id: "other-page" } : page),
        );
      await act(async () =>
        first.resolve({
          status: "document_conflict",
          document: { ...page, title: "Old scope peer", updatedAt: "v3" },
        }),
      );
      expect(state.resolve).toHaveBeenCalledTimes(1);
      expect(state.entries).toEqual([journal]);
      expect(originalDraft).toMatchObject({
        content: journal.snapshot.content,
      });
      expect(state.cleared).not.toHaveBeenCalled();
      expect(toast.success).not.toHaveBeenCalled();
    },
  );

  // The journal's own choice is answered while the page's owner is not
  // known: what the answer would do waits for the owner.
  async function answerWhileUnknown(unknown: "account" | "creation time") {
    const journal = retainJournalDraft();
    const first = held<unknown>();
    state.resolve.mockReturnValueOnce(first.promise);
    await act(async () => render());
    expect(state.resolve).toHaveBeenCalledTimes(1);
    const session = state.session;
    if (unknown === "account") state.session = null;
    await act(async () =>
      render(
        unknown === "account"
          ? page
          : ({ ...page, createdAt: undefined } as unknown as Document),
      ),
    );
    await act(async () => first.resolve({ status: "resolved" }));
    expect(state.resolve).toHaveBeenCalledTimes(1);
    expect(state.entries).toEqual([journal]);
    expect(state.cleared).not.toHaveBeenCalled();
    expect(toast.success).not.toHaveBeenCalled();
    expect(toast.error).not.toHaveBeenCalled();
    return { journal, session: session! };
  }

  it.each(["account", "creation time"] as const)(
    "finishes a choice answered while the page's %s was unknown once, for the same owner",
    async (unknown) => {
      const { session } = await answerWhileUnknown(unknown);

      state.session = session;
      await act(async () => render());

      expect(state.resolve).toHaveBeenCalledTimes(1);
      expect(state.entries).toEqual([]);
      expect(toast.success).toHaveBeenCalledOnce();
      await act(async () => render());
      expect(state.resolve).toHaveBeenCalledTimes(1);
      expect(toast.success).toHaveBeenCalledOnce();
    },
  );

  it.each(["another account", "unmount", "account A to B to A"] as const)(
    "drops a choice answered while the account was unknown once %s",
    async (change) => {
      const { journal } = await answerWhileUnknown("account");
      // A page back in its own scope recovers the journal itself; that new
      // choice is held so only the old answer could settle anything.
      state.resolve.mockReturnValueOnce(new Promise(() => {}));

      if (change === "unmount")
        await act(async () => {
          root.unmount();
          root = createRoot(container);
        });
      else {
        state.session = { email: "other@example.test", orgId: "org" };
        state.draft = null;
        await act(async () => render());
      }
      if (change === "account A to B to A") {
        state.session = { email: "writer@example.test", orgId: "org" };
        await act(async () => render());
      }

      expect(state.resolve).toHaveBeenCalledTimes(
        change === "account A to B to A" ? 2 : 1,
      );
      expect(state.entries).toEqual([journal]);
      expect(state.cleared).not.toHaveBeenCalled();
      expect(toast.success).not.toHaveBeenCalled();
      expect(toast.error).not.toHaveBeenCalled();
    },
  );

  // The account comes back, then a render queued right behind that ends the
  // owner, outside any act scope so it commits in its own turn.
  async function returnThenEnd(session: { email: string; orgId: string }) {
    let journalAtEnd: unknown[] | null = null;
    act(() => {
      state.session = session;
      render();
    });
    queueMicrotask(() => {
      journalAtEnd = [...state.entries];
      state.session = { email: "other@example.test", orgId: "org" };
      state.draft = null;
      act(() => render());
    });
    await new Promise((resume) => setTimeout(resume, 20));
    await act(async () => {});
    return journalAtEnd;
  }

  it("clears the journal as a save receipt answered while the account was unknown is admitted, before a render queued behind it ends the owner", async () => {
    const session = state.session!;
    const sent = entry("first", "Local");
    state.entries = [
      { ...sent, snapshot: { ...sent.snapshot, saveAttemptId: "a-1" } },
    ];
    const receipt = held<unknown>();
    state.receipt.mockReturnValueOnce(receipt.promise);
    await act(async () => render());
    expect(state.receipt).toHaveBeenCalledOnce();
    state.session = null;
    await act(async () => render());
    await act(async () => receipt.resolve({ found: true }));
    expect(state.entries).toHaveLength(1);

    expect(await returnThenEnd(session)).toEqual([]);
    expect(state.entries).toEqual([]);
    expect(state.cleared).toHaveBeenCalledOnce();
  });

  // The choice's own answer is admitted a turn after its request's, so that
  // render ends the owner first.
  it("changes nothing for a choice whose owner ended between its request's answer and its own", async () => {
    const session = state.session!;
    const { journal } = await answerWhileUnknown("account");
    // Only the old answer could settle anything.
    state.resolve.mockReturnValueOnce(new Promise(() => {}));

    expect(await returnThenEnd(session)).toEqual([journal]);
    expect(state.entries).toEqual([journal]);
    expect(state.cleared).not.toHaveBeenCalled();
    expect(toast.success).not.toHaveBeenCalled();
    expect(toast.error).not.toHaveBeenCalled();
  });

  it.each(["journal", "reviewed"] as const)(
    "keeps the current scope comparison after an old %s response arrives",
    async (flow) => {
      if (flow === "journal") retainJournalDraft();
      else
        state.draft = {
          id: "selected-draft",
          version: 1,
          title: "Saved",
          baseTitle: "Saved",
          content: "Unsent",
          baseDocumentUpdatedAt: "old",
          editorSessionId: "first",
          editGeneration: 5,
        };
      const first = held<unknown>();
      const newPage = {
        ...page,
        title: "New scope page",
        content: "New scope canonical",
        updatedAt: "new-scope",
      };
      if (flow === "reviewed") {
        state.resolve.mockResolvedValueOnce({
          status: "recovery_required",
          reason: "prior_choice",
          document: page,
        });
        await act(async () => render());
        state.resolve.mockReturnValueOnce(first.promise);
        const button = Array.from(container.querySelectorAll("button")).find(
          (b) => b.textContent === "editor.previewDraftUseSaved",
        );
        expect(button).toBeDefined();
        await act(async () => button!.click());
      } else {
        state.resolve.mockReturnValueOnce(first.promise);
        await act(async () => render());
      }
      state.resolve.mockResolvedValue({
        status: "recovery_required",
        reason: "prior_choice",
        document: newPage,
      });
      state.session = { email: "writer@example.test", orgId: "other-org" };
      state.draft = {
        id: "selected-draft",
        version: 1,
        title: "Other draft",
        baseTitle: "Saved",
        content: "Other body",
        baseDocumentUpdatedAt: "old",
        editorSessionId: "other-writer",
        editGeneration: 1,
      };
      await act(async () => render());
      expect(
        container.querySelector("[data-recovery-comparison]"),
      ).not.toBeNull();
      expect(container.textContent).toContain(newPage.content);
      await act(async () =>
        first.resolve({
          status: "recovery_required",
          reason: "prior_choice",
          document: { ...page, title: "Old scope page" },
        }),
      );
      expect(
        container.querySelector("[data-recovery-comparison]"),
      ).not.toBeNull();
      expect(container.textContent).toContain(newPage.content);
      expect(toast.success).not.toHaveBeenCalled();
      expect(state.cleared).not.toHaveBeenCalled();
    },
  );

  it("does not assign or resolve an old retained journal after an upsert crosses a scope boundary", async () => {
    const journal = retainJournalDraft();
    const retained = held<unknown>();
    state.upsert.mockReturnValueOnce(retained.promise);
    await act(async () => render());
    expect(state.upsert).toHaveBeenCalledTimes(1);
    state.session = { email: "other@example.test", orgId: "org" };
    await act(async () => render());
    await act(async () =>
      retained.resolve({
        status: "saved",
        draft: {
          ...journal.snapshot,
          id: "promoted-draft",
          editorSessionId: journal.scope.writerId,
          version: 1,
        },
      }),
    );
    expect(state.resolve).not.toHaveBeenCalled();
    expect(state.entries).toEqual([journal]);
    expect(container.querySelector("textarea")).not.toBeNull();
    expect(toast.success).not.toHaveBeenCalled();
  });

  it("does not retry a selected SQL draft after a newer same-text incarnation becomes visible", async () => {
    const journal = retainJournalDraft();
    const first = held<unknown>();
    state.resolve.mockReturnValueOnce(first.promise);
    await act(async () => render());
    state.draft = {
      ...state.draft,
      id: "new-incarnation",
      editGeneration: 7,
      version: 1,
    };
    const newer = state.draft;
    await act(async () => render());
    await act(async () =>
      first.resolve({
        status: "document_conflict",
        document: { ...page, updatedAt: "v3" },
      }),
    );
    expect(state.resolve).toHaveBeenCalledTimes(1);
    expect(state.draft).toEqual(newer);
    expect(state.entries).toEqual([journal]);
    expect(state.cleared).not.toHaveBeenCalled();
  });

  it("does not revive an old attempt after account A to B to A", async () => {
    const journal = retainJournalDraft();
    const first = held<unknown>();
    state.resolve.mockReturnValueOnce(first.promise);
    await act(async () => render());
    state.session = { email: "other@example.test", orgId: "org" };
    state.draft = null;
    await act(async () => render());
    state.session = { email: "writer@example.test", orgId: "org" };
    const current = held<unknown>();
    state.resolve.mockReturnValueOnce(current.promise);
    await act(async () => render());
    const calls = state.resolve.mock.calls.length;
    await act(async () => first.resolve({ status: "resolved" }));
    expect(state.resolve).toHaveBeenCalledTimes(calls);
    expect(state.entries).toEqual([journal]);
    expect(state.cleared).not.toHaveBeenCalled();
    expect(toast.success).not.toHaveBeenCalled();
    await act(async () =>
      current.resolve({
        status: "recovery_required",
        reason: "prior_choice",
        document: page,
      }),
    );
    expect(
      container.querySelector("[data-recovery-comparison]"),
    ).not.toBeNull();
  });

  it("keeps one automatic workflow while the peer page renders again and after its retry resolves", async () => {
    retainJournalDraft();
    const first = held<unknown>();
    state.resolve.mockReturnValueOnce(first.promise);
    await act(async () => render());
    await act(async () => render({ ...page, updatedAt: "peer-render" }));
    expect(state.resolve).toHaveBeenCalledTimes(1);
    state.resolve.mockResolvedValueOnce({ status: "resolved" });
    await act(async () =>
      first.resolve({
        status: "document_conflict",
        document: { ...page, updatedAt: "peer-render" },
      }),
    );
    expect(state.resolve).toHaveBeenCalledTimes(2);
    await act(async () =>
      render({ ...page, updatedAt: "peer-after-resolution" }),
    );
    expect(state.resolve).toHaveBeenCalledTimes(2);
    expect(toast.success).toHaveBeenCalledOnce();
    expect(state.entries).toEqual([]);
  });

  describe("when recovery for another draft still holds the page", () => {
    const newerDraft = {
      id: "newer-draft",
      version: 1,
      title: "Saved",
      baseTitle: "Saved",
      content: "Newer body",
      baseDocumentUpdatedAt: "v1",
      editorSessionId: "newer-writer",
      editGeneration: 3,
    };
    const legacyDraft = {
      ...newerDraft,
      id: "legacy-draft",
      content: "Legacy body",
      editorSessionId: null,
      editGeneration: null,
    };
    const arrivals = ["draft", "legacy draft", "journal entry"] as const;
    type Arrival = (typeof arrivals)[number];
    const arrivalContent = {
      draft: newerDraft.content,
      "legacy draft": legacyDraft.content,
      "journal entry": "Second journal body",
    };
    const choicesFor = (arrival: Arrival) =>
      state.resolve.mock.calls.filter(
        ([request]) => request.expectedDraftContent === arrivalContent[arrival],
      );
    function arrive(arrival: Arrival) {
      if (arrival === "journal entry")
        state.entries.push(
          entry("second-writer", arrivalContent[arrival], "unknown"),
        );
      else state.draft = arrival === "draft" ? newerDraft : legacyDraft;
    }
    // A settled draft leaves the page, as it does on the server.
    function settleDrafts() {
      state.resolve.mockImplementation(
        async (request: { expectedDraftContent: string }) => {
          if (
            (state.draft as { content?: string } | null)?.content ===
            request.expectedDraftContent
          )
            state.draft = null;
          return { status: "resolved" };
        },
      );
    }
    // The journal's recovery reads the page again after History keeps its
    // draft, and the arrival lands while those reads are held. A journal
    // entry is already queued behind it; a draft arrives meanwhile.
    async function holdJournalRereads(arrival: Arrival) {
      retainJournalDraft();
      if (arrival === "journal entry") arrive(arrival);
      settleDrafts();
      const reread = held<void>();
      let holding = true;
      state.refetch.mockImplementation(async () => {
        if (holding) await reread.promise;
        return { data: { draft: state.draft } };
      });
      await act(async () => render());
      expect(state.resolve).toHaveBeenCalledTimes(1);
      if (arrival !== "journal entry") {
        arrive(arrival);
        await act(async () => render());
      }
      return () =>
        act(async () => {
          holding = false;
          reread.resolve();
        });
    }

    it.each(arrivals)(
      "recovers a %s once that recovery lets go of the page",
      async (arrival) => {
        const release = await holdJournalRereads(arrival);
        expect(choicesFor(arrival)).toHaveLength(0);

        await release();

        expect(choicesFor(arrival)).toHaveLength(1);
        expect(choicesFor(arrival)[0][0]).toMatchObject({
          choice: "use_saved",
          trigger: "automatic",
        });
        expect(state.entries).toEqual([]);
        expect(container.querySelector("textarea")).not.toBeNull();
        expect(
          container.querySelector('[data-testid="editor-skeleton"]'),
        ).toBeNull();
        await act(async () => render());
        expect(choicesFor(arrival)).toHaveLength(1);
      },
    );

    it.each(["keep_mine", "use_saved", "save_separately"] as const)(
      "offers no choice while that recovery holds the page, then makes one %s click count",
      async (choice) => {
        const release = await holdJournalRereads("journal entry");
        // The queued entry waits behind a draft another writer saved
        // meanwhile, so that draft needs a reviewed choice.
        arrive("draft");
        await act(async () => render());

        expect(
          container.querySelector("[data-recovery-comparison]"),
        ).toBeNull();
        expect(
          container.querySelector('[data-testid="editor-skeleton"]'),
        ).not.toBeNull();

        await release();

        expect(container.textContent).toContain("editor.previewDraftConflict");
        expect(choicesFor("draft")).toHaveLength(0);
        const control = (label: string) =>
          [...container.querySelectorAll("button")].find(
            (button) => button.textContent === label,
          )!;
        if (choice === "save_separately") {
          const more = control("editor.previewDraftMoreOptions");
          expect(more.disabled).toBe(false);
          await act(async () => {
            more.dispatchEvent(
              new PointerEvent("pointerdown", { bubbles: true, button: 0 }),
            );
          });
          const item = [...document.querySelectorAll('[role="menuitem"]')].find(
            (menuItem) =>
              menuItem.textContent === "editor.previewDraftSaveSeparately",
          ) as HTMLElement;
          await act(async () => item.click());
        } else {
          const button = control(
            choice === "keep_mine"
              ? "editor.previewDraftKeepMine"
              : "editor.previewDraftUseSaved",
          );
          expect(button.disabled).toBe(false);
          await act(async () => button.click());
        }

        expect(choicesFor("draft")).toHaveLength(1);
        expect(choicesFor("draft")[0][0]).toEqual({
          choice,
          trigger: "reviewed",
          documentId: "page",
          expectedDraftId: newerDraft.id,
          expectedDraftEditorSessionId: newerDraft.editorSessionId,
          expectedDraftEditGeneration: newerDraft.editGeneration,
          expectedDraftVersion: newerDraft.version,
          expectedDraftTitle: newerDraft.title,
          expectedDraftContent: newerDraft.content,
          expectedDraftBaseTitle: newerDraft.baseTitle,
          expectedDocumentTitle: page.title,
          expectedDocumentUpdatedAt: page.updatedAt,
        });
        await act(async () => render());
        expect(choicesFor("draft")).toHaveLength(1);
      },
    );

    it.each(arrivals)("recovers a lone %s once", async (arrival) => {
      retainJournalDraft();
      state.entries = [];
      settleDrafts();
      arrive(arrival);

      await act(async () => render());

      expect(choicesFor(arrival)).toHaveLength(1);
      expect(state.entries).toEqual([]);
      expect(container.querySelector("textarea")).not.toBeNull();
    });

    it("keeps that recovery while the account is briefly unknown", async () => {
      const release = await holdJournalRereads("draft");
      const counts = () => ({
        upserts: state.upsert.mock.calls.length,
        resolves: state.resolve.mock.calls.length,
      });
      const held = counts();
      const session = state.session;
      state.session = null;
      await act(async () => render());
      state.session = session;
      await act(async () => render());
      expect(counts()).toEqual(held);

      await release();

      expect(choicesFor("draft")).toHaveLength(1);
      expect(choicesFor("draft")[0][0]).toMatchObject({
        choice: "use_saved",
        trigger: "automatic",
      });
      expect(state.entries).toEqual([]);
      expect(container.querySelector("textarea")).not.toBeNull();
    });

    it.each([
      "unmount",
      "account A to B to A",
      "a same-id replacement",
    ] as const)(
      "starts nothing more when an ended recovery lets go after %s",
      async (change) => {
        const release = await holdJournalRereads("draft");
        if (change === "unmount")
          await act(async () => {
            root.unmount();
            root = createRoot(container);
          });
        else if (change === "a same-id replacement") {
          // The replacement reads the page for itself.
          state.refetch.mockImplementation(async () => ({
            data: { draft: state.draft },
          }));
          await act(async () =>
            render({ ...page, createdAt: "replacement" } as Document),
          );
        } else {
          state.session = { email: "other@example.test", orgId: "org" };
          state.draft = null;
          await act(async () => render());
          state.session = { email: "writer@example.test", orgId: "org" };
          state.draft = newerDraft;
          await act(async () => render());
        }
        // Back in its own scope, the page recovers the draft itself.
        const recovered = change === "unmount" ? 0 : 1;
        expect(choicesFor("draft")).toHaveLength(recovered);
        const settled = {
          html: container.innerHTML,
          resolves: state.resolve.mock.calls.length,
          successes: vi.mocked(toast.success).mock.calls.length,
          errors: vi.mocked(toast.error).mock.calls.length,
        };

        await release();

        expect(choicesFor("draft")).toHaveLength(recovered);
        expect({
          html: container.innerHTML,
          resolves: state.resolve.mock.calls.length,
          successes: vi.mocked(toast.success).mock.calls.length,
          errors: vi.mocked(toast.error).mock.calls.length,
        }).toEqual(settled);
        if (change !== "unmount")
          expect(container.querySelector("textarea")).not.toBeNull();
      },
    );
  });

  describe("when a page with the same id replaces this one", () => {
    const original = { ...page, createdAt: "incarnation-a" } as Document;
    const replacement = { ...original, createdAt: "incarnation-b" } as Document;
    const replacementDraft = {
      id: "replacement-draft",
      version: 1,
      title: "Saved",
      baseTitle: "Saved",
      content: "Replacement body",
      baseDocumentUpdatedAt: "v1",
      editorSessionId: "replacement-writer",
      editGeneration: 2,
    };

    it.each(["upsert", "resolve"] as const)(
      "ends the replaced page's held journal %s without acting on its replacement",
      async (step) => {
        const journal = retainJournalDraft();
        const first = held<unknown>();
        if (step === "upsert") state.upsert.mockReturnValueOnce(first.promise);
        else state.resolve.mockReturnValueOnce(first.promise);
        await act(async () => render(original));
        expect(state[step]).toHaveBeenCalledTimes(1);
        // The journal names the page id alone, so the replacement replays it
        // on its own; that replay waits here.
        state.upsert.mockReturnValue(new Promise(() => {}));
        state.draft = null;
        await act(async () => render(replacement));
        const reads = state.refetch.mock.calls.length;
        const resolves = state.resolve.mock.calls.length;

        await act(async () =>
          first.resolve(
            step === "upsert"
              ? {
                  status: "saved",
                  draft: {
                    ...journal.snapshot,
                    id: "promoted-draft",
                    editorSessionId: journal.scope.writerId,
                    version: 1,
                  },
                }
              : { status: "resolved" },
          ),
        );

        expect(state.resolve).toHaveBeenCalledTimes(resolves);
        expect(state.refetch).toHaveBeenCalledTimes(reads);
        expect(state.entries).toEqual([journal]);
        expect(state.cleared).not.toHaveBeenCalled();
        expect(toast.success).not.toHaveBeenCalled();
      },
    );

    it("reads the replacement's draft itself before recovering it", async () => {
      await act(async () => render(original));
      expect(state.verify).toHaveBeenCalledTimes(1);
      expect(container.querySelector("textarea")).not.toBeNull();
      const reread = held<void>();
      state.refetch.mockImplementation(async () => {
        await reread.promise;
        return { data: { draft: state.draft } };
      });
      state.draft = replacementDraft;

      await act(async () => render(replacement));

      // A read this page open made, or one adopted for it, came from the
      // page it opened.
      expect(state.resolve).not.toHaveBeenCalled();
      expect(
        container.querySelector('[data-testid="editor-skeleton"]'),
      ).not.toBeNull();
      await act(async () => reread.resolve());
      expect(state.resolve).toHaveBeenCalledTimes(1);
      expect(state.resolve).toHaveBeenCalledWith(
        expect.objectContaining({ expectedDraftId: replacementDraft.id }),
      );
    });

    it("does not revive the replaced page's attempt when its row renders again", async () => {
      const journal = retainJournalDraft();
      const first = held<unknown>();
      state.resolve.mockReturnValueOnce(first.promise);
      await act(async () => render(original));
      expect(state.resolve).toHaveBeenCalledTimes(1);
      state.upsert.mockReturnValue(new Promise(() => {}));
      state.draft = null;
      await act(async () => render(replacement));
      await act(async () => render(original));
      const resolves = state.resolve.mock.calls.length;

      await act(async () => first.resolve({ status: "resolved" }));

      expect(state.resolve).toHaveBeenCalledTimes(resolves);
      expect(state.entries).toEqual([journal]);
      expect(state.cleared).not.toHaveBeenCalled();
      expect(toast.success).not.toHaveBeenCalled();
    });

    it("recovers a same-id replacement of a page this tab created", async () => {
      const created = markDocumentCreationConfirmed(
        queryClient as never,
        {
          ...original,
          id: "created-page",
          createdAt: "created-here",
        } as Document,
      );
      try {
        state.draft = replacementDraft;
        await act(async () => render(created));
        // The creating editor lets go of creation; the page stays its own.
        clearDocumentCreationConfirmed(queryClient as never, created);
        await act(async () => render(created));
        expect(state.verify).not.toHaveBeenCalled();
        expect(state.resolve).not.toHaveBeenCalled();
        expect(container.querySelector("textarea")).not.toBeNull();

        await act(async () =>
          render({ ...created, createdAt: "created-elsewhere" }),
        );

        expect(state.resolve).toHaveBeenCalledTimes(1);
        expect(state.resolve).toHaveBeenCalledWith(
          expect.objectContaining({
            documentId: "created-page",
            expectedDraftId: replacementDraft.id,
          }),
        );
      } finally {
        clearDocumentCreationConfirmed(queryClient as never, created);
      }
    });

    it.each(["draft", "journal entry"] as const)(
      "recovers a same-id replacement's %s while the created page's confirmation is still recorded",
      async (retained) => {
        const created = markDocumentCreationConfirmed(
          queryClient as never,
          {
            ...original,
            id: "created-page",
            createdAt: "created-here",
          } as Document,
        );
        try {
          if (retained === "draft") state.draft = replacementDraft;
          else retainJournalDraft().scope.documentId = "created-page";
          await act(async () => render(created));
          expect(state.verify).not.toHaveBeenCalled();
          expect(state.refetch).not.toHaveBeenCalled();
          expect(state.upsert).not.toHaveBeenCalled();
          expect(state.resolve).not.toHaveBeenCalled();
          expect(container.querySelector("textarea")).not.toBeNull();

          const replacing = { ...created, createdAt: "created-elsewhere" };
          await act(async () => render(replacing));

          // The replacement reads its own draft rather than the open's read.
          expect(state.refetch).toHaveBeenCalled();
          expect(state.resolve).toHaveBeenCalledTimes(1);
          expect(state.resolve).toHaveBeenCalledWith(
            expect.objectContaining({
              documentId: "created-page",
              expectedDraftId:
                retained === "draft" ? replacementDraft.id : "promoted-draft",
            }),
          );
          if (retained === "journal entry")
            expect(state.cleared).toHaveBeenCalledWith("closed-writer");

          // The confirmation was never the replacement's to hold.
          clearDocumentCreationConfirmed(queryClient as never, created);
          state.draft = {
            ...replacementDraft,
            id: "later-draft",
            content: "Later replacement body",
          };
          await act(async () => render(replacing));

          expect(state.resolve).toHaveBeenCalledTimes(2);
          expect(state.resolve).toHaveBeenLastCalledWith(
            expect.objectContaining({
              documentId: "created-page",
              expectedDraftId: "later-draft",
            }),
          );
        } finally {
          clearDocumentCreationConfirmed(queryClient as never, created);
        }
      },
    );

    it("keeps skipping recovery across the created page's confirmed timestamp", async () => {
      const optimistic = markDocumentCreationPending(
        queryClient as never,
        {
          ...original,
          id: "created-page",
          createdAt: "client-clock",
        } as Document,
      );
      try {
        state.draft = replacementDraft;
        await act(async () => render(optimistic));
        const confirmed = markDocumentCreationConfirmed(queryClient as never, {
          ...optimistic,
          createdAt: "server-clock",
        });
        await act(async () => render(confirmed));
        clearDocumentCreationConfirmed(queryClient as never, confirmed);
        await act(async () => render(confirmed));

        expect(state.verify).not.toHaveBeenCalled();
        expect(state.resolve).not.toHaveBeenCalled();
        expect(container.querySelector("textarea")).not.toBeNull();
      } finally {
        clearDocumentCreationPending(queryClient as never, optimistic);
        clearDocumentCreationConfirmed(queryClient as never, optimistic);
      }
    });
  });

  it("converges journal History preservation after a peer changes the page during promotion", async () => {
    retainJournalDraft();
    const peer = {
      ...page,
      title: "Peer title",
      content: "Peer body",
      updatedAt: "v3",
    };
    state.resolve
      .mockResolvedValueOnce({ status: "document_conflict", document: peer })
      .mockImplementationOnce(async () => {
        state.draft = null;
        return { status: "resolved", choice: "use_saved" };
      });

    await act(async () => render());

    expect(state.resolve).toHaveBeenCalledTimes(2);
    expect(state.resolve).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        choice: "use_saved",
        trigger: "automatic",
        expectedDraftContent: "Unsent journal body",
        expectedDraftBaseTitle: "Saved",
        expectedDocumentTitle: "Peer title",
        expectedDocumentUpdatedAt: "v3",
      }),
    );
    expect(state.refetch).toHaveBeenCalled();
    expect(state.entries).toEqual([]);
    expect(state.update).not.toHaveBeenCalled();
    expect(toast.success).toHaveBeenCalledExactlyOnceWith(
      "editor.previewDraftSavedToHistory",
    );
    expect(container.querySelector("textarea")).not.toBeNull();
  });

  it("bounds journal History retries and shows the newest peer version with the journal intact", async () => {
    const journal = retainJournalDraft();
    state.resolve
      .mockResolvedValueOnce({
        status: "document_conflict",
        document: { ...page, title: "Peer one", updatedAt: "v3" },
      })
      .mockResolvedValue({
        status: "document_conflict",
        document: {
          ...page,
          title: "Peer two",
          content: "Latest peer body",
          updatedAt: "v4",
        },
      });

    await act(async () => render());
    await act(async () => render({ ...page, updatedAt: "v5" }));

    expect(state.resolve).toHaveBeenCalledTimes(2);
    expect(state.entries).toEqual([journal]);
    expect(state.draft).toMatchObject({ content: journal.snapshot.content });
    expect(
      container.querySelector("[data-recovery-comparison]"),
    ).not.toBeNull();
    expect(container.textContent).toContain("Peer two");
    expect(container.textContent).toContain("Latest peer body");
    expect(container.textContent).not.toContain("empty.genericError");
    expect(toast.success).not.toHaveBeenCalled();
    expect(state.update).not.toHaveBeenCalled();
  });

  it.each(["prior_choice", "draft_changed"])(
    "keeps the journal on %s and uses the current displayed base only after a reviewed choice",
    async (reason) => {
      const journal = retainJournalDraft();
      const peer = {
        ...page,
        title: "Current peer title",
        content: "Current peer body",
        updatedAt: "v3",
      };
      state.resolve.mockResolvedValueOnce({
        status: "recovery_required",
        reason,
        document: peer,
      });

      await act(async () => render());

      expect(state.resolve).toHaveBeenCalledTimes(1);
      expect(state.entries).toEqual([journal]);
      expect(
        container.querySelector("[data-recovery-comparison]"),
      ).not.toBeNull();
      expect(container.textContent).toContain("Current peer title");
      expect(container.textContent).toContain("Current peer body");
      expect(state.cleared).not.toHaveBeenCalled();
      state.resolve.mockImplementationOnce(async () => {
        state.draft = null;
        return { status: "resolved", choice: "use_saved" };
      });
      const useSaved = Array.from(container.querySelectorAll("button")).find(
        (button) => button.textContent === "editor.previewDraftUseSaved",
      );
      expect(useSaved).toBeDefined();
      await act(async () => useSaved!.click());

      expect(state.resolve).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({
          choice: "use_saved",
          trigger: "reviewed",
          expectedDocumentTitle: peer.title,
          expectedDocumentUpdatedAt: peer.updatedAt,
        }),
      );
      expect(state.entries).toEqual([]);
      expect(state.update).not.toHaveBeenCalled();
      expect(container.querySelector("textarea")).not.toBeNull();
    },
  );

  it("offers a Retry, not the editor, when no draft holds the page after History preservation is refused", async () => {
    const journal = retainJournalDraft();
    state.resolve.mockImplementationOnce(async () => {
      state.draft = null;
      return {
        status: "recovery_required",
        reason: "prior_choice",
        document: page,
      };
    });

    await act(async () => render());

    expect(state.resolve).toHaveBeenCalledTimes(1);
    expect(container.querySelector("textarea")).toBeNull();
    expect(container.textContent).toContain("empty.genericError");
    expect(container.querySelector("[data-recovery-comparison]")).toBeNull();
    expect(state.entries).toEqual([journal]);
    expect(state.cleared).not.toHaveBeenCalled();
    expect(toast.success).not.toHaveBeenCalled();

    const retry = [...container.querySelectorAll("button")].find(
      (button) => button.textContent === "database.retry",
    )!;
    await act(async () => retry.click());

    expect(state.resolve).toHaveBeenCalledTimes(2);
    expect(state.cleared).toHaveBeenCalledExactlyOnceWith("closed-writer");
    expect(state.entries).toEqual([]);
  });

  it("keeps journal and SQL draft and exposes a Retry for a technical preservation failure", async () => {
    const journal = retainJournalDraft();
    state.resolve.mockRejectedValueOnce(
      new Error("History storage unavailable"),
    );

    await act(async () => render());

    expect(state.entries).toEqual([journal]);
    expect(state.draft).toMatchObject({ content: journal.snapshot.content });
    expect(container.textContent).toContain("empty.genericError");
    expect(container.textContent).toContain("database.retry");
    expect(container.querySelector("[data-recovery-comparison]")).toBeNull();
    expect(state.cleared).not.toHaveBeenCalled();
    expect(toast.success).not.toHaveBeenCalled();
  });

  it("keeps the chooser and the journal when a choice was made for another version of the draft", async () => {
    const journal: (typeof state.entries)[number] = entry(
      "closed-writer",
      "Same body",
    );
    journal.snapshot.baseUpdatedAt = null;
    journal.snapshot.baseContent = "Earlier body";
    state.entries = [journal];
    state.draft = {
      id: "retained-draft",
      version: 2,
      title: "Saved",
      baseTitle: "Saved",
      content: "Same body",
      baseDocumentUpdatedAt: "v1",
      editorSessionId: "closed-writer",
      editGeneration: 1,
    };
    state.resolve.mockRejectedValue(
      Object.assign(
        new Error(
          "This recovery choice was made for another version of the draft.",
        ),
        { errorCode: "PREVIEW_DRAFT_RECOVERY_CONFLICT", statusCode: 409 },
      ),
    );

    await act(async () => render());
    const useSaved = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "editor.previewDraftUseSaved",
    );
    expect(useSaved).toBeDefined();
    await act(async () => useSaved!.click());

    expect(state.resolve).toHaveBeenCalledTimes(2);
    expect(state.resolve).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        choice: "use_saved",
        trigger: "reviewed",
        expectedDraftVersion: 2,
      }),
    );
    expect(
      container.querySelector("[data-recovery-comparison]"),
    ).not.toBeNull();
    expect(container.textContent).toContain("editor.previewDraftConflict");
    expect(
      container.querySelector('[data-testid="editor-skeleton"]'),
    ).toBeNull();
    expect(state.entries).toEqual([journal]);
    expect(state.cleared).not.toHaveBeenCalled();
    expect(toast.success).not.toHaveBeenCalled();
  });

  describe("when a choice for an earlier version is refused", () => {
    const button = (label: string) =>
      Array.from(document.querySelectorAll("button")).find(
        (item) => item.textContent === label,
      );
    async function choose(choice: "use_saved" | "save_separately") {
      if (choice === "use_saved") {
        const useSaved = button("editor.previewDraftUseSaved");
        expect(useSaved).toBeDefined();
        await act(async () => useSaved!.click());
        return;
      }
      const more = button("editor.previewDraftMoreOptions");
      expect(more).toBeDefined();
      await act(async () => {
        more!.dispatchEvent(
          new PointerEvent("pointerdown", { bubbles: true, button: 0 }),
        );
      });
      const saveSeparately = Array.from(
        document.querySelectorAll('[role="menuitem"]'),
      ).find(
        (item) => item.textContent === "editor.previewDraftSaveSeparately",
      );
      expect(saveSeparately).toBeDefined();
      await act(async () => (saveSeparately as HTMLElement).click());
    }
    const refused = () =>
      Object.assign(new Error("The saved draft changed during recovery."), {
        errorCode: "PREVIEW_DRAFT_RECOVERY_CONFLICT",
        statusCode: 409,
      });
    const resolvedAs = (choice: "use_saved" | "save_separately") => ({
      status: "resolved",
      choice,
      ...(choice === "save_separately"
        ? { createdDocumentId: "copy", urlPath: "/page/copy" }
        : {}),
    });
    const exactRequest = (
      choice: "use_saved" | "save_separately",
      draft: Record<string, unknown>,
    ) => ({
      choice,
      trigger: "reviewed",
      documentId: "page",
      expectedDraftId: draft.id,
      expectedDraftEditorSessionId: draft.editorSessionId,
      expectedDraftEditGeneration: draft.editGeneration,
      expectedDraftVersion: draft.version,
      expectedDraftTitle: draft.title,
      expectedDraftContent: draft.content,
      expectedDraftBaseTitle: draft.baseTitle,
      expectedDocumentTitle: page.title,
      expectedDocumentUpdatedAt: page.updatedAt,
    });

    it.each(
      (["use_saved", "save_separately"] as const).flatMap((choice) =>
        (["no", "a newer"] as const).map((journal) => ({ choice, journal })),
      ),
    )(
      "reviews the version it reads again and completes a new $choice click for it with $journal journal",
      async ({ choice, journal }) => {
        const earlier = {
          id: "retained-draft",
          version: 1,
          title: "Saved",
          baseTitle: null,
          content: "Same body",
          baseDocumentUpdatedAt: "v1",
          editorSessionId: "closed-writer",
          editGeneration: 5,
        };
        const retained = { ...earlier, version: 2 };
        const newer: (typeof state.entries)[number] = entry(
          "closed-writer",
          "Newer body",
        );
        newer.snapshot.baseUpdatedAt = null;
        newer.snapshot.baseContent = "Earlier body";
        newer.snapshot.editGeneration = 6;
        if (journal === "a newer") state.entries = [newer];
        // The page read version 1; the server already holds version 2.
        state.cachedRead = { draft: earlier };
        state.draft = retained;
        state.refetch.mockImplementation(async () => {
          state.cachedRead = { draft: state.draft };
          return { data: state.cachedRead };
        });
        state.resolve.mockRejectedValueOnce(refused());

        await act(async () => render());
        expect(container.textContent).toContain(
          "editor.previewDraftTitleUnknown",
        );
        await choose(choice);

        expect(state.resolve).toHaveBeenCalledTimes(1);
        expect(state.resolve).toHaveBeenLastCalledWith(
          exactRequest(choice, earlier),
        );
        expect(state.cachedRead).toEqual({ draft: retained });
        expect(
          container.querySelector("[data-recovery-comparison]"),
        ).not.toBeNull();
        expect(container.textContent).toContain(
          "editor.previewDraftTitleUnknown",
        );
        expect(
          container.querySelector('[data-testid="editor-skeleton"]'),
        ).toBeNull();
        expect(state.entries).toEqual(journal === "a newer" ? [newer] : []);

        state.resolve.mockImplementationOnce(async () => {
          state.draft = null;
          return resolvedAs(choice);
        });
        await choose(choice);

        expect(state.resolve).toHaveBeenNthCalledWith(
          2,
          exactRequest(choice, retained),
        );
        expect(
          container.querySelector("[data-recovery-comparison]"),
        ).toBeNull();
        expect(
          container.querySelector('[data-testid="editor-skeleton"]'),
        ).toBeNull();
        expect(container.querySelector("textarea")).not.toBeNull();
        if (journal === "no") {
          expect(state.resolve).toHaveBeenCalledTimes(2);
          expect(state.cleared).not.toHaveBeenCalled();
          return;
        }
        // Settling version 2 leaves the newer journal, which then goes to
        // History through its own draft.
        expect(state.upsert).toHaveBeenCalledWith(
          expect.objectContaining({
            draft: expect.objectContaining({
              content: "Newer body",
              editGeneration: 6,
            }),
          }),
        );
        expect(state.resolve).toHaveBeenCalledTimes(3);
        expect(state.resolve).toHaveBeenLastCalledWith(
          expect.objectContaining({
            choice: "use_saved",
            trigger: "automatic",
            expectedDraftId: "promoted-draft",
            expectedDraftContent: "Newer body",
          }),
        );
        expect(state.cleared).toHaveBeenCalledTimes(1);
        expect(state.cleared.mock.invocationCallOrder[0]).toBeGreaterThan(
          state.resolve.mock.invocationCallOrder[2],
        );
        expect(state.entries).toEqual([]);
      },
    );

    it.each(["use_saved", "save_separately"] as const)(
      "clears the journal a new %s click settles after its automatic preservation is refused",
      async (choice) => {
        const journal: (typeof state.entries)[number] = entry(
          "closed-writer",
          "Same body",
        );
        journal.snapshot.baseUpdatedAt = null;
        journal.snapshot.baseContent = "Earlier body";
        state.entries = [journal];
        const retained = {
          id: "retained-draft",
          version: 2,
          title: "Saved",
          baseTitle: "Saved",
          content: "Same body",
          baseDocumentUpdatedAt: "v1",
          editorSessionId: "closed-writer",
          editGeneration: 1,
        };
        state.draft = retained;
        state.resolve.mockRejectedValueOnce(refused());

        await act(async () => render());
        expect(state.resolve).toHaveBeenCalledWith(
          expect.objectContaining({
            choice: "use_saved",
            trigger: "automatic",
            expectedDraftVersion: 2,
          }),
        );
        expect(container.textContent).toContain("editor.previewDraftConflict");
        expect(state.entries).toEqual([journal]);

        state.resolve.mockImplementationOnce(async () => {
          state.draft = null;
          return resolvedAs(choice);
        });
        await choose(choice);

        expect(state.resolve).toHaveBeenCalledTimes(2);
        expect(state.resolve).toHaveBeenLastCalledWith(
          exactRequest(choice, retained),
        );
        expect(state.entries).toEqual([]);
        expect(state.cleared).toHaveBeenCalledWith("closed-writer");
        expect(
          container.querySelector("[data-recovery-comparison]"),
        ).toBeNull();
        expect(
          container.querySelector('[data-testid="editor-skeleton"]'),
        ).toBeNull();
        expect(container.querySelector("textarea")).not.toBeNull();
      },
    );
  });

  it.each(["receipt", "rebase"])(
    "keeps a newer journal and continues it after an older %s preservation acknowledgement",
    async (acknowledgement) => {
      const original: (typeof state.entries)[number] = entry(
        "closed-writer",
        "Older body",
      );
      const newer = {
        ...original,
        snapshot: {
          ...original.snapshot,
          content: "Newer body",
          editGeneration: 2,
        },
        writtenAt: 2,
      };
      state.entries = [original];
      let finish!: (result: unknown) => void;
      const pending = new Promise((resolve) => {
        finish = resolve;
      });
      if (acknowledgement === "receipt") {
        original.snapshot = {
          ...original.snapshot,
          saveAttemptId: "old-preserved",
        };
        state.receipt.mockImplementationOnce(async () => {
          state.entries = [newer];
          return {
            found: true,
            preservationRequired: {
              reason: "structure",
              checkpointId: "older-history",
            },
          };
        });
      } else {
        state.rebase.mockImplementationOnce(async () => {
          state.entries = [newer];
          return { status: "preservation", checkpointId: "older-history" };
        });
      }
      state.rebase.mockImplementation(() => pending);

      await act(async () => render());

      expect(container.textContent).not.toContain("empty.genericError");
      expect(state.entries).toEqual([newer]);
      expect(state.cleared).not.toHaveBeenCalled();
      expect(state.rebase).toHaveBeenLastCalledWith(
        expect.objectContaining({ content: "Newer body" }),
      );
      await act(async () =>
        finish({
          status: "saved",
          document: { ...page, content: "Newer body" },
        }),
      );
      expect(state.entries).toEqual([]);
      expect(container.querySelector("textarea")).not.toBeNull();
    },
  );

  it("leaves the mounted editor's journal to its save queue when a save lands", async () => {
    let mounts = 0;
    const onMount = () => {
      mounts += 1;
    };
    const renderLive = (document: Document) =>
      root.render(
        <PageDraftRecovery document={document}>
          <LiveEditor onMount={onMount} />
        </PageDraftRecovery>,
      );
    await act(async () => renderLive(page));
    state.entries = [entry("live-writer", "Saved body\n\nPending")];

    await act(async () =>
      renderLive({ ...page, content: "Saved body\n\nSaved", updatedAt: "v3" }),
    );

    expect(state.rebase).not.toHaveBeenCalled();
    expect(state.update).not.toHaveBeenCalled();
    expect(state.entries).toHaveLength(1);
    expect(mounts).toBe(1);
  });

  it("sweeps legacy History markers and never shows a History banner", async () => {
    let mounts = 0;
    const onMount = () => {
      mounts += 1;
    };

    await act(async () =>
      root.render(
        <PageDraftRecovery document={page}>
          <LiveEditor onMount={onMount} />
        </PageDraftRecovery>,
      ),
    );

    expect(state.sweep).toHaveBeenCalled();
    expect(container.querySelector('[role="status"]')).toBeNull();
    expect(mounts).toBe(1);
  });

  it("keeps the editor mounted over a recovery draft its own session wrote", async () => {
    let mounts = 0;
    const onMount = () => {
      mounts += 1;
    };
    const renderLive = () =>
      root.render(
        <PageDraftRecovery document={page}>
          <LiveEditor onMount={onMount} sessionId="live-session" />
        </PageDraftRecovery>,
      );
    await act(async () => renderLive());
    for (let version = 1; version <= 3; version++) {
      state.draft = {
        id: "selected-draft",
        version,
        title: "Saved",
        content: `Saved body ${version}`,
        baseDocumentUpdatedAt: "v1",
        editorSessionId: "live-session",
        editGeneration: version,
      };
      await act(async () => renderLive());
      expect(
        container.querySelector('[data-testid="editor-skeleton"]'),
      ).toBeNull();
    }

    expect(mounts).toBe(1);
    expect(state.resolve).not.toHaveBeenCalled();
    expect(state.update).not.toHaveBeenCalled();
  });

  it("still recovers a draft another editor session wrote", async () => {
    let mounts = 0;
    const onMount = () => {
      mounts += 1;
    };
    const renderLive = () =>
      root.render(
        <PageDraftRecovery document={page}>
          <LiveEditor onMount={onMount} sessionId="live-session" />
        </PageDraftRecovery>,
      );
    await act(async () => renderLive());
    state.draft = {
      id: "selected-draft",
      version: 1,
      title: "Saved",
      baseTitle: "Saved",
      content: "Other tab body",
      baseDocumentUpdatedAt: "v1",
      editorSessionId: "other-session",
      editGeneration: 4,
    };
    await act(async () => renderLive());

    expect(state.resolve).toHaveBeenCalledWith(
      expect.objectContaining({ choice: "use_saved" }),
    );
  });
});

function LiveEditor({
  onMount,
  sessionId = "live-writer",
}: {
  onMount: () => void;
  sessionId?: string;
}) {
  useRegisterLiveEditorSession(sessionId);
  useEffect(() => {
    onMount();
  }, [onMount]);
  return <textarea defaultValue="Live editor" />;
}
