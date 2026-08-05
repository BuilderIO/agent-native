import "../register-secrets.js";
import { getOrgContext } from "@agent-native/core/org";
import {
  createAgentChatPlugin,
  loadActionsFromStaticRegistry,
} from "@agent-native/core/server";
import { accessFilter } from "@agent-native/core/sharing";
import { and, desc, like, or } from "drizzle-orm";

import actionsRegistry from "../../.generated/actions-registry.js";
import { tryAnswerBrainA2AQuestion } from "../lib/a2a-fallback.js";
import { brainFinalResponseGuard } from "../lib/brain-response-guard.js";

const BRAIN_BACKGROUND_RUN_SOFT_TIMEOUT_MS = 13 * 60_000;

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
  "list-connection-providers",
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
  finalResponseGuard: brainFinalResponseGuard,
  durableBackgroundRuns: true,
  runSoftTimeoutMs: BRAIN_BACKGROUND_RUN_SOFT_TIMEOUT_MS,
  resolveOrgId: async (event) => (await getOrgContext(event)).orgId,
  codeExecution: { production: "sandboxed" },
  systemPrompt: `You are the Brain institutional-knowledge agent.

Use actions as the source of truth. Import raw material with import-capture or import-transcript, which queue distillation by default, use enqueue-distillation to retry or explicitly queue an existing capture, and write durable knowledge with write-knowledge.

Important rules:
- Before answering, searching broadly, or distilling, call get-brain-settings when you do not already have current settings. Apply its guidance for assistant name, company name, tone, source policy, citation requirements, publish tier, pre-save capture sanitization, redaction, and distillation instructions.
- For every company-specific factual question, call get-brain-settings when current settings are not already in context, then call ask-brain before answering. Use only its cited Brain evidence. If it returns no citations, say the fact is unverified or unavailable; never fill the gap from general model knowledge.
- Evidence quotes must be exact substrings of a raw capture. Use get-capture with includeRawContent=true only when you need exact quote validation; normal capture reads are redacted by default.
- No vector database exists; search-knowledge uses SQL text matching.
- Source policy matters: strict means answer from reviewed knowledge only; balanced means raw captures are fallback context when reviewed knowledge is thin; exploratory means raw captures and sources may be surfaced as clearly labeled leads.
- Source answer policy is enforced separately from the workspace retrieval mode. For approved FAQs, docs, or other source-owner-published resources, create a generic source with policy.trustTier=blessed and choose answer eligibility, authority, freshness, review, and conflict behavior deliberately. Prefer blessed, higher-authority eligible sources in cited answers; never answer from stale or answer-ineligible sources.
- Company-tier knowledge may create a proposal instead of publishing immediately, depending on settings.
- Slack and Granola sources are configurable v1 connectors. Generic capture and transcript import are always available.
- Source/read actions are convenience readers, not provider capability limits. Before any provider API request, call list-connection-providers and inspect the matching provider. If configured is not true, do not attempt the request; explain that the connection needs setup or repair and include setupLink. Jira is queried on demand through the provider API rather than indexed as a Brain source. For ad hoc provider analysis that needs an endpoint, filter, payload, pagination mode, or API version not modeled by a Brain action, call provider-api-catalog/provider-api-docs, then provider-api-request against the provider's real HTTP API. Use connectionId for a specific shared grant and accountId for a specific OAuth account.
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
