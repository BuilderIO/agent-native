import type { EnvKeyConfig } from "@agent-native/core/server";

export const envKeys: EnvKeyConfig[] = [
  {
    key: "ATLASSIAN_CLIENT_ID",
    label: "Atlassian OAuth Client ID",
    required: false,
  },
  {
    key: "ATLASSIAN_CLIENT_SECRET",
    label: "Atlassian OAuth Client Secret",
    required: false,
  },
];
