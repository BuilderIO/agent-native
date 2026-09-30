import { defineAction } from "@agent-native/core/action";
import { listVisibleMcpTools } from "@agent-native/core/mcp-client";
import { z } from "zod";

import {
  gongNativeOperationName,
  gongNativeTools,
} from "../server/lib/gong-native-operations";

export default defineAction({
  description:
    "List the Gong native semantic operations (ask_account, ask_deal, generate_brief) connected in this request scope, with their input schemas. This never calls Gong AI or consumes Gong credits. To send one paid qualitative synthesis request, call run-gong-native-insight with the chosen operation. For transcripts, quotes, counts, source records, or absence/exhaustive claims use gong-calls or the provider corpus evidence path instead.",
  // Paid execution moved to run-gong-native-insight. Reject its arguments here
  // instead of silently returning a listing to an older caller.
  schema: z.strictObject(
    {},
    {
      error: (issue) =>
        issue.code === "unrecognized_keys"
          ? `gong-native-insights only lists operations and takes no arguments (got ${issue.keys.join(", ")}). Send a paid Gong request with run-gong-native-insight.`
          : undefined,
    },
  ),
  readOnly: true,
  parallelSafe: true,
  mcpTool: true,
  publicAgent: { expose: true, readOnly: true, requiresAuth: true },
  http: false,
  run: async () => {
    const tools = gongNativeTools(await listVisibleMcpTools());
    return {
      connected: tools.length > 0,
      creditRequests: 0,
      creditUnit: "request",
      evidenceMode: "provider-synthesis",
      rawEvidenceAvailable: false,
      operations: tools.map((tool) => ({
        operation: gongNativeOperationName(tool.name),
        serverId: tool.serverId,
        description: tool.description,
        inputSchema: tool.inputSchema,
      })),
      executionAction: "run-gong-native-insight",
      evidenceFallbackAction: "gong-calls",
      guidance:
        tools.length > 0
          ? "Choose one operation and send one consolidated, narrowly scoped request with run-gong-native-insight. Inspecting this catalog did not call Gong AI or consume a Gong credit request."
          : "No official Gong semantic MCP operations are connected in this request scope. Use gong-calls for bounded evidence, or connect Gong MCP before using the synthesis path.",
    };
  },
});
