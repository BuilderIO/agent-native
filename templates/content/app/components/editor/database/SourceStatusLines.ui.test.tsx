// @vitest-environment happy-dom
import type { ContentDatabaseSource } from "@shared/api";
import { act } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { click, renderUi } from "@/test-utils/render-ui";

type MutateOptions = {
  onSuccess?: () => void;
  onError?: (error: unknown) => void;
};

const refresh = vi.hoisted(() => ({ mutate: vi.fn(), isPending: false }));
const unlink = vi.hoisted(() => ({ mutate: vi.fn(), isPending: false }));
const toasts = vi.hoisted(() => {
  const toast = Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() });
  return { toast };
});

const elsewhere = vi.hoisted(() => ({ refreshing: false }));

vi.mock("@/hooks/use-content-database", () => ({
  useContentDatabaseSourceRefreshing: () => elsewhere.refreshing,
  useDisconnectContentDatabaseSource: () => unlink,
  useRefreshContentDatabaseSource: () => refresh,
}));
vi.mock("sonner", () => ({ toast: toasts.toast }));

import { BuilderSourceStatusLine } from "./BuilderSourceStatusLine";
import { NotionSourceStatusLine } from "./NotionSourceStatusLine";

const FIVE_MINUTES_AGO = () => new Date(Date.now() - 5 * 60_000).toISOString();

function source(
  sourceType: "builder-cms" | "notion-database",
  overrides: Partial<ContentDatabaseSource> = {},
  metadata: Partial<ContentDatabaseSource["metadata"]> = {},
): ContentDatabaseSource {
  return {
    id: "source-1",
    databaseId: "database-1",
    sourceType,
    sourceName: sourceType === "builder-cms" ? "Blog articles" : "Roadmap",
    sourceTable: sourceType === "builder-cms" ? "blog-article" : "ds-1",
    syncState: "linked",
    lastRefreshedAt: FIVE_MINUTES_AGO(),
    lastError: null,
    bodyHydration: null,
    metadata: {
      primaryKey: "id",
      titleField: "title",
      ...(sourceType === "notion-database"
        ? { federation: { role: "secondary" } }
        : {}),
      ...metadata,
    },
    ...overrides,
  } as unknown as ContentDatabaseSource;
}

function line(provider: string) {
  const element = document.querySelector<HTMLElement>(
    `[data-source-status="${provider}"]`,
  );
  if (!element) throw new Error(`No ${provider} status line`);
  return element;
}

function button(name: string) {
  const match = Array.from(document.querySelectorAll("button")).find(
    (candidate) => candidate.textContent.trim() === name,
  );
  if (!match) throw new Error(`No "${name}" button`);
  return match;
}

function renderBuilder(
  builderSource: ContentDatabaseSource,
  props: {
    canEdit?: boolean;
    clientError?: boolean;
    canRetryContent?: boolean;
  } = {},
) {
  const onSyncNow = vi.fn();
  const onRetry = vi.fn();
  const onRetryContent = vi.fn();
  renderUi(
    <BuilderSourceStatusLine
      source={builderSource}
      documentId="doc-1"
      canEdit={props.canEdit ?? true}
      pageCount={12}
      pending={false}
      clientError={props.clientError ?? false}
      onSyncNow={onSyncNow}
      onRetry={onRetry}
      onRetryContent={
        props.canRetryContent === false ? undefined : onRetryContent
      }
    />,
  );
  return { onSyncNow, onRetry, onRetryContent };
}

const CONTENT_FAILED = {
  bodyHydration: {
    total: 3,
    hydrated: 2,
    pending: 0,
    hydrating: 0,
    error: 1,
  },
} as unknown as Partial<ContentDatabaseSource>;

beforeEach(() => {
  refresh.mutate.mockReset();
  refresh.isPending = false;
  elsewhere.refreshing = false;
  unlink.mutate.mockReset();
  toasts.toast.success.mockReset();
  toasts.toast.error.mockReset();
});

describe("Builder source status line", () => {
  it("says which model the pages come from and when they updated", async () => {
    const { onSyncNow } = renderBuilder(source("builder-cms"));
    const text = line("builder").textContent;
    expect(text).toContain("From the Blog articles model in Builder");
    expect(line("builder").querySelector("strong")?.textContent).toBe(
      "Blog articles",
    );
    expect(text).toContain("Updated 5 minutes ago");
    expect(line("builder").querySelector('[role="alert"]')).toBe(null);

    await click(button("Details"));
    await click(button("Sync now"));
    expect(onSyncNow).toHaveBeenCalledTimes(1);
  });

  it("promises the pages stay when unlinking", async () => {
    renderBuilder(source("builder-cms"));
    await click(button("Details"));
    await click(button("Unlink…"));
    const text = document.body.textContent;
    expect(text).toContain("Unlink this Builder model?");
    expect(text).toContain(
      "The 12 pages stay here and become normal pages you can edit.",
    );
  });

  it("shows how far rows have got while they come in", () => {
    renderBuilder(
      source(
        "builder-cms",
        {},
        {
          sourceFetchState: "fetching",
          lastReadHasMore: true,
          lastReadFetchedEntryCount: 120,
          lastReadLimit: 500,
        },
      ),
    );
    expect(line("builder").textContent).toContain(
      "Builder is still loading rows in the background. 120 of 500 rows fetched so far.",
    );
  });

  it("shows a failed load with Retry instead of the time", async () => {
    const { onRetry } = renderBuilder(
      source("builder-cms", {}, { sourceFetchState: "error" }),
    );
    const alert = line("builder").querySelector('[role="alert"]');
    expect(alert?.textContent).toContain("Couldn’t update from Builder.");
    expect(alert?.textContent).toContain("Showing pages as of 5 minutes ago.");
    expect(line("builder").textContent).not.toContain("Updated 5 minutes ago");
    await click(button("Retry"));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("loads failed page content again on Retry, without reading the rows again", async () => {
    const { onRetry, onRetryContent, onSyncNow } = renderBuilder(
      source("builder-cms", CONTENT_FAILED, { lastReadHasMore: false }),
    );
    expect(
      line("builder").querySelector('[role="alert"]')?.textContent,
    ).toContain("Couldn’t update from Builder.");
    await click(button("Retry"));
    expect(onRetryContent).toHaveBeenCalledTimes(1);
    expect(onRetry).not.toHaveBeenCalled();
    expect(onSyncNow).not.toHaveBeenCalled();
  });

  it("offers no Retry for failed page content when nothing can load it again", () => {
    renderBuilder(
      source("builder-cms", CONTENT_FAILED, { lastReadHasMore: false }),
      { canRetryContent: false },
    );
    expect(line("builder").querySelector('[role="alert"]')).not.toBe(null);
    expect(
      Array.from(document.querySelectorAll("button")).some(
        (candidate) => candidate.textContent.trim() === "Retry",
      ),
    ).toBe(false);
  });

  it("says a model adds details, without row progress", () => {
    renderBuilder(
      source(
        "builder-cms",
        {},
        {
          federation: { role: "secondary" } as never,
          sourceFetchState: "fetching",
        },
      ),
    );
    expect(line("builder").textContent).toContain(
      "Details from the Blog articles model in Builder",
    );
    expect(line("builder").textContent).not.toContain("rows");
  });

  it("offers neither Sync now nor Unlink… to people who can't edit", async () => {
    renderBuilder(source("builder-cms"), { canEdit: false });
    await click(button("Details"));
    expect(document.body.textContent).not.toContain("Sync now");
    expect(document.body.textContent).not.toContain("Unlink…");
  });
});

describe("Notion source status line", () => {
  function notionLine(notionSource: ContentDatabaseSource) {
    return (
      <NotionSourceStatusLine
        source={notionSource}
        documentId="doc-1"
        canEdit
        pageCount={3}
      />
    );
  }
  function renderNotion(notionSource: ContentDatabaseSource) {
    return renderUi(notionLine(notionSource));
  }

  it("says which database adds details and when they updated", () => {
    renderNotion(source("notion-database"));
    expect(line("notion").textContent).toContain(
      "Details from the Roadmap database in Notion",
    );
    expect(line("notion").textContent).toContain("Updated 5 minutes ago");
  });

  it("syncs every page of the database now and says so", async () => {
    renderNotion(source("notion-database"));
    await click(button("Details"));
    await click(button("Sync now"));
    const [variables, options] = refresh.mutate.mock.calls[0] as [
      unknown,
      MutateOptions,
    ];
    expect(variables).toEqual({
      documentId: "doc-1",
      sourceId: "source-1",
      fullRefresh: true,
    });
    await act(async () => options.onSuccess?.());
    expect(toasts.toast.success).toHaveBeenCalledWith("Updated from Notion.");
  });

  it("says a failed sync at once, and the source keeps it on the line", async () => {
    const synced = source("notion-database");
    const { rerender } = renderNotion(synced);
    await click(button("Details"));
    await click(button("Sync now"));
    const [, options] = refresh.mutate.mock.calls[0] as [
      unknown,
      MutateOptions,
    ];
    await act(async () => options.onError?.(new Error("Notion said no")));
    expect(toasts.toast.error).toHaveBeenCalledWith(
      "Couldn’t update from Notion. Notion said no.",
    );

    rerender(
      notionLine({
        ...synced,
        syncState: "error",
        lastError: "Notion said no",
      }),
    );
    expect(
      line("notion").querySelector('[role="alert"]')?.textContent,
    ).toContain(
      "Couldn’t update from Notion. Notion said no. Showing details as of 5 minutes ago.",
    );
    expect(line("notion").textContent).not.toContain("Updated 5 minutes ago");

    const twoMinutesAgo = new Date(Date.now() - 2 * 60_000).toISOString();
    rerender(notionLine({ ...synced, lastRefreshedAt: twoMinutesAgo }));
    expect(line("notion").querySelector('[role="alert"]')).toBe(null);
    expect(line("notion").textContent).toContain("Updated 2 minutes ago");
  });

  it("holds Sync now and Retry while Sources syncs the same source", async () => {
    elsewhere.refreshing = true;
    renderNotion(
      source("notion-database", { syncState: "error", lastError: "Gone" }),
    );
    expect(button("Retry").disabled).toBe(true);
    await click(button("Details"));
    const syncNow = Array.from(document.querySelectorAll("button")).find(
      (candidate) => candidate.textContent.includes("Sync now"),
    );
    expect(syncNow?.disabled).toBe(true);
  });

  it("holds Unlink… while Sources refreshes the same source", async () => {
    elsewhere.refreshing = true;
    renderNotion(source("notion-database"));
    await click(button("Details"));
    expect(button("Unlink…").disabled).toBe(true);
  });

  it("shows an error the source has stored, ended as a sentence", () => {
    renderNotion(
      source("notion-database", {
        syncState: "error",
        lastError: "The integration lost access",
      }),
    );
    expect(
      line("notion").querySelector('[role="alert"]')?.textContent,
    ).toContain(
      "Couldn’t update from Notion. The integration lost access. Showing details as of 5 minutes ago.",
    );
  });
});
