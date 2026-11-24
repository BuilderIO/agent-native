// @vitest-environment happy-dom
import type { ContentDatabaseSource } from "@shared/api";
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  GITHUB_LINK_DIALOG_OPEN_EVENT,
  type GitHubLinkDialogRequest,
} from "@/lib/github-link-dialog";
import { click, renderUi } from "@/test-utils/render-ui";

import type { GitHubCollectionPlace } from "./github-availability";

const unlink = vi.hoisted(() => ({ mutate: vi.fn(), isPending: false }));
const sync = vi.hoisted(() => ({ mutate: vi.fn(), isPending: false }));

vi.mock("@/hooks/use-github-folder", () => ({
  useGitHubConnection: () => ({ data: undefined, isPending: false }),
  useSyncGitHubFolder: () => sync,
}));
vi.mock("@/hooks/use-content-database", () => ({
  useContentDatabaseSourceRefreshing: () => false,
  useDisconnectContentDatabaseSource: () => unlink,
}));
vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }),
}));

import { GitHubSourcePanel } from "./GitHubSourcePanel";

const github = {
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
      syncedCommitSha: "65b1d83c0ffee0000000000000000000000000000",
      syncedAt: new Date(Date.now() - 2 * 60_000).toISOString(),
    },
  },
} as unknown as ContentDatabaseSource;

const place: GitHubCollectionPlace = {
  databaseId: "database-1",
  documentId: "doc-1",
  spaceId: "space-1",
  parentId: "parent-1",
  systemRole: null,
  pageCount: 3,
  canEdit: true,
};

function queryButton(name: string) {
  return (
    Array.from(document.querySelectorAll("button")).find(
      (candidate) => candidate.textContent?.trim() === name,
    ) ?? null
  );
}

function button(name: string) {
  const match = queryButton(name);
  if (!match) throw new Error(`No "${name}" button`);
  return match;
}

let opened: GitHubLinkDialogRequest[] = [];
const listen = (event: Event) =>
  opened.push((event as CustomEvent<GitHubLinkDialogRequest>).detail);

beforeEach(() => {
  opened = [];
  unlink.mutate.mockReset();
  sync.mutate.mockReset();
  sync.isPending = false;
  window.addEventListener(GITHUB_LINK_DIALOG_OPEN_EVENT, listen);
});

afterEach(() => {
  window.removeEventListener(GITHUB_LINK_DIALOG_OPEN_EVENT, listen);
});

describe("The GitHub step in Sources", () => {
  it("explains why a collection with pages can't link, and offers a new collection beside it", async () => {
    renderUi(
      <GitHubSourcePanel place={place} sources={[]} onUnlinked={vi.fn()} />,
    );
    expect(document.body.textContent).toContain(
      "A GitHub folder fills a whole collection, so it needs one with no pages. This one has 3 pages.",
    );
    await click(button("New collection from GitHub"));
    expect(opened[0]?.target).toEqual({
      kind: "new",
      spaceId: "space-1",
      parentId: "parent-1",
    });
  });

  it("says a page count of one in the singular", () => {
    renderUi(
      <GitHubSourcePanel
        place={{ ...place, pageCount: 1 }}
        sources={[]}
        onUnlinked={vi.fn()}
      />,
    );
    expect(document.body.textContent).toContain("This one has 1 page.");
  });

  it("tells readers to ask for edit access, with nothing to click", () => {
    renderUi(
      <GitHubSourcePanel
        place={{ ...place, canEdit: false }}
        sources={[]}
        onUnlinked={vi.fn()}
      />,
    );
    expect(document.body.textContent).toContain(
      "Only people who can edit this collection can link a GitHub folder. Ask its owner for edit access.",
    );
    expect(queryButton("New collection from GitHub")).toBe(null);
  });

  it("holds Unlink… while Sync now runs", () => {
    sync.isPending = true;
    renderUi(
      <GitHubSourcePanel
        place={place}
        sources={[github]}
        onUnlinked={vi.fn()}
      />,
    );
    expect(button("Unlink…").disabled).toBe(true);
  });

  it("says where a linked folder's pages come from, and asks before unlinking it", async () => {
    const onUnlinked = vi.fn();
    renderUi(
      <GitHubSourcePanel
        place={place}
        sources={[github]}
        onUnlinked={onUnlinked}
      />,
    );
    const text = document.body.textContent ?? "";
    expect(text).toContain("Pages come from the docs folder in acme/handbook.");
    expect(text).toContain("Up to date · checked 2 minutes ago");
    expect(text).toContain(
      "You can’t edit these pages here. Edit them on GitHub.",
    );
    expect(text).toContain("The pages stay here and become yours to edit.");
    expect(text).not.toContain("65b1d83");
    expect(
      document.querySelector<HTMLAnchorElement>(
        'a[href="https://github.com/acme/handbook/tree/main/docs"]',
      )?.textContent,
    ).toBe("Open in GitHub");
    expect(queryButton("Sync now")).not.toBe(null);
    expect(text).not.toContain("Branch");
    await click(button("More"));
    expect(document.body.textContent).toContain("Branchmain");

    await click(button("Unlink…"));
    expect(document.body.textContent).toContain("Unlink this GitHub folder?");
    await click(button("Unlink"));
    const [variables, options] = unlink.mutate.mock.calls[0] as [
      unknown,
      { onSuccess?: () => void },
    ];
    expect(variables).toEqual({ documentId: "doc-1", sourceId: "source-1" });
    await act(async () => options.onSuccess?.());
    expect(onUnlinked).toHaveBeenCalledTimes(1);
  });

  it("shows a stopped sync's problem and fix in place of Up to date", () => {
    renderUi(
      <GitHubSourcePanel
        place={place}
        sources={[
          {
            ...github,
            metadata: {
              github: {
                ...github.metadata.github,
                problem: {
                  code: "connection",
                  message: "Bad credentials",
                  at: new Date().toISOString(),
                },
              },
            },
          } as ContentDatabaseSource,
        ]}
        onUnlinked={vi.fn()}
      />,
    );
    const alert = document.querySelector('[role="alert"]');
    expect(alert?.textContent).toContain("Showing pages as of 2 minutes ago.");
    expect(queryButton("Reconnect GitHub")).not.toBe(null);
    expect(document.body.textContent).not.toContain("Up to date");
  });

  it("doesn't offer Unlink to readers", () => {
    renderUi(
      <GitHubSourcePanel
        place={{ ...place, canEdit: false }}
        sources={[github]}
        onUnlinked={vi.fn()}
      />,
    );
    expect(queryButton("Unlink…")).toBe(null);
    expect(queryButton("Sync now")).not.toBe(null);
  });
});
