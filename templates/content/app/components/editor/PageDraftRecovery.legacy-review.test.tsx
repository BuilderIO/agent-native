// @vitest-environment happy-dom
import type { Document } from "@shared/api";
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { FlushLocalSnapshot } from "./document-flush-participant";

const state = vi.hoisted(() => ({
  session: { email: "writer@example.test", orgId: "org" as string | null },
  draft: null as null | {
    id: string;
    title: string;
    content: string;
    version: number;
    baseTitle: string | null;
    baseDocumentUpdatedAt: string | null;
    loadedContentWasEmpty: number;
    editorSessionId: string | null;
    editGeneration: number | null;
  },
  snapshot: null as unknown as FlushLocalSnapshot,
  drain: vi.fn(),
  update: vi.fn(),
  remove: vi.fn(),
  resolve: vi.fn(),
  refetch: vi.fn(),
  verify: vi.fn(),
  copy: vi.fn(),
  journalWrite: vi.fn(),
  journalClear: vi.fn(),
  comparison: null as null | { onKeepMine: () => void },
}));
vi.mock("@agent-native/core/client/hooks", () => ({
  callAction: vi.fn().mockResolvedValue({ draft: null }),
  useSession: () => ({ session: state.session }),
}));
vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string) => key,
}));
vi.mock("@agent-native/toolkit/clipboard", () => ({
  writeClipboardText: (text: string) => state.copy(text),
}));
vi.mock("react-router", () => ({ useNavigate: () => vi.fn() }));
vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ refetchQueries: state.refetch }),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/hooks/use-documents", () => ({
  documentQueryFilter: (id: string) => ({ id }),
  ensurePreviewDocumentDraftRead: (...args: unknown[]) => state.verify(...args),
  usePreviewDocumentDraft: () => ({
    data: { draft: state.draft },
    refetch: state.refetch,
  }),
  useUpdateDocument: () => ({ mutateAsync: state.update }),
  useResolvePreviewDocumentDraft: () => ({ mutateAsync: state.resolve }),
  useUpdatePreviewDocumentDraft: () => ({ mutateAsync: state.remove }),
}));
vi.mock("./page-draft-journal", () => ({
  holdPageDraftWriter: () => () => undefined,
  liveDraftWriterIds: async () => new Set<string>(),
  readPageDraftJournal: () => null,
  listPageDraftJournal: () => [],
  sweepLegacyRetainedPageDraftMarkers: () => undefined,
  writePageDraftJournal: (...args: unknown[]) => state.journalWrite(...args),
  clearPageDraftJournal: (...args: unknown[]) => state.journalClear(...args),
}));
vi.mock("./document-save-rebase", () => ({
  saveDocumentWithRebase: vi.fn(),
}));
vi.mock("./DocumentEditorSkeleton", () => ({
  DocumentEditorSkeleton: () => <div data-testid="editor-skeleton" />,
}));
vi.mock("@/components/ui/dialog", async () => {
  const { createContext, useContext } = await import("react");
  const Open = createContext(false);
  return {
    Dialog: ({ open, children }: { open: boolean; children: ReactNode }) => (
      <Open.Provider value={open}>{children}</Open.Provider>
    ),
    DialogTrigger: ({ children }: { children: ReactNode }) => children,
    DialogContent: function DialogContent({
      children,
    }: {
      children: ReactNode;
    }) {
      return useContext(Open) ? (
        <div data-testid="review">{children}</div>
      ) : null;
    },
    DialogTitle: ({ children }: { children: ReactNode }) => <h2>{children}</h2>,
  };
});
// Mirrors the real footer: a stale review offers only a refresh, and busy
// disables every choice.
vi.mock("./RecoveryComparison", () => ({
  RecoveryComparison: (props: {
    mine: { content: string };
    busy: boolean;
    keepMineDisabled?: boolean;
    failure: string;
    stale?: boolean;
    onRefresh?: () => void;
    onKeepMine: () => void;
    onUseSaved: () => void;
    onSaveSeparately: () => void;
    onCopy: () => void;
  }) => (
    (state.comparison = props),
    (
      <div data-testid="recovery-comparison">
        <pre>{props.mine.content}</pre>
        <span>{props.failure}</span>
        {props.stale && props.onRefresh ? (
          <button onClick={props.onRefresh}>Refresh</button>
        ) : (
          <>
            <button
              disabled={props.busy || props.keepMineDisabled}
              onClick={props.onKeepMine}
            >
              Keep mine
            </button>
            <button disabled={props.busy} onClick={props.onUseSaved}>
              Use saved
            </button>
            <button disabled={props.busy} onClick={props.onSaveSeparately}>
              Save separately
            </button>
          </>
        )}
      </div>
    )
  ),
}));

import { useRegisterLiveEditorSession } from "./live-editor-session";
import { PageDraftRecovery } from "./PageDraftRecovery";

const flush = {
  snapshot: () => state.snapshot,
  drain: () => state.drain(),
};

function LiveEditor() {
  useRegisterLiveEditorSession("live-session", flush);
  return <textarea aria-label="Live editor" defaultValue="Saved body" />;
}

function saved(changes: Partial<FlushLocalSnapshot> = {}): FlushLocalSnapshot {
  return {
    identity: "live-session",
    generation: 1,
    observation: 0,
    valueEpoch: 0,
    visualVersion: null,
    title: "Saved",
    content: "Saved body",
    clean: true,
    claim: null,
    ...changes,
  };
}

describe("a legacy draft of unknown lineage beside the open editor", () => {
  let root: Root;
  let container: HTMLDivElement;
  const page = {
    id: "page",
    title: "Saved",
    content: "Saved body",
    canEdit: true,
    updatedAt: "v2",
    createdAt: "created-1",
    revision: "saved-body-revision",
    contentHash: "sha256:saved-body",
  } as Document;
  const render = (document: Document = page) =>
    root.render(
      <PageDraftRecovery document={document}>
        <LiveEditor />
      </PageDraftRecovery>,
    );
  const button = (label: string) =>
    Array.from(container.querySelectorAll("button")).find(
      (candidate) => candidate.textContent === label,
    );
  const click = (label: string) =>
    act(async () => {
      button(label)!.click();
    });
  const review = () => container.querySelector('[data-testid="review"]');
  const expectNoDraftEffects = () => {
    expect(state.resolve).not.toHaveBeenCalled();
    expect(state.remove).not.toHaveBeenCalled();
    expect(state.update).not.toHaveBeenCalled();
    expect(state.journalWrite).not.toHaveBeenCalled();
    expect(state.journalClear).not.toHaveBeenCalled();
  };

  beforeEach(() => {
    (
      globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    vi.clearAllMocks();
    state.session = { email: "writer@example.test", orgId: "org" };
    state.draft = {
      id: "legacy-draft",
      title: "Legacy title",
      content: "Saved body\nA line the server never saved.",
      version: 1,
      baseTitle: null,
      baseDocumentUpdatedAt: null,
      loadedContentWasEmpty: 0,
      editorSessionId: null,
      editGeneration: null,
    };
    state.snapshot = saved();
    state.drain.mockResolvedValue(undefined);
    state.refetch.mockImplementation(async () => ({
      data: { draft: state.draft },
    }));
    state.verify.mockResolvedValue(undefined);
    state.resolve.mockResolvedValue({ status: "resolved" });
    state.copy.mockResolvedValue(true);
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });
  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it("keeps the editor open and the draft untouched until a reviewed choice", async () => {
    await act(async () => render());

    const editor = container.querySelector("textarea");
    expect(editor).not.toBeNull();
    expect(editor!.disabled).toBe(false);
    expect(container.textContent).toContain("editor.previewDraftRecovery");
    expect(review()).toBeNull();
    expectNoDraftEffects();

    await click("editor.copyUnsavedText");
    expect(state.copy).toHaveBeenCalledExactlyOnceWith(state.draft!.content);

    await click("editor.reconcileReview");
    expect(state.drain).toHaveBeenCalledOnce();
    expect(review()?.textContent).toContain("A line the server never saved.");
    expect(review()?.textContent).toContain("editor.previewDraftTitleUnknown");
    expect(button("Keep mine")!.disabled).toBe(true);
    expect(button("Use saved")!.disabled).toBe(false);
    expect(container.querySelector("textarea")).toBe(editor);
    expectNoDraftEffects();
  });

  it.each([true, false])(
    "never restores the draft over the page, even when Keep mine is invoked (editor clean=%s)",
    async (clean) => {
      await act(async () => render());
      await click("editor.reconcileReview");
      expect(button("Keep mine")!.disabled).toBe(true);

      state.snapshot = saved({ clean });
      await act(async () => state.comparison!.onKeepMine());

      expectNoDraftEffects();
    },
  );

  it.each(["Use saved", "Save separately"])(
    "refuses %s once the editor holds an edit the review did not cover",
    async (choice) => {
      await act(async () => render());
      await click("editor.reconcileReview");
      expect(button(choice)!.disabled).toBe(false);

      state.snapshot = saved({
        generation: 2,
        content: "Saved body typed after review",
        clean: false,
      });
      await click(choice);

      expectNoDraftEffects();
      expect(button(choice)).toBeUndefined();
      expect(button("Refresh")).toBeDefined();
      expect(review()?.textContent).toContain("editor.reconcileReviewStale");
      expect(review()?.textContent).toContain("A line the server never saved.");
    },
  );

  it("refuses a choice once the editor saved an edit the review did not cover", async () => {
    await act(async () => render());
    await click("editor.reconcileReview");

    state.snapshot = saved({
      generation: 2,
      content: "Saved body typed after review",
    });
    await click("Use saved");

    expectNoDraftEffects();
    expect(button("Refresh")).toBeDefined();
  });

  it("needs a new review and a new click after the editor saves that edit", async () => {
    await act(async () => render());
    await click("editor.reconcileReview");
    state.snapshot = saved({ generation: 2, clean: false });
    await click("Use saved");

    state.snapshot = saved({ generation: 2 });
    await act(async () => render());
    expectNoDraftEffects();
    expect(button("Use saved")).toBeUndefined();

    await click("Refresh");
    expect(state.drain).toHaveBeenCalledTimes(2);
    expectNoDraftEffects();

    await click("Use saved");
    expect(state.resolve).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        choice: "use_saved",
        trigger: "reviewed",
        expectedDraftId: "legacy-draft",
        expectedDraftContent: state.draft!.content,
        expectedDraftBaseTitle: null,
        expectedDocumentUpdatedAt: "v2",
      }),
    );
  });

  it("saves the reviewed draft as a separate page with its unknown title base", async () => {
    await act(async () => render());
    await click("editor.reconcileReview");
    await click("Save separately");

    expect(state.resolve).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        choice: "save_separately",
        trigger: "reviewed",
        expectedDraftId: "legacy-draft",
        expectedDraftBaseTitle: null,
      }),
    );
    expect(state.remove).not.toHaveBeenCalled();
  });

  it("holds the review while the editor cannot save its edits, and still copies the draft", async () => {
    state.drain.mockRejectedValue(new Error("save refused"));
    await act(async () => render());
    await click("editor.reconcileReview");

    expect(review()?.textContent).toContain("editor.reconcileSaveFailed");
    expect(button("Use saved")).toBeUndefined();
    expect(button("Refresh")).toBeDefined();
    await click("editor.copyUnsavedText");
    expect(state.copy).toHaveBeenCalledExactlyOnceWith(state.draft!.content);
    expectNoDraftEffects();
  });

  it("holds the review while the drained editor still reads as unsaved", async () => {
    state.snapshot = saved({ clean: false });
    await act(async () => render());
    await click("editor.reconcileReview");

    expect(review()?.textContent).toContain("editor.reconcileSaveFailed");
    expect(button("Use saved")).toBeUndefined();
    expectNoDraftEffects();
  });

  it.each([
    [
      "another account",
      () => {
        state.session = { email: "other@example.test", orgId: "org" };
      },
      page,
    ],
    [
      "another org",
      () => {
        state.session = { email: "writer@example.test", orgId: "other-org" };
      },
      page,
    ],
    [
      "a page recreated under the same id",
      () => {},
      { ...page, createdAt: "created-2" },
    ],
  ] as const)(
    "drops a prepared review when the reader moves to %s",
    async (_, move, next) => {
      await act(async () => render());
      await click("editor.reconcileReview");
      expect(button("Use saved")!.disabled).toBe(false);
      const useSaved = button("Use saved")!;

      move();
      await act(async () => render(next as Document));

      expect(review()).toBeNull();
      await act(async () => {
        useSaved.click();
      });
      expectNoDraftEffects();
    },
  );

  it("drops a review still being prepared when the page is recreated under the same id", async () => {
    let release!: () => void;
    state.drain.mockReturnValue(
      new Promise<void>((resolve) => {
        release = resolve;
      }),
    );
    await act(async () => render());
    await click("editor.reconcileReview");
    expect(button("Use saved")!.disabled).toBe(true);

    await act(async () => render({ ...page, createdAt: "created-2" }));
    await act(async () => release());

    expect(review()).toBeNull();
    expect(state.refetch).not.toHaveBeenCalledWith(
      { id: "page" },
      { throwOnError: true },
    );
    expectNoDraftEffects();
  });
});
