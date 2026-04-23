import { registerRequiredSecret } from "@agent-native/core/secrets";
import { registerOnboardingStep } from "@agent-native/core/onboarding";
import {
  getActiveFileUploadProvider,
  registerFileUploadProvider,
} from "@agent-native/core/file-upload";
import { s3FileUploadProvider } from "./lib/s3-upload-provider.js";

// ── S3-compatible file upload provider ────────────────────────────────
// Registered at import time so it's available before onboarding checks.
registerFileUploadProvider(s3FileUploadProvider);

// ── File storage onboarding step (required) ───────────────────────────
// Videos must go to a real storage provider — the SQL fallback is not
// suitable for production. Builder.io is the easiest (one-button, free).
registerOnboardingStep({
  id: "file-storage",
  order: 15,
  required: true,
  title: "Video storage",
  description:
    "Clips needs a file storage provider for recorded videos. Builder.io is free and one click.",
  methods: [
    {
      id: "builder",
      kind: "builder-cli-auth",
      label: "Connect Builder.io",
      description:
        "One-click setup — also unlocks LLM + browser automation. Free during beta.",
      primary: true,
      badge: "free",
      payload: { scope: "browser" },
    },
    {
      id: "s3",
      kind: "form",
      label: "Use S3-compatible storage",
      description:
        "AWS S3, Cloudflare R2, DigitalOcean Spaces, MinIO, or any S3-compatible service.",
      payload: {
        writeScope: "workspace",
        fields: [
          {
            key: "S3_ENDPOINT",
            label: "Endpoint URL",
            placeholder: "https://s3.us-east-1.amazonaws.com",
          },
          {
            key: "S3_BUCKET",
            label: "Bucket name",
            placeholder: "my-clips-bucket",
          },
          {
            key: "S3_ACCESS_KEY_ID",
            label: "Access key ID",
            placeholder: "AKIA...",
          },
          {
            key: "S3_SECRET_ACCESS_KEY",
            label: "Secret access key",
            secret: true,
          },
          {
            key: "S3_REGION",
            label: "Region (optional)",
            placeholder: "us-east-1",
          },
          {
            key: "S3_PUBLIC_BASE_URL",
            label: "Public base URL (optional)",
            placeholder: "https://cdn.example.com",
          },
        ],
      },
    },
  ],
  isComplete: () => !!getActiveFileUploadProvider(),
});

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
