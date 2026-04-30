import { defineAction } from "@agent-native/core";
import { z } from "zod";

export default defineAction({
  description:
    "Check which image generation providers are configured (agent CLI tool).",
  schema: z.object({}),
  http: false,
  run: async () => {
    const { getConfiguredProviders } =
      await import("../server/handlers/image-providers/index.js");
    const configured = getConfiguredProviders();
    const geminiStatus = process.env.GEMINI_API_KEY
      ? "Configured"
      : "Not configured";
    const openaiStatus = process.env.OPENAI_API_KEY
      ? "Configured"
      : "Not configured";
    const autoProvider =
      configured.length > 0
        ? `Auto mode will use: ${configured[0].name}`
        : "No provider available";

    return `Image Generation Status:
========================
Gemini: ${geminiStatus}
OpenAI: ${openaiStatus}
${autoProvider}
Configured providers: ${configured.length > 0 ? configured.map((p) => p.name).join(", ") : "none"}`;
  },
});
