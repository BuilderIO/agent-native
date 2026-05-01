import type { EnvKeyConfig } from "@agent-native/core/server";

export const envKeys: EnvKeyConfig[] = [
  { key: "GOOGLE_CLIENT_ID", label: "Google OAuth Client ID", required: false },
  {
    key: "GOOGLE_CLIENT_SECRET",
    label: "Google OAuth Client Secret",
    required: false,
  },
  {
    key: "SLACK_BOT_TOKEN",
    label: "Slack Bot Token",
    required: false,
    helpText:
      "Bot User OAuth Token for Slack draft intake. Needs chat:write and users:read.email.",
  },
  {
    key: "SLACK_SIGNING_SECRET",
    label: "Slack Signing Secret",
    required: false,
    helpText: "Used to verify Slack Events API webhooks.",
  },
  {
    key: "ANTHROPIC_API_KEY",
    label: "Anthropic API Key",
    required: false,
    helpText: "Used by Slack integration agent runs.",
  },
  {
    key: "A2A_SECRET",
    label: "Internal Task Signing Secret",
    required: false,
    helpText:
      "Required in production for secure background processing of Slack webhooks.",
  },
];
