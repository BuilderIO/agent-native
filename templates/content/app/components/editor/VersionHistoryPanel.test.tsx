// @vitest-environment happy-dom

import type {
  DocumentHistoryCheckpointPage,
  DocumentHistoryPage,
  DocumentVersionComparison,
} from "@shared/document-history";
import { act, useState, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { mocks } = vi.hoisted(() => ({
  mocks: {
    setClientAppState: vi.fn(async () => null),
    prepareRestore: vi.fn(async () => "current-revision"),
    restore: vi.fn(async () => ({})),
    onOpenChange: vi.fn(),
    onRestored: vi.fn(),
    nameVersion: vi.fn(),
    toastSuccess: vi.fn(),
    toastError: vi.fn(),
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
            name: null,
            namedBy: null,
            namedAt: null,
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
    namedVersions: {
      data: { versions: [] as unknown[] },
      error: null,
      refetch: vi.fn(),
    },
    comparison: {
      data: undefined as DocumentVersionComparison | undefined,
      error: null,
      isLoading: false,
      refetch: vi.fn(),
    },
    comparedVersionIds: [] as Array<string | null>,
    detailName: null as string | null,
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
      "editor.historyCheckpointAfter": "After",
      "editor.historyLoadMore": "Load more",
      "editor.historyLoadingMore": "Loading more",
      "editor.historyNameCurrentVersion": "Name current version",
      "editor.historyNameVersion": "Name this version",
      "editor.historyNamedVersions": "Named versions",
      "editor.historyAllChanges": "All changes",
      "editor.historyRenameVersion": "Rename",
      "editor.historyRemoveVersionName": "Remove name",
      "editor.historySaveVersionName": "Save name",
      "editor.historyVersionNameLabel": "Version name",
      "editor.historyPreview": "Preview",
      "editor.historyCompareWithCurrent": "Compare with current",
      "editor.historyCompareIdentical":
        "This version matches the current page.",
    })[key] ?? key,
}));

vi.mock("sonner", () => ({
  toast: { success: mocks.toastSuccess, error: mocks.toastError },
}));

vi.mock("@/components/ui/tooltip", () => ({
  Tooltip: ({ children }: { children: ReactNode }) => children,
  TooltipContent: () => null,
  TooltipTrigger: ({ children }: { children: ReactNode }) => children,
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
            name: mocks.detailName,
            namedBy: null,
            namedAt: null,
            content: "Earlier content",
          },
        }
      : undefined,
    error: null,
    isLoading: false,
    refetch: vi.fn(),
  }),
  useNamedDocumentVersions: () => mocks.namedVersions,
  useDocumentVersionComparison: (
    documentId: string | null,
    versionId: string | null,
  ) => {
    if (!documentId) {
      return {
        data: undefined,
        error: null,
        isLoading: false,
        refetch: vi.fn(),
      };
    }
    mocks.comparedVersionIds.push(versionId);
    return mocks.comparison;
  },
  useNameDocumentVersion: () => ({
    mutateAsync: mocks.nameVersion,
    isPending: false,
  }),
  useRestoreDocumentVersion: () => ({
    mutateAsync: mocks.restore,
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
  canRestore = true,
}: {
  documentId?: string;
  restoreReady?: boolean;
  canRestore?: boolean;
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
      canRestore={canRestore}
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
          name: null,
          namedBy: null,
          namedAt: null,
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
            name: null,
            namedBy: null,
            namedAt: null,
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
          name: null,
          namedBy: null,
          namedAt: null,
        },
        {
          id: "version-1",
          documentId: "document-1",
          groupId: "group-1",
          title: "Draft",
          checkpointKind: "after",
          createdAt: "2026-09-08T10:05:00.000Z",
          name: null,
          namedBy: null,
          namedAt: null,
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

describe("VersionHistoryPanel named versions", () => {
  let container: HTMLDivElement;
  let root: Root;
  const namedVersion = {
    id: "version-1",
    title: "Draft",
    createdAt: "2026-09-08T10:05:00.000Z",
    name: "Week of Sep 7",
    namedBy: "alice@example.com",
    namedAt: "2026-09-08T11:00:00.000Z",
  };

  function nameResult(id: string, name: string | null) {
    return {
      checkpoint: {
        id,
        documentId: "document-1",
        groupId: "group-1",
        title: "Draft",
        checkpointKind: "after",
        createdAt: "2026-09-08T10:05:00.000Z",
        name,
        namedBy: name ? "alice@example.com" : null,
        namedAt: name ? "2026-09-08T11:00:00.000Z" : null,
      },
      created: id !== "version-1",
    };
  }

  async function render(props: { canRestore?: boolean } = {}) {
    await act(async () => {
      root.render(<ControlledPanel {...props} />);
      await Promise.resolve();
    });
  }

  function nameInput() {
    return document.querySelector(
      'input[aria-label="Version name"]',
    ) as HTMLInputElement | null;
  }

  function openNameInput() {
    const input = nameInput();
    if (!input) throw new Error(`No name input in ${document.body.innerHTML}`);
    return input;
  }

  async function typeName(value: string) {
    const input = openNameInput();
    const setValue = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )?.set;
    if (!setValue) throw new Error("The input value setter is missing.");
    await act(async () => {
      setValue.call(input, value);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
  }

  async function pressEscape(target: Element) {
    await act(async () => {
      target.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Escape",
          bubbles: true,
          cancelable: true,
        }),
      );
    });
  }

  beforeEach(() => {
    (
      globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    mocks.nameVersion.mockReset();
    mocks.onOpenChange.mockClear();
    mocks.toastSuccess.mockClear();
    mocks.setClientAppState.mockClear();
    mocks.namedVersions.data = { versions: [] };
    mocks.comparison.data = undefined;
    mocks.comparedVersionIds.length = 0;
    mocks.detailName = null;
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    document.body.replaceChildren();
    (
      globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = false;
  });

  it("lists named versions above all changes and opens one in place", async () => {
    mocks.namedVersions.data = { versions: [namedVersion] };
    mocks.detailName = namedVersion.name;
    await render();
    const text = document.body.textContent;
    expect(text.indexOf("Named versions")).toBeGreaterThan(-1);
    expect(text.indexOf("Named versions")).toBeLessThan(
      text.indexOf("All changes"),
    );
    expect(text.indexOf("All changes")).toBeLessThan(
      text.indexOf("Editing session"),
    );

    await clickButton("Week of Sep 7", false);
    expect(
      document.querySelector("[data-testid=history-preview]")?.textContent,
    ).toBe("Earlier content");
    expect(document.body.textContent).toContain("Week of Sep 7");
    expect(document.body.textContent).toContain("Rename");
  });

  it("names the page as it is now and returns focus to the button", async () => {
    mocks.nameVersion.mockResolvedValueOnce(
      nameResult("version-2", "Launch draft"),
    );
    await render();
    await clickButton("Name current version");
    expect(document.activeElement).toBe(nameInput());
    await typeName("  Launch draft ");
    await clickButton("Save name");

    expect(mocks.nameVersion).toHaveBeenCalledWith({
      documentId: "document-1",
      name: "Launch draft",
    });
    expect(nameInput()).toBeNull();
    expect(mocks.toastSuccess).toHaveBeenCalledTimes(1);
    expect(document.activeElement?.textContent.trim()).toBe(
      "Name current version",
    );
  });

  it("keeps the form open with the error when naming fails", async () => {
    mocks.nameVersion.mockRejectedValueOnce(new Error("taken"));
    await render();
    await clickButton("Name current version");
    await typeName("Launch draft");
    await clickButton("Save name");

    expect(nameInput()?.value).toBe("Launch draft");
    expect(document.querySelector('[role="alert"]')?.textContent).toBe(
      "editor.historyVersionNameFailed",
    );
    expect(nameInput()?.getAttribute("aria-invalid")).toBe("true");
  });

  it("says when another version already has the name", async () => {
    mocks.nameVersion.mockRejectedValueOnce(
      Object.assign(new Error("taken"), {
        errorCode: "DOCUMENT_VERSION_NAME_TAKEN",
      }),
    );
    await render();
    await clickButton("Name current version");
    await typeName("Launch draft");
    await clickButton("Save name");

    expect(document.querySelector('[role="alert"]')?.textContent).toBe(
      "editor.historyVersionNameTaken",
    );
    expect(nameInput()?.value).toBe("Launch draft");
  });

  it("Escape cancels the name form without closing the panel", async () => {
    await render();
    await clickButton("Name current version");
    await pressEscape(openNameInput());

    expect(nameInput()).toBeNull();
    expect(mocks.onOpenChange).not.toHaveBeenCalledWith(false);
    expect(mocks.nameVersion).not.toHaveBeenCalled();
    expect(document.activeElement?.textContent.trim()).toBe(
      "Name current version",
    );
  });

  it("names, then removes the name of, the selected version", async () => {
    await render();
    await clickButton("Editing session", false);
    await clickButton("DraftAfter");

    mocks.nameVersion.mockResolvedValueOnce(
      nameResult("version-1", "Week of Sep 7"),
    );
    await clickButton("Name this version");
    await typeName("Week of Sep 7");
    await clickButton("Save name");
    expect(mocks.nameVersion).toHaveBeenLastCalledWith({
      documentId: "document-1",
      versionId: "version-1",
      name: "Week of Sep 7",
    });
    expect(document.body.textContent).toContain("Week of Sep 7");
    expect(document.activeElement?.textContent.trim()).toBe("Rename");

    mocks.nameVersion.mockResolvedValueOnce(nameResult("version-1", null));
    const remove = document.querySelector(
      'button[aria-label="Remove name"]',
    ) as HTMLButtonElement;
    await act(async () => {
      remove.click();
      await Promise.resolve();
    });
    expect(mocks.nameVersion).toHaveBeenLastCalledWith({
      documentId: "document-1",
      versionId: "version-1",
      name: "",
    });
    expect(document.querySelector('button[aria-label="Remove name"]')).toBe(
      null,
    );
    expect(document.activeElement?.textContent.trim()).toBe(
      "Name this version",
    );
  });

  it("shows a new name in the loaded history list", async () => {
    await render();
    await clickButton("Editing session", false);
    await clickButton("DraftAfter");

    mocks.nameVersion.mockResolvedValueOnce(
      nameResult("version-1", "Week of Sep 7"),
    );
    await clickButton("Name this version");
    await typeName("Week of Sep 7");
    await clickButton("Save name");
    await clickButton("Back to history");

    await clickButton("Week of Sep 7After");
    expect(document.body.textContent).toContain("Week of Sep 7");
  });

  it("compares the selected version with the current page", async () => {
    const comparisonData: DocumentVersionComparison = {
      from: {
        kind: "checkpoint",
        id: "version-1",
        name: null,
        title: "Draft",
        at: "2026-09-08T10:05:00.000Z",
      },
      to: {
        kind: "current",
        id: null,
        name: null,
        title: "Final",
        at: "2026-09-09T10:05:00.000Z",
      },
      identical: false,
      title: { before: "Draft", after: "Final" },
      body: {
        hunks: [
          {
            lines: [
              { kind: "removed", text: "Earlier content" },
              { kind: "added", text: "Current content" },
            ],
            omittedLineCount: 0,
          },
        ],
        omittedHunkCount: 0,
        addedLineCount: 1,
        removedLineCount: 1,
      },
    };
    mocks.comparison.data = comparisonData;
    await render();
    await clickButton("Editing session", false);
    await clickButton("DraftAfter");
    expect(mocks.comparedVersionIds).toEqual([]);

    const compare = await clickButton("Compare with current");
    expect(compare.getAttribute("aria-pressed")).toBe("true");
    expect(mocks.comparedVersionIds).toContain("version-1");
    expect(document.querySelector("[data-testid=history-preview]")).toBeNull();
    expect(document.body.textContent).toContain("Current content");
    expect(document.body.textContent).toContain("Final");
    expect(mocks.setClientAppState).toHaveBeenLastCalledWith(
      "content-history:document-1",
      expect.objectContaining({
        selectedCheckpointId: "version-1",
        selectedCheckpointView: "compare",
      }),
      expect.anything(),
    );

    mocks.comparison.data = { ...comparisonData, identical: true };
    await render();
    expect(document.body.textContent).toContain(
      "This version matches the current page.",
    );
  });

  it("hides naming from people who cannot edit", async () => {
    mocks.namedVersions.data = { versions: [namedVersion] };
    mocks.detailName = namedVersion.name;
    await render({ canRestore: false });
    expect(document.body.textContent).toContain("Week of Sep 7");
    expect(document.body.textContent).not.toContain("Name current version");
    await clickButton("Week of Sep 7", false);
    expect(document.body.textContent).not.toContain("Rename");
  });
});
