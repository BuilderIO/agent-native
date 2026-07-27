import { getOrgContext } from "@agent-native/core/org";
import {
  createAgentChatPlugin,
  loadActionsFromStaticRegistry,
} from "@agent-native/core/server";

import actionsRegistry from "../../.generated/actions-registry.js";
import {
  publicDocumentExtraContext,
  resolvePublicViewerOwner,
} from "../lib/public-documents.js";

const INITIAL_TOOL_NAMES = [
  "view-screen",
  "list-documents",
  "search-documents",
  "get-document",
  "create-document",
  "edit-document",
  "update-document",
  "add-comment",
  "list-comments",
  "refresh-list",
  "navigate",
  "connect-notion-status",
  "provider-api-catalog",
  "provider-api-docs",
  "provider-api-request",
  "query-staged-dataset",
];

export default createAgentChatPlugin({
  appId: "content",
  actions: loadActionsFromStaticRegistry(actionsRegistry),
  initialToolNames: INITIAL_TOOL_NAMES,
  anonymousOwner: resolvePublicViewerOwner,
  extraContext: publicDocumentExtraContext,
  // Enable sandboxed JavaScript execution so Content agents can fetch,
  // paginate, and reduce provider data through providerFetch() without us
  // hardcoding one action per Notion endpoint.
  codeExecution: { production: "sandboxed" },
  resolveOrgId: async (event) => (await getOrgContext(event)).orgId,
  systemPrompt: `You are an AI document assistant. You manage documents, comments, media blocks, sharing, and connected Notion content through actions and shared application state.

Some less-common tool schemas are loaded on demand. Use tool-search with a specific query when you need a capability that is not already available as a direct tool.

Provider-specific Content actions are shortcuts, not limits. If a first-class action cannot express the exact Notion endpoint, page/database/comment object, filter, request body, pagination mode, markdown endpoint, payload shape, or API version needed, call provider-api-catalog and provider-api-docs as needed, then call provider-api-request against the real Notion API. Use the raw provider API escape hatch instead of weakening the answer, broadening filters, or claiming Content cannot do something the underlying Notion API can do.

Content's Notion access is per-user OAuth only. Never ask for or use NOTION_API_KEY. provider-api-request resolves Notion auth from the user's connected Notion OAuth account. For large Notion searches or database queries, pass stageAs and pagination options to provider-api-request, then use query-staged-dataset to count, filter, group, or project the staged rows.`,
  mentionProviders: async () => {
    const { getDb } = await import("../db/index.js");
    const { documents } = await import("../db/schema.js");
    const { and, desc, eq, like } = await import("drizzle-orm");
    const { getCurrentOwnerEmail } = await import("../lib/documents.js");
    return {
      documents: {
        label: "Documents",
        icon: "document",
        search: async (query: string) => {
          const db = getDb();
          const ownerEmail = getCurrentOwnerEmail();
          const rows = query
            ? await db
                .select()
                .from(documents)
                .where(
                  and(
                    eq(documents.ownerEmail, ownerEmail),
                    like(documents.title, `%${query}%`),
                  ),
                )
                .limit(15)
            : await db
                .select()
                .from(documents)
                .where(eq(documents.ownerEmail, ownerEmail))
                .orderBy(desc(documents.updatedAt))
                .limit(15);
          return rows.map((doc) => ({
            id: doc.id,
            label: doc.title,
            description: doc.parentId ? "Sub-page" : undefined,
            icon: "document" as const,
            refType: "document",
            refId: doc.id,
          }));
        },
      },
    };
  },
});
