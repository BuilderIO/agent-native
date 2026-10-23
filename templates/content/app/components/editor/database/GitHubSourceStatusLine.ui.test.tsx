// @vitest-environment happy-dom
import type {
  ContentDatabaseSource,
  ContentGitHubSourceStatus,
} from "@shared/api";
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { SyncGitHubFolderResponse } from "@/hooks/use-github-folder";
import { click, renderUi } from "@/test-utils/render-ui";

type MutateOptions<T> = {
  onSuccess?: (response: T) => void;
  onError?: (error: unknown) => void;
};

const sync = vi.hoisted(() => ({
  mutate: vi.fn(),
  mutateAsync: vi.fn(),
  isPending: false,
}));
const unlink = vi.hoisted(() => ({
  mutate: vi.fn(),
  isPending: false,
}));
const toasts = vi.hoisted(() => {
  const toast = Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() });
  return { toast };
});
const oauth = vi.hoisted(() => ({ start: vi.fn() }));

vi.mock("@agent-native/core/client/integrations", () => ({
  startWorkspaceProviderOAuth: oauth.start,
}));
/** The refreshes the open-collection fill asked for, in order. */
const refreshes = vi.hoisted(() => [] as string[]);
vi.mock("@/hooks/use-github-folder", () => ({
  useSyncGitHubFolder: () => sync,
  useRefreshAfterGitHubFolder: () => (action: string) => refreshes.push(action),
}));
vi.mock("@/hooks/use-content-database", () => ({
  useDisconnectContentDatabaseSource: () => unlink,
}));
vi.mock("sonner", () => ({ toast: toasts.toast }));

import { GitHubSourceStatusLine } from "./GitHubSourceStatusLine";

const SYNCED_SHA = "65b1d83c0ffee0000000000000000000000000000";
const FOLDER_URL = "https://github.com/acme/handbook/tree/main/docs";

function githubSource(
  status: Partial<ContentGitHubSourceStatus> = {},
): ContentDatabaseSource {
  return {
    id: "source-1",
    databaseId: "database-1",
    sourceType: "github",
    sourceName: "acme/handbook/docs",
    metadata: {
      github: {
        owner: "acme",
        repo: "handbook",
        branch: "main",
        path: "docs",
        folderUrl: FOLDER_URL,
        mode: "view_only",
        syncedCommitSha: SYNCED_SHA,
        syncedAt: new Date(Date.now() - 2 * 60_000).toISOString(),
        checkedAt: null,
        pendingCommitSha: null,
        progress: null,
        files: 4,
        skipped: [],
        skippedCount: status.skipped?.length ?? 0,
        imagesWaiting: 0,
        imagesFailed: false,
        problem: null,
        ...status,
      },
    },
  } as unknown as ContentDatabaseSource;
}

function problem(
  code: NonNullable<ContentGitHubSourceStatus["problem"]>["code"],
): ContentGitHubSourceStatus["problem"] {
  return { code, message: "From the server", at: new Date().toISOString() };
}

function statusLine() {
  const element = document.querySelector<HTMLElement>(
    "[data-github-source-status]",
  );
  if (!element) throw new Error("No GitHub status line");
  return element;
}

function button(name: string) {
  const match = Array.from(document.querySelectorAll("button")).find(
    (candidate) => candidate.textContent?.trim() === name,
  );
  if (!match) throw new Error(`No "${name}" button`);
  return match;
}

function queryButton(name: string) {
  return (
    Array.from(document.querySelectorAll("button")).find(
      (candidate) => candidate.textContent?.trim() === name,
    ) ?? null
  );
}

function syncResult(
  overrides: Partial<SyncGitHubFolderResponse["sync"]>,
): SyncGitHubFolderResponse {
  return {
    database: {} as SyncGitHubFolderResponse["database"],
    source: null,
    summary: "",
    sync: {
      state: "synced",
      commitSha: "abcdef1234567",
      created: 0,
      updated: 1,
      renamed: 0,
      trashed: 0,
      remaining: 0,
      problem: null,
      ...overrides,
    },
  };
}

function renderLine(
  source: ContentDatabaseSource | null,
  {
    canEdit = true,
    pageCount = 4,
    onOpenSource,
  }: { canEdit?: boolean; pageCount?: number; onOpenSource?: () => void } = {},
) {
  renderUi(
    <GitHubSourceStatusLine
      source={source}
      documentId="doc-1"
      canEdit={canEdit}
      pageCount={pageCount}
      onOpenSource={onOpenSource}
    />,
  );
}

async function checkForUpdates(response: SyncGitHubFolderResponse) {
  await click(button("Details"));
  await click(button("Check for updates"));
  const [variables, options] = sync.mutate.mock.calls[0] as [
    { databaseId: string },
    MutateOptions<SyncGitHubFolderResponse>,
  ];
  expect(variables).toEqual({ databaseId: "database-1" });
  await act(async () => options.onSuccess?.(response));
}

describe("GitHub source status line", () => {
  beforeEach(() => {
    sync.mutate.mockReset();
    sync.isPending = false;
    sync.mutateAsync.mockReset();
    sync.mutateAsync.mockReturnValue(new Promise(() => {}));
    unlink.mutate.mockReset();
    unlink.isPending = false;
    oauth.start.mockReset();
    toasts.toast.mockReset();
    toasts.toast.success.mockReset();
    toasts.toast.error.mockReset();
  });

  it("says where the pages come from in one line, with the folder in bold", () => {
    renderLine(githubSource());
    const line = statusLine();
    expect(line.textContent).toContain("From the docs folder on GitHub");
    expect(line.querySelector("strong")?.textContent).toBe("docs");
    expect(line.textContent).toContain("Updated 2 minutes ago");
    expect(line.textContent).not.toContain(SYNCED_SHA.slice(0, 7));
    const edit = Array.from(line.querySelectorAll("a")).find((link) =>
      link.textContent?.includes("Edit on GitHub"),
    );
    expect(edit?.getAttribute("href")).toBe(FOLDER_URL);
    expect(line.querySelector('[role="alert"]')).toBe(null);
  });

  it("opens the folder's page in Sources from where the pages come from", async () => {
    const onOpenSource = vi.fn();
    renderLine(githubSource(), { onOpenSource });
    await click(button("From the docs folder on GitHub"));
    expect(onOpenSource).toHaveBeenCalledTimes(1);
  });

  it("keeps where the pages come from as plain text with no Sources to open", () => {
    renderLine(githubSource());
    expect(queryButton("From the docs folder on GitHub")).toBe(null);
  });

  it("names the repository when the whole repository is linked", () => {
    renderLine(githubSource({ path: "" }));
    expect(statusLine().textContent).toContain("From handbook on GitHub");
  });

  it("says just now for an update under a minute old", () => {
    renderLine(githubSource({ syncedAt: new Date().toISOString() }));
    expect(statusLine().textContent).toContain("Updated just now");
  });

  it("lists files that won't show, and why, from a count on the line", async () => {
    renderLine(
      githubSource({ skipped: [{ path: "demo.mdx", reason: "mdx" }] }),
    );
    await click(button("1 file not shown"));
    expect(document.body.textContent).toContain(
      "demo.mdxUses MDX, which Content can’t show yet",
    );
  });

  it("keeps the folder's details, Check for updates and Unlink behind Details", async () => {
    renderLine(githubSource());
    expect(queryButton("Check for updates")).toBe(null);
    await click(button("Details"));
    const text = document.body.textContent ?? "";
    expect(text).toContain("Folderacme/handbook/docs");
    expect(text).toContain("Branchmain");
    expect(text).toContain("Version65b1d83");
    expect(queryButton("Check for updates")).not.toBe(null);
    expect(queryButton("Unlink folder…")).not.toBe(null);
  });

  it("doesn't offer Unlink to people who can't edit the collection", async () => {
    renderLine(githubSource(), { canEdit: false });
    await click(button("Details"));
    expect(queryButton("Check for updates")).not.toBe(null);
    expect(queryButton("Unlink folder…")).toBe(null);
  });

  it.each([
    [{ state: "unchanged" as const, updated: 0 }, "Up to date."],
    [{ state: "synced" as const, updated: 0 }, "Up to date."],
    [{ state: "synced" as const, updated: 1 }, "Updated. 1 page changed."],
    [
      { state: "synced" as const, created: 2, updated: 1 },
      "Updated. 3 pages changed.",
    ],
  ])("says how a check for updates went: %o", async (sync, said) => {
    renderLine(githubSource());
    await checkForUpdates(syncResult(sync));
    expect(toasts.toast.success).toHaveBeenCalledWith(said);
  });

  it("says a failed check for updates as the problem it hit", async () => {
    renderLine(githubSource());
    await checkForUpdates(
      syncResult({
        state: "error",
        problem: { code: "branch_not_found", message: "Gone." },
      }),
    );
    expect(toasts.toast.error).toHaveBeenCalledWith(
      "Stopped updating: the “main” branch is gone from GitHub.",
    );
  });

  it("puts a stopping problem on its own red line, with what to do about it", () => {
    renderLine(githubSource({ problem: problem("folder_not_found") }));
    const alert = document.querySelector<HTMLElement>('[role="alert"]');
    expect(alert?.textContent).toContain(
      "Stopped updating: the “docs” folder is gone from that branch. Showing pages as of 2 minutes ago.",
    );
    expect(alert?.textContent).toContain("Open in GitHub");
    expect(alert?.textContent).toContain("Unlink folder…");
    expect(statusLine().textContent).not.toContain("Updated 2 minutes ago");
  });

  it("offers Reconnect GitHub when the connection stopped updates", async () => {
    renderLine(githubSource({ problem: problem("connection") }));
    await click(button("Reconnect GitHub"));
    expect(oauth.start).toHaveBeenCalledWith(
      "github",
      expect.objectContaining({ appId: "content", scope: "user" }),
    );
  });

  it.each(["rate_limited", "unavailable", "sync_failed"] as const)(
    "calls %s a pause that resolves itself, not an alarm",
    (code) => {
      renderLine(githubSource({ problem: problem(code) }));
      expect(document.querySelector('[role="alert"]')).toBe(null);
      expect(statusLine().textContent).toContain(
        "Updates are paused for a moment. They’ll resume on their own.",
      );
      expect(statusLine().textContent).toContain("Updated 2 minutes ago");
    },
  );

  it("notes pictures waiting on file storage without calling it a stop", () => {
    renderLine(githubSource({ problem: problem("storage_unavailable") }));
    expect(document.querySelector('[role="alert"]')).toBe(null);
    expect(statusLine().textContent).toContain(
      "Some pictures won’t show until a workspace admin sets up file storage.",
    );
  });

  it("says when file storage is set up but couldn't save pictures", () => {
    renderLine(
      githubSource({ problem: problem("storage_failed"), imagesWaiting: 2 }),
    );
    expect(document.querySelector('[role="alert"]')).toBe(null);
    expect(statusLine().textContent).toContain(
      "Some pictures couldn’t be saved to file storage. Each sync tries them again.",
    );
    expect(statusLine().textContent).not.toContain("sets up file storage");
    expect(statusLine().textContent).not.toContain("Updates are paused");
  });

  it("still says storage couldn't save pictures when another problem stopped the sync", () => {
    renderLine(
      githubSource({
        problem: problem("unavailable"),
        imagesWaiting: 1,
        imagesFailed: true,
      }),
    );
    expect(statusLine().textContent).toContain(
      "Some pictures couldn’t be saved to file storage.",
    );
    expect(statusLine().textContent).not.toContain("sets up file storage");
    // The problem that stopped the sync still shows too.
    expect(statusLine().textContent).toContain(
      "Updates are paused for a moment.",
    );
  });

  it("asks for file storage once it's gone, even after it failed", () => {
    renderLine(
      githubSource({
        problem: problem("storage_unavailable"),
        imagesWaiting: 1,
        imagesFailed: true,
      }),
    );
    expect(statusLine().textContent).toContain(
      "Some pictures won’t show until a workspace admin sets up file storage.",
    );
    expect(statusLine().textContent).not.toContain("couldn’t be saved");
  });

  it("doesn't ask for file storage while a sync adds pictures once it's set up", () => {
    renderLine(
      githubSource({
        imagesWaiting: 3,
        pendingCommitSha: "abcdef1234567",
        progress: { done: 40, total: 120 },
      }),
    );
    expect(statusLine().textContent).toContain(
      "Bringing in changes: 40 of 120 files",
    );
    expect(statusLine().textContent).not.toContain("sets up file storage");
    expect(statusLine().textContent).not.toContain("couldn’t be saved");
  });

  it("shows how far an update has got", () => {
    renderLine(
      githubSource({
        pendingCommitSha: "abcdef1234567",
        progress: { done: 40, total: 120 },
      }),
    );
    expect(statusLine().textContent).toContain(
      "Bringing in changes: 40 of 120 files",
    );
  });

  it("asks before unlinking, then says the pages are kept", async () => {
    renderLine(githubSource());
    await click(button("Details"));
    await click(button("Unlink folder…"));
    const text = document.body.textContent ?? "";
    expect(text).toContain("Unlink this GitHub folder?");
    expect(text).toContain(
      "The 4 pages stay here and become normal pages you can edit.",
    );
    expect(unlink.mutate).not.toHaveBeenCalled();

    await click(button("Unlink"));
    const [variables, options] = unlink.mutate.mock.calls[0] as [
      unknown,
      MutateOptions<unknown>,
    ];
    expect(variables).toEqual({ documentId: "doc-1", sourceId: "source-1" });
    await act(async () => options.onSuccess?.({}));
    expect(toasts.toast.success).toHaveBeenCalledWith(
      "Unlinked. Your pages are kept and you can edit them now.",
    );
  });

  it("shows nothing for a collection that doesn't come from GitHub", () => {
    renderLine({
      ...githubSource(),
      sourceType: "builder-cms",
    } as ContentDatabaseSource);
    expect(document.querySelector("[data-github-source-status]")).toBe(null);
  });
});

describe("Filling while the collection is open", () => {
  const filling = () =>
    githubSource({
      pendingCommitSha: "abcdef1234567",
      progress: { done: 40, total: 120 },
    });

  function deferred<T>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>((done) => {
      resolve = done;
    });
    return { promise, resolve };
  }

  function showTab(visibility: DocumentVisibilityState) {
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => visibility,
    });
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
  }

  /** Lets every sync that's ready to start, start. */
  async function settle() {
    for (let turn = 0; turn < 5; turn++) {
      await act(async () => {});
    }
  }

  function expectNoToasts() {
    expect(toasts.toast).not.toHaveBeenCalled();
    expect(toasts.toast.success).not.toHaveBeenCalled();
    expect(toasts.toast.error).not.toHaveBeenCalled();
  }

  beforeEach(() => {
    sync.mutateAsync.mockReset();
    sync.mutateAsync.mockReturnValue(new Promise(() => {}));
    refreshes.length = 0;
    toasts.toast.mockReset();
    toasts.toast.success.mockReset();
    toasts.toast.error.mockReset();
    showTab("visible");
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("asks for the next part as soon as the last one comes back, without toasts", async () => {
    sync.mutateAsync
      .mockResolvedValueOnce(syncResult({ state: "partial", remaining: 80 }))
      .mockResolvedValueOnce(
        syncResult({
          state: "partial",
          remaining: 40,
          problem: problem("storage_unavailable"),
        }),
      )
      .mockResolvedValueOnce(syncResult({ state: "synced" }));
    renderLine(filling());
    await settle();
    expect(sync.mutateAsync).toHaveBeenCalledTimes(3);
    expect(sync.mutateAsync).toHaveBeenCalledWith({ databaseId: "database-1" });
    expectNoToasts();
  });

  it.each([
    ["the folder is current", syncResult({ state: "synced" })],
    ["nothing changed", syncResult({ state: "unchanged" })],
  ])("stops when %s", async (_why, result) => {
    vi.useFakeTimers();
    sync.mutateAsync.mockResolvedValue(result);
    renderLine(filling());
    await settle();
    await act(async () => {
      vi.advanceTimersByTime(30 * 60_000);
    });
    await settle();
    expect(sync.mutateAsync).toHaveBeenCalledTimes(1);
    expectNoToasts();
  });

  /** Moves the clock on, then lets the syncs that are due start. */
  async function after(ms: number) {
    await act(async () => {
      vi.advanceTimersByTime(ms);
    });
    await settle();
  }

  it("waits a minute after a part that got no further, so the background sync can take it, and longer each time", async () => {
    vi.useFakeTimers();
    // The status says 80 files are left; each part leaves them all.
    const stuck = syncResult({ state: "partial", updated: 0, remaining: 80 });
    sync.mutateAsync
      .mockResolvedValueOnce(stuck)
      .mockResolvedValueOnce(stuck)
      .mockResolvedValueOnce(stuck)
      .mockResolvedValueOnce(syncResult({ state: "partial", remaining: 20 }))
      .mockResolvedValueOnce(stuck)
      .mockResolvedValueOnce(syncResult({ state: "synced" }));
    renderLine(filling());
    await settle();
    expect(sync.mutateAsync).toHaveBeenCalledTimes(1);
    await after(59_900);
    expect(sync.mutateAsync).toHaveBeenCalledTimes(1);
    await after(100);
    expect(sync.mutateAsync).toHaveBeenCalledTimes(2);
    await after(119_900);
    expect(sync.mutateAsync).toHaveBeenCalledTimes(2);
    await after(100);
    expect(sync.mutateAsync).toHaveBeenCalledTimes(3);
    // The fourth part gets further, so the next starts at once, and the wait
    // after one that doesn't starts over at a minute.
    await after(240_000);
    expect(sync.mutateAsync).toHaveBeenCalledTimes(5);
    await after(60_000);
    expect(sync.mutateAsync).toHaveBeenCalledTimes(6);
    expectNoToasts();
  });

  it("counts a part that only skipped files as getting further", async () => {
    vi.useFakeTimers();
    sync.mutateAsync
      .mockResolvedValueOnce(
        syncResult({ state: "partial", updated: 0, remaining: 30 }),
      )
      .mockResolvedValueOnce(syncResult({ state: "synced" }));
    renderLine(filling());
    await settle();
    expect(sync.mutateAsync).toHaveBeenCalledTimes(2);
  });

  it("measures a part after an error answer against the files left before it", async () => {
    vi.useFakeTimers();
    sync.mutateAsync
      .mockResolvedValueOnce(
        syncResult({ state: "error", problem: problem("unavailable") }),
      )
      .mockResolvedValueOnce(
        syncResult({ state: "partial", updated: 0, remaining: 60 }),
      )
      .mockResolvedValueOnce(syncResult({ state: "synced" }));
    // The status says 80 files are left.
    renderLine(filling());
    await settle();
    expect(sync.mutateAsync).toHaveBeenCalledTimes(1);
    // The part after the wait only skipped files, but left 60 of the 80, so
    // the next starts at once.
    await after(60_000);
    expect(sync.mutateAsync).toHaveBeenCalledTimes(3);
  });

  it.each([
    [
      "a sync fails",
      () =>
        sync.mutateAsync.mockResolvedValueOnce(
          syncResult({ state: "error", problem: problem("unavailable") }),
        ),
    ],
    [
      "a sync throws",
      () => sync.mutateAsync.mockRejectedValueOnce(new Error("Network down")),
    ],
  ])("tries again a minute after %s", async (_why, fail) => {
    vi.useFakeTimers();
    fail();
    sync.mutateAsync.mockResolvedValueOnce(syncResult({ state: "synced" }));
    renderLine(filling());
    await settle();
    expect(sync.mutateAsync).toHaveBeenCalledTimes(1);
    await after(60_000);
    expect(sync.mutateAsync).toHaveBeenCalledTimes(2);
    expectNoToasts();
  });

  it("stops once the collection shows a problem that stops updates", async () => {
    vi.useFakeTimers();
    sync.mutateAsync.mockResolvedValue(
      syncResult({ state: "error", problem: problem("connection") }),
    );
    const { rerender } = renderUi(
      <GitHubSourceStatusLine
        source={filling()}
        documentId="doc-1"
        canEdit
        pageCount={4}
      />,
    );
    await settle();
    expect(refreshes).toEqual(["sync-github-folder"]);
    // The refresh brings the problem the sync recorded.
    rerender(
      <GitHubSourceStatusLine
        source={githubSource({
          pendingCommitSha: "abcdef1234567",
          progress: { done: 40, total: 120 },
          problem: problem("connection"),
        })}
        documentId="doc-1"
        canEdit
        pageCount={4}
      />,
    );
    await after(30 * 60_000);
    expect(sync.mutateAsync).toHaveBeenCalledTimes(1);
  });

  it("keeps trying, further apart each time, while the collection shows a problem it can retry", async () => {
    vi.useFakeTimers();
    sync.mutateAsync.mockResolvedValue(
      syncResult({ state: "error", problem: problem("rate_limited") }),
    );
    const { rerender } = renderUi(
      <GitHubSourceStatusLine
        source={filling()}
        documentId="doc-1"
        canEdit
        pageCount={4}
      />,
    );
    await settle();
    expect(sync.mutateAsync).toHaveBeenCalledTimes(1);
    // The refresh brings the problem the sync recorded.
    rerender(
      <GitHubSourceStatusLine
        source={githubSource({
          pendingCommitSha: "abcdef1234567",
          progress: { done: 40, total: 120 },
          problem: problem("rate_limited"),
        })}
        documentId="doc-1"
        canEdit
        pageCount={4}
      />,
    );
    await after(60_000);
    expect(sync.mutateAsync).toHaveBeenCalledTimes(2);
    await after(119_900);
    expect(sync.mutateAsync).toHaveBeenCalledTimes(2);
    await after(100);
    expect(sync.mutateAsync).toHaveBeenCalledTimes(3);
  });

  it("waits a minute before its first sync when the collection opens with a problem it can retry", async () => {
    vi.useFakeTimers();
    sync.mutateAsync.mockResolvedValue(syncResult({ state: "synced" }));
    renderLine(
      githubSource({
        pendingCommitSha: "abcdef1234567",
        progress: { done: 40, total: 120 },
        problem: problem("unavailable"),
      }),
    );
    await settle();
    expect(sync.mutateAsync).not.toHaveBeenCalled();
    await after(60_000);
    expect(sync.mutateAsync).toHaveBeenCalledTimes(1);
  });

  it("refreshes the collection after a part that got further, but not after a busy answer or one that got no further", async () => {
    vi.useFakeTimers();
    sync.mutateAsync
      .mockResolvedValueOnce(syncResult({ state: "partial", remaining: 70 }))
      .mockResolvedValueOnce(syncResult({ state: "busy" }))
      .mockResolvedValueOnce(
        syncResult({ state: "partial", updated: 0, remaining: 70 }),
      )
      .mockResolvedValueOnce(syncResult({ state: "synced" }));
    renderLine(filling());
    await settle();
    expect(sync.mutateAsync).toHaveBeenCalledTimes(2);
    expect(refreshes).toHaveLength(1);
    await after(2_000);
    expect(sync.mutateAsync).toHaveBeenCalledTimes(3);
    expect(refreshes).toHaveLength(1);
    await after(60_000);
    expect(sync.mutateAsync).toHaveBeenCalledTimes(4);
    expect(refreshes).toEqual(["sync-github-folder", "sync-github-folder"]);
  });

  it("waits a moment while the background sweep holds the sync", async () => {
    vi.useFakeTimers();
    sync.mutateAsync
      .mockResolvedValueOnce(syncResult({ state: "busy" }))
      .mockResolvedValueOnce(syncResult({ state: "synced" }));
    renderLine(filling());
    await settle();
    expect(sync.mutateAsync).toHaveBeenCalledTimes(1);

    await act(async () => {
      vi.advanceTimersByTime(1_900);
    });
    expect(sync.mutateAsync).toHaveBeenCalledTimes(1);
    await act(async () => {
      vi.advanceTimersByTime(100);
    });
    await settle();
    expect(sync.mutateAsync).toHaveBeenCalledTimes(2);
    expectNoToasts();
  });

  it("pauses in a hidden tab and picks up when the tab shows again", async () => {
    const first = deferred<SyncGitHubFolderResponse>();
    sync.mutateAsync
      .mockReturnValueOnce(first.promise)
      .mockResolvedValueOnce(syncResult({ state: "synced" }));
    renderLine(filling());
    await settle();
    expect(sync.mutateAsync).toHaveBeenCalledTimes(1);

    showTab("hidden");
    await act(async () => first.resolve(syncResult({ state: "partial" })));
    await settle();
    expect(sync.mutateAsync).toHaveBeenCalledTimes(1);

    showTab("visible");
    await settle();
    expect(sync.mutateAsync).toHaveBeenCalledTimes(2);
  });

  it("doesn't start in a hidden tab", async () => {
    showTab("hidden");
    renderLine(filling());
    await settle();
    expect(sync.mutateAsync).not.toHaveBeenCalled();
  });

  it("stops when the collection closes", async () => {
    const first = deferred<SyncGitHubFolderResponse>();
    sync.mutateAsync.mockReturnValueOnce(first.promise);
    const { rerender } = renderUi(
      <GitHubSourceStatusLine
        source={filling()}
        documentId="doc-1"
        canEdit
        pageCount={4}
      />,
    );
    await settle();
    rerender(null);
    await act(async () => first.resolve(syncResult({ state: "partial" })));
    await settle();
    expect(sync.mutateAsync).toHaveBeenCalledTimes(1);
  });

  it("leaves a folder alone that isn't filling or that a problem stopped", async () => {
    renderLine(githubSource());
    renderLine(
      githubSource({
        pendingCommitSha: "abcdef1234567",
        progress: { done: 40, total: 120 },
        problem: problem("connection"),
      }),
    );
    await settle();
    expect(sync.mutateAsync).not.toHaveBeenCalled();
  });
});
