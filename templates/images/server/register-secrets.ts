import { registerRequiredSecret } from "@agent-native/core/secrets";

registerRequiredSecret({
  key: "GEMINI_API_KEY",
  label: "Gemini API Key",
  description:
    "Required for AI image generation with Nano Banana 2 / Gemini image models.",
  docsUrl: "https://aistudio.google.com/apikey",
  scope: "user",
  kind: "api-key",
  required: true,
  validator: async (value) => {
    if (!value || value.length < 20) {
      return { ok: false, error: "Key looks too short." };
    }
    try {
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models?key=${value}`,
      );
      if (res.ok) return true;
      return { ok: false, error: `Gemini returned ${res.status}.` };
    } catch (err: any) {
      return {
        ok: false,
        error: `Could not reach Gemini: ${err?.message ?? err}`,
      };
    }
  },
});
