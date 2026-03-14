import type { Response } from "express";

export interface MissingKeyResponse {
  error: "missing_api_key";
  key: string;
  label: string;
  message: string;
  settingsPath: string;
}

/**
 * Check if an env var is set. If not, send a structured missing_api_key response.
 * Returns true if the key is missing (response was sent), false if the key exists.
 */
export function requireEnvKey(
  res: Response,
  key: string,
  label: string,
  options?: { message?: string; settingsPath?: string }
): boolean {
  if (process.env[key]) return false;

  res.status(200).json({
    error: "missing_api_key",
    key,
    label,
    message: options?.message ?? `Connect your ${label} account to see this data`,
    settingsPath: options?.settingsPath ?? "/settings",
  } satisfies MissingKeyResponse);
  return true;
}
