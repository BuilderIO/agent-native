import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { runWithRequestContext } from "@agent-native/core/server";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const databasePath = join(
  tmpdir(),
  `canonical-relation-integration-${process.pid}-${Date.now()}.pglite`,
);
const owner = "relationship-owner@example.com";
const viewer = "relationship-viewer@example.com";
const spaceId = "relationship-integration-space";
let dbModule: typeof import("../server/db/index.js");
let configure: typeof import("./configure-content-relation-property.js").default;
let mutate: typeof import("./mutate-content-relationships.js").default;
let list: typeof import("./list-content-relationships.js").default;
let setProperty: typeof import("./set-document-property.js").default;
let deleteProperty: typeof import("./delete-document-property.js").default;
let duplicateProperty: typeof import("./duplicate-document-property.js").default;
let configureProperty: typeof import("./configure-document-property.js").default;
let listProperties: typeof import("./_property-utils.js").listPropertiesForDatabaseDocuments;
let nextId = 0;

const asOwner = <T>(run: () => Promise<T>) =>
  runWithRequestContext({ userEmail: owner }, run);

beforeAll(async () => {
  process.env.DATABASE_URL = `pglite:${databasePath}`;
  dbModule = await import("../server/db/index.js");
  const plugin = (await import("../server/plugins/db.js")).default;
  await plugin(undefined as never);
  configure = (await import("./configure-content-relation-property.js"))
    .default;
  mutate = (await import("./mutate-content-relationships.js")).default;
  list = (await import("./list-content-relationships.js")).default;
  setProperty = (await import("./set-document-property.js")).default;
  deleteProperty = (await import("./delete-document-property.js")).default;
  duplicateProperty = (await import("./duplicate-document-property.js"))
    .default;
  configureProperty = (await import("./configure-document-property.js"))
    .default;
  listProperties = (await import("./_property-utils.js"))
    .listPropertiesForDatabaseDocuments;
  await dbModule.getDb().insert(dbModule.schema.contentSpaces).values({
    id: spaceId,
    name: "Relationship integration",
    kind: "personal",
    ownerEmail: owner,
    filesDatabaseId: "integration-files",
    createdBy: owner,
  });
  await dbModule.getDb().insert(dbModule.schema.documents).values({
    id: "integration-files-page",
    spaceId,
    ownerEmail: owner,
    title: "Files",
  });
  await dbModule.getDb().insert(dbModule.schema.contentDatabases).values({
    id: "integration-files",
    documentId: "integration-files-page",
    spaceId,
    ownerEmail: owner,
    title: "Files",
    systemRole: "files",
    blocksSeeded: 1,
  });
});

afterAll(() => rmSync(databasePath, { recursive: true, force: true }));

async function fixture(inverseEditable = true) {
  const prefix = `relations-${++nextId}`;
  const db = dbModule.getDb();
  const { schema } = dbModule;
  const sourceDatabaseId = `${prefix}-deliverables`;
  const targetDatabaseId = `${prefix}-team`;
  const sourcePageId = `${prefix}-launch`;
  const targetPageId = `${prefix}-mira`;
  await db.insert(schema.documents).values([
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
    { id: sourcePageId, spaceId, ownerEmail: owner, title: "Launch article" },
    { id: targetPageId, spaceId, ownerEmail: owner, title: "Mira" },
  ]);
  await db.insert(schema.contentDatabases).values([
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
      title: "Team",
      blocksSeeded: 1,
    },
  ]);
  await db.insert(schema.contentDatabaseItems).values([
    {
      id: `${prefix}-source-item`,
      databaseId: sourceDatabaseId,
      documentId: sourcePageId,
      ownerEmail: owner,
    },
    {
      id: `${prefix}-target-item`,
      databaseId: targetDatabaseId,
      documentId: targetPageId,
      ownerEmail: owner,
    },
  ]);
  const configured = await configure.run({
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
      editable: inverseEditable,
    },
  });
  const propertyId = configured.projection.propertyId;
  await mutate.run({
    operationId: `${prefix}-add`,
    changes: [
      {
        kind: "add",
        typeId: configured.relationshipType.id,
        typeVersionId: configured.relationshipTypeVersion.id,
        sourcePageId,
        targetPageId,
        route: { kind: "forward-property", propertyId, sourcePageId },
      },
    ],
  });
  return {
    prefix,
    sourceDatabaseId,
    targetDatabaseId,
    sourcePageId,
    targetPageId,
    propertyId,
    configured,
  };
}

describe("canonical relationship integration", () => {
  it("exposes inverse edit policy and preserves it through metadata updates", () =>
    asOwner(async () => {
      const f = await fixture(false);
      const inverseId = f.configured.inverseProjection!.propertyId;
      const read = async () => {
        const [page] = await dbModule
          .getDb()
          .select()
          .from(dbModule.schema.documents)
          .where(eq(dbModule.schema.documents.id, f.targetPageId));
        const values = await listProperties(f.targetDatabaseId, [page]);
        return values
          .get(f.targetPageId)!
          .find((property) => property.definition.id === inverseId)!;
      };
      expect((await read()).editable).toBe(false);
      const definition = {
        kind: "existing" as const,
        relationshipTypeId: f.configured.relationshipType.id,
        direction: "inverse" as const,
      };
      await configure.run({
        ownerDatabaseId: f.targetDatabaseId,
        propertyId: inverseId,
        alias: "My deliverables",
        description: "Assignment history",
        editable: true,
        definition,
        operationId: `${f.prefix}-enable-inverse`,
      });
      expect((await read()).editable).toBe(true);
      await configure.run({
        ownerDatabaseId: f.targetDatabaseId,
        propertyId: inverseId,
        alias: "Creative work",
        visibility: "hide_when_empty",
        definition,
        operationId: `${f.prefix}-rename-inverse`,
      });
      const after = await read();
      expect(after.editable).toBe(true);
      expect(after.definition).toMatchObject({
        id: inverseId,
        name: "Creative work",
        description: "Assignment history",
        visibility: "hide_when_empty",
      });
      expect(after.value).toEqual([f.sourcePageId]);
    }));

  it("fails closed when a persisted projection loses its property marker", () =>
    asOwner(async () => {
      const f = await fixture();
      await dbModule
        .getDb()
        .update(dbModule.schema.documentPropertyDefinitions)
        .set({ optionsJson: "{}" })
        .where(
          eq(dbModule.schema.documentPropertyDefinitions.id, f.propertyId),
        );
      const context = {
        documentId: f.sourcePageId,
        databaseId: f.sourceDatabaseId,
        propertyId: f.propertyId,
      };
      await expect(deleteProperty.run(context)).rejects.toMatchObject({
        errorCode: "UNAVAILABLE",
      });
      await expect(duplicateProperty.run(context)).rejects.toMatchObject({
        errorCode: "UNAVAILABLE",
      });
      await expect(
        configureProperty.run({
          documentId: f.sourcePageId,
          databaseId: f.sourceDatabaseId,
          id: f.propertyId,
          name: "Changed",
          type: "text",
        }),
      ).rejects.toMatchObject({ errorCode: "UNAVAILABLE" });
    }));

  it("allows duplication of unassigned rows and rejects silent loss of existing relationships", () =>
    asOwner(async () => {
      const f = await fixture();
      const { getDb, schema } = dbModule;
      const pageId = `${f.prefix}-unassigned`;
      const itemId = `${f.prefix}-unassigned-item`;
      await getDb().insert(schema.documents).values({
        id: pageId,
        ownerEmail: owner,
        spaceId,
        title: "Unassigned draft",
      });
      await getDb().insert(schema.contentDatabaseItems).values({
        id: itemId,
        databaseId: f.sourceDatabaseId,
        documentId: pageId,
        ownerEmail: owner,
      });
      const duplicate = (await import("./duplicate-database-item.js")).default;
      const result = await duplicate.run({ itemId });
      expect(result.duplicatedDocumentId).not.toBe(pageId);
      expect(
        (await list.run({ pageId: result.duplicatedDocumentId })).items,
      ).toEqual([]);
      await expect(
        duplicate.run({ itemId: `${f.prefix}-source-item` }),
      ).rejects.toMatchObject({ errorCode: "UNSUPPORTED_CONFIGURATION" });
    }));

  it("reports an unreadable legacy relation instead of an empty assignment", () =>
    asOwner(async () => {
      const f = await fixture();
      const { getDb, schema } = dbModule;
      const legacyId = `${f.prefix}-legacy`;
      await getDb()
        .insert(schema.documentPropertyDefinitions)
        .values({
          id: legacyId,
          databaseId: f.sourceDatabaseId,
          ownerEmail: owner,
          name: "Legacy relation",
          type: "relation",
          optionsJson: JSON.stringify({
            relation: { databaseId: f.targetDatabaseId },
          }),
        });
      await getDb()
        .insert(schema.documentPropertyValues)
        .values({
          id: `${f.prefix}-legacy-value`,
          documentId: f.sourcePageId,
          propertyId: legacyId,
          ownerEmail: owner,
          valueJson: JSON.stringify({ unsupportedProviderPayload: true }),
        });
      const [page] = await getDb()
        .select()
        .from(schema.documents)
        .where(eq(schema.documents.id, f.sourcePageId));
      await expect(
        listProperties(f.sourceDatabaseId, [page]),
      ).rejects.toMatchObject({ errorCode: "UNSUPPORTED_CONFIGURATION" });
    }));

  it("suspends and restores the same lineage through the Page lifecycle Actions", () =>
    asOwner(async () => {
      const f = await fixture();
      const trash = (await import("./delete-document.js")).default;
      const restore = (await import("./restore-document.js")).default;
      const remove = (await import("./permanently-delete-document.js")).default;
      const initial = (await list.run({ pageId: f.sourcePageId })).items[0];
      const { schema, getDb } = dbModule;
      const [page] = await getDb()
        .select()
        .from(schema.documents)
        .where(eq(schema.documents.id, f.sourcePageId));
      await trash.run({ id: f.targetPageId });
      const suspended = (await listProperties(f.sourceDatabaseId, [page])).get(
        page.id,
      )!;
      expect(
        suspended.find((p) => p.definition.id === f.propertyId)?.value,
      ).toEqual([]);
      await restore.run({ id: f.targetPageId });
      expect(
        (await list.run({ pageId: f.sourcePageId })).items.map(
          (edge) => edge.edgeId,
        ),
      ).toContain(initial.edgeId);
      await trash.run({ id: f.targetPageId });
      await remove.run({ id: f.targetPageId });
      await expect(restore.run({ id: f.targetPageId })).rejects.toThrow();
      const deleted = (await listProperties(f.sourceDatabaseId, [page])).get(
        page.id,
      )!;
      expect(
        deleted.find((p) => p.definition.id === f.propertyId)?.value,
      ).toEqual([]);
    }));

  it("prevents legacy property Actions from replacing or deleting canonical truth", () =>
    asOwner(async () => {
      const f = await fixture();
      const context = {
        documentId: f.sourcePageId,
        databaseId: f.sourceDatabaseId,
        propertyId: f.propertyId,
      };
      await expect(
        setProperty.run({ ...context, value: [] }),
      ).rejects.toMatchObject({ errorCode: "USE_RELATIONSHIP_MUTATION" });
      const bulk = (await import("./update-database-items.js")).default;
      await expect(
        bulk.run({
          databaseId: f.sourceDatabaseId,
          documentIds: [f.sourcePageId],
          propertyId: f.propertyId,
          value: [],
        }),
      ).rejects.toMatchObject({ errorCode: "USE_RELATIONSHIP_MUTATION" });
      await expect(deleteProperty.run(context)).rejects.toMatchObject({
        errorCode: "USE_RELATIONSHIP_MUTATION",
      });
      await expect(duplicateProperty.run(context)).rejects.toMatchObject({
        errorCode: "USE_RELATIONSHIP_MUTATION",
      });
      await expect(
        configureProperty.run({
          documentId: f.sourcePageId,
          databaseId: f.sourceDatabaseId,
          id: f.propertyId,
          name: "Text",
          type: "text",
        }),
      ).rejects.toMatchObject({ errorCode: "USE_RELATIONSHIP_MUTATION" });
      expect((await list.run({ pageId: f.sourcePageId })).items).toHaveLength(
        1,
      );
    }));

  it("hydrates canonical relation values and rollup count without stored endpoint arrays", () =>
    asOwner(async () => {
      const f = await fixture();
      const { schema, getDb } = dbModule;
      const rollupId = `${f.prefix}-count`;
      await getDb()
        .insert(schema.documentPropertyDefinitions)
        .values({
          id: rollupId,
          databaseId: f.sourceDatabaseId,
          ownerEmail: owner,
          name: "Contributor count",
          type: "rollup",
          optionsJson: JSON.stringify({
            rollup: { relationPropertyId: f.propertyId, aggregation: "count" },
          }),
        });
      const [page] = await getDb()
        .select()
        .from(schema.documents)
        .where(eq(schema.documents.id, f.sourcePageId));
      const properties = (await listProperties(f.sourceDatabaseId, [page])).get(
        page.id,
      )!;
      expect(
        properties.find((p) => p.definition.id === f.propertyId)?.value,
      ).toEqual([f.targetPageId]);
      expect(properties.find((p) => p.definition.id === rollupId)?.value).toBe(
        1,
      );
      const raw = await getDb()
        .select()
        .from(schema.documentPropertyValues)
        .where(eq(schema.documentPropertyValues.propertyId, f.propertyId));
      expect(raw).toHaveLength(0);
      const { buildCollectionExportProjection } =
        await import("./_collection-export.js");
      const exported = await buildCollectionExportProjection(
        `${f.sourceDatabaseId}-page`,
        {
          scope: { kind: "all_members" },
          propertyIds: [f.propertyId, rollupId],
          includePrimaryBody: false,
          blockPropertyIds: [],
        },
      );
      expect(exported.records[0].scalarValues.get(f.propertyId)).toContain(
        f.targetPageId,
      );
      expect(exported.records[0].scalarValues.get(rollupId)).toBe("1");
    }));

  it("does not expose a private target or its count through ordinary property reads", () =>
    asOwner(async () => {
      const f = await fixture();
      const { schema, getDb } = dbModule;
      await getDb()
        .insert(schema.documentShares)
        .values([
          {
            id: `${f.prefix}-source-share`,
            resourceId: f.sourcePageId,
            principalType: "user",
            principalId: viewer,
            role: "viewer",
            createdBy: owner,
          },
          {
            id: `${f.prefix}-database-share`,
            resourceId: `${f.sourceDatabaseId}-page`,
            principalType: "user",
            principalId: viewer,
            role: "viewer",
            createdBy: owner,
          },
        ]);
      const [page] = await getDb()
        .select()
        .from(schema.documents)
        .where(eq(schema.documents.id, f.sourcePageId));
      await runWithRequestContext({ userEmail: viewer }, async () => {
        const properties = (
          await listProperties(f.sourceDatabaseId, [page])
        ).get(page.id)!;
        expect(
          properties.find((p) => p.definition.id === f.propertyId)?.value,
        ).toEqual([]);
        expect((await list.run({ pageId: f.sourcePageId })).items).toEqual([]);
        const { buildCollectionExportProjection } =
          await import("./_collection-export.js");
        const exported = await buildCollectionExportProjection(
          `${f.sourceDatabaseId}-page`,
          {
            scope: { kind: "all_members" },
            propertyIds: [f.propertyId],
            includePrimaryBody: false,
            blockPropertyIds: [],
          },
        );
        expect(exported.records[0].scalarValues.get(f.propertyId)).toBe("");
      });
    }));
});
