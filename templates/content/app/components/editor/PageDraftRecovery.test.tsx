// @vitest-environment happy-dom
import type { Document } from "@shared/api";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  draft: null as null | {
    title: string;
    content: string;
    version: number;
    baseDocumentUpdatedAt: string | null;
    loadedContentWasEmpty: number;
    editorSessionId: string | null;
    editGeneration: number | null;
  },
  update: vi.fn(),
  remove: vi.fn(),
  resolve: vi.fn(),
  refetch: vi.fn(),
}));
vi.mock("@agent-native/core/client/hooks", () => ({
  callAction: vi.fn().mockResolvedValue({ draft: null }),
  useSession: () => ({
    session: { email: "writer@example.test", orgId: "org" },
  }),
}));
vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string) => key,
}));
vi.mock("react-router", () => ({ useNavigate: () => vi.fn() }));
vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ refetchQueries: state.refetch }),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/hooks/use-documents", () => ({
  documentQueryFilter: (id: string) => ({ id }),
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
  useResolvePreviewDocumentDraft: () => ({ mutateAsync: state.resolve }),
  useUpdatePreviewDocumentDraft: () => ({ mutateAsync: state.remove }),
}));
vi.mock("./page-draft-journal", () => ({
  readPageDraftJournal: () => null,
  listPageDraftJournal: () => [],
  hasRetainedPageDraftNotice: () => false,
  clearPageDraftJournal: () => true,
  markPageDraftJournalRetained: () => true,
}));
vi.mock("./document-save-rebase", () => ({
  saveDocumentWithRebase: vi.fn(),
}));
vi.mock("./DocumentEditorSkeleton", () => ({
  DocumentEditorSkeleton: () => <div data-testid="editor-skeleton" />,
}));
vi.mock("./RecoveryComparison", () => ({
  RecoveryComparison: ({
    failure,
    onKeepMine,
    onUseSaved,
    onSaveSeparately,
  }: {
    failure: string;
    onKeepMine: () => void;
    onUseSaved: () => void;
    onSaveSeparately: () => void;
  }) => (
    <div data-testid="recovery-comparison">
      <span>{failure}</span>
      <button onClick={onKeepMine}>Keep mine</button>
      <button onClick={onUseSaved}>Use saved</button>
      <button onClick={onSaveSeparately}>Save separately</button>
    </div>
  ),
}));

import { PageDraftRecovery } from "./PageDraftRecovery";

describe("Page draft recovery", () => {
  let root: Root;
  let container: HTMLDivElement;
  const page = {
    id: "page",
    title: "Saved",
    content: "Saved body",
    updatedAt: "v2",
    revision: "saved-body-revision",
  } as Document;
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
    state.draft = null;
    state.refetch.mockResolvedValue(undefined);
    state.update.mockResolvedValue({
      ...page,
      title: "Draft",
      content: "Draft body",
    });
    state.remove.mockResolvedValue({ status: "deleted" });
    state.resolve.mockResolvedValue({ status: "resolved" });
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });
  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it("mounts the editor when no draft remains", async () => {
    await act(async () => render());
    expect(container.querySelector("textarea")).not.toBeNull();
  });

  it("does not keep an already released editor over a newly observed private draft", async () => {
    await act(async () => render());
    expect(container.querySelector("textarea")).not.toBeNull();
    state.draft = {
      title: "Draft",
      content: "Draft body",
      version: 3,
      baseDocumentUpdatedAt: "v1",
      loadedContentWasEmpty: 0,
      editorSessionId: "tab:page",
      editGeneration: 4,
    };
    await act(async () => render());
    expect(container.querySelector("textarea")).toBeNull();
    expect(state.resolve).toHaveBeenCalledWith(
      expect.objectContaining({ choice: "use_saved" }),
    );
  });

  it("restores an identified draft against its matching canonical base", async () => {
    state.draft = {
      title: "Draft",
      content: "Draft body",
      version: 3,
      baseDocumentUpdatedAt: "v2",
      loadedContentWasEmpty: 0,
      editorSessionId: "tab:page",
      editGeneration: 4,
    };
    await act(async () => render());
    expect(state.update).toHaveBeenCalledWith(
      expect.objectContaining({
        baseUpdatedAt: "v2",
        editorSessionId: "tab:page",
        editorEditGeneration: 5,
        baseRevision: "saved-body-revision",
        authoredBaseRevision: "saved-body-revision",
        authoredBaseContent: "Saved body",
        authoredCandidateContent: "Draft body",
        browserSaveAttemptId: expect.any(String),
      }),
    );
    expect(state.resolve).not.toHaveBeenCalled();
  });

  it("keeps an identified draft pending when its write requires preservation", async () => {
    state.draft = {
      title: "Draft",
      content: "Draft body",
      version: 3,
      baseDocumentUpdatedAt: "v2",
      loadedContentWasEmpty: 0,
      editorSessionId: "tab:page",
      editGeneration: 4,
    };
    state.update.mockResolvedValue({
      preservationRequired: true,
      document: page,
      reason: "structure",
      checkpointId: "checkpoint",
    });

    await act(async () => render());

    expect(state.remove).not.toHaveBeenCalled();
    expect(container.querySelector("textarea")).toBeNull();
    expect(
      container.querySelector('[data-testid="recovery-comparison"]'),
    ).not.toBeNull();
  });

  it("does not reopen recovery when Use saved already superseded the draft generation", async () => {
    state.draft = {
      title: "Draft",
      content: "Discarded draft body",
      version: 3,
      baseDocumentUpdatedAt: "v2",
      loadedContentWasEmpty: 0,
      editorSessionId: "tab:page",
      editGeneration: 4,
    };
    state.update.mockResolvedValue({
      superseded: true,
      id: "page",
      document: page,
      editorSessionId: "tab:page",
      editGeneration: 4,
      discardedGeneration: 4,
    });

    await act(async () => render());

    expect(state.update).toHaveBeenCalledTimes(1);
    expect(state.resolve).not.toHaveBeenCalled();
    expect(state.refetch).toHaveBeenCalled();
    expect(
      container.querySelector('[data-testid="recovery-comparison"]'),
    ).toBeNull();
  });

  it("preserves an unrebased newer-base draft in History without showing a conflict", async () => {
    state.draft = {
      title: "Draft",
      content: "Draft body",
      version: 3,
      baseDocumentUpdatedAt: "v1",
      loadedContentWasEmpty: 0,
      editorSessionId: "tab:page",
      editGeneration: 4,
    };
    await act(async () => render());
    expect(state.update).not.toHaveBeenCalled();
    expect(state.resolve).toHaveBeenCalledWith({
      choice: "use_saved",
      documentId: "page",
      expectedDraftVersion: 3,
      expectedDraftTitle: "Draft",
      expectedDraftContent: "Draft body",
      expectedDocumentUpdatedAt: "v2",
    });
    expect(
      container.querySelector('[role="status"]')?.textContent ?? "",
    ).not.toContain("editor.previewDraftConflict");
  });

  it("moves a legacy draft to History without blocking the editor", async () => {
    state.draft = {
      title: "Legacy draft",
      content: "Legacy body",
      version: 7,
      baseDocumentUpdatedAt: "v1",
      loadedContentWasEmpty: 0,
      editorSessionId: null,
      editGeneration: null,
    };
    await act(async () => render());
    expect(state.resolve).toHaveBeenCalledWith({
      choice: "use_saved",
      documentId: "page",
      expectedDraftVersion: 7,
      expectedDraftTitle: "Legacy draft",
      expectedDraftContent: "Legacy body",
      expectedDocumentUpdatedAt: "v2",
    });
    expect(container.querySelector("textarea")).not.toBeNull();
    expect(container.querySelector('[role="status"]')).not.toBeNull();
  });

  it("keeps a failed legacy draft pending", async () => {
    state.draft = {
      title: "Legacy draft",
      content: "Legacy body",
      version: 7,
      baseDocumentUpdatedAt: null,
      loadedContentWasEmpty: 0,
      editorSessionId: null,
      editGeneration: null,
    };
    state.resolve.mockRejectedValueOnce(new Error("offline"));
    await act(async () => render());
    expect(state.remove).not.toHaveBeenCalled();
    expect(container.querySelector("textarea")).toBeNull();
    expect(
      container.querySelector('[data-testid="recovery-comparison"]')
        ?.textContent,
    ).toContain("empty.genericError");
    await act(async () => {
      container.querySelector<HTMLButtonElement>("button")?.click();
    });
    expect(state.resolve).toHaveBeenLastCalledWith(
      expect.objectContaining({ choice: "keep_mine" }),
    );
  });
});
