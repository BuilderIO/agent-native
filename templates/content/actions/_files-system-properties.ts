import { createHash } from "node:crypto";

import { accessFilter } from "@agent-native/core/sharing";
import { and, eq, inArray, isNull, or } from "drizzle-orm";

import { getDb, schema } from "../server/db/index.js";
import type {
  ContentDatabaseViewConfig,
  DocumentProperty,
  DocumentPropertyDefinition,
  DocumentPropertyOption,
  DocumentPropertySystemRole,
  DocumentPropertyValue,
} from "../shared/api.js";
import {
  parsePropertyOptions,
  serializePropertyOptions,
} from "../shared/properties.js";
import {
  defaultDatabaseViewConfig,
  parseDatabaseViewConfig,
  serializeDatabaseViewConfig,
} from "./_property-utils.js";

type Db = Pick<ReturnType<typeof getDb>, "select" | "insert" | "update">;
type Database = typeof schema.contentDatabases.$inferSelect;
type Document = Pick<
  typeof schema.documents.$inferSelect,
  | "id"
  | "spaceId"
  | "parentId"
  | "sourceMode"
  | "sourceKind"
  | "ownerEmail"
  | "orgId"
>;

const SYSTEM_PROPERTY_SPECS = [
  {
    role: "files_kind" as const,
    name: "Kind",
    type: "select" as const,
    description: "The kind of Content artifact represented by this file.",
    position: -300,
  },
  {
    role: "files_parent" as const,
    name: "Parent",
    type: "select" as const,
    description: "The authorized parent page or database for this file.",
    position: -200,
  },
  {
    role: "files_source" as const,
    name: "Source",
    type: "multi_select" as const,
    description: "The source system that supplies this file.",
    position: -100,
  },
] as const;

const KIND_OPTIONS: DocumentPropertyOption[] = [
  { id: "page", name: "Page", color: "gray" },
  { id: "database", name: "Database", color: "blue" },
  { id: "database_row", name: "Database row", color: "purple" },
  { id: "imported_file", name: "Imported file", color: "green" },
  { id: "shared_copy", name: "Shared copy", color: "orange" },
];

function systemPropertyId(
  databaseId: string,
  role: DocumentPropertySystemRole,
) {
  return `content_files_property_${createHash("sha256")
    .update(`${databaseId}:${role}`)
    .digest("hex")
    .slice(0, 32)}`;
}

export function filesKindPropertyId(databaseId: string) {
  return systemPropertyId(databaseId, "files_kind");
}

export function defaultFilesDatabaseViewConfig(
  databaseId: string,
): ContentDatabaseViewConfig {
  const config = defaultDatabaseViewConfig("table");
  const filters = [
    {
      key: filesKindPropertyId(databaseId),
      label: "Kind",
      operator: "does_not_equal" as const,
      value: "database_row",
    },
  ];
  return {
    ...config,
    filters,
    views: config.views.map((view) => ({ ...view, filters })),
  };
}

function storedOptions(role: DocumentPropertySystemRole) {
  if (role === "files_kind") return { options: KIND_OPTIONS };
  if (role === "files_source") {
    return {
      options: [{ id: "local", name: "Local", color: "gray" as const }],
    };
  }
  return { options: [] };
}

export async function ensureFilesSystemPropertyDefinitions(args: {
  database: Database;
  db?: Db;
  now?: string;
}) {
  if (args.database.systemRole !== "files") return;
  if (args.database.filesSystemPropertiesSeeded === 1) return;
  const db = args.db ?? getDb();
  const now = args.now ?? new Date().toISOString();
  const existingDefinitions = await db
    .select()
    .from(schema.documentPropertyDefinitions)
    .where(eq(schema.documentPropertyDefinitions.databaseId, args.database.id));
  const existingSourceSystemProperty = existingDefinitions.find(
    (definition) => definition.systemRole === "files_source",
  );
  const sourceIds = (
    await db
      .select({ id: schema.contentDatabaseSources.id })
      .from(schema.contentDatabaseSources)
      .where(eq(schema.contentDatabaseSources.databaseId, args.database.id))
  ).map((source) => source.id);
  const legacySourceOptionIds = [...sourceIds, "local"].sort();
  const legacySourceProperty = existingDefinitions.find((definition) => {
    if (
      definition.systemRole ||
      definition.name !== "Source" ||
      (definition.type !== "select" && definition.type !== "multi_select")
    ) {
      return false;
    }
    const optionIds = (
      parsePropertyOptions(definition.optionsJson).options ?? []
    )
      .map((option) => option.id)
      .sort();
    return (
      sourceIds.length >= 2 &&
      optionIds.length === legacySourceOptionIds.length &&
      optionIds.every((id, index) => id === legacySourceOptionIds[index])
    );
  });
  if (!existingSourceSystemProperty && legacySourceProperty) {
    await db
      .update(schema.documentPropertyDefinitions)
      .set({
        systemRole: "files_source",
        type: "multi_select",
        updatedAt: now,
      })
      .where(
        eq(schema.documentPropertyDefinitions.id, legacySourceProperty.id),
      );
  }
  const existingRoles = new Set(
    existingDefinitions
      .map((definition) => definition.systemRole)
      .filter((role): role is string => Boolean(role)),
  );
  if (legacySourceProperty && !existingSourceSystemProperty) {
    existingRoles.add("files_source");
  }
  const missingDefinitions = SYSTEM_PROPERTY_SPECS.filter(
    (spec) => !existingRoles.has(spec.role),
  ).map((spec) => ({
    id: systemPropertyId(args.database.id, spec.role),
    ownerEmail: args.database.ownerEmail,
    orgId: args.database.orgId,
    databaseId: args.database.id,
    systemRole: spec.role,
    name: spec.name,
    type: spec.type,
    description: spec.description,
    visibility: "always_show",
    optionsJson: serializePropertyOptions(storedOptions(spec.role)),
    position: spec.position,
    createdAt: now,
    updatedAt: now,
  }));
  if (missingDefinitions.length > 0) {
    await db
      .insert(schema.documentPropertyDefinitions)
      .values(missingDefinitions)
      .onConflictDoNothing();
  }
  const normalizedStored = serializeDatabaseViewConfig(
    parseDatabaseViewConfig(args.database.viewConfigJson),
  );
  const untouchedLegacyDefaults = new Set([
    serializeDatabaseViewConfig(defaultDatabaseViewConfig("sidebar")),
    serializeDatabaseViewConfig(defaultDatabaseViewConfig("table")),
  ]);
  const viewConfigJson = untouchedLegacyDefaults.has(normalizedStored)
    ? serializeDatabaseViewConfig(
        defaultFilesDatabaseViewConfig(args.database.id),
      )
    : args.database.viewConfigJson;
  await db
    .update(schema.contentDatabases)
    .set({
      viewConfigJson,
      filesSystemPropertiesSeeded: 1,
      updatedAt: now,
    })
    .where(eq(schema.contentDatabases.id, args.database.id));
}

export async function repairFilesSystemPropertyDefinitions() {
  const db = getDb();
  const databases = await db
    .select()
    .from(schema.contentDatabases)
    .where(
      and(
        eq(schema.contentDatabases.systemRole, "files"),
        eq(schema.contentDatabases.filesSystemPropertiesSeeded, 0),
        isNull(schema.contentDatabases.deletedAt),
      ),
    );
  for (const database of databases) {
    await db.transaction((tx) =>
      ensureFilesSystemPropertyDefinitions({ database, db: tx }),
    );
  }
  return databases.length;
}

function safeOption(
  id: string,
  name: string,
  color: DocumentPropertyOption["color"] = "gray",
): DocumentPropertyOption {
  return { id, name: name.trim() || "Untitled", color };
}

function filesVisibilityFilter(database: Database) {
  return database.orgId
    ? and(
        eq(schema.documents.spaceId, database.spaceId!),
        eq(schema.documents.orgId, database.orgId),
        or(
          eq(schema.documents.visibility, "org"),
          eq(schema.documents.visibility, "public"),
        ),
        or(
          eq(schema.documents.hideFromSearch, 0),
          isNull(schema.documents.hideFromSearch),
        ),
      )
    : and(
        eq(schema.documents.spaceId, database.spaceId!),
        eq(schema.documents.ownerEmail, database.ownerEmail),
      );
}

async function readableDatabaseIds(
  db: Db,
  databaseIds: string[],
  options: { includeSystem?: boolean } = {},
) {
  if (databaseIds.length === 0) return new Set<string>();
  const databases = await db
    .select({
      id: schema.contentDatabases.id,
      documentId: schema.contentDatabases.documentId,
    })
    .from(schema.contentDatabases)
    .where(
      and(
        inArray(schema.contentDatabases.id, databaseIds),
        isNull(schema.contentDatabases.deletedAt),
        options.includeSystem === false
          ? isNull(schema.contentDatabases.systemRole)
          : undefined,
      ),
    );
  if (databases.length === 0) return new Set<string>();
  const readableDocuments = await db
    .select({ id: schema.documents.id })
    .from(schema.documents)
    .where(
      and(
        inArray(
          schema.documents.id,
          databases.map((database) => database.documentId),
        ),
        accessFilter(schema.documents, schema.documentShares),
      ),
    );
  const readableDocumentIds = new Set(readableDocuments.map((row) => row.id));
  return new Set(
    databases
      .filter((database) => readableDocumentIds.has(database.documentId))
      .map((database) => database.id),
  );
}

export async function filesSystemPropertyProjection(args: {
  database: Database;
  documents: Document[];
  properties: DocumentProperty[];
}) {
  const systemProperties = args.properties.filter((property) =>
    SYSTEM_PROPERTY_SPECS.some(
      (spec) => spec.role === property.definition.systemRole,
    ),
  );
  if (args.database.systemRole !== "files" || systemProperties.length === 0) {
    return null;
  }
  const db = getDb();
  const documentIds = args.documents.map((document) => document.id);
  const parentIds = [
    ...new Set(
      args.documents
        .map((document) => document.parentId)
        .filter((id): id is string => Boolean(id)),
    ),
  ];
  const parents = parentIds.length
    ? await db
        .select({ id: schema.documents.id, title: schema.documents.title })
        .from(schema.documents)
        .where(
          and(
            inArray(schema.documents.id, parentIds),
            filesVisibilityFilter(args.database),
            accessFilter(schema.documents, schema.documentShares),
          ),
        )
    : [];
  const parentById = new Map(parents.map((parent) => [parent.id, parent]));

  const ownedDatabases = documentIds.length
    ? await db
        .select({
          id: schema.contentDatabases.id,
          documentId: schema.contentDatabases.documentId,
        })
        .from(schema.contentDatabases)
        .where(
          and(
            inArray(schema.contentDatabases.documentId, documentIds),
            isNull(schema.contentDatabases.deletedAt),
          ),
        )
    : [];
  const ownedDatabaseDocumentIds = new Set(
    ownedDatabases.map((database) => database.documentId),
  );

  const memberships = documentIds.length
    ? await db
        .select({
          documentId: schema.contentDatabaseItems.documentId,
          databaseId: schema.contentDatabaseItems.databaseId,
        })
        .from(schema.contentDatabaseItems)
        .where(inArray(schema.contentDatabaseItems.documentId, documentIds))
    : [];
  const membershipDatabaseIds = [
    ...new Set(
      memberships
        .map((membership) => membership.databaseId)
        .filter((databaseId) => databaseId !== args.database.id),
    ),
  ];
  const readableMembershipDatabaseIds = await readableDatabaseIds(
    db,
    membershipDatabaseIds,
    { includeSystem: false },
  );
  const databaseRowDocumentIds = new Set(
    memberships
      .filter((membership) =>
        readableMembershipDatabaseIds.has(membership.databaseId),
      )
      .map((membership) => membership.documentId),
  );

  const sourceRows = documentIds.length
    ? await db
        .select({
          documentId: schema.contentDatabaseSourceRows.documentId,
          sourceId: schema.contentDatabaseSourceRows.sourceId,
        })
        .from(schema.contentDatabaseSourceRows)
        .where(
          inArray(schema.contentDatabaseSourceRows.documentId, documentIds),
        )
    : [];
  const sourceIds = [...new Set(sourceRows.map((row) => row.sourceId))];
  const sources = sourceIds.length
    ? await db
        .select({
          id: schema.contentDatabaseSources.id,
          databaseId: schema.contentDatabaseSources.databaseId,
          sourceName: schema.contentDatabaseSources.sourceName,
        })
        .from(schema.contentDatabaseSources)
        .where(inArray(schema.contentDatabaseSources.id, sourceIds))
    : [];
  const readableSourceDatabaseIds = await readableDatabaseIds(
    db,
    sources
      .map((source) => source.databaseId)
      .filter((databaseId) => databaseId !== args.database.id),
  );
  readableSourceDatabaseIds.add(args.database.id);
  const readableSourceById = new Map(
    sources
      .filter((source) => readableSourceDatabaseIds.has(source.databaseId))
      .map((source) => [source.id, source]),
  );
  const sourceIdsByDocument = new Map<string, string[]>();
  for (const row of sourceRows) {
    if (!readableSourceById.has(row.sourceId)) continue;
    sourceIdsByDocument.set(row.documentId, [
      ...(sourceIdsByDocument.get(row.documentId) ?? []),
      row.sourceId,
    ]);
  }

  const parentOptions = parents.map((parent) =>
    safeOption(parent.id, parent.title, "blue"),
  );
  const sourceOptions = [
    safeOption("local", "Local"),
    ...[...readableSourceById.values()].map((source) =>
      safeOption(source.id, source.sourceName, "green"),
    ),
  ];
  const definitionByRole = new Map<
    DocumentPropertySystemRole,
    DocumentPropertyDefinition
  >();
  for (const property of systemProperties) {
    const role = property.definition.systemRole!;
    definitionByRole.set(role, {
      ...property.definition,
      options: {
        options:
          role === "files_kind"
            ? KIND_OPTIONS
            : role === "files_parent"
              ? parentOptions
              : sourceOptions,
      },
    });
  }

  const valuesByDocumentId = new Map<
    string,
    Map<DocumentPropertySystemRole, DocumentPropertyValue>
  >();
  for (const document of args.documents) {
    const sourceValues = [
      ...new Set(sourceIdsByDocument.get(document.id) ?? []),
    ];
    const kind =
      document.sourceKind === "local-file-copy"
        ? "shared_copy"
        : document.sourceMode === "local-files" &&
            document.sourceKind === "file"
          ? "imported_file"
          : ownedDatabaseDocumentIds.has(document.id)
            ? "database"
            : databaseRowDocumentIds.has(document.id)
              ? "database_row"
              : "page";
    valuesByDocumentId.set(
      document.id,
      new Map<DocumentPropertySystemRole, DocumentPropertyValue>([
        ["files_kind", kind],
        [
          "files_parent",
          document.parentId && parentById.has(document.parentId)
            ? document.parentId
            : null,
        ],
        ["files_source", sourceValues.length > 0 ? sourceValues : ["local"]],
      ]),
    );
  }
  return { definitionByRole, valuesByDocumentId };
}

export function applyFilesSystemPropertyProjection(args: {
  properties: DocumentProperty[];
  projection: NonNullable<
    Awaited<ReturnType<typeof filesSystemPropertyProjection>>
  >;
  documentId?: string;
}) {
  return args.properties.map((property) => {
    const role = property.definition.systemRole;
    if (!role) return property;
    return {
      ...property,
      definition:
        args.projection.definitionByRole.get(role) ?? property.definition,
      value: args.documentId
        ? (args.projection.valuesByDocumentId.get(args.documentId)?.get(role) ??
          null)
        : null,
      editable: false,
    };
  });
}
