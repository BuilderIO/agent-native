import { z } from "zod";

export const a2aConfig = z.object({
  allowedOrigins: z
    .array(z.string().min(1))
    .default([])
    .meta({
      env: ["AGENT_NATIVE_A2A_ALLOWED_ORIGINS"],
      doc: "Comma-separated extra origins trusted as private A2A siblings.",
    }),
  allowUnsignedInternal: z
    .boolean()
    .default(false)
    .meta({
      env: ["A2A_ALLOW_UNSIGNED_INTERNAL"],
      doc: "Trust unsigned internal self-dispatch on an unrecognized non-production host. Never grants trust in production.",
    }),
});
