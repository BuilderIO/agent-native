import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import {
  BUILDER_CMS_SAFE_WRITE_MODEL,
  type ContentDatabaseResponse,
  type ContentDatabaseSource,
  type ContentDatabaseSourceChangeSet,
} from "../shared/api";
import { readBuilderCmsEntryLiveState } from "./_builder-cms-read-client";
import { builderCmsQualifiedId } from "./_builder-cms-source-adapter";
import { buildBuilderCmsExecutionPlan } from "./_builder-cms-write-adapter";
import { executeBuilderCmsWrite } from "./_builder-cms-write-client";
import {
  executeBuilderSourceExecutionWithDeps,
  type BuilderSourceExecutionRecord,
  type ExecuteBuilderSourceExecutionDeps,
} from "./execute-builder-source-execution";

// Gated live integration: when explicitly enabled, this makes real Builder
// writes against BUILDER_CMS_SAFE_WRITE_MODEL. Normal CI skips it offline.
const LIVE_BUILDER_ENABLED =
  process.env.BUILDER_LIVE_E2E === "1" &&
  !!process.env.BUILDER_PRIVATE_KEY &&
  !!process.env.BUILDER_PUBLIC_KEY;

const NOW = "2026-06-15T12:00:00.000Z";
const DATABASE_ID = "database-live";
const SOURCE_ID = "source-live";
const CHANGE_SET_ID = "change-live";
const DOCUMENT_ID = "doc-live";
const DATABASE_ITEM_ID = "item-live";
const AUTOSAVED_MARKER = "v2-autosaved-should-NOT-go-live";

const RESPONSE: ContentDatabaseResponse = {
  database: {
    id: DATABASE_ID,
    documentId: "database-page-live",
    title: "Builder live execution test",
    viewConfig: {
      activeViewId: "default",
      views: [],
      sorts: [],
      filters: [],
      columnWidths: {},
    },
    createdAt: NOW,
    updatedAt: NOW,
  },
  properties: [],
  items: [],
  source: null,
};

type DatabaseRecord = NonNullable<
  Awaited<ReturnType<ExecuteBuilderSourceExecutionDeps["resolveDatabase"]>>
>;
type ReconcileWriteArgs = Parameters<
  ExecuteBuilderSourceExecutionDeps["reconcileWrite"]
>[0];
type MarkExecutionSucceededArgs = Parameters<
  ExecuteBuilderSourceExecutionDeps["markExecutionSucceeded"]
>[0];
type MarkExecutionFailedArgs = Parameters<
  ExecuteBuilderSourceExecutionDeps["markExecutionFailed"]
>[0];

const DATABASE: DatabaseRecord = {
  id: DATABASE_ID,
  ownerEmail: "local@localhost",
  orgId: null,
  documentId: "database-page-live",
  title: "Builder live execution test",
  viewConfigJson: "{}",
  createdAt: NOW,
  updatedAt: NOW,
};

function randomSuffix() {
  return crypto.randomUUID().slice(0, 8);
}

function requireEnv(name: "BUILDER_PRIVATE_KEY" | "BUILDER_PUBLIC_KEY") {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required for live Builder tests.`);
  return value;
}

function recordFromJson(value: unknown): Record<string, unknown> {
  expect(value).toEqual(expect.any(Object));
  expect(Array.isArray(value)).toBe(false);
  return value as Record<string, unknown>;
}

function buildSource(args: {
  entryId: string;
  changeSet: ContentDatabaseSourceChangeSet;
}): ContentDatabaseSource {
  return {
    id: SOURCE_ID,
    databaseId: DATABASE_ID,
    sourceType: "builder-cms",
    sourceName: "Builder CMS",
    sourceTable: BUILDER_CMS_SAFE_WRITE_MODEL,
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
      liveWritesEnabled: true,
      readOnlyRefresh: true,
    },
    metadata: {
      primaryKey: "id",
      titleField: "data.title",
      naturalKeyField: "/blog/[slug]",
      pushMode: "autosave",
      allowedWriteModes: ["autosave"],
    },
    fields: [],
    rows: [
      {
        id: "row-live",
        databaseItemId: DATABASE_ITEM_ID,
        documentId: DOCUMENT_ID,
        sourceRowId: args.entryId,
        sourceQualifiedId: builderCmsQualifiedId({
          sourceTable: BUILDER_CMS_SAFE_WRITE_MODEL,
          entryId: args.entryId,
        }),
        sourceDisplayKey: "Builder live execution fixture",
        provenance: "Builder CMS write adapter",
        syncState: "idle",
        freshness: "fresh",
        lastSyncedAt: NOW,
        lastSourceUpdatedAt: NOW,
      },
    ],
    changeSets: [args.changeSet],
  };
}

function buildChangeSet(): ContentDatabaseSourceChangeSet {
  return {
    id: CHANGE_SET_ID,
    databaseItemId: DATABASE_ITEM_ID,
    documentId: DOCUMENT_ID,
    kind: "field_update",
    direction: "outbound",
    state: "approved",
    pushMode: "autosave",
    localOnly: true,
    summary: "Approved local Builder marker autosave.",
    fieldChanges: [
      {
        propertyId: null,
        propertyName: "Marker",
        localFieldKey: "marker",
        sourceFieldKey: "data.marker",
        currentValue: "v1-live",
        proposedValue: AUTOSAVED_MARKER,
      },
    ],
    bodyChange: null,
    riskLevel: "low",
    riskReasons: ["single safe-model autosave field diff"],
    conflictState: "none",
    reviewEvents: [],
    executions: [],
    createdAt: NOW,
    updatedAt: NOW,
  };
}

function buildDeps(args: {
  source: ContentDatabaseSource;
  execution: BuilderSourceExecutionRecord;
  onSucceeded: (call: MarkExecutionSucceededArgs) => void;
  onFailed: (call: MarkExecutionFailedArgs) => void;
  onReconcile: (call: ReconcileWriteArgs) => void;
}): ExecuteBuilderSourceExecutionDeps {
  return {
    now: vi.fn(() => NOW),
    resolveDatabase: vi.fn(async () => DATABASE),
    assertEditor: vi.fn(async () => {}),
    getSourceSnapshot: vi.fn(async () => args.source),
    getExecution: vi.fn(async () => args.execution),
    updateExecutionState: vi.fn(async () => {}),
    claimExecution: vi.fn(async () => true),
    markExecutionSucceeded: vi.fn(async (call) => {
      args.onSucceeded(call);
    }),
    markExecutionFailed: vi.fn(async (call) => {
      args.onFailed(call);
    }),
    executeWrite: vi.fn((call) => executeBuilderCmsWrite(call)),
    readLiveEntry: vi.fn(async () => ({
      exists: true,
      published: "draft",
      lastUpdated: NOW,
      blocksHash: null,
      id: args.source.rows[0]?.sourceRowId ?? "builder-entry-1",
    })),
    reconcileWrite: vi.fn(async (call) => {
      args.onReconcile(call);
    }),
    getResponse: vi.fn(async () => RESPONSE),
  };
}

async function fetchLiveBuilderEntry(entryId: string) {
  const url = new URL(
    `https://cdn.builder.io/api/v3/content/${encodeURIComponent(
      BUILDER_CMS_SAFE_WRITE_MODEL,
    )}/${encodeURIComponent(entryId)}`,
  );
  url.searchParams.set("apiKey", requireEnv("BUILDER_PUBLIC_KEY"));
  url.searchParams.set("includeUnpublished", "true");
  url.searchParams.set("cachebust", randomSuffix());

  const response = await fetch(url);
  expect(response.ok).toBe(true);
  return recordFromJson(await response.json());
}

describe.skipIf(!LIVE_BUILDER_ENABLED)(
  "execute Builder source execution against live Builder",
  () => {
    let entryId: string | null = null;

    beforeAll(async () => {
      const result = await executeBuilderCmsWrite({
        request: {
          method: "POST",
          path: `/api/v1/write/${BUILDER_CMS_SAFE_WRITE_MODEL}`,
          body: {
            name: `zz-pr3-e2e-${randomSuffix()}`,
            published: "published",
            data: {
              marker: "v1-live",
            },
          },
        },
      });

      expect(result.ok).toBe(true);
      expect(result.entryId).toEqual(expect.any(String));
      entryId = result.entryId ?? null;
      if (!entryId) {
        throw new Error("Builder did not return an entry ID for live setup.");
      }
    });

    afterAll(async () => {
      if (!entryId) return;
      try {
        await fetch(
          `https://builder.io/api/v1/write/${encodeURIComponent(
            BUILDER_CMS_SAFE_WRITE_MODEL,
          )}/${encodeURIComponent(entryId)}`,
          {
            method: "DELETE",
            headers: {
              authorization: `Bearer ${requireEnv("BUILDER_PRIVATE_KEY")}`,
            },
          },
        );
      } catch {
        // Best-effort cleanup only; the assertion path above owns test failure.
      }
    });

    it("executes a prepared autosave plan and leaves published content unchanged", async () => {
      if (!entryId) throw new Error("Live Builder entry was not created.");

      const changeSet = buildChangeSet();
      const source = buildSource({ entryId, changeSet });
      const plan = buildBuilderCmsExecutionPlan({
        source,
        changeSet,
        pushModeConfirmation: "autosave",
      });
      expect(plan.state).toBe("ready");

      const execution: BuilderSourceExecutionRecord = {
        id: "execution-live",
        state: "ready",
        idempotencyKey: plan.idempotencyKey,
        payloadJson: JSON.stringify(plan.payload),
        updatedAt: NOW,
      };

      let succeededCall: MarkExecutionSucceededArgs | null = null;
      let failedCall: MarkExecutionFailedArgs | null = null;
      let reconcileCall: ReconcileWriteArgs | null = null;
      const deps = buildDeps({
        source,
        execution,
        onSucceeded: (call) => {
          succeededCall = call;
        },
        onFailed: (call) => {
          failedCall = call;
        },
        onReconcile: (call) => {
          reconcileCall = call;
        },
      });

      await expect(
        executeBuilderSourceExecutionWithDeps(
          {
            databaseId: DATABASE_ID,
            changeSetId: CHANGE_SET_ID,
            pushModeConfirmation: "autosave",
          },
          deps,
        ),
      ).resolves.toBe(RESPONSE);

      expect(succeededCall).toEqual(
        expect.objectContaining({
          executionId: execution.id,
          changeSetId: changeSet.id,
          summary: "Builder autosave execution succeeded.",
        }),
      );
      expect(failedCall).toBeNull();
      expect(reconcileCall).toEqual(
        expect.objectContaining({
          database: DATABASE,
          source,
          changeSet,
          plan,
          writeResult: expect.objectContaining({
            ok: true,
          }),
          now: NOW,
        }),
      );

      const liveEntry = await fetchLiveBuilderEntry(entryId);
      const liveData = recordFromJson(liveEntry.data);
      expect(liveEntry.published).toBe("published");
      expect(liveData.marker).toBe("v1-live");
    });
  },
);

// Publication-state effects against live Builder, using the REAL readLiveEntry
// preflight. The baseline is derived from the seeded entry's real `lastUpdated`
// (a NUMBER from delivery), which locks down the stale-guard format fix:
// update_in_place must NOT be falsely blocked, and a wrong baseline MUST block.
describe.skipIf(!LIVE_BUILDER_ENABLED)(
  "Builder publication-state effects against live Builder",
  () => {
    const seededIds: string[] = [];

    async function seedEntry(
      published: "published" | "draft",
      marker: string,
    ): Promise<{ entryId: string; baselineLastUpdated: string | null }> {
      const created = await executeBuilderCmsWrite({
        request: {
          method: "POST",
          path: `/api/v1/write/${BUILDER_CMS_SAFE_WRITE_MODEL}`,
          query: { triggerWebhooks: "false" },
          body: {
            name: `zz-pr3-eff-${randomSuffix()}`,
            published,
            data: { marker },
          },
        },
      });
      if (!created.entryId) throw new Error("Failed to seed live entry.");
      seededIds.push(created.entryId);
      // Derive the staleness baseline exactly as a real sync would observe it:
      // the live numeric lastUpdated, stringified.
      const live = await readBuilderCmsEntryLiveState({
        model: BUILDER_CMS_SAFE_WRITE_MODEL,
        entryId: created.entryId,
      });
      const baselineLastUpdated =
        live.lastUpdated === null || live.lastUpdated === undefined
          ? null
          : String(live.lastUpdated);
      return { entryId: created.entryId, baselineLastUpdated };
    }

    afterAll(async () => {
      for (const id of seededIds) {
        await fetch(
          `https://builder.io/api/v1/write/${encodeURIComponent(
            BUILDER_CMS_SAFE_WRITE_MODEL,
          )}/${encodeURIComponent(id)}`,
          {
            method: "DELETE",
            headers: {
              authorization: `Bearer ${requireEnv("BUILDER_PRIVATE_KEY")}`,
            },
          },
        ).catch(() => {});
      }
    });

    async function runEffect(opts: {
      entryId: string;
      pushMode: "autosave" | "draft" | "publish";
      allowedWriteModes: ("autosave" | "draft" | "publish")[];
      baselineLastUpdated: string | null;
      marker: string;
      publicationTransition?: "publish" | "unpublish";
      confirmUnpublish?: boolean;
    }) {
      const changeSet: ContentDatabaseSourceChangeSet = {
        ...buildChangeSet(),
        pushMode: opts.pushMode,
        fieldChanges: [
          {
            propertyId: null,
            propertyName: "Marker",
            localFieldKey: "marker",
            sourceFieldKey: "data.marker",
            currentValue: null,
            proposedValue: opts.marker,
          },
        ],
      };
      const source = buildSource({ entryId: opts.entryId, changeSet });
      source.metadata = {
        ...source.metadata,
        pushMode: opts.pushMode,
        allowedWriteModes: opts.allowedWriteModes,
        allowPublicationTransitions: Boolean(opts.publicationTransition),
      };
      source.rows[0]!.lastSourceUpdatedAt = opts.baselineLastUpdated;

      const plan = buildBuilderCmsExecutionPlan({
        source,
        changeSet,
        pushModeConfirmation: opts.pushMode,
        publicationTransition: opts.publicationTransition,
        confirmUnpublish: opts.confirmUnpublish,
      });
      const execution: BuilderSourceExecutionRecord = {
        id: "execution-eff",
        state: "ready",
        idempotencyKey: plan.idempotencyKey,
        payloadJson: JSON.stringify(plan.payload),
        updatedAt: NOW,
      };
      let succeededCall: MarkExecutionSucceededArgs | null = null;
      let failedCall: MarkExecutionFailedArgs | null = null;
      let wrote = false;
      const deps = buildDeps({
        source,
        execution,
        onSucceeded: (c) => {
          succeededCall = c;
        },
        onFailed: (c) => {
          failedCall = c;
        },
        onReconcile: () => {},
      });
      // Use the REAL preflight read against live Builder.
      deps.readLiveEntry = (args) => readBuilderCmsEntryLiveState(args);
      const realWrite = deps.executeWrite;
      deps.executeWrite = (args) => {
        wrote = true;
        return realWrite(args);
      };
      const result = await executeBuilderSourceExecutionWithDeps(
        {
          databaseId: DATABASE_ID,
          changeSetId: CHANGE_SET_ID,
          pushModeConfirmation: opts.pushMode,
          publicationTransition: opts.publicationTransition,
          confirmUnpublish: opts.confirmUnpublish,
        },
        deps,
      );
      return { result, succeededCall, failedCall, wrote, plan };
    }

    it("update_in_place takes content live, stays published, and is NOT falsely stale-blocked", async () => {
      const { entryId, baselineLastUpdated } = await seedEntry(
        "published",
        "before",
      );
      const { wrote, failedCall } = await runEffect({
        entryId,
        pushMode: "publish", // non-autosave + no transition → update_in_place
        allowedWriteModes: ["publish"],
        baselineLastUpdated,
        marker: "after-LIVE",
      });
      expect(wrote).toBe(true);
      expect(failedCall).toBeNull();
      const after = await fetchLiveBuilderEntry(entryId);
      expect(after.published).toBe("published");
      expect(recordFromJson(after.data).marker).toBe("after-LIVE");
    });

    it("blocks before write when the baseline is stale (entry changed since the diff)", async () => {
      const { entryId } = await seedEntry("published", "orig");
      await expect(
        runEffect({
          entryId,
          pushMode: "publish",
          allowedWriteModes: ["publish"],
          baselineLastUpdated: "1700000000000", // wrong/old → stale
          marker: "should-not-write",
        }),
      ).rejects.toThrow(/changed since this diff/i);
      const after = await fetchLiveBuilderEntry(entryId);
      expect(recordFromJson(after.data).marker).toBe("orig");
    });

    it("publish transition takes a draft to published", async () => {
      const { entryId, baselineLastUpdated } = await seedEntry("draft", "d1");
      const { wrote } = await runEffect({
        entryId,
        pushMode: "autosave",
        allowedWriteModes: ["autosave"],
        baselineLastUpdated,
        marker: "d2",
        publicationTransition: "publish",
      });
      expect(wrote).toBe(true);
      const after = await fetchLiveBuilderEntry(entryId);
      expect(after.published).toBe("published");
    });

    it("unpublish transition takes a published entry to draft (with confirmation)", async () => {
      const { entryId, baselineLastUpdated } = await seedEntry(
        "published",
        "u1",
      );
      const { wrote } = await runEffect({
        entryId,
        pushMode: "autosave",
        allowedWriteModes: ["autosave"],
        baselineLastUpdated,
        marker: "u1",
        publicationTransition: "unpublish",
        confirmUnpublish: true,
      });
      expect(wrote).toBe(true);
      const after = await fetchLiveBuilderEntry(entryId);
      expect(after.published).toBe("draft");
    });
  },
);
