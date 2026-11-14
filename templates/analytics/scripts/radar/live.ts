import dotenv from "dotenv";

import { isLocalDatabaseUrl, RadarQueryError } from "./query.ts";

export function liveDatabaseUrlFromEnv(contents: string): string {
  const parsed: Record<string, unknown> = dotenv.parse(contents);
  const databaseUrlValue = parsed.DATABASE_URL;
  const databaseUrl =
    typeof databaseUrlValue === "string" ? databaseUrlValue.trim() : undefined;
  if (!databaseUrl || isLocalDatabaseUrl(databaseUrl)) {
    throw new RadarQueryError(
      "Live radar requires a remote DATABASE_URL in the selected environment file.",
      2,
    );
  }
  return databaseUrl;
}
