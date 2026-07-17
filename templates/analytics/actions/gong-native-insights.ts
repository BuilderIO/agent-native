import { defineAction } from "@agent-native/core";
import {
  callMcpTool,
  listVisibleMcpTools,
  type AppMcpTool,
} from "@agent-native/core/mcp-client";
import { z } from "zod";

import { readGongNativeInsightsPolicy } from "../server/lib/gong-native-policy";

const GONG_NATIVE_OPERATIONS = [
  "ask_account",
  "ask_deal",
  "generate_brief",
] as const;

type GongNativeOperation = (typeof GONG_NATIVE_OPERATIONS)[number];

function operationName(value: string): string {
  return value.trim().toLowerCase().replace(/-/g, "_");
}

function gongNativeTools(tools: AppMcpTool[]): AppMcpTool[] {
  const names = new Set<string>(GONG_NATIVE_OPERATIONS);
  return tools.filter((tool) => names.has(operationName(tool.name)));
}

function selectTool(
  tools: AppMcpTool[],
  operation: GongNativeOperation,
): AppMcpTool | null {
  const matches = tools.filter(
    (tool) => operationName(tool.name) === operation,
  );
  if (matches.length === 1) return matches[0];
  const gongNamed = matches.filter((tool) => /gong/i.test(tool.serverId));
  return gongNamed.length === 1 ? gongNamed[0] : null;
}

export default defineAction({
  description:
    "Use Gong's official MCP semantic operations for one bounded qualitative synthesis request. Omit operation to inspect the connected schemas without spending Gong credits. Paid calls fail closed unless configure-gong-native-insights has enabled them for this workspace and this invocation sets allowCreditRequest=true. With operation, pass one consolidated arguments object; each invocation independently consumes Gong credits. Use this only for themes, risks, summaries, and deck narrative. For transcripts, quotes, counts, source records, or absence/exhaustive claims use gong-calls or the provider corpus evidence path instead.",
  schema: z.object({
    operation: z
      .enum(GONG_NATIVE_OPERATIONS)
      .optional()
      .describe(
        "Official Gong MCP operation. Omit to list the currently connected operation schemas without calling Gong AI.",
      ),
    allowCreditRequest: z
      .boolean()
      .default(false)
      .describe(
        "Explicitly authorize this one Gong semantic request. Leave false while inspecting schemas or when the workspace should not spend Gong credits.",
      ),
    arguments: z
      .record(z.string(), z.unknown())
      .default({})
      .describe(
        "Arguments passed unchanged to the connected Gong MCP operation. Consolidate related questions into one request and narrow the entity/date scope.",
      ),
  }),
  readOnly: true,
  parallelSafe: true,
  publicAgent: { expose: true, readOnly: true, requiresAuth: true },
  http: false,
  run: async ({ operation, allowCreditRequest, arguments: args }) => {
    const tools = gongNativeTools(await listVisibleMcpTools());
    if (!operation) {
      return {
        connected: tools.length > 0,
        creditRequests: 0,
        creditUnit: "request",
        evidenceMode: "provider-synthesis",
        rawEvidenceAvailable: false,
        operations: tools.map((tool) => ({
          operation: operationName(tool.name),
          serverId: tool.serverId,
          description: tool.description,
          inputSchema: tool.inputSchema,
        })),
        evidenceFallbackAction: "gong-calls",
        guidance:
          tools.length > 0
            ? "Choose one operation and make one consolidated, narrowly scoped request. Inspecting this catalog did not call Gong AI or consume a Gong credit request."
            : "No official Gong semantic MCP operations are connected in this request scope. Use gong-calls for bounded evidence, or connect Gong MCP before using the synthesis path.",
      };
    }

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

    const tool = selectTool(tools, operation);
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
            : `The ${operation} operation is missing or ambiguous across connected MCP servers.`,
        availableOperations: tools.map((candidate) => ({
          operation: operationName(candidate.name),
          serverId: candidate.serverId,
        })),
        evidenceFallbackAction: "gong-calls",
      };
    }

    const startedAt = Date.now();
    const result = await callMcpTool(tool.serverId, tool.name, args);
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
