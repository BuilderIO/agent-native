// Integration tests for the three GTM ports: the typed status lifecycle, the
// dedupe/merge pair, and one-call workspace orientation. All three are about
// what happens to real rows — a partition that reports what it skipped, a claim
// that refuses to clobber a concurrent move, a merge that keeps both sides — so
// they run against a real libsql (SQLite) database with the app's migrations.

import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { runWithRequestContext } from "@agent-native/core/server";
import { and, asc, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const TEST_DB_PATH = join(
  tmpdir(),
  `crm-lifecycle-actions-test-${process.pid}-${Date.now()}.sqlite`,
);

const OWNER = "owner@example.test";
const OTHER = "other@example.test";
const CONNECTION_ID = "conn_lifecycle";
const STAGE_ATTRIBUTE_ID = "attr_lifecycle_stage";

type Schema = typeof import("../server/db/schema.js");
let getDb: () => any;
let schema: Schema;

let lifecycleLib: typeof import("../server/lib/lifecycle.js");
let writeCrmRecordField: typeof import("../server/lib/record-fields.js").writeCrmRecordField;
let findCrmDuplicates: any;
let mergeCrmRecords: any;
let getCrmWorkspace: any;
let updateCrmRecord: any;

const ownership = {
  ownerEmail: OWNER,
  orgId: null,
  visibility: "private" as const,
};

const asOwner = <T>(fn: () => Promise<T>): Promise<T> =>
  runWithRequestContext({ userEmail: OWNER }, fn) as Promise<T>;
const asOther = <T>(fn: () => Promise<T>): Promise<T> =>
  runWithRequestContext({ userEmail: OTHER }, fn) as Promise<T>;

const ownerCtx = { caller: "frontend" as const, userEmail: OWNER, orgId: null };
const agentCtx = { caller: "tool" as const, userEmail: OWNER, orgId: null };
const otherCtx = { caller: "frontend" as const, userEmail: OTHER, orgId: null };

const actor = { type: "user" as const, id: OWNER };

let counter = 0;

async function createRecord(input: {
  displayName: string;
  objectType?: string;
  kind?: "account" | "person" | "opportunity";
  stage?: string | null;
  amount?: number | null;
  ownerRemoteId?: string | null;
  domain?: string | null;
  primaryEmail?: string | null;
  ownerEmail?: string;
}): Promise<string> {
  const id = `rec_${++counter}`;
  const now = new Date().toISOString();
  await getDb()
    .insert(schema.crmRecords)
    .values({
      id,
      connectionId: CONNECTION_ID,
      provider: "native",
      objectType: input.objectType ?? "companies",
      kind: input.kind ?? "account",
      remoteId: id,
      displayName: input.displayName,
      stage: input.stage ?? null,
      amount: input.amount ?? null,
      domain: input.domain ?? null,
      primaryEmail: input.primaryEmail ?? null,
      ownerRemoteId: input.ownerRemoteId ?? null,
      ownerName: input.ownerRemoteId ? "Rep One" : null,
      accessScopeKey: "native",
      accessScopeJson: "{}",
      ...ownership,
      ownerEmail: input.ownerEmail ?? OWNER,
      createdAt: now,
      updatedAt: now,
    });
  return id;
}

async function createStatusAttribute(input: {
  id: string;
  objectType: string;
  options: Array<{ value: string; archived?: boolean }>;
  authority?: "provider" | "local-authoritative";
  archived?: boolean;
  updateable?: boolean;
  storagePolicy?: "mirrored" | "local-authoritative";
}): Promise<void> {
  const now = new Date().toISOString();
  await getDb()
    .insert(schema.crmFieldPolicies)
    .values({
      id: input.id,
      connectionId: CONNECTION_ID,
      objectType: input.objectType,
      fieldName: "stage",
      label: "Stage",
      valueType: "enum",
      storagePolicy: input.storagePolicy ?? "local-authoritative",
      attributeType: "status",
      target: "object",
      targetId: input.objectType,
      apiSlug: "stage",
      authority: input.authority ?? "local-authoritative",
      archived: input.archived ?? false,
      updateable: input.updateable ?? false,
      ...ownership,
      createdAt: now,
      updatedAt: now,
    });
  for (const [index, option] of input.options.entries()) {
    await getDb()
      .insert(schema.crmAttributeOptions)
      .values({
        id: `${input.id}_${option.value}`,
        attributeId: input.id,
        value: option.value,
        title: option.value,
        position: index,
        archived: option.archived ?? false,
        ...ownership,
        createdAt: now,
        updatedAt: now,
      });
  }
}

async function setStage(recordId: string, value: string): Promise<void> {
  await asOwner(() =>
    writeCrmRecordField({
      target: { recordId },
      attribute: {
        id: STAGE_ATTRIBUTE_ID,
        apiSlug: "stage",
        attributeType: "status",
        multi: false,
        historyTracked: true,
        valueType: "enum",
        storagePolicy: "local-authoritative",
        fieldPolicyId: STAGE_ATTRIBUTE_ID,
      },
      value,
      actor,
      ownership,
    }),
  );
}

function stageRows(recordId: string) {
  return getDb()
    .select()
    .from(schema.crmRecordFields)
    .where(
      and(
        eq(schema.crmRecordFields.recordId, recordId),
        eq(schema.crmRecordFields.fieldName, "stage"),
      ),
    )
    .orderBy(asc(schema.crmRecordFields.activeFrom));
}

async function loadLifecycle(attributeId = STAGE_ATTRIBUTE_ID) {
  return asOwner(() =>
    lifecycleLib.loadCrmStatusLifecycle(getDb(), attributeId),
  );
}

beforeAll(async () => {
  process.env.DATABASE_URL = `file:${TEST_DB_PATH}`;
  const dbModule = await import("../server/db/index.js");
  getDb = dbModule.getDb;
  schema = dbModule.schema;

  const plugin = (await import("../server/plugins/db.js")).default;
  await plugin(undefined as never);

  lifecycleLib = await import("../server/lib/lifecycle.js");
  writeCrmRecordField = (await import("../server/lib/record-fields.js"))
    .writeCrmRecordField;
  findCrmDuplicates = (await import("./find-crm-duplicates.js")).default;
  mergeCrmRecords = (await import("./merge-crm-records.js")).default;
  getCrmWorkspace = (await import("./get-crm-workspace.js")).default;
  updateCrmRecord = (await import("./update-crm-record.js")).default;

  const now = new Date().toISOString();
  await getDb()
    .insert(schema.crmConnections)
    .values({
      id: CONNECTION_ID,
      provider: "native",
      label: "Native SQL",
      mode: "native",
      status: "connected",
      accessScopeKey: "native",
      ...ownership,
      createdAt: now,
      updatedAt: now,
    });
  await createStatusAttribute({
    id: STAGE_ATTRIBUTE_ID,
    objectType: "companies",
    options: [
      { value: "new" },
      { value: "in-progress" },
      { value: "won" },
      { value: "retired", archived: true },
    ],
  });
}, 60_000);

afterAll(() => {
  for (const suffix of ["", "-shm", "-wal"]) {
    rmSync(`${TEST_DB_PATH}${suffix}`, { force: true });
  }
});

// ---------------------------------------------------------------------------
// 1. Typed lifecycle
// ---------------------------------------------------------------------------

describe("loadCrmStatusLifecycle", () => {
  it("takes the allowed values from the attribute's options, not an enum", async () => {
    const lifecycle = await loadLifecycle();
    expect(lifecycle.knownValues).toEqual([
      "new",
      "in-progress",
      "won",
      "retired",
    ]);
    expect(lifecycle.enterableValues).toEqual(["new", "in-progress", "won"]);
  });

  it("refuses to govern a non-status attribute", async () => {
    const now = new Date().toISOString();
    await getDb()
      .insert(schema.crmFieldPolicies)
      .values({
        id: "attr_plain_text",
        connectionId: CONNECTION_ID,
        objectType: "companies",
        fieldName: "nickname",
        label: "Nickname",
        valueType: "string",
        storagePolicy: "local-authoritative",
        attributeType: "text",
        target: "object",
        targetId: "companies",
        apiSlug: "nickname",
        ...ownership,
        createdAt: now,
        updatedAt: now,
      });

    await expect(loadLifecycle("attr_plain_text")).rejects.toMatchObject({
      code: "crm-status-attribute-type",
      statusCode: 422,
    });
  });
});

describe("applyCrmStatusTransitions", () => {
  it("partitions by eligibility and reports what it skipped, per status", async () => {
    const lifecycle = await loadLifecycle();
    const fresh = await createRecord({ displayName: "Fresh" });
    const moving = await createRecord({ displayName: "Moving" });
    const alreadyWon = await createRecord({ displayName: "Already Won" });
    const merged = await createRecord({ displayName: "Merged Away" });
    await setStage(moving, "in-progress");
    await setStage(alreadyWon, "won");
    await setStage(merged, "new");

    const report = await asOwner(() =>
      lifecycleLib.applyCrmStatusTransitions({
        db: getDb(),
        lifecycle,
        targets: [fresh, moving, alreadyWon, merged].map((recordId) => ({
          recordId,
        })),
        to: "won",
        actor,
        ownership,
        tombstonedRecordIds: new Set([merged]),
      }),
    );

    expect(report).toMatchObject({
      to: "won",
      changed: 2,
      unchanged: 1,
      skipped: 1,
      skippedByStatus: { new: 1 },
      skippedByReason: { "record-tombstoned": 1 },
    });
    expect(
      report.rows.find((row) => row.recordId === alreadyWon)?.outcome,
    ).toBe("unchanged");
    expect(report.rows.find((row) => row.recordId === merged)?.block).toEqual({
      code: "record-tombstoned",
      message: 'Cannot move a merged or deleted record through "Stage".',
    });

    // A skipped target is not written, and an unchanged one opens no history.
    expect(await stageRows(merged)).toHaveLength(1);
    expect(await stageRows(alreadyWon)).toHaveLength(1);
    expect(await stageRows(moving)).toHaveLength(2);
  });

  it("reports an undeclared target for every row instead of writing any", async () => {
    const lifecycle = await loadLifecycle();
    const a = await createRecord({ displayName: "Bulk A" });
    const b = await createRecord({ displayName: "Bulk B" });
    await setStage(a, "new");

    const report = await asOwner(() =>
      lifecycleLib.applyCrmStatusTransitions({
        db: getDb(),
        lifecycle,
        targets: [{ recordId: a }, { recordId: b }],
        to: "invented",
        actor,
        ownership,
      }),
    );

    expect(report.changed).toBe(0);
    expect(report.skipped).toBe(2);
    expect(report.skippedByStatus).toEqual({ new: 1, "(not set)": 1 });
    expect(report.skippedByReason).toEqual({ "unknown-status": 2 });
    expect(await stageRows(b)).toHaveLength(0);
  });

  it("rejects a bulk larger than the declared cap rather than truncating it", async () => {
    const lifecycle = await loadLifecycle();
    await expect(
      asOwner(() =>
        lifecycleLib.applyCrmStatusTransitions({
          db: getDb(),
          lifecycle,
          targets: Array.from(
            { length: lifecycleLib.MAX_STATUS_TRANSITION_TARGETS + 1 },
            (_, index) => ({ recordId: `rec_missing_${index}` }),
          ),
          to: "won",
          actor,
          ownership,
        }),
      ),
    ).rejects.toMatchObject({ code: "crm-status-transition-too-many" });
  });
});

describe("claimCrmStatusTransition", () => {
  it("refuses a target whose status moved since the decision was made", async () => {
    const lifecycle = await loadLifecycle();
    const recordId = await createRecord({ displayName: "Raced" });
    await setStage(recordId, "new");

    // A concurrent writer moves it between the partition read and the write.
    await setStage(recordId, "in-progress");

    const claimed = await asOwner(() =>
      lifecycleLib.claimCrmStatusTransition({
        db: getDb(),
        lifecycle,
        expected: [{ target: { recordId }, from: "new" }],
      }),
    );
    expect(claimed.has(`record:${recordId}`)).toBe(false);

    // Re-deciding on the value that IS current claims it.
    const reclaimed = await asOwner(() =>
      lifecycleLib.claimCrmStatusTransition({
        db: getDb(),
        lifecycle,
        expected: [{ target: { recordId }, from: "in-progress" }],
      }),
    );
    expect(reclaimed.has(`record:${recordId}`)).toBe(true);
  });

  it("refuses an unset target that has since grown a status", async () => {
    const lifecycle = await loadLifecycle();
    const recordId = await createRecord({ displayName: "Grew A Stage" });

    const beforeWrite = await asOwner(() =>
      lifecycleLib.claimCrmStatusTransition({
        db: getDb(),
        lifecycle,
        expected: [{ target: { recordId }, from: null }],
      }),
    );
    expect(beforeWrite.has(`record:${recordId}`)).toBe(true);

    await setStage(recordId, "new");
    const afterWrite = await asOwner(() =>
      lifecycleLib.claimCrmStatusTransition({
        db: getDb(),
        lifecycle,
        expected: [{ target: { recordId }, from: null }],
      }),
    );
    expect(afterWrite.has(`record:${recordId}`)).toBe(false);
  });

  it("leaves a raced row with exactly one current value", async () => {
    const lifecycle = await loadLifecycle();
    const stable = await createRecord({ displayName: "Stable" });
    const raced = await createRecord({ displayName: "Raced Bulk" });
    await setStage(stable, "new");
    await setStage(raced, "new");

    // Decide on both at "new", then move one of them out from under the write.
    const expected = [
      { target: { recordId: stable }, from: "new" as string | null },
      { target: { recordId: raced }, from: "new" as string | null },
    ];
    await setStage(raced, "won");
    const claimed = await asOwner(() =>
      lifecycleLib.claimCrmStatusTransition({
        db: getDb(),
        lifecycle,
        expected,
      }),
    );

    expect([...claimed]).toEqual([`record:${stable}`]);
    const current = (await stageRows(raced)).filter(
      (row: any) => row.activeUntil === null,
    );
    expect(current).toHaveLength(1);
    expect(current[0].stringValue).toBe("won");
  });
});

describe("lifecycle blocks that come from the attribute", () => {
  it("blocks a provider-owned status attribute for the whole bulk", async () => {
    await createStatusAttribute({
      id: "attr_provider_stage",
      objectType: "provider_companies",
      options: [{ value: "open" }, { value: "closed" }],
      authority: "provider",
    });
    const lifecycle = await loadLifecycle("attr_provider_stage");
    const recordId = await createRecord({
      displayName: "Provider Owned",
      objectType: "provider_companies",
    });

    const report = await asOwner(() =>
      lifecycleLib.applyCrmStatusTransitions({
        db: getDb(),
        lifecycle,
        targets: [{ recordId }],
        to: "closed",
        actor,
        ownership,
      }),
    );
    expect(report.skippedByReason).toEqual({ "provider-authority": 1 });
    expect(report.rows[0].block?.message).toContain(
      "the connected provider owns this attribute",
    );
  });

  it("lets a row leave an archived status but not enter one", async () => {
    await createStatusAttribute({
      id: "attr_sunset_stage",
      objectType: "sunset_co",
      options: [{ value: "open" }, { value: "sunset" }],
    });
    const recordId = await createRecord({
      displayName: "Parked On A Retired Stage",
      objectType: "sunset_co",
    });
    await asOwner(() =>
      writeCrmRecordField({
        target: { recordId },
        attribute: {
          id: "attr_sunset_stage",
          apiSlug: "stage",
          attributeType: "status",
          multi: false,
          historyTracked: true,
          valueType: "enum",
          storagePolicy: "local-authoritative",
          fieldPolicyId: "attr_sunset_stage",
        },
        value: "sunset",
        actor,
        ownership,
      }),
    );
    // Retire the stage AFTER a row is parked on it — the case an enterable-only
    // rule has to get right.
    await getDb()
      .update(schema.crmAttributeOptions)
      .set({ archived: true })
      .where(eq(schema.crmAttributeOptions.id, "attr_sunset_stage_sunset"));
    const lifecycle = await loadLifecycle("attr_sunset_stage");

    const intoArchived = await asOwner(() =>
      lifecycleLib.applyCrmStatusTransitions({
        db: getDb(),
        lifecycle,
        targets: [{ recordId }],
        to: "sunset",
        actor,
        ownership,
      }),
    );
    expect(intoArchived.skippedByReason).toEqual({ "archived-status": 1 });
    expect(intoArchived.skippedByStatus).toEqual({ sunset: 1 });

    const outOfArchived = await asOwner(() =>
      lifecycleLib.applyCrmStatusTransitions({
        db: getDb(),
        lifecycle,
        targets: [{ recordId }],
        to: "open",
        actor,
        ownership,
      }),
    );
    expect(outOfArchived.changed).toBe(1);
  });
});

describe("update-crm-record routes a status field through the lifecycle", () => {
  const RECORD_STAGE = "attr_record_stage";
  let stagedRecordId: string;

  beforeAll(async () => {
    await createStatusAttribute({
      id: RECORD_STAGE,
      objectType: "gated_co",
      options: [{ value: "open" }, { value: "retired", archived: true }],
      updateable: true,
    });
    stagedRecordId = await createRecord({
      displayName: "Gated Co",
      objectType: "gated_co",
    });
  });

  it("refuses an undeclared stage with the sentence, not a generic 4xx", async () => {
    await expect(
      asOwner(() =>
        updateCrmRecord.run(
          {
            recordId: stagedRecordId,
            target: "local",
            fields: { stage: "invented" },
          },
          ownerCtx,
        ),
      ),
    ).rejects.toMatchObject({
      code: "unknown-status",
      statusCode: 422,
      message: expect.stringContaining("Known values: open, retired"),
    });
  });

  it("refuses a move into a retired stage and writes nothing", async () => {
    await expect(
      asOwner(() =>
        updateCrmRecord.run(
          {
            recordId: stagedRecordId,
            target: "local",
            fields: { stage: "retired" },
          },
          ownerCtx,
        ),
      ),
    ).rejects.toMatchObject({ code: "archived-status", statusCode: 422 });

    const rows = await getDb()
      .select()
      .from(schema.crmRecordFields)
      .where(eq(schema.crmRecordFields.recordId, stagedRecordId));
    expect(rows).toHaveLength(0);
  });

  it("leaves a provider-target status change to the proposal flow", async () => {
    // The provider path is a handoff, not a blocked transition, so the
    // lifecycle must not turn a working flow into an error.
    await createStatusAttribute({
      id: "attr_mirrored_stage",
      objectType: "mirrored_co",
      options: [{ value: "open" }],
      storagePolicy: "mirrored",
      updateable: true,
    });
    const recordId = await createRecord({
      displayName: "Mirrored Co",
      objectType: "mirrored_co",
    });

    const proposal = await asOwner(() =>
      updateCrmRecord.run(
        {
          recordId,
          target: "provider",
          fields: { stage: "invented" },
          expectedRemoteRevision: "rev-1",
        },
        ownerCtx,
      ),
    );
    expect(proposal.status).toBe("pending");
  });
});

// ---------------------------------------------------------------------------
// 2. Dedupe and merge
// ---------------------------------------------------------------------------

describe("find-crm-duplicates", () => {
  it("returns scored pairs with a reason and never changes a record", async () => {
    const a = await createRecord({
      displayName: "Globex Inc",
      objectType: "dedupe_co",
      domain: "globex.example",
    });
    const b = await createRecord({
      displayName: "Globex Corporation",
      objectType: "dedupe_co",
      domain: "globex.example",
    });

    const result = await asOwner(() =>
      findCrmDuplicates.run({ recordIds: [a] }, ownerCtx),
    );
    expect(result.records).toHaveLength(1);
    const [candidate] = result.records[0].candidates;
    expect(candidate.recordId).toBe(b);
    expect(candidate.signals.map((signal: any) => signal.reason)).toContain(
      "domain",
    );
    expect(candidate.confidence).toBeGreaterThan(0.4);

    const [untouched] = await getDb()
      .select()
      .from(schema.crmRecords)
      .where(eq(schema.crmRecords.id, b));
    expect(untouched.tombstone).toBe(false);
  });

  it("names requested records it could not read instead of calling them clean", async () => {
    const hidden = await createRecord({
      displayName: "Hidden Co",
      objectType: "dedupe_hidden",
    });
    const result = await asOther(() =>
      findCrmDuplicates.run({ recordIds: [hidden] }, otherCtx),
    );
    expect(result.unreadableRecordIds).toEqual([hidden]);
    expect(result.cleanRecordIds).toEqual([]);
    expect(result.records).toEqual([]);
  });
});

describe("merge-crm-records", () => {
  async function buildMergePair() {
    const survivor = await createRecord({
      displayName: "Initech",
      objectType: "merge_co",
      domain: "initech.example",
    });
    const duplicate = await createRecord({
      displayName: "Initech Inc",
      objectType: "merge_co",
      domain: "initech.example",
    });
    const now = new Date().toISOString();

    const listId = `list_${++counter}`;
    await getDb()
      .insert(schema.crmLists)
      .values({
        id: listId,
        connectionId: CONNECTION_ID,
        name: "Pipeline",
        apiSlug: `pipeline_${counter}`,
        parentObjectType: "merge_co",
        ...ownership,
        createdAt: now,
        updatedAt: now,
      });
    const survivorEntryId = `entry_s_${counter}`;
    const duplicateEntryId = `entry_d_${counter}`;
    for (const [id, recordId] of [
      [survivorEntryId, survivor],
      [duplicateEntryId, duplicate],
    ] as const) {
      await getDb()
        .insert(schema.crmListEntries)
        .values({
          id,
          listId,
          recordId,
          ...ownership,
          createdAt: now,
          updatedAt: now,
        });
    }

    for (const [id, recordId, title] of [
      [`task_s_${counter}`, survivor, "Survivor task"],
      [`task_d_${counter}`, duplicate, "Duplicate task"],
    ] as const) {
      await getDb()
        .insert(schema.crmTasks)
        .values({
          id,
          recordId,
          title,
          ...ownership,
          createdAt: now,
          updatedAt: now,
        });
    }

    for (const [id, recordId, label] of [
      [`sig_s_${counter}`, survivor, "Survivor signal"],
      [`sig_d_${counter}`, duplicate, "Duplicate signal"],
    ] as const) {
      await getDb()
        .insert(schema.crmSignals)
        .values({
          id,
          recordId,
          evidenceId: `ev_${id}`,
          kind: "moment",
          label,
          detector: "keyword",
          idempotencyKey: `idem_${id}`,
          ...ownership,
          createdAt: now,
          updatedAt: now,
        });
    }

    await getDb()
      .insert(schema.crmInteractions)
      .values({
        id: `note_d_${counter}`,
        recordId: duplicate,
        kind: "note",
        title: "Duplicate note",
        occurredAt: now,
        ...ownership,
        createdAt: now,
        updatedAt: now,
      });
    await getDb()
      .insert(schema.crmCallEvidence)
      .values({
        id: `ev_d_${counter}`,
        recordId: duplicate,
        artifactId: "clip_1",
        sourceUrl: "https://clips.example/r/clip_1",
        capturedAt: now,
        ...ownership,
        createdAt: now,
        updatedAt: now,
      });

    return { survivor, duplicate, listId, survivorEntryId, duplicateEntryId };
  }

  it("keeps list entries, tasks, notes, signals, and evidence from BOTH sides", async () => {
    const pair = await buildMergePair();

    const result = await asOwner(() =>
      mergeCrmRecords.run(
        {
          survivorRecordId: pair.survivor,
          duplicateRecordId: pair.duplicate,
        },
        ownerCtx,
      ),
    );
    expect(result).toMatchObject({
      status: "applied",
      replayed: false,
      duplicateTombstoned: true,
      moved: {
        listEntries: 1,
        tasks: 1,
        interactions: 1,
        callEvidence: 1,
        signals: 1,
      },
    });

    const entries = await getDb()
      .select()
      .from(schema.crmListEntries)
      .where(eq(schema.crmListEntries.recordId, pair.survivor));
    expect(entries.map((row: any) => row.id).sort()).toEqual(
      [pair.survivorEntryId, pair.duplicateEntryId].sort(),
    );

    const tasks = await getDb()
      .select()
      .from(schema.crmTasks)
      .where(eq(schema.crmTasks.recordId, pair.survivor));
    expect(tasks.map((row: any) => row.title).sort()).toEqual([
      "Duplicate task",
      "Survivor task",
    ]);

    const signals = await getDb()
      .select()
      .from(schema.crmSignals)
      .where(eq(schema.crmSignals.recordId, pair.survivor));
    expect(signals).toHaveLength(2);

    const notes = await getDb()
      .select()
      .from(schema.crmInteractions)
      .where(eq(schema.crmInteractions.recordId, pair.survivor));
    expect(notes.map((row: any) => row.title)).toEqual(["Duplicate note"]);

    // The loser is tombstoned and points at the survivor — never hard-deleted.
    const [loser] = await getDb()
      .select()
      .from(schema.crmRecords)
      .where(eq(schema.crmRecords.id, pair.duplicate));
    expect(loser).toMatchObject({
      tombstone: true,
      displayName: "Initech Inc",
    });
    const [link] = await getDb()
      .select()
      .from(schema.crmRelationships)
      .where(eq(schema.crmRelationships.fromRecordId, pair.duplicate));
    expect(link).toMatchObject({
      toRecordId: pair.survivor,
      relationshipType: "merged-into",
    });

    // The merge is in the mutations ledger, not just in the rows it moved.
    const [ledger] = await getDb()
      .select()
      .from(schema.crmMutations)
      .where(eq(schema.crmMutations.id, result.mutationId));
    expect(ledger).toMatchObject({
      recordId: pair.survivor,
      target: "local",
      status: "applied",
      risk: "ownership",
      initiatedBy: "human",
    });
    expect(JSON.parse(ledger.patchJson).merge).toEqual({
      survivorRecordId: pair.survivor,
      duplicateRecordId: pair.duplicate,
    });
  });

  it("promotes a field value the survivor is missing through the bitemporal writer", async () => {
    const survivor = await createRecord({
      displayName: "Field Survivor",
      objectType: "companies",
    });
    const duplicate = await createRecord({
      displayName: "Field Duplicate",
      objectType: "companies",
    });
    await setStage(duplicate, "won");

    const result = await asOwner(() =>
      mergeCrmRecords.run(
        { survivorRecordId: survivor, duplicateRecordId: duplicate },
        ownerCtx,
      ),
    );
    expect(result.promotedFields).toEqual(["stage"]);

    const promoted = (await stageRows(survivor)).filter(
      (row: any) => row.activeUntil === null,
    );
    expect(promoted).toHaveLength(1);
    expect(promoted[0]).toMatchObject({
      stringValue: "won",
      attributeId: STAGE_ATTRIBUTE_ID,
    });
    // The duplicate keeps its own history — the merge is reversible by reading.
    expect(await stageRows(duplicate)).toHaveLength(1);
  });

  it("does not overwrite a value the survivor already holds", async () => {
    const survivor = await createRecord({
      displayName: "Keeps Its Stage",
      objectType: "companies",
    });
    const duplicate = await createRecord({
      displayName: "Loses Its Stage",
      objectType: "companies",
    });
    await setStage(survivor, "in-progress");
    await setStage(duplicate, "won");

    const result = await asOwner(() =>
      mergeCrmRecords.run(
        { survivorRecordId: survivor, duplicateRecordId: duplicate },
        ownerCtx,
      ),
    );
    expect(result.promotedFields).toEqual([]);
    const current = (await stageRows(survivor)).filter(
      (row: any) => row.activeUntil === null,
    );
    expect(current[0].stringValue).toBe("in-progress");
  });

  it("is idempotent on re-run and replays the original ledger row", async () => {
    const pair = await buildMergePair();
    const first = await asOwner(() =>
      mergeCrmRecords.run(
        { survivorRecordId: pair.survivor, duplicateRecordId: pair.duplicate },
        ownerCtx,
      ),
    );
    const second = await asOwner(() =>
      mergeCrmRecords.run(
        { survivorRecordId: pair.survivor, duplicateRecordId: pair.duplicate },
        ownerCtx,
      ),
    );

    expect(second).toMatchObject({
      mutationId: first.mutationId,
      replayed: true,
      status: "applied",
    });
    const ledger = await getDb()
      .select()
      .from(schema.crmMutations)
      .where(eq(schema.crmMutations.recordId, pair.survivor));
    expect(ledger).toHaveLength(1);
    const entries = await getDb()
      .select()
      .from(schema.crmListEntries)
      .where(eq(schema.crmListEntries.recordId, pair.survivor));
    expect(entries).toHaveLength(2);
  });

  it("is approval-gated for an agent caller and immediate for a human", async () => {
    const args = {
      survivorRecordId: "rec_a",
      duplicateRecordId: "rec_b",
    };
    expect(await mergeCrmRecords.needsApproval(args, agentCtx)).toBe(true);
    expect(
      await mergeCrmRecords.needsApproval(args, {
        caller: "a2a" as const,
        userEmail: OWNER,
      }),
    ).toBe(true);
    expect(await mergeCrmRecords.needsApproval(args, ownerCtx)).toBe(false);
  });

  it("refuses a cross-object-type merge and a self merge", async () => {
    const account = await createRecord({
      displayName: "An Account",
      objectType: "merge_a",
    });
    const person = await createRecord({
      displayName: "A Person",
      objectType: "merge_b",
      kind: "person",
    });

    await expect(
      asOwner(() =>
        mergeCrmRecords.run(
          { survivorRecordId: account, duplicateRecordId: person },
          ownerCtx,
        ),
      ),
    ).rejects.toMatchObject({
      code: "crm-merge-object-type-mismatch",
      statusCode: 422,
    });

    await expect(
      asOwner(() =>
        mergeCrmRecords.run(
          { survivorRecordId: account, duplicateRecordId: account },
          ownerCtx,
        ),
      ),
    ).rejects.toMatchObject({ code: "crm-merge-same-record" });
  });

  it("points a second merge at the record that actually won", async () => {
    const first = await buildMergePair();
    await asOwner(() =>
      mergeCrmRecords.run(
        {
          survivorRecordId: first.survivor,
          duplicateRecordId: first.duplicate,
        },
        ownerCtx,
      ),
    );
    const third = await createRecord({
      displayName: "Third Initech",
      objectType: "merge_co",
    });

    await expect(
      asOwner(() =>
        mergeCrmRecords.run(
          { survivorRecordId: third, duplicateRecordId: first.duplicate },
          ownerCtx,
        ),
      ),
    ).rejects.toMatchObject({ code: "crm-merge-duplicate-tombstoned" });
  });
});

// ---------------------------------------------------------------------------
// 3. One-call orientation
// ---------------------------------------------------------------------------

describe("get-crm-workspace", () => {
  it("derives identity, book of business, and queues from the session alone", async () => {
    const workspace = await asOwner(() =>
      getCrmWorkspace.run({ bookLimit: 5 }, ownerCtx),
    );

    expect(workspace.user).toMatchObject({ email: OWNER, orgId: null });
    expect(workspace.book.complete).toBe(true);
    expect(workspace.book.recordCount).toBeGreaterThan(0);
    expect(Object.keys(workspace.book.byStage).length).toBeGreaterThan(0);
    expect(workspace.book.records.length).toBeLessThanOrEqual(5);
    expect(workspace.tasks).toMatchObject({ complete: true });
    expect(workspace.signals.unreviewed).toBeGreaterThanOrEqual(0);
    expect(workspace.connections.map((row: any) => row.id)).toContain(
      CONNECTION_ID,
    );
  });

  it("reports someone else's empty book as empty, not as an error", async () => {
    const workspace = await asOther(() =>
      getCrmWorkspace.run({ bookLimit: 5 }, otherCtx),
    );
    expect(workspace.book.recordCount).toBe(0);
    expect(workspace.ownerStatus).toBe("not-applicable");
    expect(workspace.ownerError).toBeUndefined();
  });

  it("resolves the provider owner from mirrored attribution", async () => {
    const now = new Date().toISOString();
    await getDb().insert(schema.crmConnections).values({
      id: "conn_hubspot_ok",
      provider: "hubspot",
      label: "HubSpot",
      mode: "connected",
      status: "connected",
      accessScopeKey: "hubspot",
      ownerEmail: "rep@example.test",
      orgId: null,
      visibility: "private",
      createdAt: now,
      updatedAt: now,
    });
    const recordId = `rec_owner_${++counter}`;
    await getDb().insert(schema.crmRecords).values({
      id: recordId,
      connectionId: "conn_hubspot_ok",
      provider: "hubspot",
      objectType: "companies",
      kind: "account",
      remoteId: recordId,
      displayName: "Owned Upstream",
      ownerRemoteId: "owner-77",
      ownerName: "Rep Seven",
      accessScopeKey: "hubspot",
      accessScopeJson: "{}",
      ownerEmail: "rep@example.test",
      orgId: null,
      visibility: "private",
      createdAt: now,
      updatedAt: now,
    });

    const workspace = await runWithRequestContext(
      { userEmail: "rep@example.test" },
      () =>
        getCrmWorkspace.run(
          {},
          { caller: "frontend" as const, userEmail: "rep@example.test" },
        ),
    );
    expect(workspace.ownerStatus).toBe("resolved");
    expect(workspace.owner).toMatchObject({
      provider: "hubspot",
      ownerRemoteId: "owner-77",
      ownerName: "Rep Seven",
      recordCount: 1,
    });
  });

  it("degrades to a typed ownerError when a connection is unreadable", async () => {
    const now = new Date().toISOString();
    const rep = "broken-rep@example.test";
    await getDb().insert(schema.crmConnections).values({
      id: "conn_hubspot_broken",
      provider: "hubspot",
      label: "HubSpot",
      mode: "connected",
      status: "error",
      lastError: "401 token expired",
      accessScopeKey: "hubspot",
      ownerEmail: rep,
      orgId: null,
      visibility: "private",
      createdAt: now,
      updatedAt: now,
    });

    const workspace = await runWithRequestContext({ userEmail: rep }, () =>
      getCrmWorkspace.run({}, { caller: "frontend" as const, userEmail: rep }),
    );

    // The failure mode this exists to prevent: a broken connection reading the
    // same as an empty book.
    expect(workspace.book.recordCount).toBe(0);
    expect(workspace.ownerStatus).toBe("unreadable");
    expect(workspace.owner).toBeNull();
    expect(workspace.ownerError).toMatchObject({
      code: "crm-owner-connection-unhealthy",
      connectionId: "conn_hubspot_broken",
    });
    expect(workspace.ownerError.message).toContain("401 token expired");
  });

  it("reports an unmapped owner separately from an unreadable one", async () => {
    const now = new Date().toISOString();
    const rep = "unmapped-rep@example.test";
    await getDb().insert(schema.crmConnections).values({
      id: "conn_hubspot_unmapped",
      provider: "hubspot",
      label: "HubSpot",
      mode: "connected",
      status: "connected",
      accessScopeKey: "hubspot",
      ownerEmail: rep,
      orgId: null,
      visibility: "private",
      createdAt: now,
      updatedAt: now,
    });

    const workspace = await runWithRequestContext({ userEmail: rep }, () =>
      getCrmWorkspace.run({}, { caller: "frontend" as const, userEmail: rep }),
    );
    expect(workspace.ownerStatus).toBe("unmapped");
    expect(workspace.owner).toBeNull();
    expect(workspace.ownerError).toBeUndefined();
  });

  it("refuses to guess when the caller appears under two provider owner ids", async () => {
    const now = new Date().toISOString();
    const rep = "split-rep@example.test";
    await getDb().insert(schema.crmConnections).values({
      id: "conn_hubspot_split",
      provider: "hubspot",
      label: "HubSpot",
      mode: "connected",
      status: "connected",
      accessScopeKey: "hubspot",
      ownerEmail: rep,
      orgId: null,
      visibility: "private",
      createdAt: now,
      updatedAt: now,
    });
    for (const ownerRemoteId of ["owner-1", "owner-2"]) {
      const id = `rec_split_${++counter}`;
      await getDb()
        .insert(schema.crmRecords)
        .values({
          id,
          connectionId: "conn_hubspot_split",
          provider: "hubspot",
          objectType: "companies",
          kind: "account",
          remoteId: id,
          displayName: `Split ${ownerRemoteId}`,
          ownerRemoteId,
          accessScopeKey: "hubspot",
          accessScopeJson: "{}",
          ownerEmail: rep,
          orgId: null,
          visibility: "private",
          createdAt: now,
          updatedAt: now,
        });
    }

    const workspace = await runWithRequestContext({ userEmail: rep }, () =>
      getCrmWorkspace.run({}, { caller: "frontend" as const, userEmail: rep }),
    );
    expect(workspace.ownerStatus).toBe("ambiguous");
    expect(workspace.owner).toBeNull();
    expect(workspace.ownerError).toMatchObject({ code: "crm-owner-ambiguous" });
    expect(workspace.book.recordCount).toBe(2);
  });
});
