import { describe, expect, it } from "vitest";

import type {
  ContentDatabaseSource,
  ContentDatabaseSourceChangeSet,
} from "../shared/api";
import { BUILDER_CMS_SAFE_WRITE_MODEL } from "../shared/api";
import {
  buildBuilderCmsExecutionPlan,
  builderCmsExecutionIdempotencyKey,
  validateBuilderCmsExecutionDryRun,
} from "./_builder-cms-write-adapter";

function source(
  liveWritesEnabled = false,
  sourceTable = "blog_article",
): ContentDatabaseSource {
  return {
    id: "source-1",
    databaseId: "database-1",
    sourceType: "builder-cms",
    sourceName: "Builder CMS",
    sourceTable,
    syncState: "idle",
    freshness: "fresh",
    lastRefreshedAt: null,
    lastSourceUpdatedAt: null,
    lastError: null,
    capabilities: {
      canRefresh: true,
      canCreateChangeSets: true,
      canWriteFields: true,
      canWriteBody: true,
      canPush: true,
      canPull: true,
      canPublish: true,
      canDelete: false,
      canStageLocalRevision: true,
      liveWritesEnabled,
      readOnlyRefresh: true,
    },
    metadata: {
      primaryKey: "id",
      titleField: "data.title",
      naturalKeyField: "/blog/[slug]",
      pushMode: "autosave",
    },
    fields: [],
    rows: [
      {
        id: "row-1",
        databaseItemId: "item-1",
        documentId: "doc-1",
        sourceRowId: "builder-entry-1",
        sourceQualifiedId: `builder-cms://${sourceTable}/builder-entry-1`,
        sourceDisplayKey: "Old title",
        provenance: "Builder CMS fixture adapter",
        syncState: "idle",
        freshness: "fresh",
        lastSyncedAt: "2026-06-08T00:00:00.000Z",
        lastSourceUpdatedAt: "2026-06-08T00:00:00.000Z",
      },
    ],
    changeSets: [],
  };
}

function approvedChangeSet(): ContentDatabaseSourceChangeSet {
  return {
    id: "change-1",
    databaseItemId: "item-1",
    documentId: "doc-1",
    kind: "field_update",
    direction: "outbound",
    state: "approved",
    pushMode: "autosave",
    localOnly: true,
    summary: "Approved local Builder title change.",
    fieldChanges: [
      {
        propertyId: null,
        propertyName: "Title",
        localFieldKey: "title",
        sourceFieldKey: "data.title",
        currentValue: "Old title",
        proposedValue: "New title",
      },
    ],
    bodyChange: null,
    riskLevel: "low",
    riskReasons: ["single field diff"],
    conflictState: "none",
    reviewEvents: [],
    executions: [],
    createdAt: "2026-06-08T00:00:00.000Z",
    updatedAt: "2026-06-08T00:00:00.000Z",
  };
}

describe("Builder CMS write adapter plan", () => {
  it("creates deterministic execution keys", () => {
    expect(
      builderCmsExecutionIdempotencyKey({
        sourceId: "source-1",
        changeSetId: "change-1",
        pushMode: "autosave",
      }),
    ).toBe("builder-cms:source-1:change-1:autosave");
  });

  it("prepares a write-disabled execution plan by default", () => {
    expect(
      buildBuilderCmsExecutionPlan({
        source: source(false),
        changeSet: approvedChangeSet(),
        pushModeConfirmation: "autosave",
      }),
    ).toMatchObject({
      adapter: "builder-cms",
      pushMode: "autosave",
      state: "write_disabled",
      idempotencyKey: "builder-cms:source-1:change-1:autosave",
      payload: {
        sourceTable: "blog_article",
        intent: "autosave_revision",
        target: {
          entryId: "builder-entry-1",
        },
        request: {
          method: "PATCH",
          path: "/api/v1/write/blog_article/builder-entry-1",
          query: {
            autoSaveOnly: "true",
            triggerWebhooks: "false",
          },
          body: {
            data: {
              title: "New title",
            },
          },
        },
        operations: [
          {
            sourceFieldKey: "data.title",
            localFieldKey: "title",
            value: "New title",
          },
        ],
        safety: {
          liveWritesEnabled: false,
          dryRunOnly: true,
          blockers: [],
        },
      },
      lastError: "Live Builder writes are disabled for this source.",
    });
  });

  it("returns ready when live writes are configured for the safe Builder test model", () => {
    expect(
      buildBuilderCmsExecutionPlan({
        source: source(true, BUILDER_CMS_SAFE_WRITE_MODEL),
        changeSet: approvedChangeSet(),
        pushModeConfirmation: "autosave",
      }),
    ).toMatchObject({
      state: "ready",
      summary: "Prepared Builder autosave execution. Ready to send to Builder.",
      payload: {
        sourceTable: BUILDER_CMS_SAFE_WRITE_MODEL,
        request: {
          method: "PATCH",
          path: `/api/v1/write/${BUILDER_CMS_SAFE_WRITE_MODEL}/builder-entry-1`,
        },
        safety: {
          liveWritesEnabled: true,
          dryRunOnly: false,
          blockers: [],
        },
      },
      lastError: null,
    });
  });

  it("encodes Builder write path segments", () => {
    const plan = buildBuilderCmsExecutionPlan({
      source: {
        ...source(false, "folder/blog article"),
        rows: [
          {
            ...source(false, "folder/blog article").rows[0],
            sourceRowId: "entry/with spaces",
            sourceQualifiedId:
              "builder-cms://folder/blog article/entry/with spaces",
          },
        ],
      },
      changeSet: approvedChangeSet(),
      pushModeConfirmation: "autosave",
    });

    expect(plan.payload.request.path).toBe(
      "/api/v1/write/folder%2Fblog%20article/entry%2Fwith%20spaces",
    );
  });

  it("blocks live autosave for unmatched legacy fixture-wrapped Builder rows", () => {
    const plan = buildBuilderCmsExecutionPlan({
      source: {
        ...source(true, BUILDER_CMS_SAFE_WRITE_MODEL),
        rows: [
          {
            ...source(true, BUILDER_CMS_SAFE_WRITE_MODEL).rows[0],
            documentId: "BU5P0mT9anul",
            sourceRowId: "builder-BU5P0mT9anul",
            sourceQualifiedId: `builder-cms://${BUILDER_CMS_SAFE_WRITE_MODEL}/builder-BU5P0mT9anul`,
            provenance: "Builder CMS fixture adapter",
          },
        ],
      },
      changeSet: {
        ...approvedChangeSet(),
        documentId: "BU5P0mT9anul",
      },
      pushModeConfirmation: "autosave",
    });

    expect(plan).toMatchObject({
      state: "blocked",
      lastError:
        "This row is not matched to a Builder entry yet. Refresh or match a Builder row before pushing.",
      payload: {
        target: {
          entryId: null,
          sourceQualifiedId: null,
        },
        request: {
          method: "PATCH",
          path: `/api/v1/write/${BUILDER_CMS_SAFE_WRITE_MODEL}`,
          query: {
            autoSaveOnly: "true",
            triggerWebhooks: "false",
          },
          body: {
            data: {
              title: "New title",
            },
          },
        },
        safety: {
          dryRunOnly: true,
          blockers: [
            "This row is not matched to a Builder entry yet. Refresh or match a Builder row before pushing.",
          ],
        },
      },
    });
  });

  it("blocks live writes for Builder models outside the safe test collection", () => {
    expect(
      buildBuilderCmsExecutionPlan({
        source: source(true, "blog_article"),
        changeSet: approvedChangeSet(),
        pushModeConfirmation: "autosave",
      }),
    ).toMatchObject({
      state: "blocked",
      lastError: `Live Builder writes are only allowed for ${BUILDER_CMS_SAFE_WRITE_MODEL}.`,
      payload: {
        safety: {
          liveWritesEnabled: true,
          dryRunOnly: true,
          blockers: [
            `Live Builder writes are only allowed for ${BUILDER_CMS_SAFE_WRITE_MODEL}.`,
          ],
        },
      },
    });
  });

  it("blocks autosave execution when the Builder entry ID is missing", () => {
    expect(
      buildBuilderCmsExecutionPlan({
        source: {
          ...source(true, BUILDER_CMS_SAFE_WRITE_MODEL),
          rows: [],
        },
        changeSet: approvedChangeSet(),
        pushModeConfirmation: "autosave",
      }),
    ).toMatchObject({
      state: "blocked",
      lastError: "Autosave requires an existing Builder entry ID.",
      payload: {
        safety: {
          blockers: ["Autosave requires an existing Builder entry ID."],
        },
      },
    });
  });

  it("keeps publish blocked without explicit adapter opt-in", () => {
    expect(
      buildBuilderCmsExecutionPlan({
        source: source(true, BUILDER_CMS_SAFE_WRITE_MODEL),
        changeSet: {
          ...approvedChangeSet(),
          pushMode: "publish",
        },
        pushModeConfirmation: "publish",
      }),
    ).toMatchObject({
      state: "blocked",
      lastError: "Publish writes require explicit adapter opt-in.",
      payload: {
        intent: "publish",
        request: {
          body: {
            data: {
              title: "New title",
            },
            published: "published",
          },
        },
        safety: {
          blockers: ["Publish writes require explicit adapter opt-in."],
        },
      },
    });
  });

  it("keeps draft blocked for existing entries without explicit adapter opt-in", () => {
    expect(
      buildBuilderCmsExecutionPlan({
        source: source(true, BUILDER_CMS_SAFE_WRITE_MODEL),
        changeSet: {
          ...approvedChangeSet(),
          pushMode: "draft",
        },
        pushModeConfirmation: "draft",
      }),
    ).toMatchObject({
      state: "blocked",
      lastError:
        "Draft writes require explicit adapter opt-in because draft can affect already-live content.",
      payload: {
        intent: "save_draft",
        request: {
          body: {
            data: {
              title: "New title",
            },
            published: "draft",
          },
        },
      },
    });
  });

  it("keeps draft blocked for new entries without explicit adapter opt-in", () => {
    const plan = buildBuilderCmsExecutionPlan({
      source: {
        ...source(true, BUILDER_CMS_SAFE_WRITE_MODEL),
        rows: [],
      },
      changeSet: {
        ...approvedChangeSet(),
        pushMode: "draft",
      },
      pushModeConfirmation: "draft",
    });

    expect(plan).toMatchObject({
      state: "blocked",
      lastError:
        "Draft writes require explicit adapter opt-in because draft can affect already-live content.",
      payload: {
        intent: "save_draft",
        target: {
          entryId: null,
        },
        request: {
          method: "POST",
          body: {
            published: "draft",
          },
        },
        safety: {
          blockers: [
            "Draft writes require explicit adapter opt-in because draft can affect already-live content.",
          ],
        },
      },
    });
  });

  it("requires approved outbound changes", () => {
    expect(() =>
      buildBuilderCmsExecutionPlan({
        source: source(false),
        changeSet: {
          ...approvedChangeSet(),
          state: "staged_revision",
        },
      }),
    ).toThrow(/Approve/);
  });

  it("validates a stored dry-run payload when it matches the rebuilt plan", () => {
    const plan = buildBuilderCmsExecutionPlan({
      source: source(false),
      changeSet: approvedChangeSet(),
      pushModeConfirmation: "autosave",
    });

    expect(
      validateBuilderCmsExecutionDryRun({
        storedPayload: plan.payload,
        plan,
        now: "2026-06-08T01:00:00.000Z",
      }),
    ).toMatchObject({
      dryRun: {
        status: "validated",
        validatedAt: "2026-06-08T01:00:00.000Z",
        mismatches: [],
      },
    });
  });

  it("marks a stored dry-run payload stale when the request no longer matches", () => {
    const plan = buildBuilderCmsExecutionPlan({
      source: source(false),
      changeSet: approvedChangeSet(),
      pushModeConfirmation: "autosave",
    });

    const payload = validateBuilderCmsExecutionDryRun({
      storedPayload: {
        ...plan.payload,
        request: {
          ...plan.payload.request,
          query: {},
        },
      },
      plan,
      now: "2026-06-08T01:00:00.000Z",
    });

    expect(payload).toMatchObject({
      request: {
        query: {},
      },
      dryRun: {
        status: "stale",
        mismatches: [
          "Stored Builder request no longer matches the approved change.",
        ],
      },
    });
  });

  it("preserves stale stored payloads instead of self-healing them", () => {
    const plan = buildBuilderCmsExecutionPlan({
      source: source(false),
      changeSet: approvedChangeSet(),
      pushModeConfirmation: "autosave",
    });

    const payload = validateBuilderCmsExecutionDryRun({
      storedPayload: {
        intent: plan.payload.intent,
        target: plan.payload.target,
        operations: plan.payload.operations,
      },
      plan,
      now: "2026-06-08T01:00:00.000Z",
    });

    expect(payload).not.toHaveProperty("request");
    expect(payload).toMatchObject({
      dryRun: {
        status: "stale",
        mismatches: [
          "Stored Builder request no longer matches the approved change.",
        ],
      },
    });
  });

  it("marks a stored dry-run payload stale when required sections are missing", () => {
    const plan = buildBuilderCmsExecutionPlan({
      source: source(false),
      changeSet: approvedChangeSet(),
      pushModeConfirmation: "autosave",
    });

    expect(
      validateBuilderCmsExecutionDryRun({
        storedPayload: {
          intent: plan.payload.intent,
          target: plan.payload.target,
          operations: plan.payload.operations,
        },
        plan,
        now: "2026-06-08T01:00:00.000Z",
      }),
    ).toMatchObject({
      dryRun: {
        status: "stale",
        mismatches: [
          "Stored Builder request no longer matches the approved change.",
        ],
      },
    });
  });
});
