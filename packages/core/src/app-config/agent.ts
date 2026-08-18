import { z } from "zod";

/**
 * Agent engine and model selection.
 *
 * These are the values `resolveEngine()` already resolves through a documented
 * seven-step ladder. The declared field replaces step 2 of that ladder only —
 * the explicit `engineOption` argument stays a function parameter and stays
 * above it, because it is per-call rather than per-process.
 */
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
  // These three stay `.optional()` rather than carrying a default: the value
  // that applies when they are unset depends on whether the run is hosted and
  // whether it is a background function, so it belongs to the resolver.
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
});
