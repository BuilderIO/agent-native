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
  builtInEngines: z
    .array(z.string().min(1))
    .min(1)
    .optional()
    .meta({
      env: ["AGENT_BUILT_IN_ENGINES"],
      doc: 'Built-in engines to register, e.g. ["ai-sdk:openai"]. Unset registers every built-in.',
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
  sourceSweepToolCallThreshold: z
    .number()
    .int()
    .positive()
    .default(24)
    .meta({
      env: ["AGENT_SOURCE_SWEEP_TOOL_CALL_THRESHOLD"],
      doc: "Read-only source/search tool calls one turn may make before the agent is told to converge and answer from what it gathered.",
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

  // ── Run-lifecycle bounds ────────────────────────────────────────────────
  //
  // These are the numbers that can TERMINATE a run, or that encode an
  // assumption about the host it runs on. They carry today's shipped values as
  // declared defaults, so a deployment that configures nothing sees no
  // behaviour change; `agent/run-lifecycle.ts` is the only place that reads
  // them, one resolver per field, and `assertRunLifecycleInvariants` checks the
  // ordering between them every time configuration resolves.
  //
  // Derived values (the foreground backstop fraction, tool-timeout headroom)
  // stay internal on purpose: they are relationships, not host facts, and
  // making them settable is how the ordering below stops being checkable.
  //
  // Each default here is the value that shipped as a module constant, and the
  // constant still exists under its historical name where its reasoning is
  // written down. `agent-run-lifecycle-config.spec.ts` pins the two together so
  // editing one alone is a failing test, not a silent divergence.
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
