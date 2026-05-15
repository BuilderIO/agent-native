import { registerRequiredSecret } from "@agent-native/core/secrets";

registerRequiredSecret({
  key: "SLACK_BOT_TOKEN",
  label: "Slack Bot Token",
  description:
    "Optional Slack bot token for channel backfills. Brain only scans allow-listed channels and never enumerates DMs.",
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
