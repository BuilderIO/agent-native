import { describe, expect, it } from "vitest";

import type {
  ContentDatabaseSource,
  ContentDatabaseSourceChangeSet,
} from "../shared/api";
import { BUILDER_CMS_SAFE_WRITE_MODEL } from "../shared/api";
import { BUILDER_CMS_BODY_BLOCKS_HASH_KEY } from "./_builder-cms-source-adapter";
import {
  buildBuilderCmsExecutionPlan,
  builderCmsExecutionIntentMarker,
  builderCmsExecutionIdempotencyKey,
  resolveBuilderCmsExecutionPushMode,
  validateBuilderCmsExecutionDryRun,
} from "./_builder-cms-write-adapter";

describe("Builder execution intent marker", () => {
  it("is deterministic, compact, and portable to browser runtimes", () => {
    const key = "builder-cms:source-1:change-set-1:draft";
    const marker = builderCmsExecutionIntentMarker(key);

    expect(marker).toBe(builderCmsExecutionIntentMarker(key));
    expect(marker).toMatch(/^agent-native-execution:[0-9a-f]{24}$/);
    expect(builderCmsExecutionIntentMarker(`${key}-other`)).not.toBe(marker);
  });
});

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
      builderModelFields: [
        {
          name: "title",
          label: "Title",
          type: "string",
          required: true,
        },
      ],
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

  it("blocks a write-disabled production-model execution plan by default", () => {
    const plan = buildBuilderCmsExecutionPlan({
      source: source(false),
      changeSet: approvedChangeSet(),
      pushModeConfirmation: "autosave",
    });

    expect(plan).toMatchObject({
      adapter: "builder-cms",
      pushMode: "autosave",
      state: "blocked",
      lastError: `Live Builder writes are only allowed for ${BUILDER_CMS_SAFE_WRITE_MODEL}.`,
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
          blockers: [
            `Live Builder writes are only allowed for ${BUILDER_CMS_SAFE_WRITE_MODEL}.`,
          ],
        },
      },
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

  it("keeps production-model title updates from changing Builder root names", () => {
    const plan = buildBuilderCmsExecutionPlan({
      source: source(true, "blog_article", {
        writeMode: "publish_updates",
        pushMode: "publish",
        allowedWriteModes: ["autosave", "publish"],
      }),
      changeSet: approvedChangeSet(),
      pushModeConfirmation: "publish",
    });

    expect(plan.payload.effect).toBe("update_in_place");
    expect(plan.payload.request.body).toMatchObject({
      data: { title: "New title" },
    });
    expect(plan.payload.request.body).not.toHaveProperty("name");
  });

  it("repairs an existing safe-model entry name during a body-only PATCH", () => {
    const plan = buildBuilderCmsExecutionPlan({
      source: source(true, BUILDER_CMS_SAFE_WRITE_MODEL, {
        writeMode: "publish_updates",
        pushMode: "publish",
        allowedWriteModes: ["autosave", "publish"],
      }),
      changeSet: {
        ...approvedChangeSet(),
        kind: "body_update",
        fieldChanges: [],
        bodyChange: {
          summary: "Body changed",
          currentExcerpt: null,
          proposedExcerpt: "Fresh body",
          proposedBlocksJson: JSON.stringify([
            {
              "@type": "@builder.io/sdk:Element",
              component: { name: "Text", options: { text: "Fresh body" } },
            },
          ]),
        },
      },
      pushModeConfirmation: "publish",
    });

    expect(plan.payload.effect).toBe("update_in_place");
    expect(plan.payload.request).toMatchObject({
      method: "PATCH",
      path: `/api/v1/write/${BUILDER_CMS_SAFE_WRITE_MODEL}/builder-entry-1`,
      query: { triggerWebhooks: "true" },
      body: {
        name: "Old title",
        data: { blocks: expect.any(Array) },
      },
    });
    expect(plan.payload.target.entryId).toBe("builder-entry-1");
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
            name: "New title",
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

  it("converts rich local field values to Builder-native safe-model JSON", () => {
    const builderSource = source(true, BUILDER_CMS_SAFE_WRITE_MODEL, {
      builderModelFields: [
        { name: "title", type: "string", required: true },
        { name: "date", type: "date", required: false },
        { name: "thumbnail", type: "file", required: false },
        {
          name: "topics",
          type: "list",
          inputType: "tags",
          options: ["Headless CMS", "Agent workflows"],
          required: false,
        },
        {
          name: "author",
          type: "reference",
          model: "blog-author",
          required: false,
        },
      ],
    });
    const plan = buildBuilderCmsExecutionPlan({
      source: { ...builderSource, rows: [] },
      changeSet: {
        ...approvedChangeSet(),
        pushMode: "draft",
        fieldChanges: [
          ...approvedChangeSet().fieldChanges,
          {
            propertyId: "date-property",
            propertyName: "Date",
            localFieldKey: "date-property",
            sourceFieldKey: "data.date",
            currentValue: null,
            proposedValue: {
              start: "2026-07-13T12:30:00.000Z",
              includeTime: true,
            },
          },
          {
            propertyId: "thumbnail-property",
            propertyName: "Thumbnail",
            localFieldKey: "thumbnail-property",
            sourceFieldKey: "data.thumbnail",
            currentValue: null,
            proposedValue: ["https://cdn.example.com/quiet-comet.jpg"],
          },
          {
            propertyId: "topics-property",
            propertyName: "Topics",
            localFieldKey: "topics-property",
            sourceFieldKey: "data.topics",
            currentValue: [],
            proposedValue: ["headless-cms", "agent-workflows"],
          },
          {
            propertyId: "author-property",
            propertyName: "Author",
            localFieldKey: "author-property",
            sourceFieldKey: "data.author",
            currentValue: null,
            proposedValue: "Alice Example",
            builderValueJson: JSON.stringify({
              "@type": "@builder.io/core:Reference",
              id: "author-entry-1",
              model: "blog-author",
            }),
          },
        ],
      },
      pushModeConfirmation: "draft",
    });

    expect(plan).toMatchObject({
      state: "ready",
      payload: {
        request: {
          body: {
            data: {
              title: "New title",
              date: Date.parse("2026-07-13T12:30:00.000Z"),
              thumbnail: "https://cdn.example.com/quiet-comet.jpg",
              topics: ["Headless CMS", "Agent workflows"],
              author: {
                "@type": "@builder.io/core:Reference",
                id: "author-entry-1",
                model: "blog-author",
              },
            },
          },
        },
        safety: { blockers: [] },
      },
    });
  });

  it("passes through trimmed labels for free-form Builder Tags fields", () => {
    const plan = buildBuilderCmsExecutionPlan({
      source: {
        ...source(true, BUILDER_CMS_SAFE_WRITE_MODEL, {
          builderModelFields: [
            { name: "title", type: "string", required: true },
            { name: "tags", type: "Tags", required: true },
          ],
        }),
        rows: [],
      },
      changeSet: {
        ...approvedChangeSet(),
        pushMode: "draft",
        fieldChanges: [
          ...approvedChangeSet().fieldChanges,
          {
            propertyId: "tags-property",
            propertyName: "Tags",
            localFieldKey: "tags-property",
            sourceFieldKey: "data.tags",
            currentValue: [],
            proposedValue: [" ai ", "Builder Sync"],
          },
        ],
      },
      pushModeConfirmation: "draft",
    });

    expect(plan).toMatchObject({
      state: "ready",
      payload: {
        request: {
          body: { data: { tags: ["ai", "Builder Sync"] } },
        },
        safety: { blockers: [] },
      },
    });
  });

  it("rejects empty labels for free-form Builder Tags fields", () => {
    const plan = buildBuilderCmsExecutionPlan({
      source: {
        ...source(true, BUILDER_CMS_SAFE_WRITE_MODEL, {
          builderModelFields: [
            { name: "title", type: "string", required: true },
            { name: "tags", type: "Tags", required: true },
          ],
        }),
        rows: [],
      },
      changeSet: {
        ...approvedChangeSet(),
        pushMode: "draft",
        fieldChanges: [
          ...approvedChangeSet().fieldChanges,
          {
            propertyId: "tags-property",
            propertyName: "Tags",
            localFieldKey: "tags-property",
            sourceFieldKey: "data.tags",
            currentValue: [],
            proposedValue: ["   "],
          },
        ],
      },
      pushModeConfirmation: "draft",
    });

    expect(plan.state).toBe("blocked");
    expect(plan.payload.safety.blockers).toContain(
      "tags contains an option that cannot be mapped to a Builder label.",
    );
  });

  it("blocks invalid native field conversion before safe-model dispatch", () => {
    const plan = buildBuilderCmsExecutionPlan({
      source: {
        ...source(true, BUILDER_CMS_SAFE_WRITE_MODEL, {
          builderModelFields: [
            { name: "title", type: "string", required: true },
            {
              name: "topics",
              label: "Topics",
              type: "list",
              inputType: "tags",
              options: ["Headless CMS"],
              required: false,
            },
          ],
        }),
        rows: [],
      },
      changeSet: {
        ...approvedChangeSet(),
        pushMode: "draft",
        fieldChanges: [
          ...approvedChangeSet().fieldChanges,
          {
            propertyId: "topics-property",
            propertyName: "Topics",
            localFieldKey: "topics-property",
            sourceFieldKey: "data.topics",
            currentValue: [],
            proposedValue: ["unknown-local-option-id"],
          },
        ],
      },
      pushModeConfirmation: "draft",
    });

    expect(plan).toMatchObject({
      state: "blocked",
      payload: {
        safety: {
          blockers: [
            "Topics contains an option that cannot be mapped to a Builder label.",
          ],
        },
      },
    });
    expect(plan.payload.request.body).not.toHaveProperty("data.topics");
  });

  it("blocks safe-model creates when a required field is missing", () => {
    const plan = buildBuilderCmsExecutionPlan({
      source: {
        ...source(true, BUILDER_CMS_SAFE_WRITE_MODEL, {
          builderModelFields: [
            { name: "title", type: "string", required: true },
            { name: "author", type: "reference", required: true },
          ],
        }),
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
      payload: {
        safety: {
          blockers: ["Required Builder field author is missing or invalid."],
        },
      },
    });
  });

  it("preserves legacy safe-model gates that predate schema snapshots", () => {
    const noSchema = source(true, BUILDER_CMS_SAFE_WRITE_MODEL, {
      builderModelFields: [],
      writeMode: "publish_updates",
      pushMode: "publish",
      allowedWriteModes: ["publish"],
      allowPublicationTransitions: true,
    });
    const create = buildBuilderCmsExecutionPlan({
      source: { ...noSchema, rows: [] },
      changeSet: { ...approvedChangeSet(), pushMode: "publish" },
      pushModeConfirmation: "publish",
    });
    const publish = buildBuilderCmsExecutionPlan({
      source: noSchema,
      changeSet: { ...approvedChangeSet(), pushMode: "publish" },
      pushModeConfirmation: "publish",
      publicationTransition: "publish",
    });

    expect(create.state).toBe("ready");
    expect(publish.state).toBe("ready");
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

  it("accepts reconciled required fields and a body hash when publishing a partial update", () => {
    const builderSource = source(true, BUILDER_CMS_SAFE_WRITE_MODEL, {
      writeMode: "publish_updates",
      pushMode: "publish",
      allowedWriteModes: ["autosave", "publish"],
      allowPublicationTransitions: true,
      builderModelFields: [
        { name: "title", type: "string", required: true },
        { name: "blocks", type: "list", required: true },
        { name: "author", type: "reference", required: true },
        { name: "image", type: "image", required: true },
      ],
    });
    builderSource.rows[0] = {
      ...builderSource.rows[0]!,
      sourceValues: {
        "data.title": "Old title",
        "data.author": {
          "@type": "@builder.io/core:Reference",
          id: "author-alice",
          model: "author",
        },
        "data.image": "https://example.com/feature.jpg",
        [BUILDER_CMS_BODY_BLOCKS_HASH_KEY]: "body-hash",
      },
    };

    const plan = buildBuilderCmsExecutionPlan({
      source: builderSource,
      changeSet: {
        ...approvedChangeSet(),
        pushMode: "publish",
      },
      pushModeConfirmation: "publish",
      publicationTransition: "publish",
    });

    expect(plan.state).toBe("ready");
    expect(plan.payload.safety.blockers).toEqual([]);
    expect(plan.payload.request.body).not.toHaveProperty("data.blocks");
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

  it("keeps an unmatched row as create_draft under the publish-updates tier", () => {
    const builderSource = source(true, BUILDER_CMS_SAFE_WRITE_MODEL, {
      writeMode: "publish_updates",
      pushMode: "publish",
      allowedWriteModes: ["autosave", "publish"],
      allowPublicationTransitions: true,
    });
    const plan = buildBuilderCmsExecutionPlan({
      source: {
        ...builderSource,
        rows: [
          {
            ...builderSource.rows[0],
            documentId: "unmatched-doc",
            sourceRowId: "builder-unmatched-doc",
            sourceQualifiedId: `builder-cms://${BUILDER_CMS_SAFE_WRITE_MODEL}/builder-unmatched-doc`,
          },
        ],
      },
      changeSet: {
        ...approvedChangeSet(),
        documentId: "unmatched-doc",
      },
      pushModeConfirmation: "publish",
    });

    expect(plan).toMatchObject({
      pushMode: "publish",
      idempotencyKey: "builder-cms:source-1:change-1:publish",
      state: "ready",
      payload: {
        effect: "create_draft",
        request: {
          method: "POST",
          body: { published: "draft" },
        },
      },
    });
  });

  it("builds matching publish-tier gates for mixed create, update, publish, and confirmed unpublish intents", () => {
    const baseSource = source(true, BUILDER_CMS_SAFE_WRITE_MODEL, {
      writeMode: "publish_updates",
      pushMode: "publish",
      allowedWriteModes: ["autosave", "publish"],
      allowPublicationTransitions: true,
    });
    const documents = [
      "create-doc",
      "update-doc",
      "publish-doc",
      "unpublish-doc",
    ];
    const mixedSource = {
      ...baseSource,
      rows: documents.map((documentId, index) => ({
        ...baseSource.rows[0],
        id: `row-${index}`,
        databaseItemId: `item-${index}`,
        documentId,
        sourceRowId:
          index === 0 ? `builder-${documentId}` : `builder-entry-${index}`,
        sourceQualifiedId: `builder-cms://${BUILDER_CMS_SAFE_WRITE_MODEL}/${
          index === 0 ? `builder-${documentId}` : `builder-entry-${index}`
        }`,
        provenance:
          index === 0
            ? "Builder CMS fixture adapter"
            : "Builder CMS read adapter",
      })),
    };
    const transitions = [
      undefined,
      undefined,
      { publicationTransition: "publish" as const },
      {
        publicationTransition: "unpublish" as const,
        confirmUnpublish: true,
      },
    ];

    const plans = documents.map((documentId, index) =>
      buildBuilderCmsExecutionPlan({
        source: mixedSource,
        changeSet: {
          ...approvedChangeSet(),
          id: `change-${index}`,
          databaseItemId: `item-${index}`,
          documentId,
        },
        pushModeConfirmation: "publish",
        ...transitions[index],
      }),
    );

    expect(plans.map((plan) => plan.payload.effect)).toEqual([
      "create_draft",
      "update_in_place",
      "publish",
      "unpublish",
    ]);
    expect(plans.map((plan) => plan.pushMode)).toEqual([
      "publish",
      "publish",
      "publish",
      "publish",
    ]);
    expect(plans.map((plan) => plan.state)).toEqual([
      "ready",
      "ready",
      "ready",
      "ready",
    ]);
    expect(plans.map((plan) => plan.idempotencyKey)).toEqual(
      plans.map(
        (_plan, index) => `builder-cms:source-1:change-${index}:publish`,
      ),
    );
  });

  it("fails closed for opted-in production Builder models", () => {
    expect(
      buildBuilderCmsExecutionPlan({
        source: source(true, "blog_article"),
        changeSet: approvedChangeSet(),
        pushModeConfirmation: "autosave",
      }),
    ).toMatchObject({
      state: "blocked",
      lastError: expect.stringContaining(BUILDER_CMS_SAFE_WRITE_MODEL),
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

  it("blocks publication transitions for production Builder models", () => {
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
      source: source(false, BUILDER_CMS_SAFE_WRITE_MODEL),
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
