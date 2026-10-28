import { defineAction } from "@agent-native/core/action";
import { callMcpTool } from "@agent-native/core/mcp-client";
import { z } from "zod";

import {
  GONG_MCP_PROVIDER_ID,
  GONG_NATIVE_OPERATIONS,
  gongNativeOperationName,
  listGongNativeTools,
  selectGongNativeTool,
} from "../server/lib/gong-native-operations";
import { readGongNativeInsightsPolicy } from "../server/lib/gong-native-policy";

function isMcpToolError(result: unknown): boolean {
  return (
    typeof result === "object" &&
    result !== null &&
    (result as { isError?: unknown }).isError === true
  );
}

function mcpToolErrorText(result: unknown): string {
  const content = (result as { content?: unknown }).content;
  const text = Array.isArray(content)
    ? content
        .map((part) => (typeof part?.text === "string" ? part.text : undefined))
        .filter(Boolean)
        .join(" ")
    : "";
  return text || "Gong returned an error result with no message.";
}

export default defineAction({
  description:
    "First choice for a question about a Gong account, deal, customer, or topic (what they said, risks, objections, next steps, call prep). One call to Gong's MCP searches the calls server-side and answers in seconds; do not page /calls or /calls/extensive to answer a question. Each call consumes one Gong credit request, so combine related sub-questions. Call gong-native-insights for operation schemas. Use gong-calls or the provider corpus path for verbatim quotes, exact counts, or absence proof. Owners can disable it with configure-gong-native-insights.",
  schema: z.object({
    operation: z
      .enum(GONG_NATIVE_OPERATIONS)
      .describe(
        "Official Gong MCP operation. Use gong-native-insights to list the connected operation schemas.",
      ),
    allowCreditRequest: z
      .boolean()
      .default(true)
      .describe(
        "Set false to preview the request without sending it or spending a Gong credit request.",
      ),
    arguments: z
      .record(z.string(), z.unknown())
      .default({})
      .describe(
        "Arguments passed unchanged to the connected Gong MCP operation. Consolidate related questions into one request and narrow the entity/date scope.",
      ),
  }),
  parallelSafe: true,
  mcpTool: true,
  publicAgent: { expose: true, readOnly: false, requiresAuth: true },
  http: false,
  grounding: true,
  run: async ({ operation, allowCreditRequest, arguments: args }, context) => {
    const tools = await listGongNativeTools();

    if (allowCreditRequest === false) {
      return {
        connected: tools.length > 0,
        operation,
        blocked: true,
        creditRequests: 0,
        creditUnit: "request",
        evidenceMode: "provider-synthesis",
        rawEvidenceAvailable: false,
        evidenceFallbackAction: "gong-calls",
        guidance:
          "This Gong semantic request was not sent because allowCreditRequest=false. Send it with allowCreditRequest=true (the default), or use gong-calls for evidence retrieval without Gong AI synthesis.",
      };
    }

    const policy = await readGongNativeInsightsPolicy();
    if (!policy.enabled) {
      return {
        connected: tools.length > 0,
        operation,
        blocked: true,
        blockedBy: "workspace-policy",
        policy,
        creditRequests: 0,
        creditUnit: "request",
        evidenceMode: "provider-synthesis",
        rawEvidenceAvailable: false,
        evidenceFallbackAction: "gong-calls",
        guidance:
          "This Gong semantic request was not sent because a workspace owner turned native insights off. They can turn it back on with configure-gong-native-insights; use gong-calls for evidence retrieval in the meantime.",
      };
    }

    const tool = selectGongNativeTool(tools, operation);
    if (!tool) {
      return {
        connected: tools.length > 0,
        operation,
        creditRequests: 0,
        creditUnit: "request",
        evidenceMode: "provider-synthesis",
        rawEvidenceAvailable: false,
        error:
          tools.length === 0
            ? "No official Gong semantic MCP operations are connected in this request scope."
            : `The ${operation} operation is missing or ambiguous across connected Gong MCP servers.`,
        availableOperations: tools.map((candidate) => ({
          operation: gongNativeOperationName(candidate.name),
          serverId: candidate.serverId,
        })),
        evidenceFallbackAction: "gong-calls",
      };
    }

    const startedAt = Date.now();
    const result = await callMcpTool(tool.serverId, tool.name, args, {
      providerId: GONG_MCP_PROVIDER_ID,
      context,
    });
    // callMcpTool resolves with isError instead of throwing; an error is not a
    // synthesis, and the request was still sent, so it stays counted.
    if (isMcpToolError(result)) {
      return {
        connected: true,
        source: "gong-native-mcp",
        operation,
        creditRequests: 1,
        creditUnit: "request",
        durationMs: Date.now() - startedAt,
        evidenceMode: "provider-synthesis",
        rawEvidenceAvailable: false,
        error: mcpToolErrorText(result),
        evidenceFallbackAction: "gong-calls",
        guidance:
          "Gong returned an error for this request, so there is no synthesis. Report the error instead of presenting it as an answer, and use gong-calls for evidence retrieval.",
      };
    }
    return {
      connected: true,
      source: "gong-native-mcp",
      operation,
      creditRequests: 1,
      creditUnit: "request",
      durationMs: Date.now() - startedAt,
      evidenceMode: "provider-synthesis",
      synthesisOnly: true,
      rawEvidenceAvailable: false,
      coverageComplete: false,
      coverageUnknown: true,
      result,
      evidenceFallbackAction: "gong-calls",
      guidance:
        "Treat this as Gong-generated qualitative synthesis, not transcript evidence. Do not use it for verbatim quotes, exact counts, source-record claims, or proof of absence; route those to gong-calls or the provider corpus evidence path.",
    };
  },
});
