import { defineAction } from "@agent-native/core";
import {
  getRequestUserEmail,
  getRequestOrgId,
} from "@agent-native/core/server";
import { z } from "zod";
import { upsertAnalysis } from "../server/lib/dashboards-store";

function resolveScope() {
  const orgId = getRequestOrgId() || null;
  const email = getRequestUserEmail() || "local@localhost";
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
    await upsertAnalysis(
      args.id,
      {
        name: args.name,
        description: args.description,
        question: args.question,
        instructions: args.instructions,
        dataSources: args.dataSources,
        resultMarkdown: args.resultMarkdown,
        resultData: args.resultData ?? null,
      },
      { email, orgId },
    );
    return `Analysis "${args.name}" saved as ${args.id}. Users can view it at /analyses/${args.id} and re-run it anytime for fresh results.`;
  },
});
