// @vitest-environment happy-dom

import type {
  DocumentHistoryChanges,
  DocumentHistoryCheckpointPage,
  DocumentHistoryGroup,
  DocumentHistoryPage,
} from "@shared/document-history";
import { act, useState, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { mocks } = vi.hoisted(() => ({
  mocks: {
    setClientAppState: vi.fn(async () => null),
    prepareRestore: vi.fn(async () => "current-revision"),
    restore: vi.fn(async () => ({})),
    undo: vi.fn(async (): Promise<object> => ({})),
    onOpenChange: vi.fn(),
    onRestored: vi.fn(),
    toastSuccess: vi.fn(),
    toastError: vi.fn(),
    toastInfo: vi.fn(),
    historyChanges: {
      data: {
        groupId: "group-agent",
        changes: [
          {
            before: {
              checkpointId: "version-1",
              title: "Plan",
              content: "One\nTwo",
              createdAt: "2026-09-08T10:00:00.000Z",
            },
            after: {
              checkpointId: "version-2",
              title: "Plan",
              content: "One\nTwo by agent",
              createdAt: "2026-09-08T10:05:00.000Z",
            },
          },
        ],
        hasMore: false,
      } as DocumentHistoryChanges,
      error: null,
      isLoading: false,
      refetch: vi.fn(),
    },
    historyPages: new Map(),
    checkpointPages: new Map(),
    historyPage: {
      data: {
        groups: [
          {
            id: "group-1",
            kind: "human_session",
            actorEmail: "alice@example.com",
            actorKind: "human",
            origin: "ui",
            operation: "update-document",
            startedAt: "2026-09-08T10:00:00.000Z",
            endedAt: "2026-09-08T10:05:00.000Z",
            checkpointCount: 1,
            latestCheckpointId: "version-1",
          },
        ],
        nextCursor: null,
        hasMore: false,
      } as DocumentHistoryPage,
      error: null,
      isFetching: false,
      isLoading: false,
      isPlaceholderData: false,
      refetch: vi.fn(),
    },
    checkpoints: {
      data: {
        checkpoints: [
          {
            id: "version-1",
            documentId: "document-1",
            groupId: "group-1",
            title: "Draft",
            checkpointKind: "after",
            createdAt: "2026-09-08T10:05:00.000Z",
          },
        ],
        nextCursor: null,
        hasMore: false,
      } as DocumentHistoryCheckpointPage,
      error: null,
      isFetching: false,
      isLoading: false,
      isPlaceholderData: false,
      refetch: vi.fn(),
    },
  },
}));

vi.mock("@agent-native/core/client/hooks", () => ({
  actionErrorMessage: () => undefined,
  setClientAppState: mocks.setClientAppState,
}));

vi.mock("@agent-native/core/client/i18n", () => ({
  useFormatters: () => ({
    formatDate: (value: Date | string) => new Date(value).toISOString(),
  }),
  useT: () => (key: string) =>
    ({
      "comments.cancel": "Cancel",
      "editor.toolbar.versionHistory": "Version history",
      "editor.versionBackToHistory": "Back to history",
      "editor.versionRestoreAnyway": "Restore anyway",
      "editor.versionRestoreThisVersion": "Restore this version",
      "editor.versionRestoreThisVersionQuestion": "Restore this version?",
      "editor.versionRestoreWarning": "The current state was saved first.",
      "editor.versionRestored": "Version restored.",
      "editor.historyGroupHuman": "Editing session",
      "editor.historyGroupAgent": "Agent run",
      "editor.historyGroupLegacy": "Earlier edits",
      "editor.historyViewChanges": "View changes",
      "editor.historyUndoChanges": "Undo these changes",
      "editor.historyCheckpointBefore": "Before",
      "editor.historyCheckpointAfter": "After",
      "editor.historyLoadMore": "Load more",
      "editor.historyLoadingMore": "Loading more",
    })[key] ?? key,
}));

vi.mock("sonner", () => ({
  toast: {
    success: mocks.toastSuccess,
    error: mocks.toastError,
    info: mocks.toastInfo,
  },
}));

vi.mock("@/components/ui/scroll-area", () => ({
  ScrollArea: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

vi.mock("./VisualEditor", () => ({
  VisualEditor: ({ content }: { content: string }) => (
    <div data-testid="history-preview">{content}</div>
  ),
}));

vi.mock("@/hooks/use-document-versions", () => ({
  useDocumentHistoryPage: (_documentId: string | null, cursor: string | null) =>
    (cursor ? mocks.historyPages.get(cursor) : undefined) ?? mocks.historyPage,
  useDocumentHistoryCheckpoints: (
    _documentId: string | null,
    _groupId: string | null,
    cursor: string | null,
  ) =>
    (cursor ? mocks.checkpointPages.get(cursor) : undefined) ??
    mocks.checkpoints,
  useDocumentHistoryCheckpoint: (
    _documentId: string,
    versionId: string | null,
  ) => ({
    data: versionId
      ? {
          checkpoint: {
            id: "version-1",
            documentId: "document-1",
            groupId: "group-1",
            title: "Draft",
            checkpointKind: "after",
            createdAt: "2026-09-08T10:05:00.000Z",
            content: "Earlier content",
          },
        }
      : undefined,
    error: null,
    isLoading: false,
    refetch: vi.fn(),
  }),
  useRestoreDocumentVersion: () => ({
    mutateAsync: mocks.restore,
    isPending: false,
  }),
  useDocumentHistoryChanges: (
    _documentId: string | null,
    groupId: string | null,
  ) =>
    groupId
      ? mocks.historyChanges
      : { data: undefined, error: null, isLoading: false, refetch: vi.fn() },
  useUndoDocumentChange: () => ({
    mutateAsync: mocks.undo,
    isPending: false,
  }),
}));

import { VersionHistoryPanel } from "./VersionHistoryPanel";

async function clickButton(label: string, exact = true) {
  const button = Array.from(document.querySelectorAll("button")).find(
    (candidate) =>
      exact
        ? candidate.textContent?.trim() === label
        : candidate.textContent?.trim().startsWith(label),
  );
  expect(button, document.body.innerHTML).toBeTruthy();
  await act(async () => {
    button?.click();
    await Promise.resolve();
  });
  return button as HTMLButtonElement;
}

function ControlledPanel({
  documentId = "document-1",
  restoreReady = true,
}: {
  documentId?: string;
  restoreReady?: boolean;
}) {
  const [open, setOpen] = useState(true);
  return (
    <VersionHistoryPanel
      documentId={documentId}
      open={open}
      onOpenChange={(next) => {
        mocks.onOpenChange(next);
        setOpen(next);
      }}
      restoreReady={restoreReady}
      prepareRestore={mocks.prepareRestore}
      onRestored={mocks.onRestored}
    />
  );
}

describe("VersionHistoryPanel restore flow", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(async () => {
    (
      globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    mocks.setClientAppState.mockClear();
    mocks.prepareRestore.mockClear();
    mocks.restore.mockReset();
    mocks.restore.mockResolvedValue({});
    mocks.onOpenChange.mockClear();
    mocks.onRestored.mockReset();
    mocks.onRestored.mockResolvedValue({ status: "applied" });
    mocks.toastSuccess.mockClear();
    mocks.toastError.mockClear();
    mocks.historyPages.clear();
    mocks.checkpointPages.clear();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => {
      root.render(<ControlledPanel />);
      await Promise.resolve();
    });
    await clickButton("Editing session", false);
    await clickButton("DraftAfter");
    expect(
      document.querySelector("[data-testid=history-preview]")?.textContent,
    ).toBe("Earlier content");
  });

  it("keeps Restore disabled until the editor controller is ready", async () => {
    await act(async () => {
      root.render(<ControlledPanel restoreReady={false} />);
    });
    const button = Array.from(document.querySelectorAll("button")).find(
      (candidate) => candidate.textContent?.trim() === "Restore this version",
    ) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    button.click();
    expect(mocks.prepareRestore).not.toHaveBeenCalled();
    await act(async () => {
      root.render(<ControlledPanel restoreReady />);
    });
    expect(button.disabled).toBe(false);
    await clickButton("Restore this version");
    expect(mocks.prepareRestore).toHaveBeenCalledOnce();
  });

  afterEach(() => {
    act(() => root.unmount());
    document.body.replaceChildren();
    (
      globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = false;
  });

  it("prepares before confirmation and cancel keeps the selected preview", async () => {
    await clickButton("Restore this version");

    expect(mocks.prepareRestore).toHaveBeenCalledTimes(1);
    expect(document.body.textContent).toContain(
      "The current state was saved first.",
    );

    await clickButton("Cancel");
    await act(async () => new Promise((resolve) => setTimeout(resolve, 50)));

    expect(mocks.onOpenChange).not.toHaveBeenCalledWith(false);
    expect(document.activeElement?.textContent).toContain(
      "Restore this version",
    );
    expect(mocks.restore).not.toHaveBeenCalled();
    expect(
      document.querySelector("[data-testid=history-preview]")?.textContent,
    ).toBe("Earlier content");
  });

  it("refreshes the first checkpoint page after loading older checkpoints", async () => {
    await clickButton("Back to history");
    mocks.checkpoints.data = {
      checkpoints: [
        {
          id: "version-1",
          documentId: "document-1",
          groupId: "group-1",
          title: "Draft",
          checkpointKind: "after",
          createdAt: "2026-09-08T10:05:00.000Z",
        },
      ],
      nextCursor: "older-checkpoints",
      hasMore: true,
    };
    mocks.checkpointPages.set("older-checkpoints", {
      data: {
        checkpoints: [
          {
            id: "version-0",
            documentId: "document-1",
            groupId: "group-1",
            title: "Older",
            checkpointKind: "after",
            createdAt: "2026-09-08T10:00:00.000Z",
          },
        ],
        nextCursor: null,
        hasMore: false,
      },
      error: null,
      isFetching: false,
      isLoading: false,
      isPlaceholderData: false,
      refetch: vi.fn(),
    });
    await act(async () => {
      root.render(<ControlledPanel />);
      await Promise.resolve();
    });
    await clickButton("Load more");
    expect(document.body.textContent).toContain("OlderAfter");

    mocks.checkpoints.data = {
      checkpoints: [
        {
          id: "version-2",
          documentId: "document-1",
          groupId: "group-1",
          title: "Newest",
          checkpointKind: "after",
          createdAt: "2026-09-08T10:10:00.000Z",
        },
        {
          id: "version-1",
          documentId: "document-1",
          groupId: "group-1",
          title: "Draft",
          checkpointKind: "after",
          createdAt: "2026-09-08T10:05:00.000Z",
        },
      ],
      nextCursor: "refreshed-older-checkpoints",
      hasMore: true,
    };
    await act(async () => {
      root.render(<ControlledPanel />);
      await Promise.resolve();
    });

    const checkpointLabels = Array.from(document.querySelectorAll("button"))
      .map((button) => button.textContent?.trim())
      .filter((label) => label?.endsWith("After"));
    expect(checkpointLabels).toEqual([
      "NewestAfter",
      "DraftAfter",
      "OlderAfter",
    ]);

    await clickButton("OlderAfter");
    await clickButton("Restore this version");
    await clickButton("Cancel");
    await clickButton("Back to history");
    expect(document.body.textContent).toContain("OlderAfter");
  });

  it("Escape dismisses only confirmation and returns focus to Restore", async () => {
    await clickButton("Restore this version");
    const confirmation = document.querySelector('[role="alertdialog"]');
    expect(confirmation).not.toBeNull();
    await act(async () => {
      confirmation!.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Escape",
          bubbles: true,
          cancelable: true,
        }),
      );
      await new Promise((resolve) => setTimeout(resolve, 50));
    });
    expect(mocks.onOpenChange).not.toHaveBeenCalledWith(false);
    expect(document.querySelector('[role="alertdialog"]')).toBeNull();
    expect(
      document.querySelector('[data-testid="history-preview"]')?.textContent,
    ).toBe("Earlier content");
    expect(document.activeElement?.textContent).toContain(
      "Restore this version",
    );
  });

  it("does not reopen confirmation after closing during preparation", async () => {
    let finishPrepare!: (value: string) => void;
    mocks.prepareRestore.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishPrepare = resolve;
        }),
    );
    await clickButton("Restore this version");
    await clickButton("Close");
    await act(async () => {
      finishPrepare("current-revision");
    });
    expect(document.querySelector('[role="alertdialog"]')).toBeNull();
    expect(mocks.restore).not.toHaveBeenCalled();
  });

  it("ignores preparation after returning to the list and selecting again", async () => {
    let finishPrepare!: (value: string) => void;
    mocks.prepareRestore.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishPrepare = resolve;
        }),
    );
    await clickButton("Restore this version");
    await clickButton("Back to history");
    await clickButton("DraftAfter");
    await act(async () => {
      finishPrepare("old-selection-revision");
    });
    expect(document.querySelector('[role="alertdialog"]')).toBeNull();
    expect(mocks.restore).not.toHaveBeenCalled();
  });

  it("ignores preparation from a page left during the save", async () => {
    let finishPrepare!: (value: string) => void;
    mocks.prepareRestore.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishPrepare = resolve;
        }),
    );
    await clickButton("Restore this version");
    await act(async () => {
      root.render(<ControlledPanel documentId="document-2" />);
    });
    await act(async () => {
      finishPrepare("old-page-revision");
    });
    expect(document.querySelector('[role="alertdialog"]')).toBeNull();
    expect(mocks.restore).not.toHaveBeenCalled();
  });

  it("does not apply an old page restore after navigation", async () => {
    let finishRestore!: (value: object) => void;
    mocks.restore.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishRestore = resolve;
        }),
    );
    await clickButton("Restore this version");
    await clickButton("Restore anyway");
    await act(async () => {
      root.render(<ControlledPanel documentId="document-2" />);
    });
    await act(async () => {
      finishRestore({
        id: "document-1",
        title: "Draft",
        content: "Earlier content",
      });
    });
    expect(mocks.onRestored).not.toHaveBeenCalled();
    expect(mocks.toastSuccess).not.toHaveBeenCalled();
    expect(mocks.onOpenChange).not.toHaveBeenCalledWith(false);
  });

  it("waits for the live editor before announcing restore success", async () => {
    let finishApply!: (value: { status: "applied" }) => void;
    mocks.onRestored.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishApply = resolve;
        }),
    );
    await clickButton("Restore this version");
    await clickButton("Restore anyway");
    expect(mocks.toastSuccess).not.toHaveBeenCalled();
    expect(mocks.onOpenChange).not.toHaveBeenCalledWith(false);
    await act(async () => {
      finishApply({ status: "applied" });
    });
    expect(mocks.toastSuccess).toHaveBeenCalledTimes(1);
    expect(mocks.onOpenChange).toHaveBeenCalledWith(false);
  });

  it("does not retry a committed restore when the editor cannot apply it", async () => {
    mocks.onRestored.mockResolvedValueOnce({
      status: "committed-editor-refresh-required",
    });
    await clickButton("Restore this version");
    await clickButton("Restore anyway");
    expect(document.querySelector('[role="alertdialog"]')).toBeNull();
    expect(mocks.toastSuccess).not.toHaveBeenCalled();
    expect(mocks.toastError).toHaveBeenCalledWith(
      "editor.historyRestoreAppliedRefreshFailed",
    );
    expect(mocks.onOpenChange).not.toHaveBeenCalledWith(false);
    expect(
      document.querySelector('[data-testid="history-preview"]')?.textContent,
    ).toBe("Earlier content");
    const restore = Array.from(document.querySelectorAll("button")).find(
      (button) => button.textContent?.trim() === "Restore this version",
    );
    expect(restore?.disabled).toBe(true);
    expect(mocks.restore).toHaveBeenCalledTimes(1);
  });

  it("keeps a failed restore open for retry and closes after success", async () => {
    mocks.restore.mockRejectedValueOnce(new Error("temporary failure"));
    await clickButton("Restore this version");
    await clickButton("Restore anyway");

    expect(mocks.restore).toHaveBeenNthCalledWith(1, {
      documentId: "document-1",
      versionId: "version-1",
      expectedUpdatedAt: "current-revision",
    });
    expect(document.querySelector('[role="alertdialog"]')).toBeNull();
    expect(document.body.textContent).toContain("editor.versionRestoreFailed");
    expect(
      document.querySelector('[data-testid="history-preview"]')?.textContent,
    ).toBe("Earlier content");
    expect(mocks.onOpenChange).not.toHaveBeenCalledWith(false);

    await clickButton("Restore this version");
    await clickButton("Restore anyway");
    expect(mocks.prepareRestore).toHaveBeenCalledTimes(2);

    expect(mocks.restore).toHaveBeenCalledTimes(2);
    expect(mocks.onOpenChange).toHaveBeenCalledWith(false);
    expect(mocks.onRestored).toHaveBeenCalledTimes(1);
  });
});

describe("VersionHistoryPanel group titles", () => {
  it("names the changes a GitHub sync brought in", async () => {
    (
      globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    const original = mocks.historyPage.data;
    mocks.historyPage.data = {
      ...original,
      groups: [
        {
          ...original.groups[0]!,
          id: "group-github",
          kind: "operation",
          actorEmail: null,
          actorKind: "source",
          origin: "github",
          operation: "sync-github-source",
        },
      ],
    };
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    try {
      await act(async () => {
        root.render(<ControlledPanel />);
        await Promise.resolve();
      });
      // The panel renders in a portal on the body.
      expect(document.body.textContent).toContain("editor.historyGroupGitHub");
    } finally {
      act(() => root.unmount());
      container.remove();
      mocks.historyPage.data = original;
    }
  });
});

describe("VersionHistoryPanel changes and undo", () => {
  let container: HTMLDivElement;
  let root: Root;
  const original = mocks.historyPage.data;
  const personGroup: DocumentHistoryGroup = {
    id: "group-1",
    kind: "human_session",
    actorEmail: "alice@example.com",
    actorKind: "human",
    origin: "ui",
    operation: "update-document",
    startedAt: "2026-09-08T10:00:00.000Z",
    endedAt: "2026-09-08T10:05:00.000Z",
    checkpointCount: 1,
    latestCheckpointId: "version-1",
  };
  const agentGroup: DocumentHistoryGroup = {
    ...personGroup,
    id: "group-agent",
    kind: "agent_run",
    actorEmail: "agent@example.com",
    actorKind: "agent",
    origin: "mcp",
    operation: "edit-document",
  };

  async function renderWith(groups: DocumentHistoryGroup[]) {
    mocks.historyPage.data = { ...original, groups };
    await act(async () => {
      root.render(<ControlledPanel />);
      await Promise.resolve();
    });
  }

  function sectionTexts() {
    return Array.from(document.querySelectorAll("section")).map(
      (section) => section.textContent,
    );
  }

  beforeEach(() => {
    (
      globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    mocks.prepareRestore.mockClear();
    mocks.undo.mockReset();
    mocks.undo.mockResolvedValue({
      id: "document-1",
      title: "Plan",
      content: "One\nTwo",
      outcome: "undone",
      undoGroupId: "undo:1",
      keptBack: [],
    });
    mocks.onOpenChange.mockClear();
    mocks.onRestored.mockReset();
    mocks.onRestored.mockResolvedValue({ status: "applied" });
    mocks.toastSuccess.mockClear();
    mocks.toastError.mockClear();
    mocks.toastInfo.mockClear();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    document.body.replaceChildren();
    mocks.historyPage.data = original;
    (
      globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = false;
  });

  it("shows an agent run's change before and after, then undoes it", async () => {
    await renderWith([agentGroup]);
    await clickButton("Agent run", false);
    await clickButton("View changes");

    expect(sectionTexts()).toEqual([
      "BeforeOne\nTwo",
      "AfterOne\nTwo by agent",
    ]);
    expect(
      Array.from(document.querySelectorAll("mark")).map(
        (mark) => mark.textContent,
      ),
    ).toEqual([" by agent"]);
    expect(document.activeElement?.textContent).toContain("Back to history");

    await clickButton("Undo these changes");
    expect(mocks.prepareRestore).toHaveBeenCalledOnce();
    expect(mocks.undo).toHaveBeenCalledWith({
      documentId: "document-1",
      groupId: "group-agent",
      idempotencyKey: expect.any(String),
    });
    expect(mocks.onRestored).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: "undone", content: "One\nTwo" }),
    );
    expect(mocks.toastSuccess).toHaveBeenCalledWith(
      "editor.historyChangesUndone",
    );
    expect(mocks.onOpenChange).toHaveBeenCalledWith(false);
  });

  it("retries a failed undo with the same key", async () => {
    mocks.undo.mockRejectedValueOnce(new Error("temporary failure"));
    await renderWith([agentGroup]);
    await clickButton("Agent run", false);
    await clickButton("View changes");
    await clickButton("Undo these changes");
    expect(document.body.textContent).toContain("editor.historyUndoFailed");
    expect(mocks.onOpenChange).not.toHaveBeenCalledWith(false);

    await clickButton("Undo these changes");
    expect(mocks.undo).toHaveBeenCalledTimes(2);
    const keys = mocks.undo.mock.calls.map(
      (call) =>
        ((call as unknown[])[0] as { idempotencyKey: string }).idempotencyKey,
    );
    expect(new Set(keys).size).toBe(1);
    expect(mocks.onOpenChange).toHaveBeenCalledWith(false);
  });

  it("shows the blocks a partial undo kept as they are and stays open", async () => {
    mocks.undo.mockResolvedValueOnce({
      id: "document-1",
      title: "Plan",
      content: "One\nThree by person",
      outcome: "partly-undone",
      undoGroupId: "undo:1",
      keptBack: [{ changedTo: "Three by agent", changedFrom: "Three" }],
    });
    await renderWith([agentGroup]);
    await clickButton("Agent run", false);
    await clickButton("View changes");
    await clickButton("Undo these changes");

    expect(mocks.onRestored).toHaveBeenCalledOnce();
    expect(mocks.toastInfo).toHaveBeenCalledWith("editor.historyUndoPartly");
    expect(mocks.toastSuccess).not.toHaveBeenCalled();
    expect(mocks.onOpenChange).not.toHaveBeenCalledWith(false);
    expect(document.body.textContent).toContain("editor.historyUndoPartly");
    expect(sectionTexts()).toEqual(["BeforeThree", "AfterThree by agent"]);
    expect(
      Array.from(document.querySelectorAll("button")).some(
        (button) => button.textContent.trim() === "Undo these changes",
      ),
    ).toBe(false);
    expect(document.activeElement?.textContent).toContain("Back to history");
  });

  it("stays open without applying anything when the changes are already undone", async () => {
    mocks.undo.mockResolvedValueOnce({
      id: "document-1",
      title: "Plan",
      content: "One\nTwo",
      outcome: "already-undone",
      keptBack: [],
    });
    await renderWith([agentGroup]);
    await clickButton("Agent run", false);
    await clickButton("View changes");
    await clickButton("Undo these changes");

    expect(mocks.onRestored).not.toHaveBeenCalled();
    expect(mocks.toastInfo).toHaveBeenCalledWith(
      "editor.historyUndoAlreadyDone",
    );
    expect(mocks.onOpenChange).not.toHaveBeenCalledWith(false);
  });

  it("lets a person's session be viewed but not undone", async () => {
    await renderWith([personGroup]);
    await clickButton("Editing session", false);
    await clickButton("View changes");
    expect(sectionTexts()).toHaveLength(2);
    expect(
      Array.from(document.querySelectorAll("button")).some(
        (button) => button.textContent.trim() === "Undo these changes",
      ),
    ).toBe(false);
  });

  it("offers no change view for earlier edits", async () => {
    await renderWith([{ ...personGroup, id: "group-legacy", kind: "legacy" }]);
    await clickButton("Earlier edits", false);
    expect(document.body.textContent).toContain("DraftAfter");
    expect(document.body.textContent).not.toContain("View changes");
  });

  it("names an undo by an agent and by a person", async () => {
    await renderWith([
      {
        ...agentGroup,
        id: "group-agent-undo",
        operation: "undo-document-change",
      },
      {
        ...personGroup,
        id: "group-undo",
        kind: "operation",
        operation: "undo-document-change",
      },
    ]);
    expect(document.body.textContent).toContain("editor.historyGroupAgentUndo");
    expect(document.body.textContent).toContain("editor.historyGroupUndo");
  });
});
