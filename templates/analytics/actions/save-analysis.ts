import {
  AgentActionStopError,
  defineAction,
  embedApp,
} from "@agent-native/core";
import {
  getRequestRunContext,
  getRequestUserEmail,
  getRequestOrgId,
  buildDeepLink,
} from "@agent-native/core/server";
import { z } from "zod";

import { upsertAnalysis } from "../server/lib/dashboards-store";
import { hasDataQueryAttempt } from "../server/lib/real-data-actions";

const MAX_RESULT_MARKDOWN_CHARS = 60_000;
const MAX_RESULT_DATA_JSON_CHARS = 80_000;

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

function stopOversizedAnalysisPayload(
  field: "resultMarkdown" | "resultData",
  size: number,
  limit: number,
): never {
  throw new AgentActionStopError(
    `I couldn't save this analysis because ${field} was too large (${size.toLocaleString()} characters, max ${limit.toLocaleString()}). Answer in chat, or save a compact artifact with IDs, metrics, coded themes, and short excerpts instead of raw transcript/tool-result dumps.`,
    {
      errorCode: "analysis_payload_too_large",
      toolResult: JSON.stringify(
        {
          error: "analysis_payload_too_large",
          field,
          size,
          limit,
          message:
            "save-analysis accepts compact evidence only. Do not include full Gong transcripts, full tool outputs, or bulk raw provider payloads in resultMarkdown/resultData.",
          stopped: true,
        },
        null,
        2,
      ),
    },
  );
}

function assertCompactAnalysisPayload(args: {
  resultMarkdown: string;
  resultData?: Record<string, unknown>;
}) {
  if (args.resultMarkdown.length > MAX_RESULT_MARKDOWN_CHARS) {
    stopOversizedAnalysisPayload(
      "resultMarkdown",
      args.resultMarkdown.length,
      MAX_RESULT_MARKDOWN_CHARS,
    );
  }

  let resultDataJson: string;
  try {
    resultDataJson = JSON.stringify(args.resultData);
  } catch {
    resultDataJson = "";
  }
  if (resultDataJson.length > MAX_RESULT_DATA_JSON_CHARS) {
    stopOversizedAnalysisPayload(
      "resultData",
      resultDataJson.length,
      MAX_RESULT_DATA_JSON_CHARS,
    );
  }
}

export default defineAction({
  description:
    "Save an ad-hoc analysis as a reusable artifact. Do not call this for ordinary in-chat analysis or deep-dive answers unless the user explicitly asks to save/create a reusable analysis, or this turn is re-running an existing saved analysis. Stores the analysis question, instructions for re-running, data sources used, and compact results. " +
    "This creates a reusable analysis that anyone can re-run later to get updated results. " +
    "Saved analyses appear in the Analyses sidebar, so do not use this as scratch storage, as a transient summary, or as a duplicate companion artifact when creating a dashboard or extension unless the user explicitly asked for a saved analysis too. " +
    "Call this only after you've gathered real evidence and include non-empty, compact resultData with structured evidence from those data-source action results. For qualitative analyses, resultData may include call/message IDs, short transcript excerpts, coded themes, mention counts, and sentiment labels derived from actual source records. Never include full Gong transcripts, full tool outputs, or bulk raw provider payloads.",
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
      .max(
        MAX_RESULT_MARKDOWN_CHARS,
        `resultMarkdown must be ${MAX_RESULT_MARKDOWN_CHARS} characters or fewer`,
      )
      .describe(
        "The full analysis results formatted as Markdown. Include tables, key findings, and conclusions. " +
          "This is what users see when they load the analysis. Keep it under 60000 characters and do not paste raw transcripts or full tool outputs.",
      ),
    resultData: z
      .preprocess(
        (v) => parseJsonArg(v, "resultData"),
        z.record(z.string(), z.unknown()),
      )
      .describe(
        "Required compact structured data (JSON) backing the analysis. Include row samples, aggregate metrics, call/message IDs, short transcript/message excerpts, coded theme counts, sentiment labels, and explicit provider error details from the real data-source actions used. Do not include full transcripts, full tool outputs, or raw provider payload dumps.",
      ),
  }),
  http: false,
  mcpApp: {
    compactCatalog: true,
    resource: embedApp({
      title: "Saved analysis",
      description: "Open the saved analysis in the real Analytics UI.",
      iframeTitle: "Agent-Native Analytics",
      openLabel: "Open analysis",
      height: 680,
    }),
  },
  run: async (args) => {
    const runCtx = getRequestRunContext();
    if (
      !args.dataSources.length ||
      !hasStructuredEvidence(args.resultData) ||
      (runCtx && !hasDataQueryAttempt(runCtx.toolResults))
    ) {
      stopWithoutEvidence();
    }
    assertCompactAnalysisPayload(args);
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
      description: args.description,
      resultMarkdown: args.resultMarkdown,
      resultData: args.resultData,
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
