import { getOrgContext } from "@agent-native/core/org";
import {
  createAgentChatPlugin,
  loadActionsFromStaticRegistry,
} from "@agent-native/core/server";
import { assertAccess } from "@agent-native/core/sharing";
import { and, desc, eq } from "drizzle-orm";

import actionsRegistry from "../../.generated/actions-registry.js";
import { A2A_RECEIVER_OWNERSHIP_FLAG } from "../../shared/feature-flags.js";
import {
  publicDocumentExtraContext,
  resolvePublicViewerOwner,
} from "../lib/public-documents.js";

// These tools are injected by the framework/provider layer, so they cannot
// declare `deferLoading` beside a Content action. Content-owned starter tools
// carry `deferLoading: false` in their own definitions.
const INJECTED_INITIAL_TOOL_NAMES = [
  "provider-api-catalog",
  "provider-api-docs",
  "provider-api-request",
  "query-staged-dataset",
];

const DOCUMENT_EDIT_TOOLS = new Set([
  "create-document",
  "delete-document",
  "edit-document",
  "restore-document-version",
  "update-document",
]);

function hasDocumentEdit(run: { events: readonly unknown[] }): boolean {
  return run.events.some((entry) => {
    if (!entry || typeof entry !== "object") return false;
    const event = (entry as { event?: unknown }).event;
    if (!event || typeof event !== "object") return false;
    const record = event as Record<string, unknown>;
    return (
      record.type === "tool_done" &&
      record.completedSideEffect === true &&
      record.isError !== true &&
      typeof record.tool === "string" &&
      DOCUMENT_EDIT_TOOLS.has(record.tool)
    );
  });
}

async function autosaveDocumentAfterAgentTurn(
  scope: { type: string; id: string },
  run: { events: readonly unknown[] },
): Promise<void> {
  if (scope.type !== "document" || !hasDocumentEdit(run)) return;

  const access = await assertAccess("document", scope.id, "editor");
  const document = access.resource as {
    ownerEmail: string;
    title: string;
    content: string;
  };
  const { getDb, schema } = await import("../db/index.js");
  const db = getDb();
  const [latest] = await db
    .select({
      title: schema.documentVersions.title,
      content: schema.documentVersions.content,
    })
    .from(schema.documentVersions)
    .where(
      and(
        eq(schema.documentVersions.documentId, scope.id),
        eq(schema.documentVersions.ownerEmail, document.ownerEmail),
      ),
    )
    .orderBy(desc(schema.documentVersions.createdAt))
    .limit(1);
  if (latest?.title === document.title && latest.content === document.content) {
    return;
  }

  await db.insert(schema.documentVersions).values({
    id: crypto.randomUUID(),
    ownerEmail: document.ownerEmail,
    documentId: scope.id,
    title: document.title,
    content: document.content,
    createdAt: new Date().toISOString(),
  });
}

export default createAgentChatPlugin({
  appId: "content",
  onAgentTurnComplete: autosaveDocumentAfterAgentTurn,
  durableBackgroundRuns: true,
  a2aReceiverOwnershipFlag: A2A_RECEIVER_OWNERSHIP_FLAG,
  actions: loadActionsFromStaticRegistry(actionsRegistry),
  initialToolNames: INJECTED_INITIAL_TOOL_NAMES,
  mcp: {
    externalAgents: { writes: "allowlisted" },
  },
  anonymousOwner: resolvePublicViewerOwner,
  extraContext: publicDocumentExtraContext,
  // Enable sandboxed JavaScript execution so Content agents can fetch,
  // paginate, and reduce provider data through providerFetch() without us
  // hardcoding one action per Notion endpoint.
  codeExecution: { production: "sandboxed" },
  resolveOrgId: async (event) => (await getOrgContext(event)).orgId,
  systemPrompt: `You are an AI document assistant. You manage documents, comments, media blocks, sharing, and connected Notion content through actions and shared application state.

The current screen is already included as bounded context on every message. Do not call view-screen at the start of a turn or repeatedly; call it only when that context is stale. Its document body is a preview, so call get-document when the full page content is required.

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
          // Project only id/title/parentId — documents.content is the full
          // page body and must not be pulled into this per-keystroke search.
          const mentionColumns = {
            id: documents.id,
            title: documents.title,
            parentId: documents.parentId,
          };
          const rows = query
            ? await db
                .select(mentionColumns)
                .from(documents)
                .where(
                  and(
                    eq(documents.ownerEmail, ownerEmail),
                    like(documents.title, `%${query}%`),
                  ),
                )
                .limit(15)
            : await db
                .select(mentionColumns)
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
