import { registerRequiredSecret } from "@agent-native/core/secrets";

// Calls needs Deepgram for diarized transcription. Everything else
// (summaries, tracker classification, topic detection, snippet titling)
// runs through the agent chat — no extra keys required because the
// framework already owns the LLM credentials.
//
// This file lives OUTSIDE server/plugins/ on purpose: Nitro's plugin
// auto-discovery wants a defineNitroPlugin-shaped default export. Keeping
// secret registration as a side-effect module imported from
// server/plugins/agent-chat.ts matches the clips pattern.

registerRequiredSecret({
  key: "DEEPGRAM_API_KEY",
  label: "Deepgram API Key",
  description:
    "Diarized transcription for your calls. Deepgram's Nova-3 model splits the transcript by speaker so we can show talk tracks, participant stats, and per-speaker quotes. Without this, calls still upload and play back — they just won't have a transcript, summary, or tracker hits.",
  docsUrl: "https://console.deepgram.com/project/default/api-keys",
  scope: "user",
  kind: "api-key",
  required: true,
  validator: async (value) => {
    if (!value || typeof value !== "string" || value.length < 20) {
      return { ok: false, error: "Key looks too short." };
    }
    try {
      const res = await fetch("https://api.deepgram.com/v1/projects", {
        headers: { Authorization: `Token ${value}` },
      });
      if (res.ok) return true;
      if (res.status === 401 || res.status === 403) {
        return { ok: false, error: "Deepgram rejected this key." };
      }
      return { ok: false, error: `Deepgram returned ${res.status}.` };
    } catch (err: any) {
      return {
        ok: false,
        error: `Could not reach Deepgram: ${err?.message ?? err}`,
      };
    }
  },
});

registerRequiredSecret({
  key: "RECALL_AI_API_KEY",
  label: "Recall.ai API Key",
  description:
    "Unified API for Zoom / Google Meet / Microsoft Teams recorder bots. Paste a meeting URL and Calls sends a bot that joins, records, and delivers the media back for transcription.",
  docsUrl: "https://www.recall.ai/",
  scope: "user",
  kind: "api-key",
  required: false,
  validator: async (value) => {
    if (!value) return true;
    if (typeof value !== "string" || value.length < 16) {
      return { ok: false, error: "Key looks too short." };
    }
    try {
      const res = await fetch("https://us-east-1.recall.ai/api/v1/bot/", {
        headers: { Authorization: `Token ${value}` },
      });
      if (res.ok || res.status === 400) return true;
      if (res.status === 401 || res.status === 403) {
        return { ok: false, error: "Recall.ai rejected this key." };
      }
      return { ok: false, error: `Recall.ai returned ${res.status}.` };
    } catch (err: any) {
      return {
        ok: false,
        error: `Could not reach Recall.ai: ${err?.message ?? err}`,
      };
    }
  },
});
