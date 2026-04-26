import { registerRequiredSecret } from "@agent-native/core/secrets";

// ── Transcription secrets ────────────────────────────────────────────
// Voice dictation needs a Whisper-compatible transcription provider.
// We support two providers (either one unlocks transcription):
//   1. Groq `whisper-large-v3-turbo` — preferred. Same Whisper model family,
//      ~10x faster than OpenAI's hosted whisper-1, ~$0.04/hour of audio,
//      OpenAI-compatible API.
//   2. OpenAI `whisper-1` — fallback. Fine, just slower.
//
// At least one key is required for voice dictation to function.

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
