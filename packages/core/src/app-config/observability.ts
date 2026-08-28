import { z } from "zod";

/**
 * Agent trace capture, plus the MCP server's own instrumentation switches.
 *
 * These were an `observability-config` settings row, which nothing in core ever
 * wrote — the only "UI" was a snippet in the docs telling app authors to write
 * it from their own code, and reading it put a database round-trip on the agent
 * hot path inside a catch that made an outage indistinguishable from "never
 * configured". They are deployment configuration, not a runtime preference.
 *
 * The three `inferredSentiment*` fields are declared here but still pass
 * through `resolveInferredSentimentConfig`, which layers a hosted-vs-self-hosted
 * derivation and an asymmetric "explicit false always wins" rule on top. Neither
 * is expressible as a declared default, so that resolver stays the top layer
 * rather than being flattened into these fields.
 */
export const observabilityConfig = z.object({
  enabled: z
    .boolean()
    .default(true)
    .meta({
      env: ["AGENT_NATIVE_OBSERVABILITY"],
      doc: "Capture agent run, model call, and tool call traces.",
    }),
  // Message bodies are user data, and a trace store is not a place to put them
  // without a decision. Each of these three defaults to off for that reason.
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
  // MCP server instrumentation. These gate the `$mcp_*` events every tracking
  // provider receives, so they live here with the other capture switches rather
  // than beside one provider's key in `analytics`.
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

  // No env aliases: `resolveInferredSentimentConfig` owns the env step for
  // these three, and declaring the alias here as well would give one value two
  // resolvers — the thing this schema exists to remove.
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
