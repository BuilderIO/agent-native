import { setResponseStatus, type H3Event } from "h3";

export interface MissingKeyResponse {
  error: "missing_api_key";
  key: string;
  label: string;
  message: string;
  settingsPath: string;
}

export function requireEnvKey(
  event: H3Event,
  key: string,
  label: string,
  options?: { message?: string; settingsPath?: string },
): MissingKeyResponse | null {
  if (process.env[key]) return null;

  setResponseStatus(event, 200);
  return {
    error: "missing_api_key",
    key,
    label,
    message:
      options?.message ?? `Connect your ${label} account to see this data`,
    settingsPath: options?.settingsPath ?? "/settings",
  };
}
