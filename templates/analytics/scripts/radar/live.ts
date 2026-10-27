import dotenv from "dotenv";

import { isLocalDatabaseUrl, RadarQueryError } from "./query.ts";

export function liveDatabaseUrlFromEnv(contents: string): string {
  const parsed = dotenv.parse(contents);
  const databaseUrl = Object.prototype.hasOwnProperty.call(
    parsed,
    "DATABASE_URL",
  )
    ? parsed.DATABASE_URL.trim()
    : undefined;
  if (!databaseUrl || isLocalDatabaseUrl(databaseUrl)) {
    throw new RadarQueryError(
      "Live radar requires a remote DATABASE_URL in the selected environment file.",
      2,
    );
  }
  return databaseUrl;
}
