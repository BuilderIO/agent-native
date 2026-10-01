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

export const CHATGPT_DIRECTORY_PROFILE = {
  connectorCatalog: CHATGPT_DIRECTORY_TOOL_NAMES,
  keyToolNames: [
    "search-documents",
    "get-document",
    "create-document",
    "edit-document",
    "query-content-database-items",
  ],
  instructions:
    "Draft and organize documents and collection records in the Agent-Native Content workspace. Search before creating duplicates, and use revision-guarded edits for existing content. This plugin does not publish to external CMSs, edit Notion, or delete workspace content.",
  toolDescriptions: {
    "update-database-item":
      "Update one Content collection row using itemId, documentId, and rowRevision from a fresh get-content-database read. Omitted properties stay unchanged.",
  },
  toolParameterDescriptions: {
    "create-content-database": {
      spaceId: "Existing Content space ID for the new collection.",
    },
  },
};
