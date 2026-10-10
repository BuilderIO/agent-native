import { z } from "zod";

export const runtimeConfig = z.object({
  allowSharedLlmKeyFallback: z.boolean().default(false).meta({
    env: "AGENT_NATIVE_ALLOW_SHARED_LLM_KEY_FALLBACK",
    doc: "Allow deployment LLM provider keys as an app-wide fallback for remote databases. Local PGlite development works without this opt-in; Hosted workspace runtimes always block deployment provider-key sharing.",
  }),
  backgroundJobsEnabled: z.boolean().optional().meta({
    env: "RUN_BACKGROUND_JOBS",
    doc: "Run app-owned recurring background jobs. Defaults to enabled only in production.",
  }),
  databasePoolMax: z.number().int().positive().optional().meta({
    env: "AGENT_NATIVE_DB_POOL_MAX",
    doc: "Maximum connections per database pool. Serverless runtimes always use one connection; local runtimes default to twenty.",
  }),
  searchDrainBudgetMs: z.number().int().min(0).default(100).meta({
    env: "AGENT_NATIVE_SEARCH_DRAIN_BUDGET_MS",
    doc: "Milliseconds a search spends processing pending search index changes before answering; if changes remain, that search uses the app's fallback. Zero processes none, leaving them to the drains that follow writes and the recurring sweep.",
  }),
  agentChatStreaming: z.boolean().default(false).meta({
    env: "AGENT_NATIVE_AGENT_CHAT_STREAM_RUNTIME",
    doc: "Run the dedicated Nitro agent-chat response-streaming route used by an AWS Lambda Function URL.",
  }),
  vercelBranchUrl: z.string().trim().min(1).optional().meta({
    env: "VERCEL_BRANCH_URL",
    doc: "Platform-provided Vercel branch URL used to address the current preview deployment.",
  }),
  databaseUrlUnpooled: z
    .string()
    .trim()
    .min(1)
    .optional()
    .meta({
      env: ["NETLIFY_DATABASE_URL_UNPOOLED", "DATABASE_URL_UNPOOLED"],
      doc: "Direct database URL reserved for migrations and DDL; serverless requests use the pooled database URL.",
    }),
});
