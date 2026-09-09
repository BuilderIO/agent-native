import type { Document } from "@shared/api";
// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  draft: null as null | {
    title: string;
    content: string;
    version: number;
    baseDocumentUpdatedAt?: string | null;
    loadedContentWasEmpty?: number;
  },
  update: vi.fn(),
  remove: vi.fn(),
  refetch: vi.fn(),
}));
vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string) => key,
}));
vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ refetchQueries: state.refetch }),
}));
vi.mock("@/hooks/use-documents", () => ({
  documentQueryFilter: (id: string) => ({ id }),
  isDocumentUpdateConflict: (value: { conflict?: boolean }) =>
    value.conflict === true,
  usePreviewDocumentDraft: () => ({
    data: { draft: state.draft },
    refetch: state.refetch,
  }),
  useUpdateDocument: () => ({ mutateAsync: state.update }),
  useUpdatePreviewDocumentDraft: () => ({ mutateAsync: state.remove }),
}));
vi.mock("./DocumentEditorSkeleton", () => ({
  DocumentEditorSkeleton: () => null,
}));
import { PageDraftRecovery } from "./PageDraftRecovery";

describe("Page draft recovery", () => {
  let root: Root;
  let container: HTMLDivElement;
  const page = {
    id: "page",
    title: "Saved",
    content: "Saved body",
    updatedAt: "v1",
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
    state.draft = {
      title: "Draft",
      content: "Draft body",
      version: 3,
      baseDocumentUpdatedAt: "original-version",
      loadedContentWasEmpty: 1,
    };
    state.refetch.mockResolvedValue(undefined);
    state.update.mockResolvedValue({ title: "Draft", content: "Draft body" });
    state.remove.mockResolvedValue({ status: "deleted" });
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });
  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });
  it("keeps a conflicting restoration visible and never deletes its draft", async () => {
    state.update.mockResolvedValue({ conflict: true, document: page });
    act(render);
    await act(async () =>
      container.querySelector<HTMLButtonElement>("button")!.click(),
    );
    expect(state.update).toHaveBeenCalledWith(
      expect.objectContaining({
        baseUpdatedAt: "original-version",
        loadedUpdatedAt: "original-version",
        loadedContentWasEmpty: true,
      }),
    );
    expect(state.remove).not.toHaveBeenCalled();
    expect(container.querySelector('[role="alert"]')).not.toBeNull();
    expect(container.textContent).toContain("Draft body");
    expect(container.querySelector("textarea")).toBeNull();
    expect(container.textContent).toContain("Saved body");
    expect(container.textContent).toContain("editor.keepLocalDraft");
  });
  it("restores after Trash only when the user chooses the draft over the displayed saved version", async () => {
    state.update.mockResolvedValueOnce({
      conflict: true,
      document: { ...page, updatedAt: "restored-version" },
    });
    act(render);
    const restore = () =>
      container.querySelector<HTMLButtonElement>("button")!.click();
    await act(async () => restore());
    expect(state.update).toHaveBeenCalledTimes(1);
    expect(state.remove).not.toHaveBeenCalled();
    await act(async () => restore());
    expect(state.update).toHaveBeenLastCalledWith(
      expect.objectContaining({
        baseUpdatedAt: "restored-version",
        loadedUpdatedAt: "restored-version",
        loadedContentWasEmpty: false,
      }),
    );
    expect(state.remove).toHaveBeenCalledTimes(1);
  });
  it("requires another review when the saved page changes during the explicit choice", async () => {
    state.update
      .mockResolvedValueOnce({ conflict: true, document: page })
      .mockResolvedValueOnce({
        conflict: true,
        document: { ...page, content: "Newer body", updatedAt: "v2" },
      });
    act(render);
    const restore = () =>
      container.querySelector<HTMLButtonElement>("button")!.click();
    await act(async () => restore());
    await act(async () => restore());
    expect(state.update).toHaveBeenCalledTimes(2);
    expect(state.update).toHaveBeenLastCalledWith(
      expect.objectContaining({ baseUpdatedAt: "v1" }),
    );
    expect(state.remove).not.toHaveBeenCalled();
    expect(container.textContent).toContain("Newer body");
    expect(container.querySelector("textarea")).toBeNull();
  });
  it("does not transfer a reviewed choice to a newer private draft", async () => {
    state.update.mockResolvedValue({ conflict: true, document: page });
    act(render);
    await act(async () =>
      container.querySelector<HTMLButtonElement>("button")!.click(),
    );
    state.draft = { ...state.draft!, version: 4, content: "New draft" };
    act(render);
    expect(container.textContent).not.toContain("editor.keepLocalDraft");
    await act(async () =>
      container.querySelector<HTMLButtonElement>("button")!.click(),
    );
    expect(state.update).toHaveBeenLastCalledWith(
      expect.objectContaining({ baseUpdatedAt: "original-version" }),
    );
    expect(state.remove).not.toHaveBeenCalled();
  });
  it("retains a draft with an unknown original version without overwriting the Page", async () => {
    state.draft!.baseDocumentUpdatedAt = null;
    act(render);
    await act(async () =>
      container.querySelector<HTMLButtonElement>("button")!.click(),
    );
    expect(state.update).not.toHaveBeenCalled();
    expect(state.remove).not.toHaveBeenCalled();
    expect(container.querySelector('[role="alert"]')).not.toBeNull();
  });
  it("uses the exact draft version when discarding without writing the Page", async () => {
    act(render);
    await act(async () =>
      container.querySelectorAll<HTMLButtonElement>("button")[1].click(),
    );
    expect(state.update).not.toHaveBeenCalled();
    expect(state.remove).toHaveBeenCalledWith({
      operation: "delete",
      documentId: "page",
      expectedVersion: 3,
      expectedTitle: "Draft",
      expectedContent: "Draft body",
    });
  });
  it("does not unmount the active editor when a later failed save retains a draft", async () => {
    state.draft = null;
    await act(async () => render());
    const editor = container.querySelector("textarea");
    state.draft = { title: "Later", content: "Unsaved body", version: 4 };
    act(render);
    expect(container.querySelector("textarea")).toBe(editor);
    expect(container.textContent).not.toContain("editor.previewDraftRecovery");
  });
});
