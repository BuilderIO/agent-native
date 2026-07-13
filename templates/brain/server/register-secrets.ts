import { registerRequiredSecret } from "@agent-native/core/secrets";

registerRequiredSecret({
  key: "SLACK_BOT_TOKEN",
  label: "Slack Bot Token (local fallback)",
  description:
    "Optional local fallback for Brain channel backfills. Prefer a Slack workspace integration in Settings > Connections. Brain only scans allow-listed channels and never enumerates DMs.",
  docsUrl: "https://api.slack.com/authentication/token-types",
  scope: "workspace",
  kind: "api-key",
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
  required: false,
});
