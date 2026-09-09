import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { runWithRequestContext } from "@agent-native/core/server";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const databasePath = join(
  tmpdir(),
  `relationship-revision-documents-${process.pid}-${Date.now()}.pglite`,
);
const owner = "relationship-revision-documents-owner@example.test";
const spaceId = `relationship-revision-documents-${process.pid}-${Date.now()}`;

let dbModule: typeof import("../server/db/index.js");
let relationshipCore: typeof import("./_relationship-core.js");
let listHistory: typeof import("./list-content-relationship-history.js").default;
let nextFixture = 0;

type RelationshipDb = ReturnType<
  (typeof import("../server/db/index.js"))["getDb"]
>;

const asOwner = <T>(run: () => Promise<T>) =>
  runWithRequestContext({ userEmail: owner }, run);

beforeAll(async () => {
  process.env.DATABASE_URL = `pglite:${databasePath}`;
  dbModule = await import("../server/db/index.js");
  await (await import("../server/plugins/db.js")).default(undefined as never);
  relationshipCore = await import("./_relationship-core.js");
  listHistory = (await import("./list-content-relationship-history.js"))
    .default;
}, 60_000);

afterAll(() => {
  delete process.env.DATABASE_URL;
  rmSync(databasePath, { recursive: true, force: true });
});

async function historicalRevision(options: { malformedSecondEvent?: boolean }) {
  const prefix = `${spaceId}-${++nextFixture}`;
  const typeId = `${prefix}-type`;
  const versionId = `${prefix}-version`;
  const sourcePageId = `${prefix}-source`;
  const targetPageId = `${prefix}-target`;
  const sourceDatabaseId = `${prefix}-missing-source-database`;
  const targetDatabaseId = `${prefix}-missing-target-database`;
  const lineageId = `${prefix}-lineage`;
  const revisionId = `${prefix}-revision`;
  await dbModule
    .getDb()
    .insert(dbModule.schema.documents)
    .values([
      {
        id: sourcePageId,
        spaceId,
        ownerEmail: owner,
        title: "Source Page",
      },
      {
        id: targetPageId,
        spaceId,
        ownerEmail: owner,
        title: "Target Page",
      },
    ]);
  await dbModule
    .getDb()
    .insert(dbModule.schema.contentRelationshipTypes)
    .values({
      id: typeId,
      ownerEmail: owner,
      spaceId,
      currentVersionId: versionId,
      createdBy: owner,
    });
  await dbModule
    .getDb()
    .insert(dbModule.schema.contentRelationshipTypeVersions)
    .values({
      id: versionId,
      ownerEmail: owner,
      spaceId,
      relationshipTypeId: typeId,
      version: 1,
      forwardLabel: "Related to",
      inverseLabel: "Related from",
      forwardCardinality: "many",
      sourceDatabaseId,
      targetDatabaseId,
      createdBy: owner,
    });
  await dbModule
    .getDb()
    .insert(dbModule.schema.contentRelationshipLineages)
    .values({
      id: lineageId,
      ownerEmail: owner,
      spaceId,
      relationshipTypeId: typeId,
      sourcePageId,
      targetPageId,
      createdBy: owner,
    });
  await dbModule
    .getDb()
    .insert(dbModule.schema.contentRelationshipRevisions)
    .values({
      id: revisionId,
      ownerEmail: owner,
      spaceId,
      operationId: `${prefix}-operation`,
      operation: "mutate-relationships",
      actorJson: JSON.stringify({
        kind: "person",
        displayName: owner,
        email: owner,
      }),
      authorizingPrincipalJson: JSON.stringify({
        kind: "user",
        email: owner,
        orgId: null,
      }),
      origin: "frontend",
      recoveryToken: `${prefix}-recovery-token`,
      diffJson: "{}",
    });
  const event = (sequence: number) => ({
    id: `${prefix}-event-${sequence}`,
    ownerEmail: owner,
    spaceId,
    revisionId,
    sequence,
    relationshipTypeId: typeId,
    relationshipTypeVersionId: versionId,
    kind: "relationship-added",
    actorJson: JSON.stringify({
      kind: "person",
      displayName: owner,
      email: owner,
    }),
    authorizingPrincipalJson: JSON.stringify({
      kind: "user",
      email: owner,
      orgId: null,
    }),
    origin: "frontend",
    routeJson: JSON.stringify({
      kind: "connections-forward",
      sourcePageId,
    }),
    targetsJson: JSON.stringify({
      lineageId,
      sourcePageId,
      targetPageId,
    }),
    diffJson: JSON.stringify({ addedActivationIds: [`${prefix}-activation`] }),
  });
  const events = [event(0)];
  if (options.malformedSecondEvent) {
    events.push({
      ...event(1),
      targetsJson: JSON.stringify({ lineageId, sourcePageId }),
    });
  }
  await dbModule
    .getDb()
    .insert(dbModule.schema.contentRelationshipEvents)
    .values(events);
  return {
    prefix,
    revisionId,
    sourcePageId,
    targetPageId,
    sourceDatabaseId,
    targetDatabaseId,
  };
}

describe("relationship Revision document indexing", () => {
  it("processes only the requested batch before the release runner continues", async () => {
    const first = await historicalRevision({});
    const second = await historicalRevision({});

    await expect(
      relationshipCore.backfillRelationshipRevisionDocuments(undefined, 1),
    ).resolves.toEqual({ processed: 1 });
    const firstPass = await dbModule
      .getDb()
      .select({
        revisionId:
          dbModule.schema.contentRelationshipRevisionDocuments.revisionId,
      })
      .from(dbModule.schema.contentRelationshipRevisionDocuments);
    expect(new Set(firstPass.map((row) => row.revisionId))).toEqual(
      new Set([first.revisionId]),
    );

    await expect(
      relationshipCore.backfillRelationshipRevisionDocuments(undefined, 1),
    ).resolves.toEqual({ processed: 1 });
    const secondPass = await dbModule
      .getDb()
      .select({
        revisionId:
          dbModule.schema.contentRelationshipRevisionDocuments.revisionId,
      })
      .from(dbModule.schema.contentRelationshipRevisionDocuments);
    expect(new Set(secondPass.map((row) => row.revisionId))).toEqual(
      new Set([first.revisionId, second.revisionId]),
    );
    await expect(
      relationshipCore.backfillRelationshipRevisionDocuments(undefined, 1),
    ).resolves.toEqual({ processed: 0 });
  });

  it("backfills explicit inaccessible tombstones for deleted database metadata", async () => {
    const seed = await historicalRevision({});

    await relationshipCore.backfillRelationshipRevisionDocuments();

    const references = await dbModule
      .getDb()
      .select({
        documentId:
          dbModule.schema.contentRelationshipRevisionDocuments.documentId,
        unresolved:
          dbModule.schema.contentRelationshipRevisionDocuments.unresolved,
      })
      .from(dbModule.schema.contentRelationshipRevisionDocuments)
      .where(
        eq(
          dbModule.schema.contentRelationshipRevisionDocuments.revisionId,
          seed.revisionId,
        ),
      );
    expect(
      references.sort((left, right) =>
        left.documentId.localeCompare(right.documentId),
      ),
    ).toEqual(
      [
        { documentId: seed.sourcePageId, unresolved: 0 },
        { documentId: seed.targetPageId, unresolved: 0 },
        {
          documentId: `missing-database:${seed.sourceDatabaseId}`,
          unresolved: 1,
        },
        {
          documentId: `missing-database:${seed.targetDatabaseId}`,
          unresolved: 1,
        },
      ].sort((left, right) => left.documentId.localeCompare(right.documentId)),
    );
    await expect(
      asOwner(() => listHistory.run({ pageId: seed.sourcePageId })),
    ).resolves.toMatchObject({ items: [] });
  });

  it("rolls back every reference when one historical Event is malformed", async () => {
    const seed = await historicalRevision({ malformedSecondEvent: true });

    await expect(
      relationshipCore.backfillRelationshipRevisionDocuments(),
    ).rejects.toMatchObject({ errorCode: "UNAVAILABLE" });
    const afterFailure = await dbModule
      .getDb()
      .select()
      .from(dbModule.schema.contentRelationshipRevisionDocuments)
      .where(
        eq(
          dbModule.schema.contentRelationshipRevisionDocuments.revisionId,
          seed.revisionId,
        ),
      );
    expect(afterFailure).toHaveLength(0);

    await dbModule
      .getDb()
      .update(dbModule.schema.contentRelationshipEvents)
      .set({
        targetsJson: JSON.stringify({
          lineageId: `${seed.prefix}-lineage`,
          sourcePageId: seed.sourcePageId,
          targetPageId: seed.targetPageId,
        }),
      })
      .where(
        eq(
          dbModule.schema.contentRelationshipEvents.id,
          `${seed.prefix}-event-1`,
        ),
      );
    await relationshipCore.backfillRelationshipRevisionDocuments();
    const afterRepair = await dbModule
      .getDb()
      .select()
      .from(dbModule.schema.contentRelationshipRevisionDocuments)
      .where(
        eq(
          dbModule.schema.contentRelationshipRevisionDocuments.revisionId,
          seed.revisionId,
        ),
      );
    expect(afterRepair.length).toBeGreaterThan(0);
  });

  it("keeps runtime Event writes strict when database metadata is missing", async () => {
    const seed = await historicalRevision({});

    await expect(
      dbModule.getDb().transaction(async (rawTx) => {
        const tx = rawTx as unknown as RelationshipDb;
        const revision = await relationshipCore.createRelationshipRevision(tx, {
          tenant: { ownerEmail: owner, orgId: null, spaceId },
          operationId: `${seed.prefix}-runtime-operation`,
          operation: "mutate-relationships",
          diff: {},
          context: { userEmail: owner },
        });
        await relationshipCore.appendRelationshipEvent(tx, revision, {
          tenant: { ownerEmail: owner, orgId: null, spaceId },
          kind: "relationship-added",
          relationshipTypeId: `${seed.prefix}-type`,
          relationshipTypeVersionId: `${seed.prefix}-version`,
          route: {
            kind: "connections-forward",
            sourcePageId: seed.sourcePageId,
          },
          targets: {
            lineageId: `${seed.prefix}-lineage`,
            sourcePageId: seed.sourcePageId,
            targetPageId: seed.targetPageId,
          },
          diff: { addedActivationIds: [`${seed.prefix}-runtime-activation`] },
        });
      }),
    ).rejects.toMatchObject({ errorCode: "UNAVAILABLE" });
    const revisions = await dbModule
      .getDb()
      .select()
      .from(dbModule.schema.contentRelationshipRevisions)
      .where(
        eq(
          dbModule.schema.contentRelationshipRevisions.operationId,
          `${seed.prefix}-runtime-operation`,
        ),
      );
    expect(revisions).toHaveLength(0);
  });

  it("rolls back a Revision before writing an Event for another tenant", async () => {
    const operationId = `${spaceId}-tenant-mismatch-${nextFixture++}`;

    await expect(
      dbModule.getDb().transaction(async (rawTx) => {
        const tx = rawTx as unknown as RelationshipDb;
        const revision = await relationshipCore.createRelationshipRevision(tx, {
          tenant: { ownerEmail: owner, orgId: null, spaceId },
          operationId,
          operation: "mutate-relationships",
          diff: {},
          context: { userEmail: owner },
        });
        await relationshipCore.appendRelationshipEvent(tx, revision, {
          tenant: {
            ownerEmail: owner,
            orgId: null,
            spaceId: `${spaceId}-other`,
          },
          kind: "relationship-added",
          route: {},
          targets: {},
          diff: {},
        });
      }),
    ).rejects.toMatchObject({ errorCode: "UNAVAILABLE" });
    const revisions = await dbModule
      .getDb()
      .select()
      .from(dbModule.schema.contentRelationshipRevisions)
      .where(
        eq(
          dbModule.schema.contentRelationshipRevisions.operationId,
          operationId,
        ),
      );
    expect(revisions).toHaveLength(0);
  });

  it("rolls back an Event whose lineage and declared endpoints disagree", async () => {
    const seed = await historicalRevision({});
    const operationId = `${seed.prefix}-lineage-mismatch`;

    await expect(
      dbModule.getDb().transaction(async (rawTx) => {
        const tx = rawTx as unknown as RelationshipDb;
        const revision = await relationshipCore.createRelationshipRevision(tx, {
          tenant: { ownerEmail: owner, orgId: null, spaceId },
          operationId,
          operation: "mutate-relationships",
          diff: {},
          context: { userEmail: owner },
        });
        await relationshipCore.appendRelationshipEvent(tx, revision, {
          tenant: { ownerEmail: owner, orgId: null, spaceId },
          kind: "relationship-added",
          relationshipTypeId: `${seed.prefix}-type`,
          relationshipTypeVersionId: `${seed.prefix}-version`,
          route: {
            kind: "connections-forward",
            sourcePageId: seed.sourcePageId,
          },
          targets: {
            lineageId: `${seed.prefix}-lineage`,
            sourcePageId: seed.sourcePageId,
            targetPageId: `${seed.targetPageId}-wrong`,
          },
          diff: { addedActivationIds: [`${seed.prefix}-activation`] },
        });
      }),
    ).rejects.toMatchObject({ errorCode: "UNAVAILABLE" });
    const revisions = await dbModule
      .getDb()
      .select()
      .from(dbModule.schema.contentRelationshipRevisions)
      .where(
        eq(
          dbModule.schema.contentRelationshipRevisions.operationId,
          operationId,
        ),
      );
    expect(revisions).toHaveLength(0);
  });
});
