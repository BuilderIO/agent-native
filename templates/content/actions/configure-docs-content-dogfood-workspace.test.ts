import { describe, expect, it } from "vitest";

import {
  buildDocsContentDogfoodViewConfig,
  deriveDogfoodRowStatus,
  mergeDogfoodViews,
} from "./configure-docs-content-dogfood-workspace";

const propertyIds = {
  persona: "persona",
  topic: "topic",
  useCase: "use-case",
  seoAngle: "seo-angle",
  owner: "owner",
  sourceStatus: "source-status",
  safeToEdit: "safe-to-edit",
  needsReview: "needs-review",
  unsupportedBlocks: "unsupported-blocks",
  unsupportedBlockNotes: "unsupported-block-notes",
};

describe("configure docs/content dogfood workspace", () => {
  it("builds practical views for docs/blog operations", () => {
    const config = buildDocsContentDogfoodViewConfig(propertyIds);

    expect(config.activeViewId).toBe("docs-content-ops");
    expect(config.views.map((view) => view.name)).toEqual([
      "Docs/blog ops",
      "Needs review",
      "Safe local drafts",
      "Unsupported blocks",
      "Safe-to-edit board",
    ]);
    expect(config.views[0]).toMatchObject({
      rowDensity: "compact",
      wrapCells: true,
      calculations: {
        "source-status": "count_values",
        "safe-to-edit": "count_values",
        "needs-review": "count_checked",
        "unsupported-blocks": "count_checked",
      },
    });
    expect(config.views[4]).toMatchObject({
      type: "board",
      groupByPropertyId: "safe-to-edit",
      hideEmptyGroups: true,
    });
  });

  it("merges dogfood views without removing existing custom views", () => {
    const dogfood = buildDocsContentDogfoodViewConfig(propertyIds);
    const merged = mergeDogfoodViews(
      {
        activeViewId: "custom-seo",
        views: [
          {
            id: "custom-seo",
            name: "SEO copy",
            type: "table",
            sorts: [],
            filters: [],
            filterMode: "and",
            columnWidths: { name: 360 },
            propertyOrderIds: ["name"],
            hiddenPropertyIds: [],
            collapsedGroupIds: [],
            hideEmptyGroups: false,
            calculations: {},
            wrapCells: true,
            rowDensity: "comfortable",
            openPagesIn: "full",
          },
          {
            ...dogfood.views[0],
            name: "Old dogfood view",
            rowDensity: "comfortable",
          },
        ],
        sorts: [],
        filters: [],
        columnWidths: { name: 360 },
      },
      dogfood,
    );

    expect(merged.activeViewId).toBe("custom-seo");
    expect(merged.views.map((view) => view.id)).toEqual([
      "custom-seo",
      "docs-content-ops",
      "docs-content-needs-review",
      "docs-content-safe",
      "docs-content-unsupported",
      "docs-content-safe-board",
    ]);
    expect(merged.views.find((view) => view.id === "custom-seo")).toMatchObject(
      {
        name: "SEO copy",
        rowDensity: "comfortable",
      },
    );
    expect(
      merged.views.find((view) => view.id === "docs-content-ops"),
    ).toMatchObject({
      name: "Docs/blog ops",
      rowDensity: "compact",
    });
  });

  it("marks fresh Builder rows as safe local drafts", () => {
    expect(
      deriveDogfoodRowStatus({
        item: {
          document: { id: "doc-1" },
          bodyHydration: { status: "hydrated", error: null },
        },
        source: {
          id: "source-1",
          databaseId: "database",
          sourceType: "builder-cms",
          sourceName: "Builder CMS",
          sourceTable: "blog-article",
          syncState: "linked",
          freshness: "fresh",
          lastRefreshedAt: null,
          lastSourceUpdatedAt: null,
          lastError: null,
          capabilities: {
            canRefresh: true,
            canCreateChangeSets: true,
            canWriteFields: false,
            canWriteBody: false,
            canPush: false,
            canPull: false,
            canPublish: false,
            canDelete: false,
            canStageLocalRevision: false,
            liveWritesEnabled: false,
            readOnlyRefresh: true,
          },
          metadata: {
            primaryKey: "id",
            titleField: "name",
          },
          fields: [],
          rows: [
            {
              id: "row-1",
              databaseItemId: "item-1",
              documentId: "doc-1",
              sourceRowId: "entry-1",
              sourceQualifiedId: "blog-article:entry-1",
              sourceDisplayKey: "Fresh post",
              provenance: "source",
              syncState: "linked",
              freshness: "fresh",
              lastSyncedAt: null,
              lastSourceUpdatedAt: null,
            },
          ],
          changeSets: [],
        },
      }),
    ).toMatchObject({
      sourceStatus: "fresh",
      safeToEdit: "safe-local-draft",
      needsReview: false,
      unsupportedBlocks: false,
      unsupportedBlockNotes: "",
    });
  });

  it("blocks rows with unsupported Builder body warnings", () => {
    expect(
      deriveDogfoodRowStatus({
        item: {
          document: { id: "doc-2" },
          bodyHydration: { status: "hydrated", error: null },
        },
        source: {
          id: "source-1",
          databaseId: "database",
          sourceType: "builder-cms",
          sourceName: "Builder CMS",
          sourceTable: "docs-content",
          syncState: "linked",
          freshness: "fresh",
          lastRefreshedAt: null,
          lastSourceUpdatedAt: null,
          lastError: null,
          capabilities: {
            canRefresh: true,
            canCreateChangeSets: true,
            canWriteFields: false,
            canWriteBody: false,
            canPush: false,
            canPull: false,
            canPublish: false,
            canDelete: false,
            canStageLocalRevision: false,
            liveWritesEnabled: false,
            readOnlyRefresh: true,
          },
          metadata: {
            primaryKey: "id",
            titleField: "name",
          },
          fields: [],
          rows: [
            {
              id: "row-2",
              databaseItemId: "item-2",
              documentId: "doc-2",
              sourceRowId: "entry-2",
              sourceQualifiedId: "docs-content:entry-2",
              sourceDisplayKey: "Needs mapping",
              provenance: "source",
              syncState: "linked",
              freshness: "fresh",
              lastSyncedAt: null,
              lastSourceUpdatedAt: null,
            },
          ],
          changeSets: [
            {
              id: "change-1",
              databaseItemId: "item-2",
              documentId: "doc-2",
              kind: "body_update",
              direction: "outbound",
              state: "proposed",
              pushMode: null,
              localOnly: true,
              summary: "Builder body blocks changed.",
              fieldChanges: [],
              bodyChange: {
                summary: "Builder body blocks changed.",
                currentExcerpt: null,
                proposedExcerpt: null,
                warnings: ["Unsupported Builder MDX component: <Symbol>."],
              },
              riskLevel: "medium",
              riskReasons: ["body diff"],
              conflictState: "none",
              reviewEvents: [],
              executions: [],
              createdAt: "2026-07-01T00:00:00.000Z",
              updatedAt: "2026-07-01T00:00:00.000Z",
            },
          ],
        },
      }),
    ).toMatchObject({
      sourceStatus: "fresh",
      safeToEdit: "blocked",
      needsReview: true,
      unsupportedBlocks: true,
      unsupportedBlockNotes: "Unsupported Builder MDX component: <Symbol>.",
    });
  });
});
