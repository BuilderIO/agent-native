import {
  GEMINI_API_KEY,
  registerRequiredSecret,
  registerSecretUsage,
} from "@agent-native/core/secrets";

// The framework registers the one Gemini key (Google Gemini API key), so
// Assets records what it uses the key for instead of registering a
// second copy under another name or scope.
registerSecretUsage(GEMINI_API_KEY, [
  {
    appId: "assets",
    feature: "Video generation",
    effectWhenRemoved: "Video generation uses Builder.io, or stops.",
  },
  {
    appId: "assets",
    feature: "Image generation",
    effectWhenRemoved:
      "Uses another image provider, or stops if none is set up.",
  },
]);

registerRequiredSecret({
  key: "OPENAI_API_KEY",
  label: "OpenAI API Key",
  description:
    "Optional manual image-generation fallback when Builder-managed generation is not connected.",
  docsUrl: "https://platform.openai.com/api-keys",
  scope: "user",
  kind: "api-key",
  usedFor: [
    {
      appId: "assets",
      feature: "Image generation",
      effectWhenRemoved:
        "Uses another image provider, or stops if none is set up.",
    },
  ],
  required: false,
  validator: async (value) => {
    if (!value) return true;
    if (typeof value !== "string" || value.length < 20) {
      return { ok: false, error: "Key looks too short." };
    }
    try {
      const res = await fetch("https://api.openai.com/v1/models", {
        headers: { Authorization: `Bearer ${value}` },
      });
      if (res.ok) return true;
      if (res.status === 401) {
        return { ok: false, error: "OpenAI rejected this key." };
      }
      return { ok: false, error: `OpenAI returned ${res.status}.` };
    } catch (err: any) {
      return {
        ok: false,
        error: `Could not reach OpenAI: ${err?.message ?? err}`,
      };
    }
  },
});
