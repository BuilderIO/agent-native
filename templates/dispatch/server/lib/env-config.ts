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
  {
    key: "EMAIL_AGENT_ADDRESS",
    label: "Agent email address",
    required: false,
  },
  {
    key: "DISPATCH_DEFAULT_OWNER_EMAIL",
    label: "Default Slack owner email",
    required: false,
  },
  {
    key: "WHATSAPP_ACCESS_TOKEN",
    label: "WhatsApp access token",
    required: false,
  },
  {
    key: "WHATSAPP_VERIFY_TOKEN",
    label: "WhatsApp verify token",
    required: false,
  },
  {
    key: "WHATSAPP_PHONE_NUMBER_ID",
    label: "WhatsApp phone number ID",
    required: false,
  },
];
