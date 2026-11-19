import { z } from "zod";

export const GOOGLE_SOURCE_PROVIDERS = [
  "google_calendar",
  "gmail",
  "google_drive",
] as const;

export type GoogleSourceProvider = (typeof GOOGLE_SOURCE_PROVIDERS)[number];

export function isGoogleSourceProvider(
  provider: string,
): provider is GoogleSourceProvider {
  return GOOGLE_SOURCE_PROVIDERS.some((value) => value === provider);
}

const googleSourceConfigSchema = z.object({
  calendarId: z.string().trim().min(1).max(256).default("primary"),
  query: z.string().trim().max(2000).default("newer_than:30d"),
  fileIds: z
    .array(
      z
        .string()
        .trim()
        .regex(/^[A-Za-z0-9_-]+$/),
    )
    .max(50)
    .default([]),
  lookbackDays: z.number().int().min(1).max(30).default(7),
  lookaheadDays: z.number().int().min(0).max(30).default(7),
  pageSize: z.number().int().min(1).max(25).default(10),
});

export function parseGoogleSourceConfig(
  provider: GoogleSourceProvider,
  config: Record<string, unknown>,
) {
  const parsed = googleSourceConfigSchema.parse(config.google ?? {});
  if (provider === "google_drive" && !parsed.fileIds.length) {
    throw new Error("Google Drive requires 1-50 approved file IDs.");
  }
  return parsed;
}

export function googleSourceScopeKey(
  provider: GoogleSourceProvider,
  config: Record<string, unknown>,
) {
  return JSON.stringify({
    provider,
    connectionId: config.workspaceConnectionId,
    options: parseGoogleSourceConfig(provider, config),
  });
}
