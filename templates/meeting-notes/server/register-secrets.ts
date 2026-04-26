import { registerRequiredSecret } from "@agent-native/core/secrets";

// ── Transcription secrets (optional) ──────────────────────────────────
// Meeting notes can optionally transcribe audio from meetings. We support
// two providers — Deepgram and AssemblyAI. Neither is strictly required;
// meetings still work without transcription, they just won't have
// AI-enhanced notes from audio.

registerRequiredSecret({
  key: "DEEPGRAM_API_KEY",
  label: "Deepgram API Key (recommended)",
  description:
    "Real-time and batch transcription with speaker diarization via Deepgram Nova-2. Preferred for live meeting transcription.",
  docsUrl: "https://console.deepgram.com/",
  scope: "user",
  kind: "api-key",
  required: false,
  validator: async (value) => {
    if (!value) return true;
    if (typeof value !== "string" || value.length < 20) {
      return { ok: false, error: "Key looks too short." };
    }
    try {
      const res = await fetch("https://api.deepgram.com/v1/projects", {
        headers: { Authorization: `Token ${value}` },
      });
      if (res.ok) return true;
      if (res.status === 401)
        return { ok: false, error: "Deepgram rejected this key (401)." };
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
  key: "ASSEMBLYAI_API_KEY",
  label: "AssemblyAI API Key",
  description:
    "Fallback transcription via AssemblyAI. Used only if DEEPGRAM_API_KEY is not set. Supports speaker diarization and summarization.",
  docsUrl: "https://www.assemblyai.com/dashboard/signup",
  scope: "user",
  kind: "api-key",
  required: false,
  validator: async (value) => {
    if (!value) return true;
    if (typeof value !== "string" || value.length < 20) {
      return { ok: false, error: "Key looks too short." };
    }
    try {
      const res = await fetch("https://api.assemblyai.com/v2/transcript", {
        method: "GET",
        headers: { Authorization: value },
      });
      // AssemblyAI returns 200 with a list on valid keys
      if (res.ok || res.status === 200) return true;
      if (res.status === 401)
        return { ok: false, error: "AssemblyAI rejected this key (401)." };
      return { ok: false, error: `AssemblyAI returned ${res.status}.` };
    } catch (err: any) {
      return {
        ok: false,
        error: `Could not reach AssemblyAI: ${err?.message ?? err}`,
      };
    }
  },
});
