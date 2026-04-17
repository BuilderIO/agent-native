import { registerRequiredSecret } from "@agent-native/core/secrets";

// Register the secrets Clips needs. They appear automatically in the agent
// sidebar settings UI and in the onboarding checklist.
//
// Transcription (Whisper) is the one AI operation Clips calls directly —
// everything else (titles, summaries, chapters, filler-word removal) is
// delegated to the agent chat. See the `ai-video-tools` skill.
//
// This file lives OUTSIDE `server/plugins/` on purpose: Nitro's plugin
// auto-discovery expects a defineNitroPlugin-shaped default export and
// silently skips files that don't match. Keeping the registration as a
// side-effect module that's imported at the top of `server/plugins/agent-chat.ts`
// matches the mail template's `import "../onboarding.js"` pattern and
// guarantees the registerRequiredSecret() call runs at boot.

registerRequiredSecret({
  key: "OPENAI_API_KEY",
  label: "OpenAI API Key",
  description:
    "Used for Whisper transcription of your recordings. Without this, videos still upload and play back — they just won't have captions or AI-generated titles/summaries.",
  docsUrl: "https://platform.openai.com/api-keys",
  scope: "user",
  kind: "api-key",
  required: true,
  validator: async (value) => {
    if (!value || typeof value !== "string" || value.length < 20) {
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
