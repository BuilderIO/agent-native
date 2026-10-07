export const CHATGPT_DIRECTORY_TOOL_NAMES = [
  "list-documents",
  "search-documents",
  "get-document",
  "create-document",
  "edit-document",
  "list-content-databases",
  "get-content-database",
  "create-content-database",
  "add-database-item",
  "update-database-item",
];

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function id(...values: unknown[]): string | null {
  return (
    values.find(
      (value): value is string =>
        typeof value === "string" && Boolean(value.trim()),
    ) ?? null
  );
}

export const CHATGPT_DIRECTORY_PROFILE = {
  connectorCatalog: CHATGPT_DIRECTORY_TOOL_NAMES,
  widgets: true,
  widgetDomain: "https://content.agent-native.com",
  widgetTargets: {
    "create-document": (_args: Record<string, unknown>, result: unknown) => {
      const documentId = id(record(result).id, record(result).documentId);
      return documentId
        ? {
            targetPath: `/page/${encodeURIComponent(documentId)}`,
            resourceIds: { documentId },
          }
        : null;
    },
    "create-content-database": (
      _args: Record<string, unknown>,
      result: unknown,
    ) => {
      const database = record(record(result).database);
      const databaseId = id(database.id);
      const documentId = id(database.documentId);
      return databaseId && documentId
        ? {
            targetPath: `/page/${encodeURIComponent(documentId)}`,
            resourceIds: { databaseId, documentId },
          }
        : null;
    },
  },
  widgetReadActionArguments: {
    "get-document": { id: "documentId" },
    "get-content-database": {
      databaseId: "databaseId",
      documentId: "documentId",
      limit: { type: "integerRange" as const, min: 0, max: 5_000 },
    },
  },
  keyToolNames: [
    "search-documents",
    "get-document",
    "create-document",
    "edit-document",
  ],
  instructions:
    "Draft and organize documents and collection records in the Agent-Native Content workspace. Search before creating duplicates, and use revision-guarded edits for existing content. This plugin does not publish to external CMSs, edit Notion, or delete workspace content.",
  // The action's own description points at patch-database-items, which this
  // profile does not expose.
  toolDescriptions: {
    "update-database-item":
      "Sparsely update one exact Content collection row using identifiers and revisions copied from a fresh get-content-database read: item.id is the membership itemId, document.id is the distinct page documentId, and rowRevision is expectedRowRevision. Requires the fresh schema revision, preserves omitted properties, validates every provided non-Blocks property, and returns a verified idempotent receipt.",
  },
  toolParameterDescriptions: {
    "create-content-database": {
      spaceId: "Existing Content space ID for the new collection.",
    },
  },
};
