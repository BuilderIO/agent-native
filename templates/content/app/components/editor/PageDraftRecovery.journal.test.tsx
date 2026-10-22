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
vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ refetchQueries: state.refetch }),
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
    data: { draft: state.draft },
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

import { useRegisterLiveEditorSession } from "./live-editor-session";
import { PageDraftRecovery } from "./PageDraftRecovery";

const page = {
  id: "page",
  title: "Saved",
  content: "Saved body",
  canEdit: true,
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
        title: localRename,
        baseTitle: "Saved",
        content: "Local",
        version: 3,
      },
    });

    await act(async () =>
      render({ ...page, title: "Peer rename" } as Document),
    );

    expect(state.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        expectedVersion: 2,
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
        draft: { ...journal.snapshot, version: 1 },
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
