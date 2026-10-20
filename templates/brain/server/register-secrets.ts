import {
  GEMINI_API_KEY,
  registerRequiredSecret,
  registerSecretUsage,
} from "@agent-native/core/secrets";

import "./onboarding.js";

registerRequiredSecret({
  key: "SLACK_BOT_TOKEN",
  label: "Slack Bot Token (local fallback)",
  description:
    "Optional local fallback for Brain channel backfills. Prefer a Slack workspace integration in Settings > Integrations. Brain only scans allow-listed channels and never enumerates DMs.",
  docsUrl: "https://api.slack.com/authentication/token-types",
  scope: "workspace",
  kind: "api-key",
  usedFor: [
    {
      appId: "brain",
      feature: "Slack backfills",
      effectWhenRemoved:
        "Uses the Slack workspace integration, or stops if there is none.",
    },
  ],
  required: false,
});

registerRequiredSecret({
  key: "SLACK_SIGNING_SECRET",
  label: "Slack Signing Secret",
  description:
    "Optional for Slack Events API delivery. Brain verifies signed events before refreshing an allow-listed channel thread.",
  docsUrl: "https://api.slack.com/authentication/verifying-requests-from-slack",
  scope: "workspace",
  kind: "api-key",
  usedFor: [
    {
      appId: "brain",
      feature: "Slack events",
      effectWhenRemoved: "Channel threads stop refreshing from Slack events.",
    },
  ],
  required: false,
});

registerRequiredSecret({
  key: "GRANOLA_API_KEY",
  label: "Granola Enterprise API Key",
  description:
    "Optional Granola Enterprise API key for workspace meeting imports.",
  docsUrl:
    "https://docs.granola.ai/help-center/sharing/integrations/enterprise-api",
  scope: "workspace",
  kind: "api-key",
  usedFor: [
    {
      appId: "brain",
      feature: "Granola imports",
      effectWhenRemoved: "Granola meeting imports stop.",
    },
  ],
  required: false,
});

registerRequiredSecret({
  key: "ZOOM_ACCOUNT_ID",
  label: "Zoom Account ID",
  description:
    "Optional Zoom Server-to-Server OAuth account ID for cloud-recording transcript imports. The app needs scopes cloud_recording:read:list_account_recordings:admin, cloud_recording:read:list_recording_files:admin and cloud_recording:read:recording:admin; sources that set zoom.userIds also need cloud_recording:read:list_user_recordings:admin.",
  docsUrl: "https://developers.zoom.us/docs/internal-apps/s2s-oauth/",
  scope: "workspace",
  kind: "api-key",
  usedFor: [
    {
      appId: "brain",
      feature: "Zoom transcript imports",
      effectWhenRemoved: "Zoom transcript imports stop.",
    },
  ],
  required: false,
});

registerRequiredSecret({
  key: "ZOOM_CLIENT_ID",
  label: "Zoom Client ID",
  description:
    "Optional Zoom Server-to-Server OAuth client ID for cloud-recording transcript imports. The app needs scopes cloud_recording:read:list_account_recordings:admin, cloud_recording:read:list_recording_files:admin and cloud_recording:read:recording:admin; sources that set zoom.userIds also need cloud_recording:read:list_user_recordings:admin.",
  docsUrl: "https://developers.zoom.us/docs/internal-apps/s2s-oauth/",
  scope: "workspace",
  kind: "api-key",
  usedFor: [
    {
      appId: "brain",
      feature: "Zoom transcript imports",
      effectWhenRemoved: "Zoom transcript imports stop.",
    },
  ],
  required: false,
});

registerRequiredSecret({
  key: "ZOOM_CLIENT_SECRET",
  label: "Zoom Client Secret",
  description:
    "Optional Zoom Server-to-Server OAuth client secret for cloud-recording transcript imports. The app needs scopes cloud_recording:read:list_account_recordings:admin, cloud_recording:read:list_recording_files:admin and cloud_recording:read:recording:admin; sources that set zoom.userIds also need cloud_recording:read:list_user_recordings:admin.",
  docsUrl: "https://developers.zoom.us/docs/internal-apps/s2s-oauth/",
  scope: "workspace",
  kind: "api-key",
  usedFor: [
    {
      appId: "brain",
      feature: "Zoom transcript imports",
      effectWhenRemoved: "Zoom transcript imports stop.",
    },
  ],
  required: false,
});

registerRequiredSecret({
  key: "GITHUB_TOKEN",
  label: "GitHub Token",
  description:
    "Optional GitHub token for Brain source sync. Used only for configured repositories and Slack-linked GitHub issue or PR URLs.",
  docsUrl:
    "https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens",
  scope: "workspace",
  kind: "api-key",
  usedFor: [
    {
      appId: "brain",
      feature: "GitHub sync",
      effectWhenRemoved: "GitHub source sync stops.",
    },
  ],
  required: false,
});

registerRequiredSecret({
  key: "GONG_ACCESS_KEY",
  label: "Gong Access Key",
  description:
    "Optional organization-scoped Gong API key for on-demand call queries. Brain uses the shared organization credential so members do not need individual Gong seats.",
  docsUrl: "https://gong.app.gong.io/settings/api/documentation",
  scope: "org",
  kind: "api-key",
  usedFor: [
    {
      appId: "brain",
      feature: "Gong call queries",
      effectWhenRemoved:
        "Brain can no longer query Gong calls with the organization's shared access.",
    },
  ],
  required: false,
});

registerRequiredSecret({
  key: "GONG_ACCESS_SECRET",
  label: "Gong Access Secret",
  description:
    "Optional organization-scoped Gong API secret paired with the shared access key for on-demand call queries.",
  docsUrl: "https://gong.app.gong.io/settings/api/documentation",
  scope: "org",
  kind: "api-key",
  usedFor: [
    {
      appId: "brain",
      feature: "Gong call queries",
      effectWhenRemoved:
        "Brain can no longer authenticate its shared Gong API requests.",
    },
  ],
  required: false,
});

registerRequiredSecret({
  key: "GONG_API_BASE",
  label: "Gong API Base URL",
  description:
    "Optional organization-scoped Gong API base URL override. Leave unset to use Gong's default API base.",
  docsUrl: "https://gong.app.gong.io/settings/api/documentation",
  scope: "org",
  kind: "api-key",
  usedFor: [
    {
      appId: "brain",
      feature: "Gong call queries",
      effectWhenRemoved:
        "Brain uses the default Gong API base URL instead of the organization's override.",
    },
  ],
  required: false,
});

// The framework registers the one Gemini key (Google Gemini API key), so
// Brain records what it uses the key for instead of registering a
// second copy under another name or scope.
registerSecretUsage(GEMINI_API_KEY, [
  {
    appId: "brain",
    feature: "Embeddings",
    effectWhenRemoved:
      "Semantic search uses another provider, or falls back to keyword search.",
  },
]);

registerSecretUsage("OPENAI_API_KEY", [
  {
    appId: "brain",
    feature: "Search embeddings",
    effectWhenRemoved:
      "New Slack and Zoom items are not embedded and semantic search fails.",
  },
]);

registerRequiredSecret({
  key: "COHERE_API_KEY",
  label: "Cohere API Key",
  description:
    "Optional shared embedding provider for Brain semantic retrieval. Lexical search remains available without it.",
  docsUrl: "https://dashboard.cohere.com/api-keys",
  scope: "workspace",
  kind: "api-key",
  usedFor: [
    {
      appId: "brain",
      feature: "Embeddings",
      effectWhenRemoved:
        "Semantic search uses another provider, or falls back to keyword search.",
    },
  ],
  required: false,
});

registerRequiredSecret({
  key: "VOYAGE_API_KEY",
  label: "Voyage API Key",
  description:
    "Optional shared embedding provider for Brain semantic retrieval. Lexical search remains available without it.",
  docsUrl: "https://dashboard.voyageai.com/api-keys",
  scope: "workspace",
  kind: "api-key",
  usedFor: [
    {
      appId: "brain",
      feature: "Embeddings",
      effectWhenRemoved:
        "Semantic search uses another provider, or falls back to keyword search.",
    },
  ],
  required: false,
});
