import { z } from "zod";

export const openAiAppsConfig = z.object({
  challengeToken: z.string().trim().min(1).optional().meta({
    env: "OPENAI_APPS_CHALLENGE_TOKEN",
    doc: "Domain-verification token for the OpenAI plugin challenge route.",
  }),
});
