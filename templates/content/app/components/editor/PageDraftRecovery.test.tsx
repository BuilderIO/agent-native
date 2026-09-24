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
vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ refetchQueries: state.refetch }),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/hooks/use-documents", () => ({
  documentQueryFilter: (id: string) => ({ id }),
  isDocumentUpdateConflict: (result: { conflict?: boolean }) =>
    result.conflict === true,
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

import { PageDraftRecovery } from "./PageDraftRecovery";

describe("Page draft recovery", () => {
  let root: Root;
  let container: HTMLDivElement;
  const page = {
    id: "page",
    title: "Saved",
    content: "Saved body",
    updatedAt: "v2",
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
        editorEditGeneration: 4,
      }),
    );
    expect(state.resolve).not.toHaveBeenCalled();
  });

  it("retains a newer-base identified draft without filing it as saved", async () => {
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
    expect(state.resolve).not.toHaveBeenCalled();
    expect(container.querySelector("textarea")).not.toBeNull();
    expect(container.querySelector('[role="status"]')?.textContent).toContain(
      "editor.previewDraftConflict",
    );
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
    state.resolve.mockRejectedValue(new Error("offline"));
    await act(async () => render());
    expect(state.remove).not.toHaveBeenCalled();
    expect(container.querySelector("textarea")).not.toBeNull();
    expect(container.querySelector('[role="status"]')?.textContent).toContain(
      "empty.genericError",
    );
  });
});
