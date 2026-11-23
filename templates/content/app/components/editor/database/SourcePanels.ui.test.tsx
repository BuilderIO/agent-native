// @vitest-environment happy-dom
import type { ContentDatabaseSource } from "@shared/api";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { click, renderUi } from "@/test-utils/render-ui";

const refresh = vi.hoisted(() => ({ mutate: vi.fn(), isPending: false }));
const unlink = vi.hoisted(() => ({ mutate: vi.fn(), isPending: false }));
const preview = vi.hoisted(() => ({
  state: {
    isPending: false,
    isError: false,
    data: undefined as unknown,
    refetch: vi.fn(),
  },
  calls: [] as Array<{ enabled: boolean }>,
}));

vi.mock("@/hooks/use-content-database", () => ({
  useContentDatabaseSourceRefreshing: () => false,
  useDisconnectContentDatabaseSource: () => unlink,
  useRefreshContentDatabaseSource: () => refresh,
  usePreviewBuilderSourceReview: (args: { enabled: boolean }) => {
    preview.calls.push(args);
    return preview.state;
  },
}));
vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }),
}));

import { BuilderSourcePanel } from "./BuilderSourcePanel";
import {
  BuilderDetailsSourcePanel,
  NotionDetailsSourcePanel,
  sourceMatchedOnText,
} from "./DetailsSourcePanel";

const FIVE_MINUTES_AGO = () => new Date(Date.now() - 5 * 60_000).toISOString();

function builder(
  overrides: Partial<ContentDatabaseSource> = {},
  metadata: Partial<ContentDatabaseSource["metadata"]> = {},
): ContentDatabaseSource {
  return {
    id: "source-1",
    databaseId: "database-1",
    sourceType: "builder-cms",
    sourceName: "Blog article",
    sourceTable: "blog-article",
    syncState: "linked",
    lastRefreshedAt: FIVE_MINUTES_AGO(),
    lastError: null,
    bodyHydration: null,
    capabilities: { liveWritesEnabled: true },
    fields: [],
    changeSets: [],
    metadata: {
      primaryKey: "id",
      titleField: "title",
      writeMode: "stage_only",
      ...metadata,
    },
    ...overrides,
  } as unknown as ContentDatabaseSource;
}

function details(
  sourceType: "notion-database" | "builder-cms",
  fields: Array<{ propertyId: string | null; mappingType?: string }> = [
    { propertyId: "prop-status", mappingType: "field" },
  ],
): ContentDatabaseSource {
  return {
    id: "source-2",
    databaseId: "database-1",
    sourceType,
    sourceName: sourceType === "notion-database" ? "Roadmap" : "Authors",
    sourceTable: "table-1",
    syncState: "linked",
    lastRefreshedAt: FIVE_MINUTES_AGO(),
    lastError: null,
    capabilities: {},
    fields,
    changeSets: [],
    metadata: {
      primaryKey: "id",
      titleField: "Name",
      federation: {
        role: "secondary",
        keyField: "Name",
        canonicalKey: { label: "Name" },
        normalizationFormula: "trim(lower(value))",
      },
    },
  } as unknown as ContentDatabaseSource;
}

function panel(provider: string) {
  const element = document.querySelector<HTMLElement>(
    `[data-source-panel="${provider}"]`,
  );
  if (!element) throw new Error(`No ${provider} panel`);
  return element;
}

function queryButton(name: string) {
  return (
    Array.from(document.querySelectorAll("button")).find(
      (candidate) => candidate.textContent.trim() === name,
    ) ?? null
  );
}

function button(name: string) {
  const match = queryButton(name);
  if (!match) throw new Error(`No "${name}" button`);
  return match;
}

function radio(label: string) {
  const match = Array.from(
    document.querySelectorAll<HTMLButtonElement>('[role="radio"]'),
  ).find(
    (candidate) =>
      document.querySelector(`label[for="${candidate.id}"]`)?.textContent ===
      label,
  );
  if (!match) throw new Error(`No "${label}" choice`);
  return match;
}

function renderBuilder(
  source: ContentDatabaseSource,
  props: { canEdit?: boolean; knownChangeCount?: number | null } = {},
) {
  const handlers = {
    onSyncNow: vi.fn(),
    onRetryContent: vi.fn(),
    onReview: vi.fn(),
    onSetWriteMode: vi.fn(),
    onAddDetailsInstead: vi.fn(),
    onUnlinked: vi.fn(),
  };
  renderUi(
    <BuilderSourcePanel
      source={source}
      documentId="doc-1"
      canEdit={props.canEdit ?? true}
      pageCount={3}
      knownChangeCount={
        props.knownChangeCount === undefined ? 0 : props.knownChangeCount
      }
      syncPending={false}
      syncDisabled={false}
      retryContentDisabled={false}
      reviewDisabled={false}
      writeModeDisabled={false}
      roleDisabled={false}
      unlinkDisabled={false}
      {...handlers}
    />,
  );
  return handlers;
}

beforeEach(() => {
  refresh.mutate.mockReset();
  refresh.isPending = false;
  unlink.mutate.mockReset();
  preview.state = {
    isPending: false,
    isError: false,
    data: undefined,
    refetch: vi.fn(),
  };
  preview.calls = [];
});

describe("Builder model panel", () => {
  it("says where pages come from, that they're current, and what editing does", () => {
    renderBuilder(builder());
    const text = panel("builder").textContent;
    expect(text).toContain("Pages come from the Blog article model.");
    expect(panel("builder").querySelector("strong")?.textContent).toBe(
      "Blog article",
    );
    expect(text).toContain("Up to date · checked 5 minutes ago");
    expect(text).toContain(
      "Edits here are saved to Builder for review, not published.",
    );
    expect(text).toContain("No changes waiting");
    expect(text).toContain("The pages stay here and become yours to edit.");
    expect(queryButton("Review and send")).toBe(null);
    expect(queryButton("Sync now")).not.toBe(null);
    expect(text).not.toContain("Live writes on");
    expect(text).not.toContain("Source role");
  });

  it("offers Review and send once pages have changed", async () => {
    const { onReview } = renderBuilder(builder(), { knownChangeCount: 2 });
    expect(panel("builder").textContent).toContain("2 pages changed");
    await click(button("Review and send"));
    expect(onReview).toHaveBeenCalledTimes(1);
    expect(preview.calls.every((call) => !call.enabled)).toBe(true);
  });

  it("asks the server how many pages changed when this view holds only some of them", () => {
    preview.state.data = {
      sourceId: "source-1",
      sourceTable: "blog-article",
      changeSetIds: ["change-1"],
      review: { totalRowCount: 1 },
    };
    renderBuilder(builder(), { knownChangeCount: null });
    expect(preview.calls.length).toBeGreaterThan(0);
    expect(preview.calls.every((call) => call.enabled)).toBe(true);
    expect(panel("builder").textContent).toContain("1 page changed");
  });

  it("says nothing about changes until it knows, and says so when it can't find out", async () => {
    preview.state.isPending = true;
    renderBuilder(builder(), { knownChangeCount: null });
    expect(panel("builder").textContent).not.toContain("No changes waiting");
    expect(
      panel("builder").querySelector('[data-source-panel-changes="loading"]'),
    ).not.toBe(null);
  });

  it("offers a retry when it can't check for changes", async () => {
    preview.state.isError = true;
    renderBuilder(builder(), { knownChangeCount: null });
    expect(panel("builder").textContent).toContain(
      "Couldn’t check for changes.",
    );
    expect(panel("builder").textContent).not.toContain("No changes waiting");
    await click(button("Retry"));
    expect(preview.state.refetch).toHaveBeenCalledTimes(1);
  });

  it("leaves out changes when edits aren't sent to Builder", () => {
    renderBuilder(builder({}, { writeMode: "read_only" }), {
      knownChangeCount: 2,
    });
    const text = panel("builder").textContent;
    expect(text).toContain("Edits here aren’t sent to Builder.");
    expect(text).not.toContain("pages changed");
  });

  it("shows page content loading only while it runs", () => {
    renderBuilder(
      builder({
        bodyHydration: {
          total: 3,
          hydrated: 2,
          pending: 1,
          hydrating: 0,
          error: 0,
        },
      } as Partial<ContentDatabaseSource>),
    );
    const text = panel("builder").textContent;
    expect(text).toContain("Loading page content, 2 of 3");
    expect(text).not.toContain("Up to date");
  });

  it("shows a failed update with Retry in place of Up to date", async () => {
    const { onSyncNow } = renderBuilder(builder({ syncState: "error" }));
    const alert = panel("builder").querySelector('[role="alert"]');
    expect(alert?.textContent).toContain("Couldn’t update from Builder.");
    expect(panel("builder").textContent).not.toContain("Up to date");
    await click(button("Retry"));
    expect(onSyncNow).toHaveBeenCalledTimes(1);
  });

  it("reads the rows again on Retry after a row read failed", async () => {
    const { onSyncNow, onRetryContent } = renderBuilder(
      builder({}, { sourceFetchState: "error" }),
    );
    expect(panel("builder").querySelector('[role="alert"]')).not.toBe(null);
    await click(button("Retry"));
    expect(onSyncNow).toHaveBeenCalledTimes(1);
    expect(onRetryContent).not.toHaveBeenCalled();
  });

  it("loads failed page content again on Retry", async () => {
    const { onSyncNow, onRetryContent } = renderBuilder(
      builder(
        {
          bodyHydration: {
            total: 3,
            hydrated: 2,
            pending: 0,
            hydrating: 0,
            error: 1,
          },
        } as Partial<ContentDatabaseSource>,
        { lastReadHasMore: false },
      ),
    );
    await click(button("Retry"));
    expect(onRetryContent).toHaveBeenCalledTimes(1);
    expect(onSyncNow).not.toHaveBeenCalled();
  });

  it("keeps the edit modes behind More, and asks before publishing", async () => {
    const { onSetWriteMode } = renderBuilder(builder());
    expect(document.querySelector('[role="radio"]')).toBe(null);

    await click(button("More"));
    expect(panel("builder").textContent).toContain("What happens to my edits");
    expect(radio("Save to Builder for review").dataset.state).toBe("checked");

    await click(radio("Publish to the live site"));
    expect(onSetWriteMode).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain(
      "Publish edits to the live site?",
    );
    const dialog = document.querySelector('[role="alertdialog"]');
    if (!dialog) throw new Error("No dialog");
    const confirm = Array.from(dialog.querySelectorAll("button")).find(
      (candidate) =>
        candidate.textContent.trim() === "Publish to the live site",
    );
    if (!confirm) throw new Error("No confirm button");
    await click(confirm);
    expect(onSetWriteMode).toHaveBeenCalledWith({
      sourceId: "source-1",
      writeMode: "publish_updates",
      allowPublicationTransitions: false,
    });

    await click(radio("Don’t send"));
    expect(onSetWriteMode).toHaveBeenLastCalledWith({
      sourceId: "source-1",
      writeMode: "read_only",
      allowPublicationTransitions: false,
    });
  });

  it("gives people who can't edit the words without the controls", () => {
    renderBuilder(builder(), { canEdit: false, knownChangeCount: 2 });
    const text = panel("builder").textContent;
    expect(text).toContain("Pages come from the Blog article model.");
    expect(queryButton("Sync now")).toBe(null);
    expect(queryButton("Unlink…")).toBe(null);
    expect(queryButton("Review and send")).toBe(null);
  });
});

describe("Details panels", () => {
  it("says what a Notion database adds, how pages match, and that its details are edited in Notion", async () => {
    const onChooseDetails = vi.fn();
    renderUi(
      <NotionDetailsSourcePanel
        source={details("notion-database")}
        documentId="doc-1"
        canEdit
        pageCount={3}
        rolePending={false}
        onChooseDetails={onChooseDetails}
        onUnlinked={vi.fn()}
      />,
    );
    const text = panel("notion").textContent;
    expect(text).toContain(
      "Details come from the Roadmap database, added to matching pages here.",
    );
    expect(text).toContain("Up to date · checked 5 minutes ago");
    expect(text).toContain(
      "You can’t edit Notion’s details here. Edit them in Notion.",
    );
    expect(text).toContain("The pages stay here and stay yours to edit.");
    expect(text).not.toContain("trim(lower(value))");

    await click(button("More"));
    expect(panel("notion").textContent).toContain(
      "Pages are matched on Name, ignoring capitals.",
    );

    await click(button("Choose details"));
    expect(onChooseDetails).toHaveBeenCalledTimes(1);

    await click(button("Sync now"));
    expect(refresh.mutate.mock.calls[0]?.[0]).toEqual({
      documentId: "doc-1",
      sourceId: "source-2",
      fullRefresh: true,
    });
  });

  it("says no details are chosen yet before any are chosen", () => {
    renderUi(
      <NotionDetailsSourcePanel
        source={details("notion-database", [
          { propertyId: null, mappingType: "field" },
          { propertyId: "prop-title", mappingType: "title" },
        ])}
        documentId="doc-1"
        canEdit
        pageCount={3}
        rolePending={false}
        onChooseDetails={vi.fn()}
        onUnlinked={vi.fn()}
      />,
    );
    const text = panel("notion").textContent;
    expect(text).toContain("No details chosen yet.");
    expect(text).not.toContain("Up to date");
  });

  it("offers Builder details a way back to adding items, behind More", async () => {
    const onAddAsItems = vi.fn();
    renderUi(
      <BuilderDetailsSourcePanel
        source={details("builder-cms")}
        documentId="doc-1"
        canEdit
        pageCount={3}
        syncPending={false}
        syncDisabled={false}
        rolePending={false}
        onSyncNow={vi.fn()}
        onChooseDetails={vi.fn()}
        onAddAsItems={onAddAsItems}
        onUnlinked={vi.fn()}
      />,
    );
    expect(panel("builder").textContent).toContain(
      "You can’t edit Builder’s details here. Edit them in Builder.",
    );
    expect(queryButton("Add as items")).toBe(null);
    await click(button("More"));
    await click(button("Add as items"));
    expect(onAddAsItems).toHaveBeenCalledTimes(1);
  });
});

describe("sourceMatchedOnText", () => {
  const federation = (normalizationFormula: string) =>
    ({
      role: "secondary",
      keyField: "url",
      canonicalKey: { label: "URL" },
      normalizationFormula,
    }) as never;

  it("puts the usual match rules in words", () => {
    expect(sourceMatchedOnText(federation("value"))).toBe(
      "Pages are matched on URL.",
    );
    expect(sourceMatchedOnText(federation("trim({url})"))).toBe(
      "Pages are matched on URL.",
    );
    expect(sourceMatchedOnText(federation("lower(trim({url}))"))).toBe(
      "Pages are matched on URL, ignoring capitals.",
    );
    expect(sourceMatchedOnText(federation("trim( lower(value) )"))).toBe(
      "Pages are matched on URL, ignoring capitals.",
    );
  });

  it("calls anything else a custom rule", () => {
    expect(
      sourceMatchedOnText(federation('replace(lower(value), "-", " ")')),
    ).toBe("Pages are matched on URL with a custom rule.");
  });
});
