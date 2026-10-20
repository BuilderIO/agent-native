import { defineAction } from "@agent-native/core/action";
import { resolveGeminiApiKey, resolveSecret } from "@agent-native/core/server";
import { z } from "zod";

export default defineAction({
  description:
    "Check which local image providers are configured (Gemini/OpenAI). Slides uses local generation by default; Assets is reserved for a requested brand library or an Assets-exclusive capability.",
  schema: z.object({}),
  http: { method: "GET" },
  run: async () => {
    return {
      gemini: !!(await resolveGeminiApiKey()),
      openai: !!(await resolveSecret("OPENAI_API_KEY")),
    };
  },
});
