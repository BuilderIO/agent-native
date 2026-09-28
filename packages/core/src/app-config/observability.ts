import { z } from "zod";

export const observabilityConfig = z.object({
  enabled: z
    .boolean()
    .default(true)
    .meta({
      env: ["AGENT_NATIVE_OBSERVABILITY"],
      doc: "Capture agent run, model call, and tool call traces.",
    }),
  superOrgId: z
    .string()
    .trim()
    .min(1)
    .max(200)
    .optional()
    .meta({
      env: ["AGENT_NATIVE_OBSERVABILITY_SUPER_ORG_ID"],
      doc: "The single organization whose verified admins may review observability data across organizations. Unset disables cross-organization review.",
    }),
  capturePrompts: z
    .boolean()
    .default(false)
    .meta({
      env: ["AGENT_NATIVE_OBSERVABILITY_CAPTURE_PROMPTS"],
      doc: "Include prompt and completion content on exported spans.",
    }),
  captureToolArgs: z
    .boolean()
    .default(false)
    .meta({
      env: ["AGENT_NATIVE_OBSERVABILITY_CAPTURE_TOOL_ARGS"],
      doc: "Include action input arguments on tool spans.",
    }),
  captureToolResults: z
    .boolean()
    .default(false)
    .meta({
      env: ["AGENT_NATIVE_OBSERVABILITY_CAPTURE_TOOL_RESULTS"],
      doc: "Include tool results and error text on tool spans.",
    }),
  mcpEvents: z
    .boolean()
    .default(true)
    .meta({
      env: ["MCP_ANALYTICS"],
      doc: "Emit `$mcp_*` analytics events for the MCP server the app exposes.",
    }),
  mcpCaptureParameters: z
    .boolean()
    .default(false)
    .meta({
      env: ["MCP_ANALYTICS_PARAMETERS"],
      doc: "Include redacted MCP tool-call arguments as $mcp_parameters. Off by default: arguments carry user content.",
    }),
  mcpDebugInitialize: z
    .boolean()
    .default(false)
    .meta({
      env: ["MCP_DEBUG_INIT"],
      doc: "Log the clientInfo and capabilities of every MCP initialize handshake. Off by default: a handshake can carry client-specific metadata.",
    }),
  captureLlmSpans: z
    .boolean()
    .default(true)
    .meta({
      env: ["AGENT_NATIVE_OBSERVABILITY_CAPTURE_LLM_SPANS"],
      doc: "Emit one span per tool call alongside the run's trace.",
    }),
  evalSampleRate: z
    .number()
    .min(0)
    .max(1)
    .default(0)
    .meta({
      env: ["AGENT_NATIVE_OBSERVABILITY_EVAL_SAMPLE_RATE"],
      doc: "Fraction of runs given an LLM-as-judge eval, 0 to 1.",
    }),

  inferredSentimentEnabled: z.boolean().optional().meta({
    doc: "Classify the raw user message as positive, negative, or neutral. Defaults on for first-party hosted deployments only.",
  }),
  inferredSentimentSampleRate: z.number().min(0).max(1).optional().meta({
    doc: "Deterministic fraction of eligible user messages to classify, 0 to 1.",
  }),
  inferredSentimentModel: z.string().min(1).default("gpt-5-6-luna").meta({
    doc: "Model used by the managed sentiment classifier.",
  }),
});
