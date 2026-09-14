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
    deferredReason?: "hydration" | "conflict" | null;
  },
  draftQueryOptions: null as null | { enabled?: boolean } | undefined,
  update: vi.fn(),
  remove: vi.fn(),
  resolve: vi.fn(),
  refetch: vi.fn(),
  writeClipboardText: vi.fn(),
}));
vi.mock("@agent-native/core/client/clipboard", () => ({
  writeClipboardText: state.writeClipboardText,
}));
vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string) => key,
}));
vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));
vi.mock("react-router", () => ({ useNavigate: () => vi.fn() }));
vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ refetchQueries: state.refetch }),
}));
vi.mock("@/hooks/use-documents", () => ({
  documentQueryFilter: (id: string) => ({ id }),
  isDocumentUpdateConflict: (value: { conflict?: boolean }) =>
    value.conflict === true,
  usePreviewDocumentDraft: (_id: string, options?: { enabled?: boolean }) => {
    state.draftQueryOptions = options ?? null;
    if (options?.enabled === false)
      return { data: undefined, refetch: state.refetch };
    return { data: { draft: state.draft }, refetch: state.refetch };
  },
  useUpdateDocument: () => ({ mutateAsync: state.update }),
  useResolvePreviewDocumentDraft: () => ({ mutateAsync: state.resolve }),
  useUpdatePreviewDocumentDraft: () => ({ mutateAsync: state.remove }),
}));
vi.mock("./DocumentEditorSkeleton", () => ({
  DocumentEditorSkeleton: () => <div data-testid="editor-skeleton" />,
}));
import { markDocumentCreationPending } from "@/lib/optimistic-document";

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
    state.draftQueryOptions = null;
    state.draft = {
      title: "Draft",
      content: "Draft body",
      version: 3,
      baseDocumentUpdatedAt: "original-version",
      loadedContentWasEmpty: 1,
    };
    state.refetch.mockResolvedValue(undefined);
    state.writeClipboardText.mockResolvedValue(true);
    state.update.mockResolvedValue({ title: "Draft", content: "Draft body" });
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
  it("keeps a conflicting restoration visible and never deletes its draft", async () => {
    state.update.mockResolvedValue({
      conflict: true,
      document: {
        ...page,
        title: "Someone else's newer title",
        content: "Someone else's newer body",
        updatedAt: "v2",
      },
    });
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
    expect(container.querySelector('[role="alert"]')?.textContent).toBe(
      "editor.previewDraftConflict",
    );
    expect(container.textContent).toContain("Draft body");
    expect(container.textContent).toContain("Someone else's newer body");
    expect(container.textContent).toContain("editor.previewDraftYourEdits");
    expect(container.textContent).toContain("editor.previewDraftSavedVersion");
    expect(container.textContent).not.toContain("editor.restorePreviewDraft");
    const copyButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "editor.copyUnsavedText",
    );
    await act(async () => copyButton!.click());
    expect(state.writeClipboardText).toHaveBeenCalledWith("Draft body");

    const useSavedButton = Array.from(
      container.querySelectorAll("button"),
    ).find((button) => button.textContent === "editor.previewDraftUseSaved");
    await act(async () => useSavedButton!.click());
    expect(state.update).toHaveBeenCalledTimes(1);
    expect(state.resolve).toHaveBeenCalledWith({
      choice: "use_saved",
      documentId: "page",
      expectedDraftVersion: 3,
      expectedDraftTitle: "Draft",
      expectedDraftContent: "Draft body",
    });
    expect(container.querySelector("textarea")).toBeNull();
  });
  it("compares both versions and refreshes after an unseen Keep mine conflict", async () => {
    state.draft!.deferredReason = "conflict";
    state.resolve.mockResolvedValue({
      status: "document_conflict",
      document: {
        ...page,
        title: "Even newer",
        content: "Unseen saved body",
        updatedAt: "v2",
      },
    });
    act(render);
    expect(container.textContent).toContain("Draft body");
    expect(container.textContent).toContain("Saved body");

    const keepButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "editor.previewDraftKeepMine",
    );
    await act(async () => keepButton!.click());
    expect(state.resolve).toHaveBeenCalledWith({
      choice: "keep_mine",
      documentId: "page",
      expectedDraftVersion: 3,
      expectedDraftTitle: "Draft",
      expectedDraftContent: "Draft body",
      expectedDocumentUpdatedAt: "v1",
    });
    expect(container.textContent).toContain("Unseen saved body");
    expect(container.textContent).toContain("Draft body");
  });
  it("highlights every disjoint change in both versions", () => {
    state.draft = {
      title: "Same title",
      content: "First mine middle mine last",
      version: 3,
      deferredReason: "conflict",
    };
    const saved = {
      ...page,
      title: "Same title",
      content: "First saved middle saved last",
    } as Document;
    act(() =>
      root.render(
        <PageDraftRecovery document={saved}>
          <textarea defaultValue="Live editor" />
        </PageDraftRecovery>,
      ),
    );
    const panels = container.querySelectorAll("section");
    expect(
      Array.from(
        panels[0]!.querySelectorAll("mark"),
        (mark) => mark.textContent,
      ),
    ).toEqual(["mine", "mine"]);
    expect(
      Array.from(
        panels[1]!.querySelectorAll("mark"),
        (mark) => mark.textContent,
      ),
    ).toEqual(["saved", "saved"]);
  });
  it("keeps generic restore failures distinct and allows another restore attempt", async () => {
    state.update.mockRejectedValue(new Error("network unavailable"));
    act(render);
    await act(async () =>
      container.querySelector<HTMLButtonElement>("button")!.click(),
    );
    expect(container.querySelector('[role="alert"]')?.textContent).toBe(
      "empty.genericError",
    );
    expect(container.textContent).toContain("editor.restorePreviewDraft");
    expect(container.textContent).not.toContain("editor.copyUnsavedText");
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
  it("uses the exact draft version when choosing the saved Page", async () => {
    act(render);
    await act(async () =>
      container.querySelectorAll<HTMLButtonElement>("button")[1].click(),
    );
    expect(state.update).not.toHaveBeenCalled();
    expect(state.resolve).toHaveBeenCalledWith({
      choice: "use_saved",
      documentId: "page",
      expectedDraftVersion: 3,
      expectedDraftTitle: "Draft",
      expectedDraftContent: "Draft body",
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
  it("does not query or surface draft errors while document creation is pending", () => {
    const pending = markDocumentCreationPending({ ...page } as Document);
    act(() =>
      root.render(
        <PageDraftRecovery document={pending}>
          <textarea defaultValue="Live editor" />
        </PageDraftRecovery>,
      ),
    );
    expect(state.draftQueryOptions).toEqual({ enabled: false });
    expect(
      container.querySelector('[data-testid="editor-skeleton"]'),
    ).not.toBeNull();
    expect(container.querySelector('[role="alert"]')).toBeNull();
    expect(container.querySelector("textarea")).toBeNull();
  });
  it("queries the draft once document creation is no longer pending", () => {
    const pending = markDocumentCreationPending({ ...page } as Document);
    act(() =>
      root.render(
        <PageDraftRecovery document={pending}>
          <textarea defaultValue="Live editor" />
        </PageDraftRecovery>,
      ),
    );
    expect(state.draftQueryOptions?.enabled).toBe(false);
    state.draft = null;
    act(() =>
      root.render(
        <PageDraftRecovery document={page}>
          <textarea defaultValue="Live editor" />
        </PageDraftRecovery>,
      ),
    );
    expect(state.draftQueryOptions?.enabled).toBe(true);
    expect(container.querySelector("textarea")).not.toBeNull();
  });
});
