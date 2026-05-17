import { AgentActionStopError, defineAction } from "@agent-native/core";
import {
  getRequestRunContext,
  getRequestUserEmail,
  getRequestOrgId,
  buildDeepLink,
} from "@agent-native/core/server";
import { z } from "zod";
import { upsertAnalysis } from "../server/lib/dashboards-store";
import { hasDataQueryAttempt } from "../server/lib/real-data-actions";

function parseJsonArg(value: unknown, label: string): unknown {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    throw new Error(`--${label} must be valid JSON`);
  }
}

function resolveScope() {
  const orgId = getRequestOrgId() || null;
  const email = getRequestUserEmail();
  if (!email) throw new Error("no authenticated user");
  return { orgId, email };
}

function hasStructuredEvidence(
  value: unknown,
): value is Record<string, unknown> {
  return !!value && typeof value === "object" && Object.keys(value).length > 0;
}

function stopWithoutEvidence(): never {
  throw new AgentActionStopError(
    "I couldn't save this analysis because it did not include structured evidence from a real data-source action in this turn. Evidence can be table rows, call/message records, transcript excerpts, coded themes, sentiment labels, or provider error details. I stopped rather than risk saving fabricated analytics results.",
    {
      errorCode: "analysis_missing_data_evidence",
      toolResult: JSON.stringify(
        {
          error: "analysis_missing_data_evidence",
          message:
            "save-analysis requires resultData with raw query results, row samples, aggregate metrics, call/message IDs, transcript/message excerpts, coded theme counts, sentiment labels, or explicit provider error details from real data-source actions.",
          stopped: true,
        },
        null,
        2,
      ),
    },
  );
}

export default defineAction({
  description:
    "Save an ad-hoc analysis. Stores the analysis question, instructions for re-running, data sources used, and the results. " +
    "This creates a reusable analysis that anyone can re-run later to get updated results. " +
    "Call this only after you've gathered real evidence and include non-empty resultData with structured evidence from those data-source action results. For qualitative analyses, resultData may include call/message IDs, transcript excerpts, coded themes, mention counts, and sentiment labels derived from actual source records.",
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
      .preprocess((v) => parseJsonArg(v, "dataSources"), z.array(z.string()))
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
      .preprocess(
        (v) => parseJsonArg(v, "resultData"),
        z.record(z.string(), z.unknown()),
      )
      .describe(
        "Required structured data (JSON) backing the analysis. Include raw query results, row samples, aggregate metrics, call/message IDs, transcript/message excerpts, coded theme counts, sentiment labels, and any explicit provider error details from the real data-source actions used.",
      ),
  }),
  http: false,
  run: async (args) => {
    const runCtx = getRequestRunContext();
    if (
      !args.dataSources.length ||
      !hasStructuredEvidence(args.resultData) ||
      (runCtx && !hasDataQueryAttempt(runCtx.toolResults))
    ) {
      stopWithoutEvidence();
    }
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
        resultData: args.resultData,
      },
      { email, orgId },
    );
    return {
      id: args.id,
      analysisId: args.id,
      name: args.name,
      urlPath: `/analyses/${args.id}`,
      deepLink: buildDeepLink({
        app: "analytics",
        view: "analyses",
        params: { analysisId: args.id },
      }),
      message: `Analysis "${args.name}" saved as ${args.id}. Users can view it at /analyses/${args.id} and re-run it anytime for fresh results.`,
    };
  },
  link: ({ result }) => {
    const id =
      result && typeof result === "object"
        ? ((result as { analysisId?: string; id?: string }).analysisId ??
          (result as { id?: string }).id)
        : undefined;
    if (!id) return null;
    return {
      url: buildDeepLink({
        app: "analytics",
        view: "analyses",
        params: { analysisId: id },
      }),
      label: "Open analysis in Analytics",
      view: "analyses",
    };
  },
});
