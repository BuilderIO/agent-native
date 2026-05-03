import { registerRequiredSecret } from "@agent-native/core/secrets";

// ── File upload provider + onboarding step ────────────────────────────
// Registered in server/plugins/onboarding.ts (not here) because Nitro
// plugins share the same module context as the framework's onboarding
// and file-upload route handlers. Side-effect imports from agent-chat.ts
// run in a separate Vite SSR module graph and write to a different Map.

// ── Transcription secrets (optional) ──────────────────────────────────
// Native web/macOS speech is the primary transcript source. These cloud
// providers are optional fallbacks when native transcription is unavailable.
//
// We support three BYOK providers:
//   1. Gemini — recommended for fast LLM cleanup in the desktop tray.
//   2. Groq `whisper-large-v3-turbo` — preferred Whisper fallback. Same Whisper model family,
//      ~10x faster than OpenAI's hosted whisper-1, ~$0.04/hour of audio,
//      OpenAI-compatible API.
//   3. OpenAI `whisper-1` — fallback. Fine, just slower.
//
// Neither is strictly required — videos still upload and play back without
// cloud transcription.
//
// This file lives OUTSIDE `server/plugins/` on purpose: Nitro's plugin
// auto-discovery expects a defineNitroPlugin-shaped default export and
// silently skips files that don't match. Keeping the registration as a
// side-effect module that's imported at the top of `server/plugins/agent-chat.ts`
// matches the mail template's `import "../onboarding.js"` pattern and
// guarantees the registerRequiredSecret() call runs at boot.

registerRequiredSecret({
  key: "GEMINI_API_KEY",
  label: "Gemini API Key (recommended)",
  description:
    "Fast LLM-backed transcription cleanup via Gemini Flash Lite. Recommended for Clips voice dictation when you want to bring your own key.",
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
        `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(value)}`,
      );
      if (res.ok) return true;
      if (res.status === 400 || res.status === 401 || res.status === 403) {
        return {
          ok: false,
          error: `Gemini rejected this key (${res.status}).`,
        };
      }
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
  key: "GOOGLE_APPLICATION_CREDENTIALS",
  label: "Google Speech-to-Text service account",
  description:
    "Service-account JSON for future Google realtime Speech-to-Text streaming. Builder.io Connect does not proxy streaming audio. When configured as an environment variable, this may be a filesystem path supported by Google client libraries.",
  docsUrl:
    "https://cloud.google.com/speech-to-text/v2/docs/streaming-recognize",
  scope: "user",
  kind: "api-key",
  required: false,
  validator: async (value) => {
    if (!value) return true;
    if (typeof value !== "string" || !value.trim()) {
      return { ok: false, error: "Paste the service-account JSON." };
    }
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(value);
    } catch {
      return {
        ok: false,
        error:
          "Service-account credentials must be JSON when saved in settings. Use an env var path only for deploy/runtime configuration.",
      };
    }
    if ("web" in parsed || "installed" in parsed) {
      return {
        ok: false,
        error:
          "This looks like an OAuth client credential, not a service account key. Create a service account key JSON in Google Cloud Console.",
      };
    }
    if (
      parsed.type !== "service_account" ||
      typeof parsed.project_id !== "string" ||
      typeof parsed.client_email !== "string" ||
      typeof parsed.private_key !== "string"
    ) {
      return {
        ok: false,
        error:
          'Invalid service-account JSON: expected "type", "project_id", "client_email", and "private_key".',
      };
    }
    return true;
  },
});

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

// ── Google Calendar OAuth (for the Meetings feature) ──────────────────
// These are deploy-level OAuth client credentials (one client id/secret per
// deployment, not per user). Per-user access/refresh tokens land in
// `app_secrets` after the OAuth dance via the framework OAuth pattern;
// `calendar_accounts` only stores pointer keys to those secrets.
//
// Scope is `workspace` so they appear once per deploy in the settings UI
// (matches how the Calls / Recall / Calendar templates register Google OAuth
// app credentials).

registerRequiredSecret({
  key: "GOOGLE_CLIENT_ID",
  label: "Google Calendar Client ID",
  description:
    "OAuth client id for the Meetings feature's Google Calendar integration. Create a Web Application credential at https://console.cloud.google.com/apis/credentials with the Calendar readonly scope, then paste the client id here.",
  docsUrl: "https://console.cloud.google.com/apis/credentials",
  scope: "workspace",
  kind: "api-key",
  required: false,
});

registerRequiredSecret({
  key: "GOOGLE_CLIENT_SECRET",
  label: "Google Calendar Client Secret",
  description:
    "OAuth client secret matching GOOGLE_CLIENT_ID. Required for the Meetings feature to fetch upcoming events from Google Calendar.",
  docsUrl: "https://console.cloud.google.com/apis/credentials",
  scope: "workspace",
  kind: "api-key",
  required: false,
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
