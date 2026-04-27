import { registerRequiredSecret } from "@agent-native/core/secrets";

// ── Image generation provider secrets ────────────────────────────────
// Two providers are supported: Gemini (with style reference matching)
// and OpenAI gpt-image-2 (excellent text rendering). Neither is strictly
// required — slides work without images. If both are set, Gemini is
// preferred (it supports reference images natively).
//
// This file lives OUTSIDE `server/plugins/` on purpose: Nitro's plugin
// auto-discovery expects a defineNitroPlugin-shaped default export and
// silently skips files that don't match. Keeping the registration as a
// side-effect module imported at the top of `server/plugins/agent-chat.ts`
// guarantees the registerRequiredSecret() calls run at boot.

registerRequiredSecret({
  key: "GEMINI_API_KEY",
  label: "Gemini API Key",
  description:
    "Required for image generation with Gemini. Supports style reference matching and up to 4K resolution.",
  docsUrl: "https://aistudio.google.com/apikey",
  scope: "user",
  kind: "api-key",
  required: false,
  validator: async (value) => {
    if (!value) return true;
    if (typeof value !== "string" || value.length < 20) {
      return { ok: false, error: "Key looks too short." };
    }
    try {
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models?key=${value}`,
      );
      if (res.ok) return true;
      if (res.status === 400 || res.status === 403)
        return { ok: false, error: "Gemini rejected this key." };
      return { ok: false, error: `Gemini returned ${res.status}.` };
    } catch (err: any) {
      return {
        ok: false,
        error: `Could not reach Gemini: ${err?.message ?? err}`,
      };
    }
  },
});

registerRequiredSecret({
  key: "OPENAI_API_KEY",
  label: "OpenAI API Key",
  description:
    "Required for image generation with gpt-image-2. Excellent text rendering and photorealistic output.",
  docsUrl: "https://platform.openai.com/api-keys",
  scope: "user",
  kind: "api-key",
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
      if (res.status === 401)
        return { ok: false, error: "OpenAI rejected this key (401)." };
      return { ok: false, error: `OpenAI returned ${res.status}.` };
    } catch (err: any) {
      return {
        ok: false,
        error: `Could not reach OpenAI: ${err?.message ?? err}`,
      };
    }
  },
});
