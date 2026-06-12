import { describe, expect, it } from "vitest";
import type {
  ContentDatabaseSource,
  ContentDatabaseSourceChangeSet,
} from "../shared/api";
import {
  buildBuilderCmsExecutionPlan,
  builderCmsExecutionIdempotencyKey,
  validateBuilderCmsExecutionDryRun,
} from "./_builder-cms-write-adapter";

function source(liveWritesEnabled = false): ContentDatabaseSource {
  return {
    id: "source-1",
    databaseId: "database-1",
    sourceType: "builder-cms",
    sourceName: "Builder CMS",
    sourceTable: "blog_article",
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
        sourceQualifiedId: "builder-cms://blog_article/builder-entry-1",
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

  it("keeps the plan write-disabled even when live writes are configured", () => {
    expect(
      buildBuilderCmsExecutionPlan({
        source: source(true),
        changeSet: approvedChangeSet(),
        pushModeConfirmation: "autosave",
      }),
    ).toMatchObject({
      state: "write_disabled",
      lastError: "Live Builder writes are disabled for this source.",
    });
  });

  it("blocks autosave execution when the Builder entry ID is missing", () => {
    expect(
      buildBuilderCmsExecutionPlan({
        source: {
          ...source(true),
          rows: [],
        },
        changeSet: approvedChangeSet(),
        pushModeConfirmation: "autosave",
      }),
    ).toMatchObject({
      state: "write_disabled",
      lastError: "Live Builder writes are disabled for this source.",
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
        source: source(true),
        changeSet: {
          ...approvedChangeSet(),
          pushMode: "publish",
        },
        pushModeConfirmation: "publish",
      }),
    ).toMatchObject({
      state: "write_disabled",
      lastError: "Live Builder writes are disabled for this source.",
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
        source: source(true),
        changeSet: {
          ...approvedChangeSet(),
          pushMode: "draft",
        },
        pushModeConfirmation: "draft",
      }),
    ).toMatchObject({
      state: "write_disabled",
      lastError: "Live Builder writes are disabled for this source.",
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
        ...source(true),
        rows: [],
      },
      changeSet: {
        ...approvedChangeSet(),
        pushMode: "draft",
      },
      pushModeConfirmation: "draft",
    });

    expect(plan).toMatchObject({
      state: "write_disabled",
      lastError: "Live Builder writes are disabled for this source.",
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
