import { registerRequiredSecret } from "@agent-native/core/secrets";

// ── File upload provider + onboarding step ────────────────────────────
// Registered in server/plugins/onboarding.ts (not here) because Nitro
// plugins share the same module context as the framework's onboarding
// and file-upload route handlers. Side-effect imports from agent-chat.ts
// run in a separate Vite SSR module graph and write to a different Map.

// ── Transcription secrets (optional) ──────────────────────────────────
// Transcription is the one AI operation Clips calls directly — everything
// else (titles, summaries, chapters, filler-word removal) is delegated to
// the agent chat. See the `ai-video-tools` skill.
//
// We support two providers (either one unlocks transcription):
//   1. Groq `whisper-large-v3-turbo` — preferred. Same Whisper model family,
//      ~10x faster than OpenAI's hosted whisper-1, ~$0.04/hour of audio,
//      OpenAI-compatible API.
//   2. OpenAI `whisper-1` — fallback. Fine, just slower.
//
// Neither is strictly required — videos still upload and play back without
// transcription, they just won't have captions or AI-generated titles.
//
// This file lives OUTSIDE `server/plugins/` on purpose: Nitro's plugin
// auto-discovery expects a defineNitroPlugin-shaped default export and
// silently skips files that don't match. Keeping the registration as a
// side-effect module that's imported at the top of `server/plugins/agent-chat.ts`
// matches the mail template's `import "../onboarding.js"` pattern and
// guarantees the registerRequiredSecret() call runs at boot.

registerRequiredSecret({
  key: "GROQ_API_KEY",
  label: "Groq API Key (recommended)",
  description:
    "Fast Whisper transcription via Groq's whisper-large-v3-turbo — typically 10x faster than OpenAI Whisper, ~$0.04 per hour of audio. Either this or OPENAI_API_KEY unlocks transcription; Groq is preferred if both are set.",
  docsUrl: "https://console.groq.com/keys",
  scope: "user",
  kind: "api-key",
  required: false,
  validator: async (value) => {
    if (!value) return true;
    if (typeof value !== "string" || value.length < 20) {
      return { ok: false, error: "Key looks too short." };
    }
    try {
      const res = await fetch("https://api.groq.com/openai/v1/models", {
        headers: { Authorization: `Bearer ${value}` },
      });
      if (res.ok) return true;
      if (res.status === 401)
        return { ok: false, error: "Groq rejected this key (401)." };
      return { ok: false, error: `Groq returned ${res.status}.` };
    } catch (err: any) {
      return {
        ok: false,
        error: `Could not reach Groq: ${err?.message ?? err}`,
      };
    }
  },
});

registerRequiredSecret({
  key: "OPENAI_API_KEY",
  label: "OpenAI API Key",
  description:
    "Fallback Whisper transcription via OpenAI's whisper-1. Used only if GROQ_API_KEY is not set. Either this or GROQ_API_KEY unlocks transcription.",
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
