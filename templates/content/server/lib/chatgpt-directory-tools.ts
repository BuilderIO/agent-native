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
    "query-content-database-items": {
      documentId: "documentId",
      limit: { type: "integerRange" as const, min: 1, max: 5_000 },
      tableQuery: { type: "actionSchema" as const },
    },
  },
  widgetReadPrivateActions: ["query-content-database-items"],
  keyToolNames: [
    "search-documents",
    "get-document",
    "create-document",
    "edit-document",
  ],
  instructions:
    "Agent-Native Content stores documents and collection records. Searches return bounded pages, and edits use revision guards. External CMS publishing, Notion editing, and workspace-content deletion are outside this plugin's capabilities.",
  // The action's own description points at patch-database-items, which this
  // profile does not expose.
  toolDescriptions: {
    "list-documents":
      "Lists one bounded page of access-scoped document metadata ordered by position. Full document bodies are omitted.",
    "search-documents":
      "Searches accessible documents by title and content or exact title, then returns relevance-ranked metadata and snippets with pagination.",
    "get-document":
      "Reads one access-scoped document by its stable ID, including the full Markdown body and metadata.",
    "create-document":
      "Creates a document in an authorized Content space from a title and optional Markdown body. The result contains the saved document ID and revision.",
    "edit-document":
      "Applies exact search-and-replace operations to a document revision or initializes an empty body. The operation requires the base revision and a unique idempotency key.",
    "list-content-databases":
      "Lists a bounded page of accessible ordinary Content collections with collection, document, and space IDs. Pagination is explicit; system collections can be included separately.",
    "get-content-database":
      "Reads an accessible collection's schema and a bounded page of rows, with collection and schema revision details.",
    "create-content-database":
      "Creates one ordinary Content collection in an authorized space with a default table and verified receipt.",
    "add-database-item":
      "Creates one row in an exact ordinary Content collection using its mutation target and schema revision. The operation validates supplied properties and returns a verified receipt.",
    "update-database-item":
      "Sparsely updates one exact Content collection row using its membership ID, page document ID, row revision, and schema revision. Omitted properties are preserved; supplied properties are validated and returned in a verified idempotent receipt.",
  },
  toolParameterDescriptions: {
    "create-content-database": {
      spaceId: "Existing Content space ID for the new collection.",
    },
  },
};
