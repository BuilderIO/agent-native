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
    label: "Slack Bot Token (legacy intake)",
    required: false,
    helpText:
      "Legacy single-workspace token for custom Slack draft intake. New messaging automations should connect Slack in Settings > Messaging. Needs chat:write and users:read.email.",
  },
  {
    key: "SLACK_SIGNING_SECRET",
    label: "Slack Signing Secret (legacy intake)",
    required: false,
    helpText:
      "Used only to verify webhooks for the legacy custom Slack draft intake.",
  },
  {
    key: "ANTHROPIC_API_KEY",
    label: "Anthropic API Key",
    required: false,
    helpText: "Used by Slack integration agent runs.",
  },
  {
    key: "A2A_SECRET",
    label: "Agent Signing Secret",
    required: false,
    helpText:
      "Required in production for secure background processing and external-agent MCP connections.",
  },
];
