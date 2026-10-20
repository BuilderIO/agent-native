// @vitest-environment happy-dom
import type { ContentDatabaseSource } from "@shared/api";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  GITHUB_LINK_DIALOG_OPEN_EVENT,
  type GitHubLinkDialogRequest,
} from "@/lib/github-link-dialog";
import { click, renderUi } from "@/test-utils/render-ui";

import type { GitHubCollectionPlace } from "./github-availability";

const connection = vi.hoisted(() => ({
  enabled: [] as boolean[],
  data: { connected: true } as { connected: boolean | null } | undefined,
}));

vi.mock("@/hooks/use-github-folder", () => ({
  useGitHubConnection: (enabled: boolean) => {
    connection.enabled.push(enabled);
    return { data: enabled ? connection.data : undefined, isPending: false };
  },
  useSyncGitHubFolder: () => ({ mutate: vi.fn(), isPending: false }),
  useLinkGitHubFolder: () => ({ mutateAsync: vi.fn() }),
  useCreateGitHubCollection: () => ({ mutateAsync: vi.fn() }),
}));

import { SourcesListView } from "./DatabaseView";

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
      syncedAt: new Date(Date.now() - 2 * 60_000).toISOString(),
    },
  },
} as unknown as ContentDatabaseSource;

const notion = {
  id: "source-2",
  databaseId: "database-1",
  sourceType: "notion-database",
  sourceName: "Team wiki",
  metadata: {},
} as unknown as ContentDatabaseSource;

const emptyCollection: GitHubCollectionPlace = {
  databaseId: "database-1",
  documentId: "doc-1",
  spaceId: "space-1",
  parentId: null,
  systemRole: null,
  pageCount: 0,
  canEdit: true,
};

function sourcesList(
  props: Partial<Parameters<typeof SourcesListView>[0]> = {},
) {
  const onOpenGitHubStep = vi.fn();
  const onOpenBuilder = vi.fn();
  const onOpenNotion = vi.fn();
  renderUi(
    <SourcesListView
      source={null}
      sources={[]}
      builderConfigured={false}
      builderSpaceLabel={null}
      onOpenBuilder={onOpenBuilder}
      onOpenNotion={onOpenNotion}
      onOpenLocalFolder={vi.fn()}
      showLocalFolder={false}
      githubPlace={emptyCollection}
      onOpenGitHubStep={onOpenGitHubStep}
      onOpenSecondary={vi.fn()}
      onAddSource={vi.fn()}
      {...props}
    />,
  );
  return { onOpenGitHubStep, onOpenBuilder, onOpenNotion };
}

function rows(label: string) {
  return Array.from(document.querySelectorAll("button")).filter(
    (button) => button.querySelector(".truncate")?.textContent === label,
  );
}

function row(label: string) {
  const [match] = rows(label);
  if (!match) throw new Error(`No "${label}" row`);
  return match;
}

/** The row's visible second line, through the same link screen readers use. */
function rowDescription(button: HTMLElement) {
  const id = button.getAttribute("aria-describedby");
  return id ? document.getElementById(id)?.textContent : undefined;
}

let opened: GitHubLinkDialogRequest[] = [];
const listen = (event: Event) =>
  opened.push((event as CustomEvent<GitHubLinkDialogRequest>).detail);

beforeEach(() => {
  opened = [];
  connection.enabled = [];
  connection.data = { connected: true };
  window.addEventListener(GITHUB_LINK_DIALOG_OPEN_EVENT, listen);
});

afterEach(() => {
  window.removeEventListener(GITHUB_LINK_DIALOG_OPEN_EVENT, listen);
});

describe("The GitHub row in Sources", () => {
  it("says it's available on an empty collection, and opens the dialog for it", async () => {
    sourcesList();
    const githubRow = row("GitHub");
    expect(rowDescription(githubRow)).toBe(
      "Show a GitHub folder’s documents here",
    );
    expect(githubRow.getAttribute("aria-disabled")).toBe(null);

    await click(githubRow);
    expect(opened).toHaveLength(1);
    expect(opened[0]?.target).toEqual({
      kind: "collection",
      databaseId: "database-1",
      documentId: "doc-1",
      spaceId: "space-1",
      parentId: null,
    });
    expect(opened[0]?.returnFocusTo).toBe(githubRow);
  });

  it("says GitHub needs connecting first, and still opens the dialog to do it", async () => {
    connection.data = { connected: false };
    sourcesList();
    expect(rowDescription(row("GitHub"))).toBe(
      "Connect your GitHub account first",
    );
    await click(row("GitHub"));
    expect(opened).toHaveLength(1);
  });

  it.each([
    [
      "a collection with pages",
      { githubPlace: { ...emptyCollection, pageCount: 3 } },
      "Only for empty collections",
    ],
    [
      "a collection from Notion",
      { source: notion, sources: [notion] },
      "Already gets its pages from Notion",
    ],
    [
      "the Files collection",
      { githubPlace: { ...emptyCollection, systemRole: "files" } },
      "Not available for Files",
    ],
    [
      "another system collection",
      { githubPlace: { ...emptyCollection, systemRole: "workspaces" } },
      "Not available for this collection",
    ],
  ])(
    "explains up front why %s can't take a folder, without asking GitHub",
    async (_name, props, description) => {
      const { onOpenGitHubStep } = sourcesList(props);
      const githubRow = row("GitHub");
      expect(rowDescription(githubRow)).toBe(description);
      expect(connection.enabled.every((enabled) => !enabled)).toBe(true);

      await click(githubRow);
      expect(onOpenGitHubStep).toHaveBeenCalledTimes(1);
      expect(opened).toHaveLength(0);
    },
  );

  it("tells readers it's for editors, and keeps the row reachable for the reason", async () => {
    const { onOpenGitHubStep } = sourcesList({
      githubPlace: { ...emptyCollection, canEdit: false },
    });
    const githubRow = row("GitHub");
    expect(rowDescription(githubRow)).toBe("Editors only");
    expect(githubRow.getAttribute("aria-disabled")).toBe("true");
    expect(githubRow.disabled).toBe(false);
    await click(githubRow);
    expect(onOpenGitHubStep).toHaveBeenCalledTimes(1);
  });
});

describe("Sources for a collection linked to GitHub", () => {
  it("shows the folder once, opening its details here rather than on GitHub", async () => {
    const { onOpenGitHubStep } = sourcesList({
      source: github,
      sources: [github],
    });
    const githubRows = rows("GitHub");
    expect(githubRows).toHaveLength(1);
    expect(rowDescription(githubRows[0]!)).toBe(
      "docs folder · Updated 2 minutes ago",
    );
    expect(document.body.textContent).not.toContain("Adding items");
    expect(document.body.textContent).not.toContain("Disconnect source");
    expect(rows("Add another source")).toHaveLength(0);

    await click(githubRows[0]!);
    expect(onOpenGitHubStep).toHaveBeenCalledTimes(1);
  });

  it("explains instead of leading Builder and Notion to a refusal", async () => {
    const { onOpenGitHubStep, onOpenBuilder, onOpenNotion } = sourcesList({
      source: github,
      sources: [github],
    });
    for (const label of ["Builder", "Notion"]) {
      const appRow = row(label);
      expect(rowDescription(appRow)).toBe(
        "Not available while linked to GitHub",
      );
      expect(appRow.getAttribute("aria-disabled")).toBe("true");
      await click(appRow);
    }
    expect(onOpenGitHubStep).toHaveBeenCalledTimes(2);
    expect(onOpenBuilder).not.toHaveBeenCalled();
    expect(onOpenNotion).not.toHaveBeenCalled();
  });
});
