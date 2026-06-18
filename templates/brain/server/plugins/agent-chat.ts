import "../register-secrets.js";
import {
  createAgentChatPlugin,
  loadActionsFromStaticRegistry,
} from "@agent-native/core/server";
import { getOrgContext } from "@agent-native/core/org";
import { accessFilter } from "@agent-native/core/sharing";
import { and, desc, like, or } from "drizzle-orm";
import actionsRegistry from "../../.generated/actions-registry.js";
import { tryAnswerBrainA2AQuestion } from "../lib/a2a-fallback.js";

const INITIAL_TOOL_NAMES = [
  "get-brain-settings",
  "ask-brain",
  "search-knowledge",
  "search-everything",
  "get-knowledge",
  "list-knowledge",
  "import-capture",
  "import-transcript",
  "write-knowledge",
  "list-sources",
  "get-source",
  "create-source",
  "sync-source",
  "enqueue-distillation",
  "list-proposals",
  "approve-proposal",
  "review-proposal",
  "reject-proposal",
  "provider-api-catalog",
  "provider-api-docs",
  "provider-api-request",
  "query-staged-dataset",
];

export default createAgentChatPlugin({
  appId: "brain",
  actions: loadActionsFromStaticRegistry(actionsRegistry),
  initialToolNames: INITIAL_TOOL_NAMES,
  resolveOrgId: async (event) => (await getOrgContext(event)).orgId,
  codeExecution: { production: "sandboxed" },
  systemPrompt: `You are the Brain institutional-knowledge agent.

Use actions as the source of truth. Import raw material with import-capture or import-transcript, queue distillation with enqueue-distillation, and write durable knowledge with write-knowledge.

Important rules:
- Before answering, searching broadly, or distilling, call get-brain-settings when you do not already have current settings. Apply its guidance for assistant name, company name, tone, source policy, citation requirements, publish tier, pre-save capture sanitization, redaction, and distillation instructions.
- Evidence quotes must be exact substrings of a raw capture. Use get-capture with includeRawContent=true only when you need exact quote validation; normal capture reads are redacted by default.
- No vector database exists; search-knowledge uses SQL text matching.
- Source policy matters: strict means answer from reviewed knowledge only; balanced means raw captures are fallback context when reviewed knowledge is thin; exploratory means raw captures and sources may be surfaced as clearly labeled leads.
- Company-tier knowledge may create a proposal instead of publishing immediately, depending on settings.
- Slack and Granola sources are configurable v1 connectors. Generic transcript import is always available.
- Source/read actions are convenience readers, not provider capability limits. For ad hoc provider analysis that needs an endpoint, filter, payload, pagination mode, or API version not modeled by a Brain action, call provider-api-catalog/provider-api-docs, then provider-api-request against the provider's real HTTP API. Use connectionId for a specific shared grant and accountId for a specific OAuth account.
- For broad searches, joins, classification, source-corpus counts, or absence claims across provider records, fetch every relevant page or an explicitly bounded cohort, stage/save large responses with stageAs/saveToFile/fetchAllPages, then use query-staged-dataset or run-code to reduce the corpus. Report source, filters, row counts, pagination, truncation, and gaps.`,
  a2aMessageFallback: async ({ text }) => tryAnswerBrainA2AQuestion(text),
  mentionProviders: async () => {
    const { getDb, schema } = await import("../db/index.js");
    return {
      knowledge: {
        label: "Brain Knowledge",
        icon: "document",
        search: async (query: string) => {
          const db = getDb();
          const q = `%${query}%`;
          const rows = await db
            .select()
            .from(schema.brainKnowledge)
            .where(
              query
                ? and(
                    accessFilter(
                      schema.brainKnowledge,
                      schema.brainKnowledgeShares,
                    ),
                    or(
                      like(schema.brainKnowledge.title, q),
                      like(schema.brainKnowledge.summary, q),
                      like(schema.brainKnowledge.body, q),
                    ),
                  )
                : accessFilter(
                    schema.brainKnowledge,
                    schema.brainKnowledgeShares,
                  ),
            )
            .orderBy(desc(schema.brainKnowledge.updatedAt))
            .limit(10);
          return rows.map((row) => ({
            id: row.id,
            label: row.title,
            description: row.summary || row.topic || undefined,
            icon: "document" as const,
            refType: "brain-knowledge",
            refId: row.id,
          }));
        },
      },
      sources: {
        label: "Brain Sources",
        icon: "database",
        search: async (query: string) => {
          const db = getDb();
          const rows = await db
            .select()
            .from(schema.brainSources)
            .where(accessFilter(schema.brainSources, schema.brainSourceShares))
            .orderBy(desc(schema.brainSources.updatedAt))
            .limit(10);
          const normalized = query.trim().toLowerCase();
          return rows
            .filter((row) =>
              normalized ? row.title.toLowerCase().includes(normalized) : true,
            )
            .map((row) => ({
              id: row.id,
              label: row.title,
              description: row.provider,
              icon: "database" as const,
              refType: "brain-source",
              refId: row.id,
            }));
        },
      },
    };
  },
});
