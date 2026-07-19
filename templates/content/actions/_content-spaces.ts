import { createHash } from "node:crypto";

import { and, eq, inArray, sql } from "drizzle-orm";

import { schema } from "../server/db/index.js";
import {
  isComputedPropertyType,
  type DocumentPropertyType,
} from "../shared/properties.js";
import {
  listContentOrganizationMemberships,
  normalizeContentSpaceEmail,
} from "./_content-space-access.js";
import {
  defaultFilesDatabaseViewConfig,
  ensureFilesSystemPropertyDefinitions,
} from "./_files-system-properties.js";
import { withPositionLock } from "./_position-utils.js";
import {
  defaultDatabaseViewConfig,
  normalizedValueJson,
  seedDefaultBlocksField,
  serializeDatabaseViewConfig,
} from "./_property-utils.js";

type Db = any;

export type ProvisionedContentSpaces = {
  personalSpaceId: string;
  personalFilesDatabaseId: string;
  catalogDatabaseId: string;
  favoritesDatabaseId: string;
  favoritesDocumentId: string;
  spaceIds: string[];
  created: {
    spaces: number;
    databases: number;
    documents: number;
    catalogItems: number;
  };
};

function opaqueId(kind: string, value: string): string {
  return `${kind}_${createHash("sha256").update(value).digest("hex").slice(0, 32)}`;
}

export function personalContentSpaceId(email: string) {
  return opaqueId("content_space_personal", normalizeContentSpaceEmail(email));
}

export function organizationContentSpaceId(orgId: string) {
  return opaqueId("content_space_org", orgId.trim());
}

export function sourceBackedContentSpaceId(
  email: string,
  connectionId: string,
) {
  return opaqueId(
    "content_space_source",
    `${normalizeContentSpaceEmail(email)}:${connectionId.trim()}`,
  );
}

export function userContentSpaceId(email: string, workspaceId: string) {
  return opaqueId(
    "content_space_user",
    `${normalizeContentSpaceEmail(email)}:${workspaceId.trim()}`,
  );
}

export function systemIdsForContentSpace(
  scope: string,
  role: "files" | "workspaces" | "favorites",
) {
  return {
    databaseId: opaqueId(`content_database_${role}`, scope),
    documentId: opaqueId(`content_document_${role}`, scope),
  };
}

async function ensureDocument(
  db: Db,
  values: Omit<typeof schema.documents.$inferInsert, "ownerEmail"> & {
    ownerEmail: string;
  },
  created: ProvisionedContentSpaces["created"],
) {
  const [existing] = await db
    .select({ id: schema.documents.id })
    .from(schema.documents)
    .where(
      and(
        eq(schema.documents.id, values.id),
        eq(schema.documents.ownerEmail, values.ownerEmail),
      ),
    );
  if (existing) return;
  await db
    .insert(schema.documents)
    .values({ ...values, ownerEmail: values.ownerEmail })
    .onConflictDoNothing();
  created.documents += 1;
}

async function ensureSystemDatabase(args: {
  db: Db;
  spaceId: string;
  ownerEmail: string;
  orgId: string | null;
  title: string;
  role: "files" | "workspaces" | "favorites";
  visibility: "private" | "org";
  now: string;
  created: ProvisionedContentSpaces["created"];
}) {
  const ids = systemIdsForContentSpace(args.spaceId, args.role);
  await ensureDocument(
    args.db,
    {
      id: ids.documentId,
      spaceId: args.spaceId,
      ownerEmail: args.ownerEmail,
      orgId: args.orgId,
      parentId: null,
      title: args.title,
      content: "",
      description: "",
      position: 0,
      isFavorite: 0,
      hideFromSearch: 1,
      visibility: args.visibility,
      createdAt: args.now,
      updatedAt: args.now,
    },
    args.created,
  );
  const [existing] = await args.db
    .select({ id: schema.contentDatabases.id })
    .from(schema.contentDatabases)
    .where(
      and(
        eq(schema.contentDatabases.spaceId, args.spaceId),
        eq(schema.contentDatabases.systemRole, args.role),
      ),
    );
  if (!existing) {
    await args.db
      .insert(schema.contentDatabases)
      .values({
        id: ids.databaseId,
        spaceId: args.spaceId,
        ownerEmail: args.ownerEmail,
        orgId: args.orgId,
        documentId: ids.documentId,
        title: args.title,
        systemRole: args.role,
        viewConfigJson: serializeDatabaseViewConfig(
          args.role === "files"
            ? defaultFilesDatabaseViewConfig(ids.databaseId)
            : defaultDatabaseViewConfig("table"),
        ),
        createdAt: args.now,
        updatedAt: args.now,
      })
      .onConflictDoNothing();
    args.created.databases += 1;
  }
  const [database] = await args.db
    .select()
    .from(schema.contentDatabases)
    .where(
      and(
        eq(schema.contentDatabases.spaceId, args.spaceId),
        eq(schema.contentDatabases.systemRole, args.role),
      ),
    );
  if (!database)
    throw new Error(
      `Unable to provision ${args.role} database for Content space`,
    );
  if (args.role === "files" && database.title === "Files") {
    await args.db
      .update(schema.contentDatabases)
      .set({ title: args.title, updatedAt: args.now })
      .where(eq(schema.contentDatabases.id, database.id));
    await args.db
      .update(schema.documents)
      .set({ title: args.title, updatedAt: args.now })
      .where(eq(schema.documents.id, database.documentId));
    database.title = args.title;
  }
  await ensureFilesSystemPropertyDefinitions({
    database,
    db: args.db,
    now: args.now,
  });
  return database;
}

async function ensureDatabaseItem(args: {
  db: Db;
  databaseId: string;
  documentId: string;
  ownerEmail: string;
  orgId: string | null;
  position: number;
  now: string;
}) {
  const [existing] = await args.db
    .select({ id: schema.contentDatabaseItems.id })
    .from(schema.contentDatabaseItems)
    .where(
      and(
        eq(schema.contentDatabaseItems.databaseId, args.databaseId),
        eq(schema.contentDatabaseItems.documentId, args.documentId),
      ),
    );
  if (existing) return existing.id;
  const id = opaqueId(
    "content_database_item",
    `${args.databaseId}:${args.documentId}`,
  );
  await args.db
    .insert(schema.contentDatabaseItems)
    .values({
      id,
      ownerEmail: args.ownerEmail,
      orgId: args.orgId,
      databaseId: args.databaseId,
      documentId: args.documentId,
      position: args.position,
      createdAt: args.now,
      updatedAt: args.now,
    })
    .onConflictDoNothing();
  return id;
}

export async function provisionContentSpaces(
  db: Db,
  userEmail: string,
): Promise<ProvisionedContentSpaces> {
  const email = normalizeContentSpaceEmail(userEmail);
  const memberships = await listContentOrganizationMemberships(email);
  const now = new Date().toISOString();
  const personalSpaceId = personalContentSpaceId(email);
  const result: ProvisionedContentSpaces = {
    personalSpaceId,
    personalFilesDatabaseId: systemIdsForContentSpace(personalSpaceId, "files")
      .databaseId,
    catalogDatabaseId: systemIdsForContentSpace(personalSpaceId, "workspaces")
      .databaseId,
    favoritesDatabaseId: systemIdsForContentSpace(personalSpaceId, "favorites")
      .databaseId,
    favoritesDocumentId: systemIdsForContentSpace(personalSpaceId, "favorites")
      .documentId,
    spaceIds: [],
    created: { spaces: 0, databases: 0, documents: 0, catalogItems: 0 },
  };

  await db.transaction(async (tx: Db) => {
    const [personalSpace] = await tx
      .select()
      .from(schema.contentSpaces)
      .where(eq(schema.contentSpaces.id, personalSpaceId));
    const personalFiles = await ensureSystemDatabase({
      db: tx,
      spaceId: personalSpaceId,
      ownerEmail: email,
      orgId: null,
      title: personalSpace?.name ?? "Personal",
      role: "files",
      visibility: "private",
      now,
      created: result.created,
    });
    if (!personalSpace) {
      await tx
        .insert(schema.contentSpaces)
        .values({
          id: personalSpaceId,
          name: "Personal",
          kind: "personal",
          ownerEmail: email,
          orgId: null,
          filesDatabaseId: personalFiles.id,
          createdBy: email,
          createdAt: now,
          updatedAt: now,
        })
        .onConflictDoNothing();
      result.created.spaces += 1;
    } else if (personalSpace.filesDatabaseId !== personalFiles.id) {
      await tx
        .update(schema.contentSpaces)
        .set({ filesDatabaseId: personalFiles.id, updatedAt: now })
        .where(eq(schema.contentSpaces.id, personalSpaceId));
    }
    const catalog = await ensureSystemDatabase({
      db: tx,
      spaceId: personalSpaceId,
      ownerEmail: email,
      orgId: null,
      title: "Workspaces",
      role: "workspaces",
      visibility: "private",
      now,
      created: result.created,
    });
    const [existingFavorites] = await tx
      .select({ id: schema.contentDatabases.id })
      .from(schema.contentDatabases)
      .where(
        and(
          eq(schema.contentDatabases.spaceId, personalSpaceId),
          eq(schema.contentDatabases.systemRole, "favorites"),
        ),
      );
    const favorites = await ensureSystemDatabase({
      db: tx,
      spaceId: personalSpaceId,
      ownerEmail: email,
      orgId: null,
      title: "Favorites",
      role: "favorites",
      visibility: "private",
      now,
      created: result.created,
    });

    const spaces = [
      {
        id: personalSpaceId,
        name: personalSpace?.name ?? "Personal",
        ownerEmail: email,
        orgId: null as string | null,
        createdBy: email,
        filesDatabaseId: personalFiles.id,
      },
      ...memberships.map((membership) => ({
        id: organizationContentSpaceId(membership.orgId),
        name: membership.name,
        ownerEmail: membership.createdBy,
        orgId: membership.orgId,
        createdBy: membership.createdBy,
        filesDatabaseId: systemIdsForContentSpace(
          organizationContentSpaceId(membership.orgId),
          "files",
        ).databaseId,
      })),
    ];
    for (const space of spaces.slice(1)) {
      const [existingSpace] = await tx
        .select()
        .from(schema.contentSpaces)
        .where(eq(schema.contentSpaces.id, space.id));
      if (existingSpace) space.name = existingSpace.name;
      const files = await ensureSystemDatabase({
        db: tx,
        spaceId: space.id,
        ownerEmail: space.ownerEmail,
        orgId: space.orgId,
        title: space.name,
        role: "files",
        visibility: "org",
        now,
        created: result.created,
      });
      if (!existingSpace) {
        await tx
          .insert(schema.contentSpaces)
          .values({
            ...space,
            filesDatabaseId: files.id,
            kind: "organization",
            createdAt: now,
            updatedAt: now,
          })
          .onConflictDoNothing();
        result.created.spaces += 1;
      }
      if (existingSpace && existingSpace.filesDatabaseId !== files.id) {
        await tx
          .update(schema.contentSpaces)
          .set({
            filesDatabaseId: files.id,
            updatedAt: now,
          })
          .where(eq(schema.contentSpaces.id, space.id));
      }
    }
    if (!existingFavorites) {
      const accessibleSpaceIds = spaces.map((space) => space.id);
      const legacyFavorites: Array<typeof schema.documents.$inferSelect> =
        await tx
          .select()
          .from(schema.documents)
          .where(
            and(
              eq(schema.documents.isFavorite, 1),
              inArray(schema.documents.spaceId, accessibleSpaceIds),
            ),
          );
      const roleByOrgId = new Map(
        memberships.map((membership) => [membership.orgId, membership.role]),
      );
      const visibleLegacyFavorites = legacyFavorites.filter((document) => {
        if (!document.orgId) {
          return normalizeContentSpaceEmail(document.ownerEmail) === email;
        }
        return (
          normalizeContentSpaceEmail(document.ownerEmail) === email ||
          document.visibility === "org" ||
          document.visibility === "public" ||
          roleByOrgId.get(document.orgId) === "owner" ||
          roleByOrgId.get(document.orgId) === "admin"
        );
      });
      if (visibleLegacyFavorites.length > 0) {
        await tx
          .insert(schema.contentDatabaseItems)
          .values(
            visibleLegacyFavorites.map((document, position) => ({
              id: opaqueId(
                "content_database_item",
                `${favorites.id}:${document.id}`,
              ),
              ownerEmail: email,
              orgId: null,
              databaseId: favorites.id,
              documentId: document.id,
              position,
              createdAt: now,
              updatedAt: now,
            })),
          )
          .onConflictDoNothing();
      }
    }
    const accessibleIds = new Set(spaces.map((space) => space.id));
    for (const [index, space] of spaces.entries()) {
      if (!accessibleIds.has(space.id)) continue;
      const referenceDocumentId = opaqueId(
        "content_workspace_reference",
        `${email}:${space.id}`,
      );
      await ensureDocument(
        tx,
        {
          id: referenceDocumentId,
          spaceId: personalSpaceId,
          ownerEmail: email,
          orgId: null,
          parentId: catalog.documentId,
          title: space.name,
          content: "",
          description: "",
          position: index,
          isFavorite: 0,
          hideFromSearch: 0,
          visibility: "private",
          createdAt: now,
          updatedAt: now,
        },
        result.created,
      );
      await tx
        .update(schema.documents)
        .set({ title: space.name, updatedAt: now })
        .where(
          and(
            eq(schema.documents.id, referenceDocumentId),
            eq(schema.documents.ownerEmail, email),
            sql`${schema.documents.title} <> ${space.name}`,
          ),
        );
      const catalogItemId = await ensureDatabaseItem({
        db: tx,
        databaseId: catalog.id,
        documentId: referenceDocumentId,
        ownerEmail: email,
        orgId: null,
        position: index,
        now,
      });
      const [existingCatalogItem] = await tx
        .select({ id: schema.contentSpaceCatalogItems.id })
        .from(schema.contentSpaceCatalogItems)
        .where(
          and(
            eq(schema.contentSpaceCatalogItems.catalogDatabaseId, catalog.id),
            eq(schema.contentSpaceCatalogItems.spaceId, space.id),
          ),
        );
      if (!existingCatalogItem) {
        await tx
          .insert(schema.contentSpaceCatalogItems)
          .values({
            id: opaqueId("content_space_catalog", `${email}:${space.id}`),
            ownerEmail: email,
            catalogDatabaseId: catalog.id,
            databaseItemId: catalogItemId,
            documentId: referenceDocumentId,
            spaceId: space.id,
            createdAt: now,
            updatedAt: now,
          })
          .onConflictDoNothing();
        result.created.catalogItems += 1;
      }
    }
  });

  // The established seeder uses its own lock/atomic claim, so call it after
  // the provisioning transaction rather than nesting transaction machinery.
  const records = await db
    .select({
      id: schema.contentDatabases.id,
      ownerEmail: schema.contentDatabases.ownerEmail,
      orgId: schema.contentDatabases.orgId,
    })
    .from(schema.contentDatabases)
    .where(and(eq(schema.contentDatabases.spaceId, personalSpaceId)));
  for (const database of records)
    await seedDefaultBlocksField({
      databaseId: database.id,
      ownerEmail: database.ownerEmail,
      orgId: database.orgId,
      now,
      db,
    });
  for (const membership of memberships) {
    const spaceId = organizationContentSpaceId(membership.orgId);
    const [database] = await db
      .select({
        id: schema.contentDatabases.id,
        ownerEmail: schema.contentDatabases.ownerEmail,
        orgId: schema.contentDatabases.orgId,
      })
      .from(schema.contentDatabases)
      .where(
        and(
          eq(schema.contentDatabases.spaceId, spaceId),
          eq(schema.contentDatabases.systemRole, "files"),
        ),
      );
    if (database)
      await seedDefaultBlocksField({
        databaseId: database.id,
        ownerEmail: database.ownerEmail,
        orgId: database.orgId,
        now,
        db,
      });
  }
  result.spaceIds = [
    personalSpaceId,
    ...memberships.map((membership) =>
      organizationContentSpaceId(membership.orgId),
    ),
  ];
  return result;
}

async function provisionOwnedContentSpace(
  db: Db,
  userEmail: string,
  input: {
    spaceId: string;
    name: string;
    kind: "user" | "source_backed";
    propertyValues?: Record<string, unknown>;
  },
) {
  const email = normalizeContentSpaceEmail(userEmail);
  const name = input.name.trim();
  if (!name) throw new Error("Workspace name is required");
  await provisionContentSpaces(db, email);

  const now = new Date().toISOString();
  const spaceId = input.spaceId;
  const personalSpaceId = personalContentSpaceId(email);
  const catalogIds = systemIdsForContentSpace(personalSpaceId, "workspaces");
  const created: ProvisionedContentSpaces["created"] = {
    spaces: 0,
    databases: 0,
    documents: 0,
    catalogItems: 0,
  };

  const provisioned = await withPositionLock<{
    files: typeof schema.contentDatabases.$inferSelect;
    name: string;
    catalogDatabaseId: string;
    catalogItemId: string;
    catalogDocumentId: string;
  }>(`contentSpace:${spaceId}`, () =>
    db.transaction(async (tx: Db) => {
      const [existingSpace] = await tx
        .select()
        .from(schema.contentSpaces)
        .where(eq(schema.contentSpaces.id, spaceId));
      const sourceFiles = await ensureSystemDatabase({
        db: tx,
        spaceId,
        ownerEmail: email,
        orgId: null,
        title: existingSpace?.name ?? name,
        role: "files",
        visibility: "private",
        now,
        created,
      });
      if (
        existingSpace &&
        input.kind === "user" &&
        existingSpace.name !== name
      ) {
        throw new Error(
          "Workspace request ID is already bound to another name",
        );
      }
      let createdSpace = false;
      if (!existingSpace) {
        const inserted = await tx
          .insert(schema.contentSpaces)
          .values({
            id: spaceId,
            name,
            kind: input.kind,
            ownerEmail: email,
            orgId: null,
            filesDatabaseId: sourceFiles.id,
            createdBy: email,
            createdAt: now,
            updatedAt: now,
          })
          .onConflictDoNothing()
          .returning({ id: schema.contentSpaces.id });
        createdSpace = inserted.length > 0;
      } else if (existingSpace.filesDatabaseId !== sourceFiles.id) {
        await tx
          .update(schema.contentSpaces)
          .set({ filesDatabaseId: sourceFiles.id, updatedAt: now })
          .where(eq(schema.contentSpaces.id, spaceId));
      }
      const [canonicalSpace] = await tx
        .select()
        .from(schema.contentSpaces)
        .where(eq(schema.contentSpaces.id, spaceId));
      if (!canonicalSpace)
        throw new Error("Unable to create Content workspace");
      if (input.kind === "user" && canonicalSpace.name !== name) {
        throw new Error(
          "Workspace request ID is already bound to another name",
        );
      }
      const referenceDocumentId = opaqueId(
        "content_workspace_reference",
        `${email}:${spaceId}`,
      );
      await ensureDocument(
        tx,
        {
          id: referenceDocumentId,
          spaceId: personalSpaceId,
          ownerEmail: email,
          orgId: null,
          parentId: catalogIds.documentId,
          title: canonicalSpace.name,
          content: "",
          description: "",
          position: 0,
          isFavorite: 0,
          hideFromSearch: 0,
          visibility: "private",
          createdAt: now,
          updatedAt: now,
        },
        created,
      );
      if (createdSpace) {
        await tx
          .update(schema.documents)
          .set({ title: canonicalSpace.name, updatedAt: now })
          .where(eq(schema.documents.id, referenceDocumentId));
      }

      const [maxCatalogPosition] = await tx
        .select({ max: sql<number>`COALESCE(MAX(position), -1)` })
        .from(schema.contentDatabaseItems)
        .where(
          eq(schema.contentDatabaseItems.databaseId, catalogIds.databaseId),
        );
      const catalogItemId = await ensureDatabaseItem({
        db: tx,
        databaseId: catalogIds.databaseId,
        documentId: referenceDocumentId,
        ownerEmail: email,
        orgId: null,
        position: (maxCatalogPosition?.max ?? -1) + 1,
        now,
      });
      const [mapping] = await tx
        .select({ id: schema.contentSpaceCatalogItems.id })
        .from(schema.contentSpaceCatalogItems)
        .where(
          and(
            eq(
              schema.contentSpaceCatalogItems.catalogDatabaseId,
              catalogIds.databaseId,
            ),
            eq(schema.contentSpaceCatalogItems.spaceId, spaceId),
          ),
        );
      if (!mapping) {
        await tx
          .insert(schema.contentSpaceCatalogItems)
          .values({
            id: opaqueId("content_space_catalog", `${email}:${spaceId}`),
            ownerEmail: email,
            catalogDatabaseId: catalogIds.databaseId,
            databaseItemId: catalogItemId,
            documentId: referenceDocumentId,
            spaceId,
            createdAt: now,
            updatedAt: now,
          })
          .onConflictDoNothing();
      }
      const initialPropertyValues = Object.entries(input.propertyValues ?? {});
      if (createdSpace && initialPropertyValues.length > 0) {
        const definitions = (await tx
          .select()
          .from(schema.documentPropertyDefinitions)
          .where(
            and(
              eq(
                schema.documentPropertyDefinitions.databaseId,
                catalogIds.databaseId,
              ),
              inArray(
                schema.documentPropertyDefinitions.id,
                initialPropertyValues.map(([propertyId]) => propertyId),
              ),
            ),
          )) as Array<typeof schema.documentPropertyDefinitions.$inferSelect>;
        const definitionById = new Map(
          definitions.map((definition) => [definition.id, definition]),
        );
        for (const [propertyId, value] of initialPropertyValues) {
          const definition = definitionById.get(propertyId);
          const type = definition?.type as DocumentPropertyType | undefined;
          if (!type || isComputedPropertyType(type)) continue;
          await tx
            .insert(schema.documentPropertyValues)
            .values({
              id: opaqueId(
                "content_workspace_property",
                `${email}:${spaceId}:${propertyId}`,
              ),
              ownerEmail: email,
              documentId: referenceDocumentId,
              propertyId,
              valueJson: normalizedValueJson(type, value),
              createdAt: now,
              updatedAt: now,
            })
            .onConflictDoUpdate({
              target: schema.documentPropertyValues.id,
              set: {
                valueJson: normalizedValueJson(type, value),
                updatedAt: now,
              },
            });
        }
      }
      return {
        files: sourceFiles,
        name: canonicalSpace.name,
        catalogDatabaseId: catalogIds.databaseId,
        catalogItemId,
        catalogDocumentId: referenceDocumentId,
      };
    }),
  );

  await seedDefaultBlocksField({
    databaseId: provisioned.files.id,
    ownerEmail: provisioned.files.ownerEmail,
    orgId: provisioned.files.orgId,
    now,
    db,
  });
  return {
    spaceId,
    name: provisioned.name,
    filesDatabaseId: provisioned.files.id,
    catalogDatabaseId: provisioned.catalogDatabaseId,
    catalogItemId: provisioned.catalogItemId,
    catalogDocumentId: provisioned.catalogDocumentId,
  };
}

export async function provisionSourceBackedContentSpace(
  db: Db,
  userEmail: string,
  input: { connectionId: string; name: string },
) {
  const connectionId = input.connectionId.trim();
  if (!connectionId) throw new Error("Local folder connection ID is required");
  return provisionOwnedContentSpace(db, userEmail, {
    spaceId: sourceBackedContentSpaceId(userEmail, connectionId),
    name: input.name.trim() || "Local folder",
    kind: "source_backed",
  });
}

export async function provisionUserContentSpace(
  db: Db,
  userEmail: string,
  input: {
    workspaceId: string;
    name: string;
    propertyValues?: Record<string, unknown>;
  },
) {
  const workspaceId = input.workspaceId.trim();
  if (!workspaceId) throw new Error("Workspace ID is required");
  return provisionOwnedContentSpace(db, userEmail, {
    spaceId: userContentSpaceId(userEmail, workspaceId),
    name: input.name,
    kind: "user",
    propertyValues: input.propertyValues,
  });
}
