import { defineEventHandler, setResponseStatus } from "h3";
import { requireCredential } from "../lib/credentials";
import { runQuery } from "../lib/bigquery";
import { getDbExec } from "@agent-native/core/db";
import { readBody } from "@agent-native/core/server";

export const handleSqlQuery = defineEventHandler(async (event) => {
  const { query, source } = await readBody(event);

  if (!query || typeof query !== "string") {
    setResponseStatus(event, 400);
    return { error: "Missing or invalid query" };
  }

  if (!source || !["bigquery", "app-db"].includes(source)) {
    setResponseStatus(event, 400);
    return { error: "Invalid source. Must be 'bigquery' or 'app-db'" };
  }

  try {
    if (source === "bigquery") {
      const missing = await requireCredential(
        event,
        "BIGQUERY_PROJECT_ID",
        "BigQuery",
      );
      if (missing) return missing;
      const result = await runQuery(query);
      return result;
    }

    // app-db: strict read-only enforcement
    const trimmed = query.trim().toUpperCase();
    if (!trimmed.startsWith("SELECT") && !trimmed.startsWith("WITH")) {
      setResponseStatus(event, 400);
      return { error: "Only SELECT queries are allowed for app-db" };
    }
    const forbiddenPattern =
      /\b(INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|TRUNCATE|REPLACE|ATTACH|DETACH|PRAGMA|LOAD_EXTENSION|VACUUM|REINDEX)\b/i;
    if (forbiddenPattern.test(query)) {
      setResponseStatus(event, 400);
      return { error: "Only SELECT queries are allowed for app-db" };
    }
    // Block semicolons to prevent statement stacking
    if (query.includes(";")) {
      const statementsBeforeSemicolon = query
        .split(";")
        .filter((s) => s.trim());
      if (statementsBeforeSemicolon.length > 1) {
        setResponseStatus(event, 400);
        return { error: "Multiple statements are not allowed" };
      }
    }

    const client = getDbExec();
    const { rows } = await client.execute(query);
    const schema =
      rows.length > 0
        ? Object.keys(rows[0] as Record<string, unknown>).map((name) => ({
            name,
            type: typeof (rows[0] as Record<string, unknown>)[name],
          }))
        : [];
    return { rows, schema };
  } catch (error: any) {
    const message = error?.message || String(error);
    console.error(`SQL query error (${source}):`, message);
    setResponseStatus(event, 400);
    return { error: message };
  }
});
