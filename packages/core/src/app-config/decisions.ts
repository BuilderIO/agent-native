import { z } from "zod";

export const decisionsConfig = z.object({
  providerOrder: z
    .array(z.enum(["openai", "jev"]))
    .min(1)
    .max(2)
    .default(["jev", "openai"])
    .meta({
      env: "DECISIONS_PROVIDER_ORDER",
      doc: "Decision providers to try in order. Defaults to Builder Jev, then personal Jev, then OpenAI.",
    }),
  timeoutMs: z.number().int().min(1_000).max(60_000).default(10_000).meta({
    env: "DECISIONS_TIMEOUT_MS",
    doc: "Maximum time for one decision provider request, in milliseconds.",
  }),
});
