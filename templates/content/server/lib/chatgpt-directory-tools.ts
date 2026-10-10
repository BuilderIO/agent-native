import {
  getRequestOrgId,
  getRequestUserEmail,
} from "@agent-native/core/server/request-context";
import { assertAccess, ForbiddenError } from "@agent-native/core/sharing";

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

type WidgetWriteAuthorizationInput = {
  toolName: string;
  args: Record<string, unknown>;
  result: unknown;
  target: { targetPath: string; resourceIds: Record<string, string> };
  identity: { userEmail?: string; orgId?: string | null };
};

export const CHATGPT_DIRECTORY_PROFILE = {
  connectorCatalog: CHATGPT_DIRECTORY_TOOL_NAMES,
  widgets: true,
  widgetDomain: "https://content.agent-native.com",
  widgetResourceTitle: false as const,
  authorizeWidgetWrite: async ({
    target,
    identity,
  }: WidgetWriteAuthorizationInput) => {
    const documentId = target.resourceIds.documentId;
    const requestEmail = getRequestUserEmail()?.trim().toLowerCase();
    const requestOrgId = getRequestOrgId() ?? undefined;
    if (
      !documentId ||
      !identity.userEmail ||
      requestEmail !== identity.userEmail.trim().toLowerCase() ||
      (identity.orgId !== undefined &&
        (identity.orgId ?? undefined) !== requestOrgId)
    ) {
      return false;
    }
    try {
      await assertAccess("document", documentId, "editor");
      return true;
    } catch (error) {
      if (error instanceof ForbiddenError) return false;
      throw error;
    }
  },
  widgetTargets: {
    "create-document": (_args: Record<string, unknown>, result: unknown) => {
      const documentId = id(record(result).id, record(result).documentId);
      const spaceId = id(record(result).spaceId);
      return documentId
        ? {
            targetPath: `/page/${encodeURIComponent(documentId)}`,
            resourceIds: {
              documentId,
              resourceType: "document",
              ...(spaceId ? { spaceId } : {}),
            },
            writeActions: [
              "update-document",
              "share-resource",
              "unshare-resource",
              "set-resource-visibility",
            ],
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
      const spaceId = id(database.spaceId, record(result).spaceId);
      return databaseId && documentId
        ? {
            targetPath: `/page/${encodeURIComponent(documentId)}`,
            resourceIds: {
              databaseId,
              documentId,
              databaseDocumentId: documentId,
              resourceType: "document",
              ...(spaceId ? { spaceId } : {}),
            },
            writeActions: ["add-database-item", "update-database-item"],
          }
        : null;
    },
  },
  widgetReadActionArguments: {
    "get-document": { id: "documentId" },
    "get-content-navigation-context": { id: "documentId" },
    "get-preview-document-draft": { documentId: "documentId" },
    "list-comments": { documentId: "documentId" },
    "list-resource-suggestions": {
      resourceType: "resourceType",
      resourceId: "documentId",
    },
    "list-resource-shares": {
      resourceType: "resourceType",
      resourceId: "documentId",
    },
    "get-content-database": {
      databaseId: "databaseId",
      documentId: "documentId",
      limit: { type: "integerRange" as const, min: 0, max: 5_000 },
    },
    "get-content-database-personal-view": { databaseId: "databaseId" },
    "query-content-database-items": {
      documentId: "documentId",
      limit: { type: "integerRange" as const, min: 1, max: 5_000 },
      tableQuery: { type: "actionSchema" as const },
    },
  },
  widgetWriteActionArguments: {
    "update-document": {
      id: "documentId",
      title: { type: "actionSchema" as const },
      icon: { type: "actionSchema" as const },
      content: { type: "actionSchema" as const },
      loadedUpdatedAt: { type: "actionSchema" as const },
      loadedContentWasEmpty: { type: "actionSchema" as const },
      baseUpdatedAt: { type: "actionSchema" as const },
      recoveryExpectedUpdatedAt: { type: "actionSchema" as const },
      baseRevision: { type: "actionSchema" as const },
      authoredBaseRevision: { type: "actionSchema" as const },
      authoredBaseContent: { type: "actionSchema" as const },
      authoredCandidateContent: { type: "actionSchema" as const },
      baseTitle: { type: "actionSchema" as const },
      historySessionId: { type: "actionSchema" as const },
      editorSessionId: { type: "actionSchema" as const },
      editorEditGeneration: { type: "actionSchema" as const },
      editorSnapshotTitle: { type: "actionSchema" as const },
      editorSnapshotContent: { type: "actionSchema" as const },
      browserSaveAttemptId: { type: "actionSchema" as const },
      preserveLeadingTitleHeading: { type: "actionSchema" as const },
    },
    "share-resource": {
      resourceType: "resourceType",
      resourceId: "documentId",
      principalType: { type: "actionSchema" as const },
      principalId: { type: "actionSchema" as const },
      role: { type: "actionSchema" as const },
      notify: { type: "actionSchema" as const },
      resourceUrl: { type: "actionSchema" as const },
      message: { type: "actionSchema" as const },
    },
    "unshare-resource": {
      resourceType: "resourceType",
      resourceId: "documentId",
      principalType: { type: "actionSchema" as const },
      principalId: { type: "actionSchema" as const },
    },
    "set-resource-visibility": {
      resourceType: "resourceType",
      resourceId: "documentId",
      visibility: { type: "actionSchema" as const },
    },
    "add-database-item": {
      target: {
        type: "actionSchemaResourceBound" as const,
        resourceKey: "databaseId",
      },
      expectedSchemaRevision: { type: "actionSchema" as const },
      idempotencyKey: { type: "actionSchema" as const },
      title: { type: "actionSchema" as const },
      propertyValues: { type: "actionSchema" as const },
      propertyEntries: { type: "actionSchema" as const },
    },
    "update-database-item": {
      target: {
        type: "actionSchemaResourceBound" as const,
        resourceKey: "databaseId",
      },
      expectedSchemaRevision: { type: "actionSchema" as const },
      idempotencyKey: { type: "actionSchema" as const },
      itemId: { type: "actionSchema" as const },
      documentId: { type: "actionSchema" as const },
      expectedRowRevision: { type: "actionSchema" as const },
      title: { type: "actionSchema" as const },
      propertyValues: { type: "actionSchema" as const },
      propertyEntries: { type: "actionSchema" as const },
    },
  },
  widgetReadOnlyActions: [
    "get-content-database-personal-view",
    "list-comments",
  ],
  widgetReadAuthenticatedActions: [
    "get-content-database-personal-view",
    "list-comments",
    "list-resource-shares",
    "list-resource-suggestions",
  ],
  // The collaborator list goes only to a ticket that can share the document;
  // a read-only or database ticket never lists who has access.
  widgetReadActionWriteGates: { "list-resource-shares": "share-resource" },
  widgetReadPrivateActions: [
    "get-content-navigation-context",
    "get-preview-document-draft",
    "query-content-database-items",
  ],
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
