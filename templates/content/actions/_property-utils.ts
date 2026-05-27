import { and, asc, eq, or, sql, type InferSelectModel } from "drizzle-orm";
import { getDb, schema } from "../server/db/index.js";
import {
  defaultPropertyOptions,
  isComputedPropertyType,
  normalizePropertyValue,
  normalizePropertyVisibility,
  parsePropertyOptions,
  parsePropertyValue,
  serializePropertyOptions,
  serializePropertyValue,
  type DocumentPropertyOptions,
  type DocumentPropertyType,
  type DocumentPropertyValue,
} from "../shared/properties.js";

type DocumentRow = InferSelectModel<typeof schema.documents>;

export function nanoid(size = 12): string {
  const chars =
    "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
  let id = "";
  const bytes = crypto.getRandomValues(new Uint8Array(size));
  for (const byte of bytes) id += chars[byte % chars.length];
  return id;
}

export function computedPropertyValue(
  type: DocumentPropertyType,
  document: DocumentRow,
): DocumentPropertyValue {
  switch (type) {
    case "id":
      return document.id;
    case "created_time":
      return document.createdAt;
    case "created_by":
      return document.ownerEmail;
    case "last_edited_time":
      return document.updatedAt;
    default:
      return null;
  }
}

export async function listPropertiesForDocument(document: DocumentRow) {
  const db = getDb();
  const definitions = await db
    .select()
    .from(schema.documentPropertyDefinitions)
    .where(
      and(
        eq(schema.documentPropertyDefinitions.ownerEmail, document.ownerEmail),
        document.orgId
          ? or(
              eq(schema.documentPropertyDefinitions.orgId, document.orgId),
              sql`${schema.documentPropertyDefinitions.orgId} IS NULL`,
            )
          : sql`${schema.documentPropertyDefinitions.orgId} IS NULL`,
      ),
    )
    .orderBy(asc(schema.documentPropertyDefinitions.position));

  if (definitions.length === 0) return [];

  const values = await db
    .select()
    .from(schema.documentPropertyValues)
    .where(eq(schema.documentPropertyValues.documentId, document.id));

  const valueByPropertyId = new Map(
    values.map((value) => [value.propertyId, value]),
  );

  return definitions.map((definition) => {
    const type = definition.type as DocumentPropertyType;
    const storedValue = valueByPropertyId.get(definition.id);
    return {
      definition: {
        id: definition.id,
        name: definition.name,
        type,
        visibility: normalizePropertyVisibility(definition.visibility),
        options: parsePropertyOptions(definition.optionsJson),
        position: definition.position,
        createdAt: definition.createdAt,
        updatedAt: definition.updatedAt,
      },
      value: isComputedPropertyType(type)
        ? computedPropertyValue(type, document)
        : parsePropertyValue(storedValue?.valueJson),
      editable: !isComputedPropertyType(type),
    };
  });
}

export function optionsForNewProperty(
  type: DocumentPropertyType,
  options?: DocumentPropertyOptions,
) {
  return serializePropertyOptions(options ?? defaultPropertyOptions(type));
}

export function normalizedValueJson(
  type: DocumentPropertyType,
  value: unknown,
) {
  return serializePropertyValue(normalizePropertyValue(type, value));
}
