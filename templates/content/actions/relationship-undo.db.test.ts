import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { runWithRequestContext } from "@agent-native/core/server";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const databasePath = join(
  tmpdir(),
  `relationship-undo-${process.pid}-${Date.now()}.pglite`,
);
const owner = "relationship-undo-owner@example.test";
const viewer = "relationship-undo-viewer@example.test";
const spaceId = `relationship-undo-${process.pid}-${Date.now()}`;

let dbModule: typeof import("../server/db/index.js");
let configure: typeof import("./configure-content-relation-property.js").default;
let listRelationships: typeof import("./list-content-relationships.js").default;
let listHistory: typeof import("./list-content-relationship-history.js").default;
let mutate: typeof import("./mutate-content-relationships.js").default;
let prepareRemoval: typeof import("./prepare-content-relationship-removal.js").default;
let removeProperty: typeof import("./remove-content-relation-property.js").default;
let undo: typeof import("./undo-content-relationship-revision.js").default;
let sequence = 0;

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
  listHistory = (await import("./list-content-relationship-history.js"))
    .default;
  mutate = (await import("./mutate-content-relationships.js")).default;
  prepareRemoval = (await import("./prepare-content-relationship-removal.js"))
    .default;
  removeProperty = (await import("./remove-content-relation-property.js"))
    .default;
  undo = (await import("./undo-content-relationship-revision.js")).default;

  const filesDatabaseId = `${spaceId}-files`;
  await dbModule.getDb().insert(dbModule.schema.contentSpaces).values({
    id: spaceId,
    name: "Relationship undo",
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

async function fixture(cardinality: "one" | "many" = "many") {
  const prefix = `${spaceId}-${++sequence}`;
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
        title: "Mira",
      },
      {
        id: targetPageIds[1],
        spaceId,
        ownerEmail: owner,
        title: "Jo",
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
  const configured = await asOwner(() =>
    configure.run({
      ownerDatabaseId: sourceDatabaseId,
      alias: cardinality === "one" ? "Assignee" : "Contributors",
      operationId: `${prefix}-configure`,
      definition: {
        kind: "new-local",
        forwardLabel: "Contributes to",
        inverseLabel: "Deliverables",
        forwardCardinality: cardinality,
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

function addInput(seed: Fixture, operationId: string, targetPageId: string) {
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

async function add(seed: Fixture, operationId: string, targetPageId: string) {
  return asOwner(() => mutate.run(addInput(seed, operationId, targetPageId)));
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

async function markDatabaseDeleted(databaseId: string) {
  const deletedAt = new Date().toISOString();
  await dbModule
    .getDb()
    .update(dbModule.schema.contentDatabases)
    .set({ deletedAt, updatedAt: deletedAt })
    .where(eq(dbModule.schema.contentDatabases.id, databaseId));
}

describe("typed relationship Undo", () => {
  it("retires only the activation added by the recovered revision", async () => {
    const seed = await fixture();
    const first = await add(
      seed,
      `${seed.prefix}-first-add`,
      seed.targetPageIds[0],
    );
    const concurrent = await add(
      seed,
      `${seed.prefix}-concurrent-add`,
      seed.targetPageIds[0],
    );
    const input = {
      revisionId: first.revisionId,
      recoveryToken: (
        await asOwner(() => listHistory.run({ revisionId: first.revisionId }))
      ).items[0]!.recovery.recoveryToken!,
      operationId: `${seed.prefix}-undo-first-add`,
      routes: [],
    };
    const recovered = await asOwner(() => undo.run(input));
    const replayed = await asOwner(() => undo.run(input));
    expect(replayed).toEqual(recovered);
    const current = await outgoing(seed);
    expect(current.items).toHaveLength(1);
    expect(current.items[0]!.observedActivationIds).toEqual(
      concurrent.results[0]!.activationIds,
    );
    await expect(
      asOwner(() =>
        undo.run({
          ...input,
          operationId: `${seed.prefix}-second-undo`,
        }),
      ),
    ).rejects.toMatchObject({ errorCode: "STALE_RECOVERY" });
  });

  it("restores a removal without overwriting a later assertion", async () => {
    const seed = await fixture();
    await add(seed, `${seed.prefix}-add`, seed.targetPageIds[0]);
    const observed = (await outgoing(seed)).items[0]!;
    const removed = await asOwner(() =>
      mutate.run({
        operationId: `${seed.prefix}-remove`,
        changes: [
          {
            kind: "remove",
            edgeId: observed.edgeId,
            observedActivationIds: observed.observedActivationIds,
            observationToken: observed.observationToken,
            route: observed.routes[0]!,
          },
        ],
      }),
    );
    const concurrent = await add(
      seed,
      `${seed.prefix}-later-add`,
      seed.targetPageIds[0],
    );
    const history = await asOwner(() =>
      listHistory.run({ revisionId: removed.revisionId }),
    );
    const recovered = await asOwner(() =>
      undo.run({
        revisionId: removed.revisionId,
        recoveryToken: history.items[0]!.recovery.recoveryToken!,
        operationId: `${seed.prefix}-undo-remove`,
        routes: [],
      }),
    );
    const current = (await outgoing(seed)).items[0]!;
    expect(current.observedActivationIds).toEqual(
      [
        ...concurrent.results[0]!.activationIds,
        ...recovered.results[0]!.activationIds,
      ].sort(),
    );
  });

  it("restores an immediate max-one replacement and rejects stale recovery", async () => {
    const immediate = await fixture("one");
    const first = await add(
      immediate,
      `${immediate.prefix}-add`,
      immediate.targetPageIds[0],
    );
    const initial = (await outgoing(immediate)).items[0]!;
    const replacement = await asOwner(() =>
      mutate.run({
        operationId: `${immediate.prefix}-replace`,
        changes: [
          {
            kind: "replace",
            typeId: immediate.typeId,
            typeVersionId: immediate.typeVersionId,
            sourcePageId: immediate.sourcePageId,
            targetPageId: immediate.targetPageIds[1],
            observedSlotToken: initial.slotObservationToken!,
            route: initial.routes[0]!,
          },
        ],
      }),
    );
    const history = await asOwner(() =>
      listHistory.run({ revisionId: replacement.revisionId }),
    );
    expect(history.items[0]?.changes).toEqual([
      expect.objectContaining({
        kind: "replaced",
        relationshipLabel: "Contributes to",
        source: {
          pageId: immediate.sourcePageId,
          title: "Launch article",
        },
        target: { pageId: immediate.targetPageIds[1], title: "Jo" },
        previousTarget: {
          pageId: immediate.targetPageIds[0],
          title: "Mira",
        },
      }),
    ]);
    const previousTargetHistory = await asOwner(() =>
      listHistory.run({ pageId: immediate.targetPageIds[0] }),
    );
    expect(
      previousTargetHistory.items.find(
        (item) => item.revisionId === replacement.revisionId,
      )?.changes,
    ).toEqual([
      expect.objectContaining({
        kind: "replaced",
        relationshipLabel: "Contributes to",
        source: {
          pageId: immediate.sourcePageId,
          title: "Launch article",
        },
        target: { pageId: immediate.targetPageIds[1], title: "Jo" },
        previousTarget: {
          pageId: immediate.targetPageIds[0],
          title: "Mira",
        },
      }),
    ]);
    const restored = await asOwner(() =>
      undo.run({
        revisionId: replacement.revisionId,
        recoveryToken: history.items[0]!.recovery.recoveryToken!,
        operationId: `${immediate.prefix}-undo-replace`,
        routes: [],
      }),
    );
    const restoredHistory = await asOwner(() =>
      listHistory.run({ revisionId: restored.revisionId }),
    );
    expect(restoredHistory.items[0]?.changes).toEqual([
      expect.objectContaining({
        kind: "restored",
        relationshipLabel: "Contributes to",
        source: {
          pageId: immediate.sourcePageId,
          title: "Launch article",
        },
        target: { pageId: immediate.targetPageIds[0], title: "Mira" },
        previousTarget: {
          pageId: immediate.targetPageIds[1],
          title: "Jo",
        },
      }),
    ]);
    expect((await outgoing(immediate)).items[0]!.edgeId).toBe(
      first.results[0]!.edgeId,
    );

    const stale = await fixture("one");
    await add(stale, `${stale.prefix}-add`, stale.targetPageIds[0]);
    const staleInitial = (await outgoing(stale)).items[0]!;
    const staleReplacement = await asOwner(() =>
      mutate.run({
        operationId: `${stale.prefix}-replace`,
        changes: [
          {
            kind: "replace",
            typeId: stale.typeId,
            typeVersionId: stale.typeVersionId,
            sourcePageId: stale.sourcePageId,
            targetPageId: stale.targetPageIds[1],
            observedSlotToken: staleInitial.slotObservationToken!,
            route: staleInitial.routes[0]!,
          },
        ],
      }),
    );
    const later = (await outgoing(stale)).items[0]!;
    await asOwner(() =>
      mutate.run({
        operationId: `${stale.prefix}-later-replace`,
        changes: [
          {
            kind: "replace",
            typeId: stale.typeId,
            typeVersionId: stale.typeVersionId,
            sourcePageId: stale.sourcePageId,
            targetPageId: stale.targetPageIds[0],
            observedSlotToken: later.slotObservationToken!,
            route: later.routes[0]!,
          },
        ],
      }),
    );
    const staleHistory = await asOwner(() =>
      listHistory.run({ revisionId: staleReplacement.revisionId }),
    );
    await expect(
      asOwner(() =>
        undo.run({
          revisionId: staleReplacement.revisionId,
          recoveryToken: staleHistory.items[0]!.recovery.recoveryToken!,
          operationId: `${stale.prefix}-stale-undo`,
          routes: [],
        }),
      ),
    ).rejects.toMatchObject({ errorCode: "STALE_RECOVERY" });
  });

  it("restores the same Property identity and selected relationship", async () => {
    const seed = await fixture();
    const added = await add(seed, `${seed.prefix}-add`, seed.targetPageIds[0]);
    const prepared = await asOwner(() =>
      prepareRemoval.run({
        selection: { kind: "property", propertyId: seed.propertyId },
      }),
    );
    const removed = await asOwner(() =>
      removeProperty.run({
        propertyId: seed.propertyId,
        relationshipMode: {
          kind: "remove-selected",
          selectionReceipt: prepared.selectionReceipt,
        },
        operationId: `${seed.prefix}-remove-property`,
      }),
    );
    const recovered = await asOwner(() =>
      undo.run({
        revisionId: removed.revisionId,
        recoveryToken: removed.undo.recoveryToken,
        operationId: `${seed.prefix}-undo-property`,
        routes: [],
      }),
    );
    const [definition] = await dbModule
      .getDb()
      .select()
      .from(dbModule.schema.documentPropertyDefinitions)
      .where(
        eq(dbModule.schema.documentPropertyDefinitions.id, seed.propertyId),
      );
    expect(definition?.id).toBe(seed.propertyId);
    const current = (await outgoing(seed)).items[0]!;
    expect(current.edgeId).toBe(added.results[0]!.edgeId);
    expect(current.observedActivationIds).toEqual(
      recovered.results[0]!.activationIds,
    );
  });

  it("preserves relation column presentation and later unrelated view edits", async () => {
    const seed = await fixture();
    const relationPresentation = {
      activeViewId: "table",
      views: [
        {
          id: "table",
          name: "Table",
          type: "table",
          sorts: [],
          filters: [],
          columnWidths: { [seed.propertyId]: 328 },
          tableColumnOrderIds: ["name", seed.propertyId],
          columnWrapOverrides: { [seed.propertyId]: true },
          frozenThroughColumnId: seed.propertyId,
        },
      ],
      sorts: [],
      filters: [],
      columnWidths: {},
    };
    await dbModule
      .getDb()
      .update(dbModule.schema.contentDatabases)
      .set({ viewConfigJson: JSON.stringify(relationPresentation) })
      .where(eq(dbModule.schema.contentDatabases.id, seed.sourceDatabaseId));
    const removed = await asOwner(() =>
      removeProperty.run({
        propertyId: seed.propertyId,
        relationshipMode: { kind: "keep" },
        operationId: `${seed.prefix}-remove-presented-property`,
      }),
    );
    const editedPresentation = {
      ...relationPresentation,
      views: [{ ...relationPresentation.views[0]!, rowDensity: "compact" }],
    };
    await dbModule
      .getDb()
      .update(dbModule.schema.contentDatabases)
      .set({ viewConfigJson: JSON.stringify(editedPresentation) })
      .where(eq(dbModule.schema.contentDatabases.id, seed.sourceDatabaseId));

    await asOwner(() =>
      undo.run({
        revisionId: removed.revisionId,
        recoveryToken: removed.undo.recoveryToken,
        operationId: `${seed.prefix}-undo-presented-property`,
        routes: [],
      }),
    );
    const [database] = await dbModule
      .getDb()
      .select({
        viewConfigJson: dbModule.schema.contentDatabases.viewConfigJson,
      })
      .from(dbModule.schema.contentDatabases)
      .where(eq(dbModule.schema.contentDatabases.id, seed.sourceDatabaseId));
    expect(JSON.parse(database!.viewConfigJson)).toEqual(editedPresentation);
  });

  it("allows removal compensation but blocks recovery that needs deleted selectors", async () => {
    const addedSeed = await fixture();
    const added = await add(
      addedSeed,
      `${addedSeed.prefix}-add`,
      addedSeed.targetPageIds[0],
    );
    const addedHistory = await asOwner(() =>
      listHistory.run({ revisionId: added.revisionId }),
    );
    await markDatabaseDeleted(addedSeed.targetDatabaseId);
    await expect(
      asOwner(() =>
        undo.run({
          revisionId: added.revisionId,
          recoveryToken: addedHistory.items[0]!.recovery.recoveryToken!,
          operationId: `${addedSeed.prefix}-undo-add-after-selector-delete`,
          routes: [
            {
              kind: "connections-forward",
              sourcePageId: addedSeed.sourcePageId,
            },
          ],
        }),
      ),
    ).resolves.toMatchObject({ undoneRevisionId: added.revisionId });

    const removedSeed = await fixture();
    await add(
      removedSeed,
      `${removedSeed.prefix}-add`,
      removedSeed.targetPageIds[0],
    );
    const observed = (await outgoing(removedSeed)).items[0]!;
    const removed = await asOwner(() =>
      mutate.run({
        operationId: `${removedSeed.prefix}-remove`,
        changes: [
          {
            kind: "remove",
            edgeId: observed.edgeId,
            observedActivationIds: observed.observedActivationIds,
            observationToken: observed.observationToken,
            route: observed.routes[0]!,
          },
        ],
      }),
    );
    const removedHistory = await asOwner(() =>
      listHistory.run({ revisionId: removed.revisionId }),
    );
    await markDatabaseDeleted(removedSeed.targetDatabaseId);
    await expect(
      asOwner(() =>
        undo.run({
          revisionId: removed.revisionId,
          recoveryToken: removedHistory.items[0]!.recovery.recoveryToken!,
          operationId: `${removedSeed.prefix}-undo-remove-after-selector-delete`,
          routes: [
            {
              kind: "connections-forward",
              sourcePageId: removedSeed.sourcePageId,
            },
          ],
        }),
      ),
    ).rejects.toMatchObject({ errorCode: "CONSTRAINT_UNAVAILABLE" });

    const replacedSeed = await fixture("one");
    await add(
      replacedSeed,
      `${replacedSeed.prefix}-add`,
      replacedSeed.targetPageIds[0],
    );
    const beforeReplace = (await outgoing(replacedSeed)).items[0]!;
    const replaced = await asOwner(() =>
      mutate.run({
        operationId: `${replacedSeed.prefix}-replace`,
        changes: [
          {
            kind: "replace",
            typeId: replacedSeed.typeId,
            typeVersionId: replacedSeed.typeVersionId,
            sourcePageId: replacedSeed.sourcePageId,
            targetPageId: replacedSeed.targetPageIds[1],
            observedSlotToken: beforeReplace.slotObservationToken!,
            route: beforeReplace.routes[0]!,
          },
        ],
      }),
    );
    const replacedHistory = await asOwner(() =>
      listHistory.run({ revisionId: replaced.revisionId }),
    );
    await markDatabaseDeleted(replacedSeed.targetDatabaseId);
    await expect(
      asOwner(() =>
        undo.run({
          revisionId: replaced.revisionId,
          recoveryToken: replacedHistory.items[0]!.recovery.recoveryToken!,
          operationId: `${replacedSeed.prefix}-undo-replace-after-selector-delete`,
          routes: [
            {
              kind: "connections-forward",
              sourcePageId: replacedSeed.sourcePageId,
            },
          ],
        }),
      ),
    ).rejects.toMatchObject({ errorCode: "CONSTRAINT_UNAVAILABLE" });

    const propertySeed = await fixture();
    const propertyRemoved = await asOwner(() =>
      removeProperty.run({
        propertyId: propertySeed.propertyId,
        relationshipMode: { kind: "keep" },
        operationId: `${propertySeed.prefix}-remove-property`,
      }),
    );
    await markDatabaseDeleted(propertySeed.targetDatabaseId);
    await expect(
      asOwner(() =>
        undo.run({
          revisionId: propertyRemoved.revisionId,
          recoveryToken: propertyRemoved.undo.recoveryToken,
          operationId: `${propertySeed.prefix}-undo-property-after-selector-delete`,
          routes: [],
        }),
      ),
    ).rejects.toMatchObject({ errorCode: "CONSTRAINT_UNAVAILABLE" });
  });

  it("rechecks endpoint access before recovery", async () => {
    const seed = await fixture();
    const documents = [
      `${seed.sourceDatabaseId}-page`,
      `${seed.targetDatabaseId}-page`,
      seed.sourcePageId,
      ...seed.targetPageIds,
    ];
    await dbModule
      .getDb()
      .insert(dbModule.schema.documentShares)
      .values(
        documents.map((resourceId, index) => ({
          id: `${seed.prefix}-share-${index}`,
          resourceId,
          principalType: "user",
          principalId: viewer,
          role: "editor",
          createdBy: owner,
        })),
      );
    const added = await asViewer(() =>
      mutate.run(
        addInput(seed, `${seed.prefix}-viewer-add`, seed.targetPageIds[0]),
      ),
    );
    const history = await asViewer(() =>
      listHistory.run({ revisionId: added.revisionId }),
    );
    await dbModule
      .getDb()
      .delete(dbModule.schema.documentShares)
      .where(
        eq(dbModule.schema.documentShares.resourceId, seed.targetPageIds[0]),
      );
    await expect(
      asViewer(() =>
        undo.run({
          revisionId: added.revisionId,
          recoveryToken: history.items[0]!.recovery.recoveryToken!,
          operationId: `${seed.prefix}-denied-undo`,
          routes: [],
        }),
      ),
    ).rejects.toMatchObject({ errorCode: "NOT_ACCESSIBLE" });
  });
});
