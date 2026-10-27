import dotenv from "dotenv";

import { isLocalDatabaseUrl, RadarQueryError } from "./query.ts";

export function liveDatabaseUrlFromEnv(contents: string): string {
  const databaseUrl = dotenv.parse(contents).DATABASE_URL?.trim();
  if (!databaseUrl || isLocalDatabaseUrl(databaseUrl)) {
    throw new RadarQueryError(
      "Live radar requires a remote DATABASE_URL in the selected environment file.",
      2,
    );
  }
  return databaseUrl;
}
