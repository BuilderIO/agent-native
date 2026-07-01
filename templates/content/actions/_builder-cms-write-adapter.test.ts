import { describe, expect, it } from "vitest";

import type {
  ContentDatabaseSource,
  ContentDatabaseSourceChangeSet,
} from "../shared/api";
import { BUILDER_CMS_SAFE_WRITE_MODEL } from "../shared/api";
import {
  buildBuilderCmsExecutionPlan,
  builderCmsExecutionIdempotencyKey,
  resolveBuilderCmsExecutionPushMode,
  validateBuilderCmsExecutionDryRun,
} from "./_builder-cms-write-adapter";

function source(
  liveWritesEnabled = false,
  sourceTable = "blog_article",
  metadata: Partial<ContentDatabaseSource["metadata"]> = {},
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
      ...metadata,
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
    const plan = buildBuilderCmsExecutionPlan({
      source: source(false),
      changeSet: approvedChangeSet(),
      pushModeConfirmation: "autosave",
    });

    expect(plan).toMatchObject({
      adapter: "builder-cms",
      pushMode: "autosave",
      state: "write_disabled",
      idempotencyKey: "builder-cms:source-1:change-1:autosave",
      payload: {
        sourceTable: "blog_article",
        effect: "autosave",
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
    expect(plan.payload.request.body).not.toHaveProperty("published");
  });

  it("returns ready when live writes are configured for the safe Builder test model", () => {
    const plan = buildBuilderCmsExecutionPlan({
      source: source(true, BUILDER_CMS_SAFE_WRITE_MODEL),
      changeSet: approvedChangeSet(),
      pushModeConfirmation: "autosave",
    });

    expect(plan).toMatchObject({
      state: "ready",
      summary: "Prepared Builder autosave execution. Ready to send to Builder.",
      payload: {
        effect: "autosave",
        sourceTable: BUILDER_CMS_SAFE_WRITE_MODEL,
        request: {
          method: "PATCH",
          path: `/api/v1/write/${BUILDER_CMS_SAFE_WRITE_MODEL}/builder-entry-1`,
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
          liveWritesEnabled: true,
          dryRunOnly: false,
          blockers: [],
        },
      },
      lastError: null,
    });
    expect(plan.payload.request.body).not.toHaveProperty("published");
  });

  it("derives autosave effect from stage-only write mode", () => {
    const plan = buildBuilderCmsExecutionPlan({
      source: source(true, BUILDER_CMS_SAFE_WRITE_MODEL, {
        writeMode: "stage_only",
        pushMode: "autosave",
        allowedWriteModes: ["autosave"],
      }),
      changeSet: {
        ...approvedChangeSet(),
        pushMode: "publish",
      },
      pushModeConfirmation: "autosave",
    });

    expect(plan).toMatchObject({
      state: "ready",
      pushMode: "autosave",
      payload: {
        effect: "autosave",
        request: {
          query: {
            autoSaveOnly: "true",
            triggerWebhooks: "false",
          },
        },
      },
    });
  });

  it("derives update-in-place effect from publish-updates write mode", () => {
    const plan = buildBuilderCmsExecutionPlan({
      source: source(true, BUILDER_CMS_SAFE_WRITE_MODEL, {
        writeMode: "publish_updates",
        pushMode: "publish",
        allowedWriteModes: ["autosave", "publish"],
      }),
      changeSet: approvedChangeSet(),
      pushModeConfirmation: "publish",
    });

    expect(plan).toMatchObject({
      state: "ready",
      pushMode: "publish",
      payload: {
        effect: "update_in_place",
        request: {
          method: "PATCH",
          query: {
            triggerWebhooks: "true",
          },
        },
        safety: {
          blockers: [],
        },
      },
    });
    expect(plan.payload.request.body).not.toHaveProperty("published");
  });

  it("prepares update-in-place for existing live-write edits without a transition", () => {
    const plan = buildBuilderCmsExecutionPlan({
      source: source(true, BUILDER_CMS_SAFE_WRITE_MODEL),
      changeSet: {
        ...approvedChangeSet(),
        pushMode: "draft",
      },
      pushModeConfirmation: "draft",
    });

    expect(plan).toMatchObject({
      state: "ready",
      payload: {
        effect: "update_in_place",
        request: {
          method: "PATCH",
          path: `/api/v1/write/${BUILDER_CMS_SAFE_WRITE_MODEL}/builder-entry-1`,
          query: {
            triggerWebhooks: "true",
          },
          body: {
            data: {
              title: "New title",
            },
          },
        },
        safety: {
          blockers: [],
          checks: expect.arrayContaining([
            "Update in place preserves publication state — no published field is sent.",
          ]),
        },
      },
    });
    expect(plan.payload.request.body).not.toHaveProperty("published");
  });

  it("prepares create-draft for new Builder entries", () => {
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
      state: "ready",
      payload: {
        effect: "create_draft",
        target: {
          entryId: null,
        },
        request: {
          method: "POST",
          path: `/api/v1/write/${BUILDER_CMS_SAFE_WRITE_MODEL}`,
          query: {
            triggerWebhooks: "false",
          },
          body: {
            data: {
              title: "New title",
            },
            published: "draft",
          },
        },
        safety: {
          blockers: [],
        },
      },
    });
  });

  it("resolves the gate push mode from the tier, ignoring a change-set's own pushMode", () => {
    // Local create change-sets hardcode pushMode "autosave". Under the
    // publish_updates tier the gate must still key on the tier mode ("publish"),
    // so prepare and execute compute the same idempotency key.
    const publishUpdatesSource = source(true, BUILDER_CMS_SAFE_WRITE_MODEL, {
      writeMode: "publish_updates",
      pushMode: "publish",
      allowedWriteModes: ["autosave", "publish"],
    });
    const autosaveChangeSet: ContentDatabaseSourceChangeSet = {
      ...approvedChangeSet(),
      pushMode: "autosave",
    };

    expect(
      resolveBuilderCmsExecutionPushMode({
        source: publishUpdatesSource,
        changeSet: autosaveChangeSet,
      }),
    ).toBe("publish");
  });

  it("keys a tier create-draft gate on the tier push mode, not autosave", () => {
    // Reproduces the create-push regression: a new-row create change-set
    // (no matched Builder entry, pushMode "autosave") pushed with no explicit
    // confirmation under publish_updates. Prepare's gate key must be :publish so
    // execute — which resolves the same way — finds the gate.
    const plan = buildBuilderCmsExecutionPlan({
      source: {
        ...source(true, BUILDER_CMS_SAFE_WRITE_MODEL, {
          writeMode: "publish_updates",
          pushMode: "publish",
          allowedWriteModes: ["autosave", "publish"],
        }),
        rows: [],
      },
      changeSet: {
        ...approvedChangeSet(),
        pushMode: "autosave",
      },
    });

    expect(plan.payload.effect).toBe("create_draft");
    expect(plan.idempotencyKey).toBe("builder-cms:source-1:change-1:publish");
  });

  it("blocks publication transitions when the source has not enabled them", () => {
    const plan = buildBuilderCmsExecutionPlan({
      source: source(true, BUILDER_CMS_SAFE_WRITE_MODEL, {
        writeMode: "publish_updates",
        pushMode: "publish",
        allowedWriteModes: ["autosave", "publish"],
        allowPublicationTransitions: false,
      }),
      changeSet: {
        ...approvedChangeSet(),
        pushMode: "publish",
      },
      pushModeConfirmation: "publish",
      publicationTransition: "publish",
    });

    expect(plan).toMatchObject({
      state: "blocked",
      payload: {
        effect: "publish",
        safety: {
          blockers: [
            "Publication transitions are not enabled for this source.",
          ],
        },
      },
    });
  });

  it("prepares explicit publish transitions when the source allows them", () => {
    const plan = buildBuilderCmsExecutionPlan({
      source: source(true, BUILDER_CMS_SAFE_WRITE_MODEL, {
        writeMode: "publish_updates",
        pushMode: "publish",
        allowedWriteModes: ["autosave", "publish"],
        allowPublicationTransitions: true,
      }),
      changeSet: {
        ...approvedChangeSet(),
        pushMode: "publish",
      },
      pushModeConfirmation: "publish",
      publicationTransition: "publish",
    });

    expect(plan).toMatchObject({
      state: "ready",
      payload: {
        effect: "publish",
        request: {
          method: "PATCH",
          path: `/api/v1/write/${BUILDER_CMS_SAFE_WRITE_MODEL}/builder-entry-1`,
          query: {
            triggerWebhooks: "true",
          },
          body: {
            data: {
              title: "New title",
            },
            published: "published",
          },
        },
        safety: {
          blockers: [],
        },
      },
    });
  });

  it("blocks unpublish transitions without explicit confirmation", () => {
    const plan = buildBuilderCmsExecutionPlan({
      source: source(true, BUILDER_CMS_SAFE_WRITE_MODEL, {
        writeMode: "publish_updates",
        pushMode: "publish",
        allowedWriteModes: ["autosave", "publish"],
        allowPublicationTransitions: true,
      }),
      changeSet: {
        ...approvedChangeSet(),
        pushMode: "publish",
      },
      pushModeConfirmation: "publish",
      publicationTransition: "unpublish",
    });

    expect(plan).toMatchObject({
      state: "blocked",
      lastError: "Unpublish requires explicit confirmation.",
      payload: {
        effect: "unpublish",
        request: {
          method: "PATCH",
          query: {
            triggerWebhooks: "true",
          },
          body: {
            data: {
              title: "New title",
            },
            published: "draft",
          },
        },
        safety: {
          blockers: ["Unpublish requires explicit confirmation."],
        },
      },
    });
  });

  it("prepares confirmed unpublish transitions", () => {
    const plan = buildBuilderCmsExecutionPlan({
      source: source(true, BUILDER_CMS_SAFE_WRITE_MODEL, {
        writeMode: "publish_updates",
        pushMode: "publish",
        allowedWriteModes: ["autosave", "publish"],
        allowPublicationTransitions: true,
      }),
      changeSet: {
        ...approvedChangeSet(),
        pushMode: "publish",
      },
      pushModeConfirmation: "publish",
      publicationTransition: "unpublish",
      confirmUnpublish: true,
    });

    expect(plan).toMatchObject({
      state: "ready",
      payload: {
        effect: "unpublish",
        request: {
          method: "PATCH",
          query: {
            triggerWebhooks: "true",
          },
          body: {
            published: "draft",
          },
        },
        safety: {
          blockers: [],
        },
      },
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

  it("creates a draft for an unmatched (synthetic-fixture) Builder row", () => {
    // A row synthesized as `builder-<documentId>` has no real Builder entry, so
    // its effect is create_draft. Creating a new entry from such a row is the
    // intended behavior — the unmatched-row blocker only applies to effects that
    // write to an existing entry (autosave / update_in_place).
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
      state: "ready",
      lastError: null,
      payload: {
        effect: "create_draft",
        target: {
          entryId: null,
          sourceQualifiedId: null,
        },
        request: {
          method: "POST",
          path: `/api/v1/write/${BUILDER_CMS_SAFE_WRITE_MODEL}`,
          query: {
            triggerWebhooks: "false",
          },
          body: {
            data: {
              title: "New title",
            },
            published: "draft",
          },
        },
        safety: {
          dryRunOnly: false,
          blockers: [],
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

  it("blocks publication transitions for Builder models outside the safe test collection", () => {
    expect(
      buildBuilderCmsExecutionPlan({
        source: source(true, "blog_article", {
          writeMode: "publish_updates",
          pushMode: "publish",
          allowedWriteModes: ["autosave", "publish"],
          allowPublicationTransitions: true,
        }),
        changeSet: {
          ...approvedChangeSet(),
          pushMode: "publish",
        },
        pushModeConfirmation: "publish",
        publicationTransition: "publish",
      }),
    ).toMatchObject({
      state: "blocked",
      payload: {
        effect: "publish",
        safety: {
          blockers: [
            `Live Builder writes are only allowed for ${BUILDER_CMS_SAFE_WRITE_MODEL}.`,
          ],
        },
      },
    });
  });

  it("keeps legacy publish push mode state-preserving without a transition", () => {
    const plan = buildBuilderCmsExecutionPlan({
      source: source(true, BUILDER_CMS_SAFE_WRITE_MODEL),
      changeSet: {
        ...approvedChangeSet(),
        pushMode: "publish",
      },
      pushModeConfirmation: "publish",
    });

    expect(plan).toMatchObject({
      state: "ready",
      payload: {
        effect: "update_in_place",
        request: {
          query: {
            triggerWebhooks: "true",
          },
          body: {
            data: {
              title: "New title",
            },
          },
        },
      },
    });
    expect(plan.payload.request.body).not.toHaveProperty("published");
  });

  it("prepares converted body diffs as Builder blocks without field operations", () => {
    const plan = buildBuilderCmsExecutionPlan({
      source: source(true, BUILDER_CMS_SAFE_WRITE_MODEL),
      changeSet: {
        ...approvedChangeSet(),
        kind: "body_update",
        fieldChanges: [],
        bodyChange: {
          summary: "Body changed",
          currentExcerpt: "Old",
          proposedExcerpt: "New",
          currentHash: "old-hash",
          proposedHash: "new-hash",
          proposedContent: "New",
          proposedBlocksJson: JSON.stringify([
            {
              "@type": "@builder.io/sdk:Element",
              component: {
                name: "Text",
                options: {
                  text: "New",
                },
              },
            },
          ]),
          sidecarsJson: "{}",
          warnings: [],
        },
      },
      pushModeConfirmation: "autosave",
    });

    expect(plan).toMatchObject({
      state: "ready",
      payload: {
        request: {
          body: {
            data: {
              blocks: [
                {
                  "@type": "@builder.io/sdk:Element",
                  component: {
                    name: "Text",
                    options: {
                      text: "New",
                    },
                  },
                },
              ],
            },
          },
        },
        safety: {
          blockers: [],
          checks: expect.arrayContaining([
            "Includes converted Builder body blocks.",
          ]),
        },
      },
    });
  });

  it("blocks body diffs that have not produced Builder blocks", () => {
    const plan = buildBuilderCmsExecutionPlan({
      source: source(true, BUILDER_CMS_SAFE_WRITE_MODEL),
      changeSet: {
        ...approvedChangeSet(),
        kind: "body_update",
        fieldChanges: [],
        bodyChange: {
          summary: "Body changed",
          currentExcerpt: "Old",
          proposedExcerpt: "New",
        },
      },
      pushModeConfirmation: "autosave",
    });

    expect(plan).toMatchObject({
      state: "blocked",
      payload: {
        safety: {
          blockers: expect.arrayContaining([
            "Builder body diff could not be converted to Builder blocks.",
          ]),
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
        effect: plan.payload.effect,
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
          effect: plan.payload.effect,
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
