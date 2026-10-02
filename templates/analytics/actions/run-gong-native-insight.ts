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

export default defineAction({
  description:
    "Send one bounded qualitative synthesis request to Gong's official MCP semantic operations. Each invocation consumes Gong credits. Paid calls fail closed unless configure-gong-native-insights has enabled them for this workspace and this invocation sets allowCreditRequest=true. Call gong-native-insights first to inspect the connected operation schemas for free, then pass one consolidated arguments object. Use this only for themes, risks, summaries, and deck narrative. For transcripts, quotes, counts, source records, or absence/exhaustive claims use gong-calls or the provider corpus evidence path instead.",
  schema: z.object({
    operation: z
      .enum(GONG_NATIVE_OPERATIONS)
      .describe(
        "Official Gong MCP operation. Use gong-native-insights to list the connected operation schemas.",
      ),
    allowCreditRequest: z
      .boolean()
      .default(false)
      .describe(
        "Explicitly authorize this one Gong semantic request. Leave false when the workspace should not spend Gong credits.",
      ),
    arguments: z
      .record(z.string(), z.unknown())
      .default({})
      .describe(
        "Arguments passed unchanged to the connected Gong MCP operation. Consolidate related questions into one request and narrow the entity/date scope.",
      ),
  }),
  parallelSafe: true,
  needsApproval: ({ allowCreditRequest }) => Boolean(allowCreditRequest),
  mcpTool: true,
  publicAgent: { expose: true, readOnly: false, requiresAuth: true },
  http: false,
  grounding: true,
  run: async ({ operation, allowCreditRequest, arguments: args }) => {
    const tools = await listGongNativeTools();

    if (!allowCreditRequest) {
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
          "This Gong semantic request was not sent. Set allowCreditRequest=true only after choosing one consolidated, narrowly scoped request; use gong-calls for evidence retrieval without Gong AI synthesis.",
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
          "This Gong semantic request was not sent because paid native insights are disabled for this workspace. An authorized user can enable them with configure-gong-native-insights; use gong-calls for evidence retrieval in the meantime.",
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
    });
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
