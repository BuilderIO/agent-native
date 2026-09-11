import type { EnvKeyConfig } from "@agent-native/core/server";

export const envKeys: EnvKeyConfig[] = [
  {
    key: "SLACK_BOT_TOKEN",
    label: "Slack bot token (legacy)",
    required: false,
  },
  {
    key: "SLACK_CLIENT_ID",
    label: "Slack OAuth client ID",
    required: true,
  },
  {
    key: "SLACK_CLIENT_SECRET",
    label: "Slack OAuth client secret",
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
    key: "TELEGRAM_WEBHOOK_SECRET",
    label: "Telegram webhook secret",
    required: true,
  },
  {
    key: "MICROSOFT_TEAMS_APP_ID",
    label: "Microsoft Bot app ID",
    required: false,
  },
  {
    key: "MICROSOFT_TEAMS_APP_PASSWORD",
    label: "Microsoft Bot client secret",
    required: false,
  },
  {
    key: "MICROSOFT_TEAMS_APP_TENANT_ID",
    label: "Microsoft Bot tenant ID",
    required: false,
  },
  {
    key: "MICROSOFT_TEAMS_ALLOWED_TENANT_IDS",
    label: "Allowed Microsoft Teams tenant IDs",
    required: false,
  },
  {
    key: "DISCORD_APPLICATION_ID",
    label: "Discord application ID",
    required: false,
  },
  {
    key: "DISCORD_PUBLIC_KEY",
    label: "Discord public key",
    required: false,
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
  {
    key: "WHATSAPP_APP_SECRET",
    label: "WhatsApp app secret",
    required: false,
  },
  {
    key: "PYLON_API_KEY",
    label: "Pylon API key",
    required: false,
  },
];
