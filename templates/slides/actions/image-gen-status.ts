import { defineAction } from "@agent-native/core";
import { resolveSecret } from "@agent-native/core/server";
import { z } from "zod";

export default defineAction({
  description:
    "Check which image generation providers are configured (agent CLI tool).",
  schema: z.object({}),
  http: false,
  run: async () => {
    const { getConfiguredProviders } =
      await import("../server/handlers/image-providers/index.js");
    const configured = await getConfiguredProviders();
    const geminiStatus = (await resolveSecret("GEMINI_API_KEY"))
      ? "Configured"
      : "Not configured";
    const openaiStatus = (await resolveSecret("OPENAI_API_KEY"))
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
