import { defineAction } from "@agent-native/core";

export default defineAction({
  description:
    "Check which image generation providers are configured (agent CLI tool).",
  parameters: {},
  http: false,
  run: async () => {
    return `Image Generation Status:\n========================\nGemini: ${process.env.GEMINI_API_KEY ? "Configured" : "Not configured"}`;
  },
});
