import {
  createAgentChatPlugin,
  loadActionsFromStaticRegistry,
} from "@agent-native/core/server";
import actionsRegistry from "../../.generated/actions-registry.js";
import { getOrgContext } from "@agent-native/core/org";
import { prepareSlidesChatAttachments } from "../lib/chat-attachments.js";
import "../register-secrets.js";

const INITIAL_TOOL_NAMES = [
  "view-screen",
  "list-decks",
  "get-deck",
  "create-deck",
  "add-slide",
  "update-slide",
  "patch-deck",
  "generate-slides-ai",
  "import-file",
  "import-google-doc",
  "import-pptx",
  "export-pptx",
  "navigate",
  "provider-api-catalog",
  "provider-api-docs",
  "provider-api-request",
];

export default createAgentChatPlugin({
  appId: "slides",
  actions: loadActionsFromStaticRegistry(actionsRegistry),
  initialToolNames: INITIAL_TOOL_NAMES,
  runSoftTimeoutMs: 240_000,
  // Enable sandboxed JavaScript execution so Slides agents can fetch,
  // paginate, and reduce provider data through providerFetch() without us
  // hardcoding one action per Google Drive endpoint.
  codeExecution: { production: "sandboxed" },
  resolveOrgId: async (event) => (await getOrgContext(event)).orgId,
  prepareRequest: prepareSlidesChatAttachments,
  systemPrompt: `You are an AI deck assistant. You create, edit, import, export, style, share, and navigate decks through actions and shared application state.

Provider-specific Slides actions are shortcuts, not limits. If a first-class action cannot express the exact Google Drive endpoint, file metadata field, export format, query, request body, pagination mode, payload shape, or API version needed, call provider-api-catalog and provider-api-docs as needed, then call provider-api-request against the real provider API. Use the raw provider API escape hatch instead of weakening the answer or claiming Slides cannot do something the underlying Google Drive API can do.

Slides' Google Drive provider API uses the user's connected Google Docs OAuth account. The drive.file scope is intentionally limited to files the user selected or the app created. For large Drive file lists or metadata sweeps, pass stageAs and pagination options to provider-api-request, then use query-staged-dataset to count, filter, group, or project the staged rows.`,
  mentionProviders: async () => {
    const { getDb } = await import("../db/index.js");
    const { decks, deckShares } = await import("../db/schema.js");
    const { like, desc, and } = await import("drizzle-orm");
    const { accessFilter } = await import("@agent-native/core/sharing");
    return {
      decks: {
        label: "Decks",
        icon: "deck",
        search: async (query: string) => {
          const db = getDb();
          const access = accessFilter(decks, deckShares);
          const rows = query
            ? await db
                .select()
                .from(decks)
                .where(and(access, like(decks.title, `%${query}%`)))
                .limit(15)
            : await db
                .select()
                .from(decks)
                .where(access)
                .orderBy(desc(decks.updatedAt))
                .limit(15);
          return rows.map((deck) => ({
            id: deck.id,
            label: deck.title,
            icon: "deck" as const,
            refType: "deck",
            refId: deck.id,
          }));
        },
      },
    };
  },
});
