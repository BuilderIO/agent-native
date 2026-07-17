import { createHash } from "node:crypto";

import { and, eq, sql } from "drizzle-orm";

import { schema } from "../server/db/index.js";
import {
  listContentOrganizationMemberships,
  normalizeContentSpaceEmail,
} from "./_content-space-access.js";
import {
  defaultDatabaseViewConfig,
  seedDefaultBlocksField,
  serializeDatabaseViewConfig,
} from "./_property-utils.js";

type Db = any;

export type ProvisionedContentSpaces = {
  personalSpaceId: string;
  personalFilesDatabaseId: string;
  catalogDatabaseId: string;
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

export function systemIdsForContentSpace(
  scope: string,
  role: "files" | "workspaces",
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
  role: "files" | "workspaces";
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
          defaultDatabaseViewConfig("sidebar"),
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
    spaceIds: [],
    created: { spaces: 0, databases: 0, documents: 0, catalogItems: 0 },
  };

  await db.transaction(async (tx: Db) => {
    const personalFiles = await ensureSystemDatabase({
      db: tx,
      spaceId: personalSpaceId,
      ownerEmail: email,
      orgId: null,
      title: "Files",
      role: "files",
      visibility: "private",
      now,
      created: result.created,
    });
    const [personalSpace] = await tx
      .select()
      .from(schema.contentSpaces)
      .where(eq(schema.contentSpaces.id, personalSpaceId));
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
    await ensureDatabaseItem({
      db: tx,
      databaseId: personalFiles.id,
      documentId: catalog.documentId,
      ownerEmail: email,
      orgId: null,
      position: 0,
      now,
    });

    const spaces = [
      {
        id: personalSpaceId,
        name: "Personal",
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
      const files = await ensureSystemDatabase({
        db: tx,
        spaceId: space.id,
        ownerEmail: space.ownerEmail,
        orgId: space.orgId,
        title: "Files",
        role: "files",
        visibility: "org",
        now,
        created: result.created,
      });
      const [existingSpace] = await tx
        .select()
        .from(schema.contentSpaces)
        .where(eq(schema.contentSpaces.id, space.id));
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
      } else if (
        existingSpace.name !== space.name ||
        existingSpace.filesDatabaseId !== files.id
      ) {
        await tx
          .update(schema.contentSpaces)
          .set({
            name: space.name,
            filesDatabaseId: files.id,
            updatedAt: now,
          })
          .where(eq(schema.contentSpaces.id, space.id));
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
      await ensureDatabaseItem({
        db: tx,
        databaseId: personalFiles.id,
        documentId: referenceDocumentId,
        ownerEmail: email,
        orgId: null,
        position: index + 1,
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

export async function provisionSourceBackedContentSpace(
  db: Db,
  userEmail: string,
  input: { connectionId: string; name: string },
) {
  const email = normalizeContentSpaceEmail(userEmail);
  const connectionId = input.connectionId.trim();
  const name = input.name.trim() || "Local folder";
  if (!connectionId) throw new Error("Local folder connection ID is required");
  await provisionContentSpaces(db, email);

  const now = new Date().toISOString();
  const spaceId = sourceBackedContentSpaceId(email, connectionId);
  const personalSpaceId = personalContentSpaceId(email);
  const personalFilesIds = systemIdsForContentSpace(personalSpaceId, "files");
  const catalogIds = systemIdsForContentSpace(personalSpaceId, "workspaces");
  const created: ProvisionedContentSpaces["created"] = {
    spaces: 0,
    databases: 0,
    documents: 0,
    catalogItems: 0,
  };

  const files = await db.transaction(async (tx: Db) => {
    const sourceFiles = await ensureSystemDatabase({
      db: tx,
      spaceId,
      ownerEmail: email,
      orgId: null,
      title: "Files",
      role: "files",
      visibility: "private",
      now,
      created,
    });
    const [existingSpace] = await tx
      .select()
      .from(schema.contentSpaces)
      .where(eq(schema.contentSpaces.id, spaceId));
    if (!existingSpace) {
      await tx
        .insert(schema.contentSpaces)
        .values({
          id: spaceId,
          name,
          kind: "source_backed",
          ownerEmail: email,
          orgId: null,
          filesDatabaseId: sourceFiles.id,
          createdBy: email,
          createdAt: now,
          updatedAt: now,
        })
        .onConflictDoNothing();
    } else if (
      existingSpace.name !== name ||
      existingSpace.filesDatabaseId !== sourceFiles.id
    ) {
      await tx
        .update(schema.contentSpaces)
        .set({ name, filesDatabaseId: sourceFiles.id, updatedAt: now })
        .where(eq(schema.contentSpaces.id, spaceId));
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
        title: name,
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
    await tx
      .update(schema.documents)
      .set({ title: name, updatedAt: now })
      .where(eq(schema.documents.id, referenceDocumentId));

    const [maxCatalogPosition] = await tx
      .select({ max: sql<number>`COALESCE(MAX(position), -1)` })
      .from(schema.contentDatabaseItems)
      .where(eq(schema.contentDatabaseItems.databaseId, catalogIds.databaseId));
    const catalogItemId = await ensureDatabaseItem({
      db: tx,
      databaseId: catalogIds.databaseId,
      documentId: referenceDocumentId,
      ownerEmail: email,
      orgId: null,
      position: (maxCatalogPosition?.max ?? -1) + 1,
      now,
    });
    await ensureDatabaseItem({
      db: tx,
      databaseId: personalFilesIds.databaseId,
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
    return sourceFiles;
  });

  await seedDefaultBlocksField({
    databaseId: files.id,
    ownerEmail: files.ownerEmail,
    orgId: files.orgId,
    now,
    db,
  });
  return { spaceId, filesDatabaseId: files.id };
}
