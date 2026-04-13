import type { EnvKeyConfig } from "@agent-native/core/server";

export const envKeys: EnvKeyConfig[] = [
  {
    key: "SLACK_BOT_TOKEN",
    label: "Slack bot token",
    required: true,
  },
  {
    key: "SLACK_SIGNING_SECRET",
    label: "Slack signing secret",
    required: true,
  },
  {
    key: "TELEGRAM_BOT_TOKEN",
    label: "Telegram bot token",
    required: true,
  },
];
