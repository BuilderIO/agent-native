import { defineAction } from "@agent-native/core";
import { z } from "zod";
import {
  getOrgSetting,
  getUserSetting,
  putOrgSetting,
  putUserSetting,
} from "@agent-native/core/settings";

const KEY_PREFIX = "adhoc-analysis-";

function resolveScope() {
  const orgId = process.env.AGENT_ORG_ID || null;
  const email = process.env.AGENT_USER_EMAIL || "local@localhost";
  return { orgId, email };
}

export default defineAction({
  description:
    "Save an ad-hoc analysis. Stores the analysis question, instructions for re-running, data sources used, and the results. " +
    "This creates a reusable analysis that anyone can re-run later to get updated results. " +
    "Call this after you've gathered all the data and formed your conclusions.",
  schema: z.object({
    id: z
      .string()
      .describe(
        "URL-safe ID for the analysis (lowercase, hyphens, no spaces). e.g. 'closed-lost-q1-2026'",
      ),
    name: z.string().describe("Human-readable title for the analysis"),
    description: z
      .string()
      .describe(
        "Brief description of what this analysis investigates (1-2 sentences)",
      ),
    question: z
      .string()
      .describe(
        "The original question or prompt that triggered this analysis. Stored so re-runs use the same framing.",
      ),
    instructions: z
      .string()
      .describe(
        "Step-by-step instructions the agent should follow to reproduce this analysis with fresh data. " +
          "Be specific: which actions to call, which data sources to query, what filters to apply, how to structure the output. " +
          "These instructions are sent verbatim to the agent on re-run.",
      ),
    dataSources: z
      .array(z.string())
      .describe(
        "List of data sources used (e.g. ['bigquery', 'hubspot', 'gong', 'slack'])",
      ),
    resultMarkdown: z
      .string()
      .describe(
        "The full analysis results formatted as Markdown. Include tables, key findings, and conclusions. " +
          "This is what users see when they load the analysis.",
      ),
    resultData: z
      .record(z.unknown())
      .optional()
      .describe(
        "Optional structured data (JSON) backing the analysis — raw query results, metrics, etc. " +
          "Useful for rendering charts or tables in the UI.",
      ),
  }),
  http: false,
  run: async (args) => {
    const { orgId, email } = resolveScope();
    const key = `${KEY_PREFIX}${args.id}`;
    const now = new Date().toISOString();

    // Check if this analysis already exists (to preserve createdAt). Always
    // look in a scoped key (org or user) — never in the global settings
    // table, so one user's analyses can't bleed across tenants.
    let existing: Record<string, unknown> | null = null;
    try {
      existing = orgId
        ? await getOrgSetting(orgId, key)
        : await getUserSetting(email, key);
    } catch {
      // Not found
    }

    const analysis = {
      id: args.id,
      name: args.name,
      description: args.description,
      question: args.question,
      instructions: args.instructions,
      dataSources: args.dataSources,
      resultMarkdown: args.resultMarkdown,
      resultData: args.resultData ?? null,
      createdAt: (existing as any)?.createdAt ?? now,
      updatedAt: now,
      author: email,
    };

    // Always write to a scoped key (org or user). Local-mode analyses go
    // under `u:local@localhost:adhoc-analysis-*` so the existing
    // migrateLocalUserData flow renames them to the real account on sign-in.
    if (orgId) {
      await putOrgSetting(orgId, key, analysis);
    } else {
      await putUserSetting(email, key, analysis);
    }

    return `Analysis "${args.name}" saved as ${args.id}. Users can view it at /analyses/${args.id} and re-run it anytime for fresh results.`;
  },
});
