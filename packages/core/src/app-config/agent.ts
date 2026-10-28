import { z } from "zod";

export const agentConfig = z.object({
  engine: z
    .string()
    .min(1)
    .optional()
    .meta({
      env: ["AGENT_ENGINE"],
      doc: "Name of the registered agent engine to use.",
    }),
  model: z
    .string()
    .min(1)
    .optional()
    .meta({
      env: ["AGENT_MODEL"],
      doc: "Model the agent runs with, when the caller does not pass one.",
    }),
  builtInEngines: z
    .array(z.string().min(1))
    .min(1)
    .optional()
    .meta({
      env: ["AGENT_BUILT_IN_ENGINES"],
      doc: 'Built-in engines to register, e.g. ["ai-sdk:openai"]. Unset registers every built-in.',
    }),
  buildEnginePackages: z
    .string()
    .min(1)
    .optional()
    .meta({
      env: ["AGENT_NATIVE_BUILD_ENGINE_PACKAGES"],
      doc: "Build-derived JSON list of runtime packages available to bundled agent engines.",
    }),
  mode: z
    .string()
    .min(1)
    .optional()
    .meta({
      env: ["AGENT_MODE"],
      doc: 'Runtime mode. "production" turns off development-only agent behavior.',
    }),
  preferBringYourOwnKey: z
    .boolean()
    .default(false)
    .meta({
      env: ["AGENT_ENGINE_PREFER_BYO_KEY"],
      doc: "Skip the Builder-managed engine and select a directly configured provider key first.",
    }),
  maxOutputTokens: z
    .number()
    .int()
    .positive()
    .optional()
    .meta({
      env: ["AGENT_MAX_OUTPUT_TOKENS"],
      doc: "Completion-token ceiling for engine calls that do not pass one explicitly. Unset uses the per-engine defaults.",
    }),
  mainChatMaxOutputTokens: z
    .number()
    .int()
    .positive()
    .default(64_000)
    .meta({
      env: ["AGENT_MAIN_CHAT_MAX_OUTPUT_TOKENS"],
      doc: "Completion-token ceiling for the first attempt of an interactive chat turn.",
    }),
  emptyResponseRetryMaxOutputTokens: z
    .number()
    .int()
    .positive()
    .default(128_000)
    .meta({
      env: ["AGENT_EMPTY_RESPONSE_RETRY_MAX_OUTPUT_TOKENS"],
      doc: "Completion-token ceiling used when retrying a turn that came back with an empty final response. Must be at or above mainChatMaxOutputTokens to raise anything.",
    }),
  sourceSweepToolCallThreshold: z
    .number()
    .int()
    .positive()
    .default(24)
    .meta({
      env: ["AGENT_SOURCE_SWEEP_TOOL_CALL_THRESHOLD"],
      doc: "Read-only source/search tool calls one turn may make before the agent is told to converge and answer from what it gathered.",
    }),
  runSoftTimeoutMs: z
    .number()
    .nonnegative()
    .optional()
    .meta({
      env: ["AGENT_RUN_SOFT_TIMEOUT_MS"],
      doc: "Soft timeout for an agent run, in milliseconds. 0 disables it.",
    }),
  completedRunRetentionMs: z
    .number()
    .nonnegative()
    .optional()
    .meta({
      env: ["AGENT_RUN_RETENTION_MS"],
      doc: "How long a completed agent run row is kept, in milliseconds.",
    }),
  erroredRunRetentionMs: z
    .number()
    .nonnegative()
    .optional()
    .meta({
      env: ["AGENT_ERRORED_RUN_RETENTION_MS"],
      doc: "How long an errored agent run row is kept, in milliseconds.",
    }),

  backgroundNoProgressTimeoutMs: z
    .number()
    .nonnegative()
    .default(150_000)
    .meta({
      env: ["AGENT_BACKGROUND_NO_PROGRESS_TIMEOUT_MS"],
      doc: "No-progress backstop for a background-function run, in milliseconds. 0 disables it.",
    }),
  backgroundRunHardTimeoutMs: z
    .number()
    .positive()
    .default(10 * 60_000)
    .meta({
      env: ["AGENT_BACKGROUND_RUN_HARD_TIMEOUT_MS"],
      doc: "Hard abort for one in-process background automation run, in milliseconds. This is the host's real function budget for scheduled work.",
    }),
});
