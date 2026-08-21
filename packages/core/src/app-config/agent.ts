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
  runNoProgressTimeoutMs: z
    .number()
    .nonnegative()
    .default(150_000)
    .meta({
      env: ["AGENT_RUN_NO_PROGRESS_TIMEOUT_MS"],
      doc: "Ceiling for the foreground no-progress backstop, in milliseconds. The effective foreground value is still clamped to a fraction of the chunk's soft timeout. 0 disables it.",
    }),
  backgroundNoProgressTimeoutMs: z
    .number()
    .nonnegative()
    .default(150_000)
    .meta({
      env: ["AGENT_BACKGROUND_NO_PROGRESS_TIMEOUT_MS"],
      doc: "No-progress backstop for a background-function run, in milliseconds. 0 disables it.",
    }),
  backgroundSoftTimeoutCeilingMs: z
    .number()
    .positive()
    .default(13 * 60_000)
    .meta({
      env: ["AGENT_BACKGROUND_SOFT_TIMEOUT_CEILING_MS"],
      doc: "Largest chunk budget a background-function run may use, in milliseconds. Must stay under the host's real background-function wall.",
    }),
  backgroundRunHardTimeoutMs: z
    .number()
    .positive()
    .default(10 * 60_000)
    .meta({
      env: ["AGENT_BACKGROUND_RUN_HARD_TIMEOUT_MS"],
      doc: "Hard abort for one in-process background automation run, in milliseconds. This is the host's real function budget for scheduled work.",
    }),
  modelStreamNoProgressTimeoutMs: z
    .number()
    .positive()
    .default(90_000)
    .meta({
      env: ["AGENT_MODEL_STREAM_NO_PROGRESS_TIMEOUT_MS"],
      doc: "In-loop watchdog for silence between engine stream frames, in milliseconds.",
    }),
  actionPreparationNoProgressTimeoutMs: z
    .number()
    .positive()
    .default(90_000)
    .meta({
      env: ["AGENT_ACTION_PREPARATION_NO_PROGRESS_TIMEOUT_MS"],
      doc: "In-loop watchdog for silence while an action's arguments stream in, in milliseconds.",
    }),
  maxRunLoopContinuations: z
    .number()
    .int()
    .positive()
    .default(6)
    .meta({
      env: ["AGENT_MAX_RUN_LOOP_CONTINUATIONS"],
      doc: "Continuation rounds allowed inside one foreground agent-loop invocation.",
    }),
  maxBackgroundRunLoopContinuations: z
    .number()
    .int()
    .positive()
    .default(20)
    .meta({
      env: ["AGENT_MAX_BACKGROUND_RUN_LOOP_CONTINUATIONS"],
      doc: "Continuation rounds allowed inside one background agent-loop invocation.",
    }),
  maxBackgroundRunContinuations: z
    .number()
    .int()
    .positive()
    .default(20)
    .meta({
      env: ["AGENT_MAX_BACKGROUND_RUN_CONTINUATIONS"],
      doc: "Server-driven background chunks a single logical turn may chain. A cost ceiling.",
    }),
  maxConsecutiveNoProgressContinuations: z
    .number()
    .int()
    .positive()
    .default(2)
    .meta({
      env: ["AGENT_MAX_CONSECUTIVE_NO_PROGRESS_CONTINUATIONS"],
      doc: "Consecutive chunks allowed to end on the same terminal code having produced nothing before the chain stops.",
    }),
  maxTurnWallClockMs: z
    .number()
    .positive()
    .default(90 * 60_000)
    .meta({
      env: ["AGENT_MAX_TURN_WALL_CLOCK_MS"],
      doc: "Absolute wall-clock ceiling on one logical turn across all its chunks, in milliseconds.",
    }),
});
