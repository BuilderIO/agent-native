import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { runWithRequestContext } from "@agent-native/core/server";
import { and, eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const databasePath = join(
  tmpdir(),
  `relationship-services-${process.pid}-${Date.now()}.pglite`,
);
const owner = "relationship-services-owner@example.test";
const viewer = "relationship-services-viewer@example.test";
const spaceId = `relationship-services-${process.pid}-${Date.now()}`;

let dbModule: typeof import("../server/db/index.js");
let configure: typeof import("./configure-content-relation-property.js").default;
let listCandidates: typeof import("./list-content-relation-candidates.js").default;
let listTypes: typeof import("./list-content-relationship-types.js").default;
let listRelationships: typeof import("./list-content-relationships.js").default;
let mutate: typeof import("./mutate-content-relationships.js").default;
let prepareRemoval: typeof import("./prepare-content-relationship-removal.js").default;
let removeProperty: typeof import("./remove-content-relation-property.js").default;
let listHistory: typeof import("./list-content-relationship-history.js").default;
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
  listCandidates = (await import("./list-content-relation-candidates.js"))
    .default;
  listTypes = (await import("./list-content-relationship-types.js")).default;
  listRelationships = (await import("./list-content-relationships.js")).default;
  mutate = (await import("./mutate-content-relationships.js")).default;
  prepareRemoval = (await import("./prepare-content-relationship-removal.js"))
    .default;
  removeProperty = (await import("./remove-content-relation-property.js"))
    .default;
  listHistory = (await import("./list-content-relationship-history.js"))
    .default;

  const filesDatabaseId = `${spaceId}-files`;
  await dbModule.getDb().insert(dbModule.schema.contentSpaces).values({
    id: spaceId,
    name: "Relationship services",
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
});

afterAll(() => {
  delete process.env.DATABASE_URL;
  rmSync(databasePath, { recursive: true, force: true });
});

async function databaseFixture() {
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
      {
        id: targetPageIds[0],
        spaceId,
        ownerEmail: owner,
        title: "Visible Mira",
      },
      {
        id: targetPageIds[1],
        spaceId,
        ownerEmail: owner,
        title: "Hidden Jo",
      },
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
  return {
    prefix,
    sourceDatabaseId,
    targetDatabaseId,
    sourcePageId,
    targetPageIds,
  };
}

type DatabaseFixture = Awaited<ReturnType<typeof databaseFixture>>;

async function relationshipFixture(cardinality: "one" | "many" = "many") {
  const seed = await databaseFixture();
  const configured = await asOwner(() =>
    configure.run({
      ownerDatabaseId: seed.sourceDatabaseId,
      alias: cardinality === "one" ? "Assignee" : "Contributors",
      operationId: `${seed.prefix}-configure`,
      definition: {
        kind: "new-local",
        forwardLabel: "Contributes to",
        inverseLabel: "Deliverables",
        forwardCardinality: cardinality,
        sourceDatabaseId: seed.sourceDatabaseId,
        targetDatabaseId: seed.targetDatabaseId,
      },
      inverseProjection: {
        ownerDatabaseId: seed.targetDatabaseId,
        alias: "Deliverables",
        editable: true,
      },
    }),
  );
  return {
    ...seed,
    typeId: configured.relationshipType.id,
    typeVersionId: configured.relationshipTypeVersion.id,
    propertyId: configured.projection.propertyId,
    inversePropertyId: configured.inverseProjection!.propertyId,
  };
}

type RelationshipFixture = Awaited<ReturnType<typeof relationshipFixture>>;

function addInput(
  seed: RelationshipFixture,
  operationId: string,
  targetPageId = seed.targetPageIds[0],
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

async function add(
  seed: RelationshipFixture,
  operationId: string,
  targetPageId = seed.targetPageIds[0],
) {
  return asOwner(() => mutate.run(addInput(seed, operationId, targetPageId)));
}

async function shareWithViewer(
  documentIds: string[],
  role: "viewer" | "editor" = "viewer",
) {
  await dbModule
    .getDb()
    .insert(dbModule.schema.documentShares)
    .values(
      documentIds.map((resourceId, index) => ({
        id: `${resourceId}-viewer-share-${index}`,
        resourceId,
        principalType: "user",
        principalId: viewer,
        role,
        createdBy: owner,
      })),
    );
}

function sourceDatabasePage(seed: DatabaseFixture) {
  return `${seed.sourceDatabaseId}-page`;
}

function targetDatabasePage(seed: DatabaseFixture) {
  return `${seed.targetDatabaseId}-page`;
}

describe("typed relationship service boundaries", () => {
  it("strictly rejects unsupported relationship definition fields", async () => {
    const seed = await databaseFixture();
    const before = await dbModule
      .getDb()
      .select({ id: dbModule.schema.contentRelationshipTypes.id })
      .from(dbModule.schema.contentRelationshipTypes)
      .where(eq(dbModule.schema.contentRelationshipTypes.spaceId, spaceId));
    await expect(
      asOwner(() =>
        configure.run({
          ownerDatabaseId: seed.sourceDatabaseId,
          alias: "Unsupported",
          operationId: `${seed.prefix}-unsupported`,
          definition: {
            kind: "new-local",
            forwardLabel: "Assigned to",
            inverseLabel: "Assignments",
            forwardCardinality: "many",
            sourceDatabaseId: seed.sourceDatabaseId,
            targetDatabaseId: seed.targetDatabaseId,
            selectorKind: "query",
          },
          symmetric: true,
        } as never),
      ),
    ).rejects.toThrow();

    const after = await dbModule
      .getDb()
      .select({ id: dbModule.schema.contentRelationshipTypes.id })
      .from(dbModule.schema.contentRelationshipTypes)
      .where(eq(dbModule.schema.contentRelationshipTypes.spaceId, spaceId));
    expect(after).toHaveLength(before.length);
  });

  it("rejects relation-valued candidate context and filters before search", async () => {
    const seed = await relationshipFixture();
    await shareWithViewer([
      sourceDatabasePage(seed),
      targetDatabasePage(seed),
      seed.sourcePageId,
      seed.targetPageIds[0],
    ]);

    await expect(
      asViewer(() =>
        listCandidates.run({
          propertyId: seed.propertyId,
          anchorPageId: seed.sourcePageId,
          search: "",
          contextPropertyIds: [seed.inversePropertyId],
        }),
      ),
    ).rejects.toMatchObject({ errorCode: "UNSUPPORTED_CONFIGURATION" });

    const hiddenSearch = await asViewer(() =>
      listCandidates.run({
        propertyId: seed.propertyId,
        anchorPageId: seed.sourcePageId,
        search: "Hidden Jo",
        contextPropertyIds: [],
      }),
    );
    expect(hiddenSearch).toMatchObject({
      scope: "viewer-accessible",
      items: [],
      nextCursor: null,
    });
    const visibleSearch = await asViewer(() =>
      listCandidates.run({
        propertyId: seed.propertyId,
        anchorPageId: seed.sourcePageId,
        search: "Visible Mira",
        contextPropertyIds: [],
      }),
    );
    expect(visibleSearch.items.map((item) => item.pageId)).toEqual([
      seed.targetPageIds[0],
    ]);
  });

  it("propagates an unreadable current definition instead of returning absence", async () => {
    const seed = await relationshipFixture();
    const [version] = await dbModule
      .getDb()
      .select()
      .from(dbModule.schema.contentRelationshipTypeVersions)
      .where(
        eq(
          dbModule.schema.contentRelationshipTypeVersions.id,
          seed.typeVersionId,
        ),
      );
    expect(version).toBeTruthy();
    try {
      await dbModule
        .getDb()
        .delete(dbModule.schema.contentRelationshipTypeVersions)
        .where(
          eq(
            dbModule.schema.contentRelationshipTypeVersions.id,
            seed.typeVersionId,
          ),
        );

      await expect(
        asOwner(() =>
          listCandidates.run({
            propertyId: seed.propertyId,
            anchorPageId: seed.sourcePageId,
            search: "",
            contextPropertyIds: [],
          }),
        ),
      ).rejects.toMatchObject({ errorCode: "UNAVAILABLE" });
      await expect(
        asOwner(() => listTypes.run({ databaseId: seed.sourceDatabaseId })),
      ).rejects.toMatchObject({ errorCode: "UNAVAILABLE" });
    } finally {
      if (version) {
        await dbModule
          .getDb()
          .insert(dbModule.schema.contentRelationshipTypeVersions)
          .values(version);
      }
    }
  });

  it("hides types, edges, and history when their full definition is not readable", async () => {
    const seed = await relationshipFixture();
    const added = await add(seed, `${seed.prefix}-add`);
    await shareWithViewer([sourceDatabasePage(seed), seed.sourcePageId]);

    const types = await asViewer(() =>
      listTypes.run({ databaseId: seed.sourceDatabaseId }),
    );
    expect(types.items).toEqual([]);
    const edges = await asViewer(() =>
      listRelationships.run({
        pageId: seed.sourcePageId,
        relationshipTypeId: seed.typeId,
        direction: "outgoing",
      }),
    );
    expect(edges.items).toEqual([]);
    const ambientHistory = await asViewer(() =>
      listHistory.run({ pageId: seed.sourcePageId }),
    );
    expect(ambientHistory.items).toEqual([]);
    await expect(
      asViewer(() => listHistory.run({ revisionId: added.revisionId })),
    ).rejects.toMatchObject({ errorCode: "NOT_ACCESSIBLE" });
  });

  it("returns display-ready typed history changes in canonical direction", async () => {
    const seed = await relationshipFixture();
    const added = await add(seed, `${seed.prefix}-add`);
    const sourceHistory = await asOwner(() =>
      listHistory.run({ pageId: seed.sourcePageId }),
    );
    expect(
      sourceHistory.items.find((item) => item.revisionId === added.revisionId)
        ?.changes,
    ).toEqual([
      expect.objectContaining({
        kind: "added",
        relationshipTypeId: seed.typeId,
        relationshipLabel: "Contributes to",
        source: { pageId: seed.sourcePageId, title: "Launch article" },
        target: { pageId: seed.targetPageIds[0], title: "Visible Mira" },
      }),
    ]);
    const targetHistory = await asOwner(() =>
      listHistory.run({ pageId: seed.targetPageIds[0] }),
    );
    expect(
      targetHistory.items.find((item) => item.revisionId === added.revisionId)
        ?.changes[0]?.relationshipLabel,
    ).toBe("Contributes to");
  });

  it("omits replacement history when its previous target is hidden", async () => {
    const seed = await relationshipFixture("one");
    await add(seed, `${seed.prefix}-add`, seed.targetPageIds[0]);
    const [observed] = (
      await asOwner(() =>
        listRelationships.run({
          pageId: seed.sourcePageId,
          relationshipTypeId: seed.typeId,
          direction: "outgoing",
        }),
      )
    ).items;
    const replaced = await asOwner(() =>
      mutate.run({
        operationId: `${seed.prefix}-replace`,
        changes: [
          {
            kind: "replace",
            typeId: seed.typeId,
            typeVersionId: seed.typeVersionId,
            sourcePageId: seed.sourcePageId,
            targetPageId: seed.targetPageIds[1],
            observedSlotToken: observed!.slotObservationToken!,
            route: observed!.routes[0]!,
          },
        ],
      }),
    );
    await shareWithViewer([
      sourceDatabasePage(seed),
      targetDatabasePage(seed),
      seed.targetPageIds[1],
    ]);
    await shareWithViewer([seed.sourcePageId], "editor");

    const history = await asViewer(() =>
      listHistory.run({ pageId: seed.sourcePageId }),
    );
    expect(history.items.map((item) => item.revisionId)).not.toContain(
      replaced.revisionId,
    );
  });

  it("includes durable Property recovery in the owning Database Page history", async () => {
    const seed = await relationshipFixture();
    await add(seed, `${seed.prefix}-add`);
    const removed = await asOwner(() =>
      removeProperty.run({
        propertyId: seed.propertyId,
        relationshipMode: { kind: "keep" },
        operationId: `${seed.prefix}-remove-property`,
      }),
    );
    const history = await asOwner(() =>
      listHistory.run({ pageId: sourceDatabasePage(seed) }),
    );
    expect(
      history.items.find((item) => item.revisionId === removed.revisionId),
    ).toMatchObject({
      operation: "remove-relation-property",
      changes: [],
      recovery: {
        allowed: true,
        recoveryToken: removed.undo.recoveryToken,
      },
    });
  });

  it("fails an explicit removal selection when any requested edge is hidden", async () => {
    const seed = await relationshipFixture();
    const visible = await add(
      seed,
      `${seed.prefix}-visible-add`,
      seed.targetPageIds[0],
    );
    const hidden = await add(
      seed,
      `${seed.prefix}-hidden-add`,
      seed.targetPageIds[1],
    );
    await shareWithViewer([
      sourceDatabasePage(seed),
      targetDatabasePage(seed),
      seed.targetPageIds[0],
    ]);
    await shareWithViewer([seed.sourcePageId], "editor");

    const visibleSelection = await asViewer(() =>
      prepareRemoval.run({
        selection: { kind: "edges", edgeIds: [visible.results[0]!.edgeId] },
      }),
    );
    expect(visibleSelection.edges.map((entry) => entry.edgeId)).toEqual([
      visible.results[0]!.edgeId,
    ]);

    for (const edgeIds of [
      [hidden.results[0]!.edgeId],
      [visible.results[0]!.edgeId, hidden.results[0]!.edgeId],
      [`${seed.prefix}-missing-edge`],
    ]) {
      await expect(
        asViewer(() =>
          prepareRemoval.run({ selection: { kind: "edges", edgeIds } }),
        ),
      ).rejects.toMatchObject({
        errorCode: "NOT_ACCESSIBLE",
        message: "A requested relationship edge is not accessible.",
      });
    }
  });

  it("keeps edges by default and removes only a prepared activation snapshot", async () => {
    const kept = await relationshipFixture();
    await add(kept, `${kept.prefix}-initial-add`);
    await asOwner(() =>
      removeProperty.run({
        propertyId: kept.propertyId,
        relationshipMode: { kind: "keep" },
        operationId: `${kept.prefix}-remove-keep`,
      }),
    );
    const keptEdges = await asOwner(() =>
      listRelationships.run({
        pageId: kept.sourcePageId,
        relationshipTypeId: kept.typeId,
        direction: "outgoing",
      }),
    );
    expect(keptEdges.items).toHaveLength(1);

    const exact = await relationshipFixture();
    const initial = await add(exact, `${exact.prefix}-initial-add`);
    const prepared = await asOwner(() =>
      prepareRemoval.run({
        selection: { kind: "property", propertyId: exact.propertyId },
      }),
    );
    expect(prepared.selectedCount).toBe(1);
    expect(prepared.edges[0]!.observedActivationIds).toEqual(
      initial.results[0]!.activationIds,
    );
    const concurrent = await add(exact, `${exact.prefix}-concurrent-add`);
    const laterEdge = await add(
      exact,
      `${exact.prefix}-later-edge`,
      exact.targetPageIds[1],
    );
    const operationId = `${exact.prefix}-remove-exact`;
    await expect(
      asOwner(() =>
        removeProperty.run({
          propertyId: exact.propertyId,
          relationshipMode: {
            kind: "remove-selected",
            selectionReceipt: prepared.selectionReceipt,
            edgeIds: [`${exact.prefix}-not-in-receipt`],
          },
          operationId,
        }),
      ),
    ).rejects.toMatchObject({ errorCode: "STALE_SELECTION" });
    const [definitionAfterRejection] = await dbModule
      .getDb()
      .select({ id: dbModule.schema.documentPropertyDefinitions.id })
      .from(dbModule.schema.documentPropertyDefinitions)
      .where(
        eq(dbModule.schema.documentPropertyDefinitions.id, exact.propertyId),
      );
    expect(definitionAfterRejection?.id).toBe(exact.propertyId);
    const removed = await asOwner(() =>
      removeProperty.run({
        propertyId: exact.propertyId,
        relationshipMode: {
          kind: "remove-selected",
          selectionReceipt: prepared.selectionReceipt,
          edgeIds: [initial.results[0]!.edgeId],
        },
        operationId,
      }),
    );
    const replayed = await asOwner(() =>
      removeProperty.run({
        propertyId: exact.propertyId,
        relationshipMode: {
          kind: "remove-selected",
          selectionReceipt: prepared.selectionReceipt,
          edgeIds: [initial.results[0]!.edgeId],
        },
        operationId,
      }),
    );
    expect(replayed).toEqual(removed);
    expect(removed.removedEdgeIds).toEqual([initial.results[0]!.edgeId]);
    const surviving = await asOwner(() =>
      listRelationships.run({
        pageId: exact.sourcePageId,
        relationshipTypeId: exact.typeId,
        direction: "outgoing",
      }),
    );
    expect(surviving.items).toHaveLength(2);
    expect(
      surviving.items.find((item) => item.edgeId === initial.results[0]!.edgeId)
        ?.observedActivationIds,
    ).toEqual(concurrent.results[0]!.activationIds);
    expect(
      surviving.items.find(
        (item) => item.edgeId === laterEdge.results[0]!.edgeId,
      )?.observedActivationIds,
    ).toEqual(laterEdge.results[0]!.activationIds);
  });

  it("fails closed instead of detaching an inconsistent source mapping", async () => {
    const seed = await relationshipFixture();
    const sourceId = `${seed.prefix}-source`;
    const fieldId = `${seed.prefix}-source-field`;
    await dbModule
      .getDb()
      .insert(dbModule.schema.contentDatabaseSources)
      .values({
        id: sourceId,
        ownerEmail: owner,
        databaseId: seed.sourceDatabaseId,
        sourceType: "test",
        sourceName: "Test source",
        sourceTable: "items",
      });
    await dbModule
      .getDb()
      .insert(dbModule.schema.contentDatabaseSourceFields)
      .values({
        id: fieldId,
        ownerEmail: owner,
        sourceId,
        propertyId: seed.propertyId,
        localFieldKey: seed.propertyId,
        sourceFieldKey: "relationship",
        sourceFieldLabel: "Relationship",
        sourceFieldType: "text",
      });

    await expect(
      asOwner(() =>
        removeProperty.run({
          propertyId: seed.propertyId,
          relationshipMode: { kind: "keep" },
          operationId: `${seed.prefix}-mapped-remove`,
        }),
      ),
    ).rejects.toMatchObject({ errorCode: "SOURCE_AUTHORITY_UNSUPPORTED" });
    const [mapping] = await dbModule
      .getDb()
      .select({
        propertyId: dbModule.schema.contentDatabaseSourceFields.propertyId,
      })
      .from(dbModule.schema.contentDatabaseSourceFields)
      .where(eq(dbModule.schema.contentDatabaseSourceFields.id, fieldId));
    const [definition] = await dbModule
      .getDb()
      .select({ id: dbModule.schema.documentPropertyDefinitions.id })
      .from(dbModule.schema.documentPropertyDefinitions)
      .where(
        eq(dbModule.schema.documentPropertyDefinitions.id, seed.propertyId),
      );
    expect(mapping?.propertyId).toBe(seed.propertyId);
    expect(definition?.id).toBe(seed.propertyId);
  });

  it("keeps historic edges readable and removable after an admission database is deleted", async () => {
    const many = await relationshipFixture();
    const added = await add(many, `${many.prefix}-initial-add`);
    const deletedAt = new Date().toISOString();
    await dbModule
      .getDb()
      .update(dbModule.schema.contentDatabases)
      .set({ deletedAt, updatedAt: deletedAt })
      .where(eq(dbModule.schema.contentDatabases.id, many.targetDatabaseId));

    const connections = await asOwner(() =>
      listRelationships.run({
        pageId: many.sourcePageId,
        relationshipTypeId: many.typeId,
        direction: "outgoing",
      }),
    );
    expect(connections.items.map((item) => item.edgeId)).toEqual([
      added.results[0]!.edgeId,
    ]);
    const history = await asOwner(() =>
      listHistory.run({ pageId: many.sourcePageId }),
    );
    expect(history.items.map((item) => item.revisionId)).toContain(
      added.revisionId,
    );
    await expect(
      add(many, `${many.prefix}-blocked-add`, many.targetPageIds[1]),
    ).rejects.toMatchObject({ errorCode: "CONSTRAINT_UNAVAILABLE" });

    const observed = connections.items[0]!;
    const removed = await asOwner(() =>
      mutate.run({
        operationId: `${many.prefix}-connections-remove`,
        changes: [
          {
            kind: "remove",
            edgeId: observed.edgeId,
            observedActivationIds: observed.observedActivationIds,
            observationToken: observed.observationToken,
            route: {
              kind: "connections-forward",
              sourcePageId: many.sourcePageId,
            },
          },
        ],
      }),
    );
    expect(removed.results[0]).toMatchObject({
      edgeId: observed.edgeId,
      kind: "remove",
      state: "inactive",
    });

    const one = await relationshipFixture("one");
    await add(one, `${one.prefix}-initial-add`);
    const oneObserved = (
      await asOwner(() =>
        listRelationships.run({
          pageId: one.sourcePageId,
          relationshipTypeId: one.typeId,
          direction: "outgoing",
        }),
      )
    ).items[0]!;
    await dbModule
      .getDb()
      .update(dbModule.schema.contentDatabases)
      .set({ deletedAt, updatedAt: deletedAt })
      .where(eq(dbModule.schema.contentDatabases.id, one.targetDatabaseId));
    await expect(
      asOwner(() =>
        mutate.run({
          operationId: `${one.prefix}-blocked-replace`,
          changes: [
            {
              kind: "replace",
              typeId: one.typeId,
              typeVersionId: one.typeVersionId,
              sourcePageId: one.sourcePageId,
              targetPageId: one.targetPageIds[1],
              observedSlotToken: oneObserved.slotObservationToken!,
              route: {
                kind: "forward-property",
                propertyId: one.propertyId,
                sourcePageId: one.sourcePageId,
              },
            },
          ],
        }),
      ),
    ).rejects.toMatchObject({ errorCode: "CONSTRAINT_UNAVAILABLE" });
  });

  it("rechecks displaced-edge access before replaying a replace receipt", async () => {
    const seed = await relationshipFixture("one");
    await add(seed, `${seed.prefix}-initial-add`);
    await shareWithViewer(
      [
        sourceDatabasePage(seed),
        targetDatabasePage(seed),
        seed.sourcePageId,
        ...seed.targetPageIds,
      ],
      "editor",
    );
    const observed = (
      await asViewer(() =>
        listRelationships.run({
          pageId: seed.sourcePageId,
          relationshipTypeId: seed.typeId,
          direction: "outgoing",
        }),
      )
    ).items[0]!;
    const input = {
      operationId: `${seed.prefix}-replace`,
      changes: [
        {
          kind: "replace" as const,
          typeId: seed.typeId,
          typeVersionId: seed.typeVersionId,
          sourcePageId: seed.sourcePageId,
          targetPageId: seed.targetPageIds[1],
          observedSlotToken: observed.slotObservationToken!,
          route: {
            kind: "forward-property" as const,
            propertyId: seed.propertyId,
            sourcePageId: seed.sourcePageId,
          },
        },
      ],
    };
    const committed = await asViewer(() => mutate.run(input));
    const displacedEdgeId = committed.results[0]!.displacedEdgeIds![0]!;
    await dbModule
      .getDb()
      .delete(dbModule.schema.documentShares)
      .where(
        and(
          eq(dbModule.schema.documentShares.resourceId, seed.targetPageIds[0]),
          eq(dbModule.schema.documentShares.principalType, "user"),
          eq(dbModule.schema.documentShares.principalId, viewer),
        ),
      );

    let replayError: unknown;
    try {
      await asViewer(() => mutate.run(input));
    } catch (error) {
      replayError = error;
    }
    expect(replayError).toMatchObject({
      errorCode: "NOT_ACCESSIBLE",
      message: "The requested Content object is not accessible.",
    });
    const serializedError = JSON.stringify(replayError);
    expect(serializedError).not.toContain(displacedEdgeId);
    expect(serializedError).not.toContain(seed.targetPageIds[0]);
  });

  it("records trusted agent lineage separately from its authorizing principal", async () => {
    const seed = await relationshipFixture();
    const forgedOperationId = `${seed.prefix}-forged-attribution`;
    await expect(
      asOwner(() =>
        mutate.run({
          ...addInput(seed, forgedOperationId),
          actor: { kind: "person", displayName: "Forged actor" },
          authorizingPrincipal: {
            kind: "user",
            email: "forged@example.test",
          },
        } as never),
      ),
    ).rejects.toThrow();

    const operationId = `${seed.prefix}-trusted-attribution`;
    const result = await mutate.run(addInput(seed, operationId), {
      caller: "tool",
      userEmail: owner,
      networkProtocol: "a2a",
      networkId: "network-relationship-test",
      networkPeer: "external-relationship-agent",
      threadId: "thread-relationship-test",
      turnId: "turn-relationship-test",
      runId: "run-relationship-test",
    });
    const [revision] = await dbModule
      .getDb()
      .select()
      .from(dbModule.schema.contentRelationshipRevisions)
      .where(
        eq(dbModule.schema.contentRelationshipRevisions.id, result.revisionId),
      );
    expect(JSON.parse(revision!.actorJson)).toEqual({
      kind: "agent",
      displayName: "external-relationship-agent",
      runId: "run-relationship-test",
      networkProtocol: "a2a",
      networkId: "network-relationship-test",
      networkPeer: "external-relationship-agent",
      threadId: "thread-relationship-test",
      turnId: "turn-relationship-test",
    });
    expect(JSON.parse(revision!.authorizingPrincipalJson)).toEqual({
      kind: "user",
      email: owner,
      orgId: null,
    });
    expect(revision).toMatchObject({
      origin: "tool",
      operationId,
    });
    const forgedReceipts = await dbModule
      .getDb()
      .select()
      .from(dbModule.schema.contentRelationshipReceipts)
      .where(
        eq(
          dbModule.schema.contentRelationshipReceipts.operationId,
          forgedOperationId,
        ),
      );
    expect(forgedReceipts).toEqual([]);
  });

  it("rolls back state, Revision, and receipt when Event insertion fails", async () => {
    const seed = await relationshipFixture();
    const operationId = `${seed.prefix}-forced-event-failure`;
    const baselineEvents = await dbModule
      .getDb()
      .select({ id: dbModule.schema.contentRelationshipEvents.id })
      .from(dbModule.schema.contentRelationshipEvents)
      .where(
        eq(
          dbModule.schema.contentRelationshipEvents.relationshipTypeId,
          seed.typeId,
        ),
      );
    await dbModule
      .getDb()
      .execute(
        sql.raw(
          "alter table content_relationship_events add constraint relationship_services_event_failure check (kind <> 'relationship-added') not valid",
        ),
      );
    try {
      await expect(
        asOwner(() => mutate.run(addInput(seed, operationId))),
      ).rejects.toThrow();
    } finally {
      await dbModule
        .getDb()
        .execute(
          sql.raw(
            "alter table content_relationship_events drop constraint relationship_services_event_failure",
          ),
        );
    }

    const [lineages, revisions, receipts, events] = await Promise.all([
      dbModule
        .getDb()
        .select()
        .from(dbModule.schema.contentRelationshipLineages)
        .where(
          and(
            eq(
              dbModule.schema.contentRelationshipLineages.relationshipTypeId,
              seed.typeId,
            ),
            eq(
              dbModule.schema.contentRelationshipLineages.sourcePageId,
              seed.sourcePageId,
            ),
          ),
        ),
      dbModule
        .getDb()
        .select()
        .from(dbModule.schema.contentRelationshipRevisions)
        .where(
          eq(
            dbModule.schema.contentRelationshipRevisions.operationId,
            operationId,
          ),
        ),
      dbModule
        .getDb()
        .select()
        .from(dbModule.schema.contentRelationshipReceipts)
        .where(
          eq(
            dbModule.schema.contentRelationshipReceipts.operationId,
            operationId,
          ),
        ),
      dbModule
        .getDb()
        .select({ id: dbModule.schema.contentRelationshipEvents.id })
        .from(dbModule.schema.contentRelationshipEvents)
        .where(
          eq(
            dbModule.schema.contentRelationshipEvents.relationshipTypeId,
            seed.typeId,
          ),
        ),
    ]);
    expect(lineages).toEqual([]);
    expect(revisions).toEqual([]);
    expect(receipts).toEqual([]);
    expect(events).toEqual(baselineEvents);
  });

  it("returns the original receipt on retry without appending duplicate events", async () => {
    const seed = await relationshipFixture();
    const input = addInput(seed, `${seed.prefix}-lost-response`);
    const committed = await asOwner(() => mutate.run(input));
    const beforeEvents = await dbModule
      .getDb()
      .select()
      .from(dbModule.schema.contentRelationshipEvents)
      .where(
        eq(
          dbModule.schema.contentRelationshipEvents.revisionId,
          committed.revisionId,
        ),
      );

    const retried = await asOwner(() => mutate.run(input));
    const afterEvents = await dbModule
      .getDb()
      .select()
      .from(dbModule.schema.contentRelationshipEvents)
      .where(
        eq(
          dbModule.schema.contentRelationshipEvents.revisionId,
          committed.revisionId,
        ),
      );
    expect(retried).toEqual(committed);
    expect(afterEvents).toEqual(beforeEvents);
    const receipts = await dbModule
      .getDb()
      .select()
      .from(dbModule.schema.contentRelationshipReceipts)
      .where(
        eq(
          dbModule.schema.contentRelationshipReceipts.operationId,
          input.operationId,
        ),
      );
    expect(receipts).toHaveLength(1);
  });

  it("rolls back state, Event, Revision, and receipt when receipt insertion fails", async () => {
    const seed = await relationshipFixture();
    const operationId = `${seed.prefix}-forced-receipt-failure`;
    const baselineEvents = await dbModule
      .getDb()
      .select({ id: dbModule.schema.contentRelationshipEvents.id })
      .from(dbModule.schema.contentRelationshipEvents)
      .where(
        eq(
          dbModule.schema.contentRelationshipEvents.relationshipTypeId,
          seed.typeId,
        ),
      );
    await dbModule
      .getDb()
      .execute(
        sql.raw(
          `alter table content_relationship_receipts add constraint relationship_services_receipt_failure check (operation_id <> '${operationId}')`,
        ),
      );
    try {
      await expect(
        asOwner(() => mutate.run(addInput(seed, operationId))),
      ).rejects.toThrow();
    } finally {
      await dbModule
        .getDb()
        .execute(
          sql.raw(
            "alter table content_relationship_receipts drop constraint relationship_services_receipt_failure",
          ),
        );
    }

    const [lineages, revisions, receipts, events] = await Promise.all([
      dbModule
        .getDb()
        .select()
        .from(dbModule.schema.contentRelationshipLineages)
        .where(
          and(
            eq(
              dbModule.schema.contentRelationshipLineages.relationshipTypeId,
              seed.typeId,
            ),
            eq(
              dbModule.schema.contentRelationshipLineages.sourcePageId,
              seed.sourcePageId,
            ),
          ),
        ),
      dbModule
        .getDb()
        .select()
        .from(dbModule.schema.contentRelationshipRevisions)
        .where(
          eq(
            dbModule.schema.contentRelationshipRevisions.operationId,
            operationId,
          ),
        ),
      dbModule
        .getDb()
        .select()
        .from(dbModule.schema.contentRelationshipReceipts)
        .where(
          eq(
            dbModule.schema.contentRelationshipReceipts.operationId,
            operationId,
          ),
        ),
      dbModule
        .getDb()
        .select({ id: dbModule.schema.contentRelationshipEvents.id })
        .from(dbModule.schema.contentRelationshipEvents)
        .where(
          eq(
            dbModule.schema.contentRelationshipEvents.relationshipTypeId,
            seed.typeId,
          ),
        ),
    ]);
    expect(lineages).toEqual([]);
    expect(revisions).toEqual([]);
    expect(receipts).toEqual([]);
    expect(events).toEqual(baselineEvents);
  });
});
