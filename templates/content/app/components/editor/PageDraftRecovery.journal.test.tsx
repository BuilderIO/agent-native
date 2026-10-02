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
  clearPageDraftJournal: (scope: { writerId: string }) => {
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
  updatedAt: "v2",
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
  const render = () =>
    root.render(
      <PageDraftRecovery document={page}>
        <textarea defaultValue="Live editor" />
      </PageDraftRecovery>,
    );
  beforeEach(() => {
    (
      globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    vi.clearAllMocks();
    state.entries = [];
    state.draft = null;
    state.session = { email: "writer@example.test", orgId: "org" };
    state.read.mockImplementation(
      () => state.entries.find((entry) => !entry.recoveryStatus) ?? null,
    );
    state.receipt.mockResolvedValue({ found: false });
    state.refetch.mockResolvedValue(undefined);
    state.verify.mockResolvedValue(undefined);
    state.rebase.mockResolvedValue({ status: "saved", document: page });
    state.upsert.mockResolvedValue({
      status: "saved",
      draft: { title: "Saved", content: "Local", version: 1 },
    });
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
      version: 1,
      title: "Saved",
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
