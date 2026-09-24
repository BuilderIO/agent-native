import { sql, type SQL } from "drizzle-orm";

import { documents } from "../db/schema.js";

export function bodyRevisionForContent(content: string | SQL) {
  return sql<number>`CASE WHEN ${documents.content} <> ${content} THEN ${documents.bodyRevision} + 1 ELSE ${documents.bodyRevision} END`;
}
