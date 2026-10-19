// @vitest-environment happy-dom
import type {
  ContentDatabaseSource,
  ContentGitHubSourceStatus,
} from "@shared/api";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { SyncGitHubFolderResponse } from "@/hooks/use-github-folder";
import { click, renderUi } from "@/test-utils/render-ui";

const sync = vi.hoisted(() => ({
  mutate: vi.fn(),
  isPending: false,
}));
const toasts = vi.hoisted(() => {
  const toast = Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() });
  return { toast };
});

vi.mock("@/hooks/use-github-folder", () => ({
  useSyncGitHubFolder: () => sync,
}));
vi.mock("sonner", () => ({ toast: toasts.toast }));

import { GitHubSourceStatusLine } from "./GitHubSourceStatusLine";

const SYNCED_SHA = "65b1d83c0ffee0000000000000000000000000000";

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
        folderUrl: "https://github.com/acme/handbook/tree/main/docs",
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

function statusLine() {
  const element = document.querySelector<HTMLElement>(
    "[data-github-source-status]",
  );
  if (!element) throw new Error("No GitHub status line");
  return element;
}

function syncNow() {
  const button = Array.from(document.querySelectorAll("button")).find(
    (candidate) => candidate.textContent?.includes("Sync now"),
  );
  if (!button) throw new Error("No Sync now button");
  return button;
}

function syncResult(
  sync: Partial<SyncGitHubFolderResponse["sync"]>,
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
      ...sync,
    },
  };
}

describe("GitHub source status line", () => {
  beforeEach(() => {
    sync.mutate.mockReset();
    sync.isPending = false;
    toasts.toast.mockReset();
    toasts.toast.success.mockReset();
    toasts.toast.error.mockReset();
  });

  it("says which folder and branch it follows, that pages are view only, and the synced commit", () => {
    renderUi(
      <GitHubSourceStatusLine
        source={githubSource({
          skipped: [{ path: "demo.mdx", reason: "mdx" }],
        })}
      />,
    );
    const text = statusLine().textContent ?? "";
    expect(text).toContain("Follows acme/handbook/docs on main");
    expect(text).toContain("View only: edit the files in GitHub");
    expect(text).toContain("Synced to 65b1d83 2 minutes ago");
    expect(text).toContain("1 file skipped");
    expect(statusLine().querySelector("a")?.getAttribute("href")).toBe(
      "https://github.com/acme/handbook/tree/main/docs",
    );
    expect(statusLine().querySelector("[data-github-source-problem]")).toBe(
      null,
    );
  });

  it("names a problem in the reader's words", () => {
    renderUi(
      <GitHubSourceStatusLine
        source={githubSource({
          problem: {
            code: "branch_not_found",
            message: "Branch main not found",
            at: new Date().toISOString(),
          },
        })}
      />,
    );
    expect(
      statusLine().querySelector("[data-github-source-problem]")?.textContent,
    ).toBe("The branch can’t be found. It may have been renamed or deleted.");
    expect(statusLine().className).toContain("border-destructive/30");
  });

  it("announces a problem, not the rest of the line and its clock", () => {
    renderUi(
      <GitHubSourceStatusLine
        source={githubSource({
          problem: {
            code: "branch_not_found",
            message: "Branch main not found",
            at: new Date().toISOString(),
          },
        })}
      />,
    );
    expect(statusLine().getAttribute("role")).toBe(null);
    expect(statusLine().querySelector('[role="status"]')).toBe(null);
    expect(
      statusLine()
        .querySelector("[data-github-source-problem]")
        ?.getAttribute("role"),
    ).toBe("alert");
  });

  it("lists the skipped files and why from a button, not only on hover", async () => {
    renderUi(
      <GitHubSourceStatusLine
        source={githubSource({
          skipped: [
            { path: "demo.mdx", reason: "mdx" },
            { path: "huge.md", reason: "too-large" },
          ],
        })}
      />,
    );
    const skipped = Array.from(statusLine().querySelectorAll("button")).find(
      (candidate) => candidate.textContent === "2 files skipped",
    );
    if (!skipped) throw new Error("No skipped files button");
    await click(skipped);
    const text = document.body.textContent ?? "";
    expect(text).toContain("Not linked");
    expect(text).toContain("demo.mdxMDX isn’t supported yet");
    expect(text).toContain("huge.mdLarger than 1 MiB");
  });

  it("counts every skipped file when the link keeps only some of their paths", async () => {
    renderUi(
      <GitHubSourceStatusLine
        source={githubSource({
          skipped: Array.from({ length: 50 }, (_, index) => ({
            path: `demo-${index}.mdx`,
            reason: "mdx" as const,
          })),
          skippedCount: 120,
        })}
      />,
    );
    const skipped = Array.from(statusLine().querySelectorAll("button")).find(
      (candidate) => candidate.textContent === "120 files skipped",
    );
    if (!skipped) throw new Error("No skipped files button");
    await click(skipped);
    const items = Array.from(document.querySelectorAll("li")).map(
      (item) => item.textContent,
    );
    expect(items).toHaveLength(51);
    expect(items[items.length - 1]).toBe("120 files skipped");
  });

  it("shows how far a newer commit has come in", () => {
    renderUi(
      <GitHubSourceStatusLine
        source={githubSource({
          pendingCommitSha: "1234567fffffff",
          progress: { done: 40, total: 120 },
        })}
      />,
    );
    expect(statusLine().textContent).toContain(
      "Bringing in 1234567: 40 of 120 files",
    );
  });

  it("says when it has never synced", () => {
    renderUi(
      <GitHubSourceStatusLine
        source={githubSource({ syncedCommitSha: null, syncedAt: null })}
      />,
    );
    expect(statusLine().textContent).toContain("Not synced yet");
  });

  it("renders nothing for a collection that doesn't follow GitHub", () => {
    const { container } = renderUi(
      <GitHubSourceStatusLine
        source={{ ...githubSource(), sourceType: "builder-cms" }}
      />,
    );
    expect(container.innerHTML).toBe("");
  });

  it("syncs on request and reports what the sync did", async () => {
    renderUi(<GitHubSourceStatusLine source={githubSource()} />);

    await click(syncNow());
    expect(sync.mutate).toHaveBeenCalledWith(
      { databaseId: "database-1" },
      expect.any(Object),
    );
    const callbacks = sync.mutate.mock.calls[0]![1] as {
      onSuccess: (result: SyncGitHubFolderResponse) => void;
      onError: (error: unknown) => void;
    };

    callbacks.onSuccess(syncResult({ state: "unchanged" }));
    expect(toasts.toast.success).toHaveBeenLastCalledWith("Already up to date");

    callbacks.onSuccess(syncResult({ state: "synced" }));
    expect(toasts.toast.success).toHaveBeenLastCalledWith("Synced to abcdef1");

    callbacks.onSuccess(
      syncResult({
        state: "error",
        problem: { code: "rate_limited", message: "rate limited" },
      }),
    );
    expect(toasts.toast.error).toHaveBeenLastCalledWith(
      "GitHub is limiting requests. Syncing resumes on its own.",
    );

    callbacks.onError(
      Object.assign(new Error("GitHub connection missing"), {
        errorCode: "GITHUB_CONNECTION",
      }),
    );
    expect(toasts.toast.error).toHaveBeenLastCalledWith(
      "Reconnect GitHub to keep this collection up to date.",
    );
  });

  it("can't start a second sync while one runs", () => {
    sync.isPending = true;
    renderUi(<GitHubSourceStatusLine source={githubSource()} />);
    expect(syncNow().disabled).toBe(true);
  });
});
