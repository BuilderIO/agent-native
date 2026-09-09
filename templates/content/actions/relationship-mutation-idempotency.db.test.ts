import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { runWithRequestContext } from "@agent-native/core/server";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const databasePath = join(
  tmpdir(),
  `relationship-mutation-idempotency-${process.pid}-${Date.now()}.pglite`,
);
const owner = "relationship-mutation-owner@example.test";
const viewer = "relationship-mutation-viewer@example.test";
const spaceId = `relationship-mutation-${process.pid}-${Date.now()}`;

let dbModule: typeof import("../server/db/index.js");
let configure: typeof import("./configure-content-relation-property.js").default;
let listRelationships: typeof import("./list-content-relationships.js").default;
let mutate: typeof import("./mutate-content-relationships.js").default;
let nextFixture = 0;

const asUser = <T>(userEmail: string, run: () => Promise<T>) =>
  runWithRequestContext({ userEmail }, run);
const asOwner = <T>(run: () => Promise<T>) => asUser(owner, run);
const asViewer = <T>(run: () => Promise<T>) => asUser(viewer, run);

beforeAll(async () => {
  process.env.DATABASE_URL = `pglite:${databasePath}`;
  dbModule = await import("../server/db/index.js");
  await (await import("../server/plugins/db.js")).default(undefined as never);
  configure = (await import("./configure-content-relation-property.js"))
    .default;
  listRelationships = (await import("./list-content-relationships.js")).default;
  mutate = (await import("./mutate-content-relationships.js")).default;

  const filesDatabaseId = `${spaceId}-files`;
  await dbModule.getDb().insert(dbModule.schema.contentSpaces).values({
    id: spaceId,
    name: "Relationship mutation idempotency",
    kind: "personal",
    ownerEmail: owner,
    filesDatabaseId,
    createdBy: owner,
  });
  await dbModule
    .getDb()
    .insert(dbModule.schema.documents)
    .values({
      id: `${filesDatabaseId}-page`,
      spaceId,
      ownerEmail: owner,
      title: "Files",
    });
  await dbModule
    .getDb()
    .insert(dbModule.schema.contentDatabases)
    .values({
      id: filesDatabaseId,
      documentId: `${filesDatabaseId}-page`,
      spaceId,
      ownerEmail: owner,
      title: "Files",
      systemRole: "files",
      blocksSeeded: 1,
    });
}, 60_000);

afterAll(() => {
  delete process.env.DATABASE_URL;
  rmSync(databasePath, { recursive: true, force: true });
});

async function fixture() {
  const prefix = `${spaceId}-${++nextFixture}`;
  const sourceDatabaseId = `${prefix}-deliverables`;
  const targetDatabaseId = `${prefix}-people`;
  const sourcePageId = `${prefix}-launch`;
  const targetPageIds = [`${prefix}-mira`, `${prefix}-jo`];
  await dbModule
    .getDb()
    .insert(dbModule.schema.documents)
    .values([
      {
        id: `${sourceDatabaseId}-page`,
        spaceId,
        ownerEmail: owner,
        title: "Campaign deliverables",
      },
      {
        id: `${targetDatabaseId}-page`,
        spaceId,
        ownerEmail: owner,
        title: "Marketing team",
      },
      {
        id: sourcePageId,
        spaceId,
        ownerEmail: owner,
        title: "Launch article",
      },
      ...targetPageIds.map((id, index) => ({
        id,
        spaceId,
        ownerEmail: owner,
        title: index === 0 ? "Mira" : "Jo",
      })),
    ]);
  await dbModule
    .getDb()
    .insert(dbModule.schema.contentDatabases)
    .values([
      {
        id: sourceDatabaseId,
        spaceId,
        ownerEmail: owner,
        documentId: `${sourceDatabaseId}-page`,
        title: "Deliverables",
        blocksSeeded: 1,
      },
      {
        id: targetDatabaseId,
        spaceId,
        ownerEmail: owner,
        documentId: `${targetDatabaseId}-page`,
        title: "People",
        blocksSeeded: 1,
      },
    ]);
  await dbModule
    .getDb()
    .insert(dbModule.schema.contentDatabaseItems)
    .values([
      {
        id: `${prefix}-source-item`,
        databaseId: sourceDatabaseId,
        documentId: sourcePageId,
        ownerEmail: owner,
      },
      ...targetPageIds.map((documentId, index) => ({
        id: `${prefix}-target-item-${index}`,
        databaseId: targetDatabaseId,
        documentId,
        ownerEmail: owner,
        position: index,
      })),
    ]);
  const configured = await asOwner(() =>
    configure.run({
      ownerDatabaseId: sourceDatabaseId,
      alias: "Contributors",
      operationId: `${prefix}-configure`,
      definition: {
        kind: "new-local",
        forwardLabel: "Contributes to",
        inverseLabel: "Deliverables",
        forwardCardinality: "many",
        sourceDatabaseId,
        targetDatabaseId,
      },
      inverseProjection: {
        ownerDatabaseId: targetDatabaseId,
        alias: "Deliverables",
        editable: true,
      },
    }),
  );
  return {
    prefix,
    sourceDatabaseId,
    targetDatabaseId,
    sourcePageId,
    targetPageIds,
    typeId: configured.relationshipType.id,
    typeVersionId: configured.relationshipTypeVersion.id,
    propertyId: configured.projection.propertyId,
  };
}

type Fixture = Awaited<ReturnType<typeof fixture>>;

function addInput(
  seed: Fixture,
  operationId: string,
  targetPageId = seed.targetPageIds[0]!,
) {
  return {
    operationId,
    changes: [
      {
        kind: "add" as const,
        typeId: seed.typeId,
        typeVersionId: seed.typeVersionId,
        sourcePageId: seed.sourcePageId,
        targetPageId,
        route: {
          kind: "forward-property" as const,
          propertyId: seed.propertyId,
          sourcePageId: seed.sourcePageId,
        },
      },
    ],
  };
}

async function outgoing(seed: Fixture) {
  return asOwner(() =>
    listRelationships.run({
      pageId: seed.sourcePageId,
      relationshipTypeId: seed.typeId,
      direction: "outgoing",
    }),
  );
}

async function applyDrift(
  seed: Fixture,
  drift: "archive" | "membership" | "trash" | "version",
) {
  if (drift === "archive") {
    const archivedAt = new Date().toISOString();
    await dbModule
      .getDb()
      .update(dbModule.schema.contentRelationshipTypes)
      .set({ state: "archived", archivedAt, updatedAt: archivedAt })
      .where(eq(dbModule.schema.contentRelationshipTypes.id, seed.typeId));
    return;
  }
  if (drift === "membership") {
    await dbModule
      .getDb()
      .delete(dbModule.schema.contentDatabaseItems)
      .where(
        and(
          eq(
            dbModule.schema.contentDatabaseItems.databaseId,
            seed.targetDatabaseId,
          ),
          eq(
            dbModule.schema.contentDatabaseItems.documentId,
            seed.targetPageIds[0]!,
          ),
        ),
      );
    return;
  }
  if (drift === "trash") {
    await dbModule
      .getDb()
      .update(dbModule.schema.documents)
      .set({ trashedAt: new Date().toISOString() })
      .where(eq(dbModule.schema.documents.id, seed.targetPageIds[0]!));
    return;
  }
  const [current] = await dbModule
    .getDb()
    .select()
    .from(dbModule.schema.contentRelationshipTypeVersions)
    .where(
      eq(
        dbModule.schema.contentRelationshipTypeVersions.id,
        seed.typeVersionId,
      ),
    );
  const nextVersionId = `${seed.typeId}-version-2`;
  await dbModule
    .getDb()
    .insert(dbModule.schema.contentRelationshipTypeVersions)
    .values({
      ...current!,
      id: nextVersionId,
      version: current!.version + 1,
      forwardLabel: "Updated contribution",
    });
  await dbModule
    .getDb()
    .update(dbModule.schema.contentRelationshipTypes)
    .set({
      currentVersionId: nextVersionId,
      updatedAt: new Date().toISOString(),
    })
    .where(eq(dbModule.schema.contentRelationshipTypes.id, seed.typeId));
}

describe("typed relationship mutation idempotency", () => {
  it.each(["archive", "membership", "trash", "version"] as const)(
    "replays a committed receipt after %s drift",
    async (drift) => {
      const seed = await fixture();
      const input = addInput(seed, `${seed.prefix}-add`);
      const committed = await asOwner(() => mutate.run(input));

      await applyDrift(seed, drift);

      await expect(asOwner(() => mutate.run(input))).resolves.toEqual(
        committed,
      );
    },
  );

  it("returns an idempotency conflict before changed state rejects the request", async () => {
    const seed = await fixture();
    const input = addInput(seed, `${seed.prefix}-add`);
    await asOwner(() => mutate.run(input));
    await applyDrift(seed, "archive");

    await expect(
      asOwner(() =>
        mutate.run({
          ...input,
          changes: [
            {
              ...input.changes[0]!,
              targetPageId: seed.targetPageIds[1]!,
            },
          ],
        }),
      ),
    ).rejects.toMatchObject({ errorCode: "IDEMPOTENCY_CONFLICT" });
  });

  it("rechecks current access before returning an early receipt", async () => {
    const seed = await fixture();
    const shares = [
      {
        resourceId: `${seed.sourceDatabaseId}-page`,
        role: "editor",
      },
      { resourceId: seed.sourcePageId, role: "editor" },
      {
        resourceId: `${seed.targetDatabaseId}-page`,
        role: "viewer",
      },
      { resourceId: seed.targetPageIds[0]!, role: "viewer" },
    ] as const;
    await dbModule
      .getDb()
      .insert(dbModule.schema.documentShares)
      .values(
        shares.map(({ resourceId, role }, index) => ({
          id: `${seed.prefix}-viewer-share-${index}`,
          resourceId,
          principalType: "user",
          principalId: viewer,
          role,
          createdBy: owner,
        })),
      );
    const input = addInput(seed, `${seed.prefix}-viewer-add`);
    await asViewer(() => mutate.run(input));
    await dbModule
      .getDb()
      .delete(dbModule.schema.documentShares)
      .where(
        and(
          eq(dbModule.schema.documentShares.resourceId, seed.targetPageIds[0]!),
          eq(dbModule.schema.documentShares.principalId, viewer),
        ),
      );

    await expect(asViewer(() => mutate.run(input))).rejects.toMatchObject({
      errorCode: "NOT_ACCESSIBLE",
      message: "The requested Content object is not accessible.",
    });
  });

  it("canonicalizes equivalent removals before hashing and recording history", async () => {
    const seed = await fixture();
    await asOwner(() =>
      mutate.run(addInput(seed, `${seed.prefix}-add-before-remove`)),
    );
    await asOwner(() =>
      mutate.run(addInput(seed, `${seed.prefix}-assert-before-remove`)),
    );
    const observed = (await outgoing(seed)).items[0]!;
    const canonicalActivationIds = [...observed.observedActivationIds].sort();
    const noisyActivationIds = [
      ...[...canonicalActivationIds].reverse(),
      canonicalActivationIds[0]!,
    ];
    const change = {
      kind: "remove" as const,
      edgeId: observed.edgeId,
      observedActivationIds: noisyActivationIds,
      observationToken: observed.observationToken,
      route: observed.routes[0]!,
    };
    const operationId = `${seed.prefix}-remove`;
    const removed = await asOwner(() =>
      mutate.run({ operationId, changes: [change, { ...change }] }),
    );

    expect(removed.results).toHaveLength(1);
    const events = await dbModule
      .getDb()
      .select()
      .from(dbModule.schema.contentRelationshipEvents)
      .where(
        eq(
          dbModule.schema.contentRelationshipEvents.revisionId,
          removed.revisionId,
        ),
      );
    expect(events).toHaveLength(1);
    expect(JSON.parse(events[0]!.diffJson)).toEqual({
      retiredActivationIds: canonicalActivationIds,
    });
    await expect(
      asOwner(() =>
        mutate.run({
          operationId,
          changes: [
            { ...change, observedActivationIds: canonicalActivationIds },
          ],
        }),
      ),
    ).resolves.toEqual(removed);
  });

  it("rejects conflicting repeated removal observations before committing", async () => {
    const seed = await fixture();
    await asOwner(() =>
      mutate.run(addInput(seed, `${seed.prefix}-add-before-conflict`)),
    );
    const observed = (await outgoing(seed)).items[0]!;
    const change = {
      kind: "remove" as const,
      edgeId: observed.edgeId,
      observedActivationIds: observed.observedActivationIds,
      observationToken: observed.observationToken,
      route: observed.routes[0]!,
    };
    const operationId = `${seed.prefix}-conflicting-remove`;

    await expect(
      asOwner(() =>
        mutate.run({
          operationId,
          changes: [
            change,
            { ...change, observationToken: `${change.observationToken}-other` },
          ],
        }),
      ),
    ).rejects.toMatchObject({ errorCode: "STALE_SELECTION" });
    const revisions = await dbModule
      .getDb()
      .select({ id: dbModule.schema.contentRelationshipRevisions.id })
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
