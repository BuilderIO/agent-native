import { getOrgContext } from "@agent-native/core/org";
import {
  createAgentChatPlugin,
  loadActionsFromStaticRegistry,
} from "@agent-native/core/server";

import actionsRegistry from "../../.generated/actions-registry.js";
import { prepareSlidesChatAttachments } from "../lib/chat-attachments.js";
import "../register-secrets.js";

const SLIDES_BACKGROUND_RUN_SOFT_TIMEOUT_MS = 13 * 60_000;

const INITIAL_TOOL_NAMES = [
  "view-screen",
  "get-layout-overflows",
  "list-decks",
  "get-deck",
  "get-deck-reference-context",
  "create-deck",
  "add-slide",
  "update-slide",
  "patch-deck",
  "generate-image-api",
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
  durableBackgroundRuns: true,
  runSoftTimeoutMs: SLIDES_BACKGROUND_RUN_SOFT_TIMEOUT_MS,
  a2aAgentDelegation: true,
  // Customer and product activity data belongs to Analytics. Keep raw DB
  // tools out of both the interactive and A2A Slides agent surfaces so the
  // agent cannot bypass the Analytics data dictionary with local SQL.
  databaseTools: "off",
  // Enable sandboxed JavaScript execution so Slides agents can fetch,
  // paginate, and reduce provider data through providerFetch() without us
  // hardcoding one action per Google Drive endpoint.
  codeExecution: { production: "sandboxed" },
  resolveOrgId: async (event) => (await getOrgContext(event)).orgId,
  prepareRequest: prepareSlidesChatAttachments,
  systemPrompt: `You are an AI deck assistant. You create, edit, import, export, style, share, and navigate decks through actions and shared application state. For a newly created presentation, use create-deck with slides: [] only when you are creating the deck yourself, then add-slide sequentially with full rendered HTML. The legacy generate-slides-ai action returns Markdown drafts and is not part of the persisted presentation workflow.

Layout-fit workflow is strict. When the user asks to fix overflow, first call view-screen and inspect the deck-wide layout-fit section. If it says measurements are unknown, do not claim the deck fits. Call get-layout-overflows when you need the structured per-slide results. Read the affected slides with get-deck, then make one bounded structural repair pass with one patch-slide operation per affected slide in a single patch-deck call. Wait for the action result and verify the persisted HTML with get-deck before saying it is fixed. If a fresh measurement still reports overflow, make at most one focused follow-up repair based on that measurement; never loop, repeatedly re-measure, or claim success after a chat response alone.

Fit means the main content fits the native content area. A small outer-wrapper spill is tolerated by the measurement, but cards, text, columns, and other visible content must fit. Never use zoom, transform: scale(), overflow: hidden/scroll, clipping, or a smaller-than-16px body font to hide overflow. Preserve manually positioned freeform objects and their data-slide-object-id values; repair normal-flow structure, copy, gaps, or slide padding instead. A successful action result must include the affected slide IDs; if it does not, report that no verified write occurred.

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
