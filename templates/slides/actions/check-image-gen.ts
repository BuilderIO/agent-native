import { defineAction } from "@agent-native/core";

export default defineAction({
  description:
    "Check which image generation providers are configured (Gemini API key status).",
  parameters: {},
  http: { method: "GET" },
  run: async () => {
    return {
      gemini: !!process.env.GEMINI_API_KEY,
    };
  },
});
