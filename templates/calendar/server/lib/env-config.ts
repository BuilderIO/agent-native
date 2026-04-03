import type { EnvKeyConfig } from "@agent-native/core/server";

export const envKeys: EnvKeyConfig[] = [
  { key: "GOOGLE_CLIENT_ID", label: "Google OAuth Client ID", required: false },
  {
    key: "GOOGLE_CLIENT_SECRET",
    label: "Google OAuth Client Secret",
    required: false,
  },
  { key: "DATABASE_URL", label: "Database URL", required: false },
  {
    key: "DATABASE_AUTH_TOKEN",
    label: "Database Auth Token",
    required: false,
  },
  {
    key: "TURNSTILE_SECRET_KEY",
    label: "Turnstile Secret Key",
    required: false,
  },
  {
    key: "VITE_TURNSTILE_SITE_KEY",
    label: "Turnstile Site Key",
    required: false,
  },
];
