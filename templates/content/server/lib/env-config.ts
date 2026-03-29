import type { EnvKeyConfig } from "@agent-native/core/server";

export const envKeys: EnvKeyConfig[] = [
  {
    key: "NOTION_API_KEY",
    label: "Notion API Key (Internal Integration)",
    required: false,
  },
  {
    key: "NOTION_CLIENT_ID",
    label: "Notion OAuth Client ID",
    required: false,
  },
  {
    key: "NOTION_CLIENT_SECRET",
    label: "Notion OAuth Client Secret",
    required: false,
  },
];
