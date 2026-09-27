import { z } from "zod";

export const runtimeConfig = z.object({
  backgroundJobsEnabled: z.boolean().optional().meta({
    env: "RUN_BACKGROUND_JOBS",
    doc: "Run app-owned recurring background jobs. Defaults to enabled only in production.",
  }),
  databasePoolMax: z.number().int().positive().optional().meta({
    env: "AGENT_NATIVE_DB_POOL_MAX",
    doc: "Maximum connections in each framework database pool. Defaults vary by runtime.",
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
      doc: "Direct database URL for request-time clients when a serverless connection pooler is unavailable.",
    }),
});
