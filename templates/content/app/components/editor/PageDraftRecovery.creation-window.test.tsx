import type { Document } from "@shared/api";
// @vitest-environment happy-dom
//
// The reported bug surfaced here: while the draft read was still resolving the
// just-created row, this surface rendered the terminal "Something went wrong"
// state with a Retry button. Automatic recovery only helps if the in-flight
// window reads as loading, so pin that the error state stays out of the DOM
// until the read actually gives up.
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  draftQuery: {} as {
    data?: { draft: null };
    isError?: boolean;
    isFetching?: boolean;
  },
  refetch: vi.fn(),
}));
vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string) => key,
}));
vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ refetchQueries: vi.fn() }),
}));
vi.mock("@/hooks/use-documents", () => ({
  documentQueryFilter: (id: string) => ({ id }),
  isDocumentUpdateConflict: () => false,
  usePreviewDocumentDraft: () => ({ ...state.draftQuery, refetch: vi.fn() }),
  useUpdateDocument: () => ({ mutateAsync: vi.fn() }),
  useUpdatePreviewDocumentDraft: () => ({ mutateAsync: vi.fn() }),
}));
vi.mock("./DocumentEditorSkeleton", () => ({
  DocumentEditorSkeleton: () => <div data-testid="editor-skeleton" />,
}));
import { PageDraftRecovery } from "./PageDraftRecovery";

describe("Page draft recovery during the creation window", () => {
  let root: Root;
  let container: HTMLDivElement;
  const page = { id: "page", title: "", content: "" } as Document;
  const render = () =>
    act(() =>
      root.render(
        <PageDraftRecovery document={page}>
          <textarea defaultValue="Live editor" />
        </PageDraftRecovery>,
      ),
    );

  beforeEach(() => {
    (
      globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    vi.clearAllMocks();
    container = document.createElement("div");
    document.body.appendChild(container);
    act(() => {
      root = createRoot(container);
    });
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it("waits on the skeleton while the read is still retrying", () => {
    state.draftQuery = { data: undefined, isError: false, isFetching: true };
    render();

    expect(
      container.querySelector('[data-testid="editor-skeleton"]'),
    ).not.toBeNull();
    expect(container.textContent).not.toContain("empty.genericError");
    expect(container.textContent).not.toContain("database.retry");
  });

  it("mounts the editor once the created row answers", () => {
    state.draftQuery = { data: { draft: null }, isError: false };
    render();

    expect(container.querySelector("textarea")).not.toBeNull();
    expect(container.textContent).not.toContain("database.retry");
  });

  it("still surfaces a terminal failure after the budget is spent", () => {
    state.draftQuery = { data: undefined, isError: true, isFetching: false };
    render();

    expect(container.textContent).toContain("empty.genericError");
    expect(container.textContent).toContain("database.retry");
  });
});
