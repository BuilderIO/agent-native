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
    baseTitle?: string | null;
    baseDocumentUpdatedAt: string | null;
    baseContentHash?: string | null;
    loadedContentWasEmpty: number;
    editorSessionId: string | null;
    editGeneration: number | null;
  },
  update: vi.fn(),
  remove: vi.fn(),
  resolve: vi.fn(),
  refetch: vi.fn(),
  verify: vi.fn(),
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
  useResolvePreviewDocumentDraft: () => ({ mutateAsync: state.resolve }),
  useUpdatePreviewDocumentDraft: () => ({ mutateAsync: state.remove }),
}));
vi.mock("./page-draft-journal", () => ({
  readPageDraftJournal: () => null,
  listPageDraftJournal: () => [],
  sweepLegacyRetainedPageDraftMarkers: () => undefined,
  clearPageDraftJournal: () => true,
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
    keepMineDisabled,
    onUseSaved,
    onSaveSeparately,
  }: {
    failure: string;
    onKeepMine: () => void;
    keepMineDisabled?: boolean;
    onUseSaved: () => void;
    onSaveSeparately: () => void;
  }) => (
    <div data-testid="recovery-comparison">
      <span>{failure}</span>
      <button disabled={keepMineDisabled} onClick={onKeepMine}>
        Keep mine
      </button>
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
    canEdit: true,
    updatedAt: "v2",
    revision: "saved-body-revision",
    contentHash: "sha256:saved-body",
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
    state.verify.mockResolvedValue(undefined);
    state.update.mockResolvedValue({
      ...page,
      title: "Draft",
      baseTitle: "Saved",
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

  it.each([true, false])(
    "distinguishes automatic recovery from an explicit reviewed override (identified=%s)",
    async (identified) => {
      state.draft = {
        title: "Builder row",
        baseTitle: "Builder row",
        content: "Chosen separate body",
        version: 1,
        baseDocumentUpdatedAt: "v1",
        baseContentHash: page.contentHash,
        loadedContentWasEmpty: 0,
        editorSessionId: identified ? "consent:page" : null,
        editGeneration: identified ? 5 : null,
      };
      state.resolve.mockResolvedValue({
        status: "recovery_required",
        reason: "prior_choice",
        choice: "save_separately",
      });
      await act(async () => render());
      expect(state.resolve).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({ choice: "keep_mine", trigger: "automatic" }),
      );
      expect(state.update).not.toHaveBeenCalled();
      expect(state.remove).not.toHaveBeenCalled();
      expect(
        container.querySelector('[data-testid="recovery-comparison"]'),
      ).not.toBeNull();
      state.resolve.mockResolvedValue({
        status: "resolved",
        choice: "keep_mine",
      });
      await act(async () =>
        container.querySelector<HTMLButtonElement>("button")?.click(),
      );
      expect(state.resolve).toHaveBeenLastCalledWith(
        expect.objectContaining({ choice: "keep_mine", trigger: "reviewed" }),
      );
    },
  );

  it("automatically restores body-only edits while retaining the peer title", async () => {
    state.draft = {
      title: "Before rename",
      baseTitle: "Before rename",
      content: "Draft body",
      version: 3,
      baseDocumentUpdatedAt: "v1",
      baseContentHash: page.contentHash,
      loadedContentWasEmpty: 0,
      editorSessionId: "tab:page",
      editGeneration: 4,
    };
    state.update.mockResolvedValue({ ...page, content: "Draft body" });
    await act(async () => render());
    expect(state.resolve).toHaveBeenCalledWith(
      expect.objectContaining({
        choice: "keep_mine",
        expectedDocumentTitle: "Saved",
        expectedDraftBaseTitle: "Before rename",
        expectedDocumentUpdatedAt: "v2",
        expectedDraftContent: "Draft body",
      }),
    );
    expect(state.update).not.toHaveBeenCalled();
    expect(
      container.querySelector('[data-testid="recovery-comparison"]'),
    ).toBeNull();
  });

  it.each([null, undefined])(
    "keeps unknown legacy title lineage visible (%s)",
    async (baseTitle) => {
      state.draft = {
        title: "Legacy title",
        baseTitle,
        content: "Legacy body",
        version: 1,
        baseDocumentUpdatedAt: "v2",
        baseContentHash: page.contentHash,
        loadedContentWasEmpty: 0,
        editorSessionId: null,
        editGeneration: null,
      };
      await act(async () => render());
      expect(state.resolve).not.toHaveBeenCalled();
      expect(state.update).not.toHaveBeenCalled();
      expect(state.remove).not.toHaveBeenCalled();
      expect(container.textContent).toContain(
        "editor.previewDraftTitleUnknown",
      );
      await act(async () => {
        Array.from(container.querySelectorAll("button"))
          .find((button) => button.textContent === "Save separately")
          ?.click();
      });
      expect(state.resolve).toHaveBeenCalledWith(
        expect.objectContaining({
          choice: "save_separately",
          expectedDraftBaseTitle: null,
        }),
      );
    },
  );

  it("resumes automatic recovery when a known newer generation replaces an unknown draft", async () => {
    state.draft = {
      title: "Legacy",
      baseTitle: null,
      content: "Legacy body",
      version: 1,
      baseDocumentUpdatedAt: "v1",
      loadedContentWasEmpty: 0,
      editorSessionId: "tab:page",
      editGeneration: 4,
    };
    await act(async () => render());
    expect(container.querySelector<HTMLButtonElement>("button")?.disabled).toBe(
      true,
    );
    expect(container.textContent).toContain("editor.previewDraftTitleUnknown");
    state.draft = {
      ...state.draft,
      title: "Before rename",
      baseTitle: "Before rename",
      content: "New body",
      version: 2,
      editGeneration: 5,
      baseContentHash: page.contentHash,
    };
    await act(async () => render());
    expect(state.resolve).toHaveBeenCalledWith(
      expect.objectContaining({
        choice: "keep_mine",
        expectedDraftVersion: 2,
        expectedDraftBaseTitle: "Before rename",
      }),
    );
    expect(container.textContent).not.toContain(
      "editor.previewDraftTitleUnknown",
    );
  });

  it("shows a typed unknown claim refusal without offering a guessed overwrite", async () => {
    state.draft = {
      title: "Draft",
      baseTitle: "Saved",
      content: "Draft body",
      version: 1,
      baseDocumentUpdatedAt: "v2",
      baseContentHash: page.contentHash,
      loadedContentWasEmpty: 0,
      editorSessionId: "tab:page",
      editGeneration: 4,
    };
    state.resolve.mockRejectedValue({
      errorCode: "PREVIEW_DRAFT_TITLE_INTENT_UNKNOWN",
    });
    await act(async () => render());
    expect(container.textContent).toContain("editor.previewDraftTitleUnknown");
    expect(container.querySelector<HTMLButtonElement>("button")?.disabled).toBe(
      true,
    );
    expect(state.remove).not.toHaveBeenCalled();
    expect(state.update).not.toHaveBeenCalled();
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
      baseTitle: "Saved",
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
      baseTitle: "Saved",
      content: "Draft body",
      version: 3,
      baseDocumentUpdatedAt: "v2",
      baseContentHash: "sha256:saved-body",
      loadedContentWasEmpty: 0,
      editorSessionId: "tab:page",
      editGeneration: 4,
    };
    await act(async () => render());
    expect(state.resolve).toHaveBeenCalledWith(
      expect.objectContaining({
        choice: "keep_mine",
        expectedDraftVersion: 3,
        expectedDraftBaseTitle: "Saved",
        expectedDocumentTitle: "Saved",
        expectedDocumentUpdatedAt: "v2",
        expectedDraftContent: "Draft body",
      }),
    );
    expect(state.update).not.toHaveBeenCalled();
  });

  it("keeps an identified draft pending when its write requires preservation", async () => {
    state.draft = {
      title: "Draft",
      baseTitle: "Saved",
      content: "Draft body",
      version: 3,
      baseDocumentUpdatedAt: "v2",
      baseContentHash: "sha256:saved-body",
      loadedContentWasEmpty: 0,
      editorSessionId: "tab:page",
      editGeneration: 4,
    };
    state.resolve.mockResolvedValue({
      status: "document_conflict",
      document: page,
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
      baseTitle: "Saved",
      content: "Discarded draft body",
      version: 3,
      baseDocumentUpdatedAt: "v2",
      baseContentHash: "sha256:saved-body",
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

    expect(state.resolve).toHaveBeenCalledWith(
      expect.objectContaining({ choice: "keep_mine" }),
    );
    expect(state.update).not.toHaveBeenCalled();
    expect(state.refetch).toHaveBeenCalled();
    expect(
      container.querySelector('[data-testid="recovery-comparison"]'),
    ).toBeNull();
  });

  it("preserves an unrebased newer-base draft in History without showing a conflict", async () => {
    state.draft = {
      title: "Draft",
      baseTitle: "Saved",
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
      trigger: "automatic",
      documentId: "page",
      expectedDraftVersion: 3,
      expectedDraftTitle: "Draft",
      expectedDraftContent: "Draft body",
      expectedDraftBaseTitle: "Saved",
      expectedDocumentTitle: "Saved",
      expectedDocumentUpdatedAt: "v2",
    });
    expect(
      container.querySelector('[role="status"]')?.textContent ?? "",
    ).not.toContain("editor.previewDraftConflict");
  });

  it.each([
    [
      "was written on another body at the page's timestamp",
      "sha256:other-body",
    ],
    ["cannot name the body it was written on", null],
  ])(
    "preserves a draft in History when it %s",
    async (_case, baseContentHash) => {
      state.draft = {
        title: "Draft",
        baseTitle: "Saved",
        content: "Draft body",
        version: 3,
        baseDocumentUpdatedAt: "v2",
        baseContentHash,
        loadedContentWasEmpty: 0,
        editorSessionId: "tab:page",
        editGeneration: 4,
      };
      await act(async () => render());
      expect(state.update).not.toHaveBeenCalled();
      expect(state.resolve).toHaveBeenCalledWith(
        expect.objectContaining({
          choice: "use_saved",
          expectedDraftContent: "Draft body",
          expectedDocumentUpdatedAt: "v2",
        }),
      );
    },
  );

  it("resolves a held draft through the automatic server permission boundary", async () => {
    state.draft = {
      title: "Saved",
      baseTitle: "Saved",
      content: "Saved body",
      version: 3,
      baseDocumentUpdatedAt: "v1",
      loadedContentWasEmpty: 0,
      editorSessionId: "tab:page",
      editGeneration: 4,
    };
    await act(async () => render());
    expect(state.resolve).toHaveBeenCalledWith(
      expect.objectContaining({
        choice: "keep_mine",
        trigger: "automatic",
        expectedDraftVersion: 3,
      }),
    );
    expect(state.update).not.toHaveBeenCalled();
    expect(state.remove).not.toHaveBeenCalled();
    expect(
      container.querySelector('[data-testid="recovery-comparison"]'),
    ).toBeNull();
  });

  it("keeps a held draft visible when the server requires a recovery choice", async () => {
    state.draft = {
      title: "Saved",
      baseTitle: "Saved",
      content: "Saved body",
      version: 3,
      baseDocumentUpdatedAt: "v1",
      loadedContentWasEmpty: 0,
      editorSessionId: "tab:page",
      editGeneration: 4,
    };
    state.resolve.mockResolvedValue({
      status: "recovery_required",
      reason: "prior_choice",
      choice: "save_separately",
      document: page,
    });
    await act(async () => render());
    expect(state.resolve).toHaveBeenCalledWith(
      expect.objectContaining({ choice: "keep_mine", trigger: "automatic" }),
    );
    expect(state.remove).not.toHaveBeenCalled();
    expect(
      container.querySelector('[data-testid="recovery-comparison"]'),
    ).not.toBeNull();
  });

  it("preserves a draft when automatic archival sees an unreviewed version that holds its text", async () => {
    state.draft = {
      title: "Saved",
      baseTitle: "Saved",
      content: "Draft body",
      version: 3,
      baseDocumentUpdatedAt: "v1",
      loadedContentWasEmpty: 0,
      editorSessionId: "tab:page",
      editGeneration: 4,
    };
    state.resolve.mockResolvedValue({
      status: "document_conflict",
      document: { ...page, content: "Draft body", updatedAt: "v3" },
    });
    await act(async () => render());
    expect(state.resolve).toHaveBeenCalledWith(
      expect.objectContaining({ choice: "use_saved", trigger: "automatic" }),
    );
    expect(state.remove).not.toHaveBeenCalled();
    expect(
      container.querySelector('[data-testid="recovery-comparison"]'),
    ).not.toBeNull();
    state.resolve.mockResolvedValue({
      status: "resolved",
      choice: "use_saved",
    });
    await act(async () =>
      Array.from(container.querySelectorAll("button"))
        .find((button) => button.textContent === "Use saved")
        ?.click(),
    );
    expect(state.resolve).toHaveBeenLastCalledWith(
      expect.objectContaining({
        choice: "use_saved",
        trigger: "reviewed",
        expectedDocumentUpdatedAt: "v3",
      }),
    );
  });

  it("moves a legacy draft to History without blocking the editor", async () => {
    state.draft = {
      title: "Legacy draft",
      baseTitle: "Saved",
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
      trigger: "automatic",
      documentId: "page",
      expectedDraftVersion: 7,
      expectedDraftTitle: "Legacy draft",
      expectedDraftContent: "Legacy body",
      expectedDraftBaseTitle: "Saved",
      expectedDocumentTitle: "Saved",
      expectedDocumentUpdatedAt: "v2",
    });
    expect(container.querySelector("textarea")).not.toBeNull();
    expect(container.querySelector('[role="status"]')).toBeNull();
  });

  it("keeps a failed legacy draft pending", async () => {
    state.draft = {
      title: "Legacy draft",
      baseTitle: "Saved",
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
