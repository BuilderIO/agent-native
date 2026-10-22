import type {
  ContentDatabaseItem,
  ContentDatabaseItemPayload,
  ContentDatabaseItemPropertyValue,
  DocumentProperty,
  DocumentPropertyDefinition,
} from "./api.js";

type ContentDatabaseRow = ContentDatabaseItem | ContentDatabaseItemPayload;

/**
 * Names each of a row's Properties by ID instead of repeating its definition.
 * The read that sends the row carries every definition once, in `properties`.
 */
export function compactContentDatabaseItem(
  item: ContentDatabaseRow,
): ContentDatabaseItemPayload {
  return {
    ...item,
    properties: item.properties.map((property) => {
      if (!hasDefinition(property)) return property;
      const { definition, ...value } = property;
      return { propertyId: definition.id, ...value };
    }),
  };
}

export function compactContentDatabaseItems(
  items: readonly ContentDatabaseRow[],
): ContentDatabaseItemPayload[] {
  return items.map(compactContentDatabaseItem);
}

/**
 * Attaches each row Property's definition from the read's `properties`, so
 * all rows share one definition object per Property. Rows that already carry
 * their definitions pass through, and a value whose Property the read does
 * not describe is left out rather than drawn without a type.
 */
export function hydrateContentDatabaseItems(
  items: readonly ContentDatabaseRow[],
  properties: readonly Pick<DocumentProperty, "definition">[],
): ContentDatabaseItem[] {
  let definitionById: Map<string, DocumentPropertyDefinition> | undefined;
  return items.map((item) => {
    if (item.properties.every(hasDefinition)) {
      return item as ContentDatabaseItem;
    }
    definitionById ??= new Map(
      properties.map((property) => [
        property.definition.id,
        property.definition,
      ]),
    );
    const definitions = definitionById;
    return {
      ...item,
      properties: item.properties.flatMap((property): DocumentProperty[] => {
        if (hasDefinition(property)) return [property];
        const { propertyId, ...value } = property;
        const definition = definitions.get(propertyId);
        return definition ? [{ definition, ...value }] : [];
      }),
    };
  });
}

type ContentDatabaseRowsRead = {
  items: readonly ContentDatabaseRow[];
  properties: readonly Pick<DocumentProperty, "definition">[];
  createdItem?: ContentDatabaseRow;
  duplicatedItems?: readonly ContentDatabaseRow[];
};

type HydratedContentDatabaseRowsRead<T> = Omit<
  T,
  "items" | "createdItem" | "duplicatedItems"
> & {
  items: ContentDatabaseItem[];
  createdItem?: ContentDatabaseItem;
  duplicatedItems?: ContentDatabaseItem[];
};

/** Attaches definitions to every row a Collection read or write returns. */
export function hydrateContentDatabaseResponse<
  T extends ContentDatabaseRowsRead,
>(response: T): HydratedContentDatabaseRowsRead<T> {
  const rows = [
    ...response.items,
    ...(response.createdItem ? [response.createdItem] : []),
    ...(response.duplicatedItems ?? []),
  ];
  if (!contentDatabaseRowsNeedDefinitions(rows)) {
    return response as HydratedContentDatabaseRowsRead<T>;
  }
  const hydrated: ContentDatabaseRowsRead = {
    ...response,
    items: hydrateContentDatabaseItems(response.items, response.properties),
  };
  if (response.createdItem) {
    hydrated.createdItem = hydrateContentDatabaseItems(
      [response.createdItem],
      response.properties,
    )[0];
  }
  if (response.duplicatedItems) {
    hydrated.duplicatedItems = hydrateContentDatabaseItems(
      response.duplicatedItems,
      response.properties,
    );
  }
  return hydrated as HydratedContentDatabaseRowsRead<T>;
}

/** Whether any of these rows still names its Properties by ID only. */
export function contentDatabaseRowsNeedDefinitions(
  items: readonly unknown[],
): boolean {
  return items.some((item) => {
    const properties = (item as { properties?: unknown } | null)?.properties;
    return (
      Array.isArray(properties) &&
      properties.some(
        (property) =>
          !!property &&
          typeof property === "object" &&
          !("definition" in property) &&
          "propertyId" in property,
      )
    );
  });
}

function hasDefinition(
  property: DocumentProperty | ContentDatabaseItemPropertyValue,
): property is DocumentProperty {
  return "definition" in property;
}
