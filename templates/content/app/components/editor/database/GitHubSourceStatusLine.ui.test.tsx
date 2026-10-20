// @vitest-environment happy-dom
import type {
  ContentDatabaseSource,
  ContentGitHubSourceStatus,
} from "@shared/api";
import { act } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { SyncGitHubFolderResponse } from "@/hooks/use-github-folder";
import {
  GITHUB_LINK_DIALOG_OPEN_EVENT,
  type GitHubLinkDialogRequest,
} from "@/lib/github-link-dialog";
import { click, renderUi } from "@/test-utils/render-ui";

type MutateOptions<T> = {
  onSuccess?: (response: T) => void;
  onError?: (error: unknown) => void;
};

const sync = vi.hoisted(() => ({
  mutate: vi.fn(),
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
vi.mock("@/hooks/use-github-folder", () => ({
  useSyncGitHubFolder: () => sync,
}));
vi.mock("@/hooks/use-content-database", () => ({
  useDisconnectContentDatabaseSource: () => unlink,
}));
vi.mock("sonner", () => ({ toast: toasts.toast }));

import {
  GitHubEmptyCollectionHint,
  GitHubSourceStatusLine,
} from "./GitHubSourceStatusLine";

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
  { canEdit = true, pageCount = 4 } = {},
) {
  renderUi(
    <GitHubSourceStatusLine
      source={source}
      documentId="doc-1"
      canEdit={canEdit}
      pageCount={pageCount}
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

describe("GitHub empty collection hint", () => {
  it("opens the GitHub folder dialog for this collection", async () => {
    const opened: GitHubLinkDialogRequest[] = [];
    const listen = (event: Event) =>
      opened.push((event as CustomEvent<GitHubLinkDialogRequest>).detail);
    window.addEventListener(GITHUB_LINK_DIALOG_OPEN_EVENT, listen);
    try {
      renderUi(
        <GitHubEmptyCollectionHint
          databaseId="database-1"
          documentId="doc-1"
          spaceId="space-1"
          parentId={null}
        />,
      );
      await click(button("Or fill it from a GitHub folder"));
      expect(opened).toHaveLength(1);
      expect(opened[0]?.target).toEqual({
        kind: "collection",
        databaseId: "database-1",
        documentId: "doc-1",
        spaceId: "space-1",
        parentId: null,
      });
      expect(opened[0]?.returnFocusTo?.textContent).toBe(
        "Or fill it from a GitHub folder",
      );
    } finally {
      window.removeEventListener(GITHUB_LINK_DIALOG_OPEN_EVENT, listen);
    }
  });
});
