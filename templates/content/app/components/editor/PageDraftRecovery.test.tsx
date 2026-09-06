import type { Document } from "@shared/api";
// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  draft: null as null | { title: string; content: string; version: number },
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
    state.draft = { title: "Draft", content: "Draft body", version: 3 };
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
    state.update.mockResolvedValue({ conflict: true });
    act(render);
    await act(async () =>
      container.querySelector<HTMLButtonElement>("button")!.click(),
    );
    expect(state.remove).not.toHaveBeenCalled();
    expect(container.querySelector('[role="alert"]')).not.toBeNull();
    expect(container.textContent).toContain("Draft body");
    expect(container.querySelector("textarea")).toBeNull();
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
