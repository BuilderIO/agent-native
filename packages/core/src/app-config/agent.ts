import { z } from "zod";

export const agentConfig = z.object({
  promptSkills: z
    .object({
      maxEntries: z.number().int().positive().max(500).default(40).meta({
        doc: "Maximum included entries per bounded prompt skill listing, including supporting files when enabled.",
      }),
      maxDescriptionChars: z
        .number()
        .int()
        .positive()
        .max(1000)
        .default(180)
        .meta({
          doc: "Character limit for normalized prompt skill descriptions before sentence punctuation.",
        }),
      includeSupportingFiles: z.boolean().default(true).meta({
        doc: "Include supporting files, such as references and scripts, when presenting skills to the agent.",
      }),
    })
    .prefault({}),
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
  questionIntake: z
    .object({
      enabled: z
        .boolean()
        .default(false)
        .meta({
          env: ["AGENT_QUESTION_INTAKE_EXPERIMENT_ENABLED"],
          doc: "Enable signup-time assignment and run-level question-intake experimentation for this app.",
        }),
      disabled: z
        .boolean()
        .default(false)
        .meta({
          env: ["AGENT_QUESTION_INTAKE_EXPERIMENT_DISABLED"],
          doc: "Emergency switch that disables this app's question-intake experiment, including when enabled by app config.",
        }),
      experimentId: z.string().trim().min(1),
      questionToolNames: z.array(z.string().trim().min(1)).default([]),
      treatmentInstructions: z.string().trim().min(1),
      trackedEventNames: z.array(z.string().trim().min(1)).default([]),
      clientTrackedEventNames: z
        .array(z.string().trim().min(1))
        .default([])
        .meta({
          doc: "Client-originated event names allowed to receive experiment assignment metadata. Keep outcome events restricted to server-confirmed behavior.",
        }),
    })
    .optional()
    .meta({
      doc: "App-specific settings for the reusable question-intake experiment. Only new users created while enabled receive an assignment.",
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
  interactiveChatTurns: z
    .boolean()
    .default(false)
    .meta({
      env: ["AGENT_INTERACTIVE_CHAT_TURNS"],
      doc: "Mark a chat turn its signed-in owner sent from this app's own page as interactive (foreground) provider work, including the tool calls of the durable run it hands off to, so provider call gates can admit them.",
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
      doc: "Soft timeout for an agent run, in milliseconds. 0 disables it. On a hosted (serverless) runtime a foreground run is clamped to hostedRunSoftTimeoutCeilingMs.",
    }),
  hostedRunSoftTimeoutCeilingMs: z
    .number()
    .int()
    .positive()
    .optional()
    .meta({
      env: ["AGENT_HOSTED_RUN_SOFT_TIMEOUT_CEILING_MS"],
      doc: "Longest foreground run soft timeout on a hosted runtime, in milliseconds, and the default there when runSoftTimeoutMs is unset. Unset keeps 40000. Raise it on hosts that allow long requests, such as Google Cloud Run.",
    }),
  maxAutoContinuesPerTurn: z
    .number()
    .int()
    .positive()
    .default(3)
    .meta({
      env: ["AGENT_MAX_AUTO_CONTINUES_PER_TURN"],
      doc: "Automatic continuations of one user turn after the server stopped it at its run time limit. Past it the turn waits for the user to press Continue. The turn wall-clock limit still ends a runaway turn.",
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
  noApprovalsEmails: z
    .array(z.string().email())
    .default([])
    .meta({
      env: ["AGENT_NATIVE_NO_APPROVALS_EMAILS"],
      doc: "User emails for which no-approvals mode defaults on unless overridden by their stored setting.",
    }),
  detailRoutes: z.array(z.string().trim().min(1)).optional().meta({
    doc: "Optional per-app route patterns (for example `/tasks/:id` or `/apps/:appId/*`) that mark item detail pages for agent navigation checks. When set, pathname matching uses these patterns instead of the generic multi-segment rule; item ID keys and query parameters still apply.",
  }),
  sharedMemoryDir: z
    .string()
    .trim()
    .min(1)
    .optional()
    .meta({
      env: ["AGENT_NATIVE_MEMORY_DIR"],
      doc: "Directory shared by local app processes in the desktop app so personal memory written by one app's agent loads in every other app's new chats.",
    }),
});
