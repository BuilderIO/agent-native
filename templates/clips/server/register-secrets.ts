import { registerRequiredSecret } from "@agent-native/core/secrets";

registerRequiredSecret({
  key: "GEMINI_API_KEY",
  label: "Gemini API Key (recommended)",
  description:
    "Fast text-model-backed transcription cleanup via Builder/Luna or Gemini Flash Lite. Recommended for Clips voice dictation when you want to bring your own key.",
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
  label: "Groq API Key (voice dictation)",
  description:
    "Optional speech-to-text provider for desktop voice dictation. Clips recording transcripts use native browser/macOS capture first and Builder transcription for the saved recording fallback.",
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
  key: "SLACK_SIGNING_SECRET",
  label: "Slack Signing Secret",
  description:
    "Signing secret for the Slack app that sends link_shared events to Clips.",
  docsUrl: "https://api.slack.com/apps",
  scope: "workspace",
  kind: "api-key",
  required: false,
});

registerRequiredSecret({
  key: "SLACK_CLIENT_ID",
  label: "Slack Client ID",
  description:
    "OAuth client id for Agent-Native Clips for Slack. Used to let Slack workspaces install the Clips unfurl app.",
  docsUrl: "https://api.slack.com/apps",
  scope: "workspace",
  kind: "api-key",
  required: false,
});

registerRequiredSecret({
  key: "SLACK_CLIENT_SECRET",
  label: "Slack Client Secret",
  description:
    "OAuth client secret matching SLACK_CLIENT_ID. Required for Clips to exchange Slack install codes for bot tokens.",
  docsUrl: "https://api.slack.com/apps",
  scope: "workspace",
  kind: "api-key",
  required: false,
});

registerRequiredSecret({
  key: "SLACK_BOT_TOKEN",
  label: "Slack Bot Token (legacy)",
  description:
    "Legacy single-workspace bot token fallback for Clips link unfurls. New installs should use the Clips Slack workspace connection; new messaging automations should connect Slack in Settings > Messaging.",
  docsUrl: "https://api.slack.com/apps",
  scope: "workspace",
  kind: "api-key",
  required: false,
});

// ── Brain transcript ingest ──────────────────────────────────────────
// Both values are workspace-scoped: every clip in the workspace must reach
// the same Brain source, while the encrypted secret store keeps the token out
// of action responses, application state, and client bundles.

registerRequiredSecret({
  key: "BRAIN_INGEST_URL",
  label: "Brain ingest URL",
  description:
    "Signed Brain generic-ingest endpoint for ready Clips transcripts. Pair with BRAIN_INGEST_TOKEN.",
  scope: "workspace",
  kind: "api-key",
  required: false,
  validator: (value) => {
    if (!value) return true;
    try {
      const url = new URL(value);
      return url.protocol === "http:" || url.protocol === "https:"
        ? true
        : { ok: false, error: "Use an HTTP or HTTPS URL." };
    } catch {
      return { ok: false, error: "Enter a valid ingest URL." };
    }
  },
});

registerRequiredSecret({
  key: "BRAIN_INGEST_TOKEN",
  label: "Brain ingest token",
  description:
    "Bearer token for the configured Brain ingest URL. Stored encrypted and never returned to Clips clients or export receipts.",
  scope: "workspace",
  kind: "api-key",
  required: false,
  validator: (value) => {
    if (!value) return true;
    return typeof value === "string" && value.trim().length >= 8
      ? true
      : { ok: false, error: "Token looks too short." };
  },
});

registerRequiredSecret({
  key: "CLIPS_DISABLE_BUILDER_COMPRESSION",
  label: "Disable Builder media compression",
  description:
    "Emergency kill switch for Clips background calls to Builder's compress-media endpoint.",
  scope: "workspace",
  kind: "api-key",
  required: false,
  validator: (value) => {
    if (!value) return true;
    const normalized = value.trim().toLowerCase();
    return ["true", "1", "yes", "on", "false", "0", "no", "off"].includes(
      normalized,
    )
      ? true
      : { ok: false, error: "Use true/1/yes/on or false/0/no/off." };
  },
});

registerRequiredSecret({
  key: "CLIPS_MEDIA_WORKER_ENABLED",
  label: "Clips media worker enabled",
  description:
    "Boolean flag for the upcoming ai-services media worker. Leave unset or false until the worker endpoint is deployed.",
  scope: "workspace",
  kind: "api-key",
  required: false,
  validator: (value) => {
    if (!value) return true;
    const normalized = value.trim().toLowerCase();
    return ["true", "1", "yes", "on", "false", "0", "no", "off"].includes(
      normalized,
    )
      ? true
      : { ok: false, error: "Use true/1/yes/on or false/0/no/off." };
  },
});

registerRequiredSecret({
  key: "CLIPS_MEDIA_WORKER_URL",
  label: "Clips media worker URL",
  description:
    "Absolute enqueue endpoint URL for the upcoming ai-services media worker.",
  scope: "workspace",
  kind: "api-key",
  required: false,
  validator: (value) => {
    if (!value) return true;
    try {
      new URL(value);
      return true;
    } catch {
      return { ok: false, error: "Enter an absolute URL." };
    }
  },
});

registerRequiredSecret({
  key: "CLIPS_MEDIA_WORKER_SECRET",
  label: "Clips media worker signing secret",
  description:
    "Shared HMAC secret used to sign media-worker enqueue requests and verify callbacks.",
  scope: "workspace",
  kind: "api-key",
  required: false,
  validator: (value) => {
    if (!value) return true;
    return value.length >= 24
      ? true
      : { ok: false, error: "Use at least 24 characters." };
  },
});
