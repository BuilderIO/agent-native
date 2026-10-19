import { defineAction } from "@agent-native/core/action";
import { resolveGeminiApiKey, resolveSecret } from "@agent-native/core/server";
import { z } from "zod";

export default defineAction({
  description:
    "Check which local image generation providers are configured. Slides uses a local provider by default; Assets is opt-in for a requested brand library or an Assets-exclusive capability.",
  schema: z.object({}),
  http: false,
  run: async () => {
    const { getConfiguredProviders } =
      await import("../server/handlers/image-providers/index.js");
    const configured = await getConfiguredProviders();
    const geminiStatus = (await resolveGeminiApiKey())
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
Primary: local image provider
Assets: opt-in for requested brand-library generation or an Assets-exclusive capability
Local providers:
Gemini: ${geminiStatus}
OpenAI: ${openaiStatus}
${autoProvider}
Configured providers: ${configured.length > 0 ? configured.map((p) => p.name).join(", ") : "none"}`;
  },
});
