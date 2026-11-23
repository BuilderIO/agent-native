import {
  defineAction,
  defineActionErrors,
  fail,
} from "@agent-native/core/action";
import { z } from "zod";

import {
  formatSqlWithConfig,
  MAX_FORMAT_SQL_BYTES,
} from "../server/formatter/sqlfluff.js";

const errors = defineActionErrors(
  "sql_format_failed",
  "sql_format_unparseable",
);

/** The formatter's own defaults; the app has no per-workspace rule file for notebook SQL. */
const NOTEBOOK_FORMAT_CONFIG = `[sqlfluff]
dialect = bigquery
templater = raw
[sqlfluff:rules:capitalisation.keywords]
capitalisation_policy = upper
[sqlfluff:indentation]
indent_unit = space
tab_space_size = 2
`;

// raw-sql-ok: the schema names the text to format; nothing here composes or runs a query
export default defineAction({
  description:
    "Format SQL text with the bundled SQL formatter (BigQuery dialect, upper-case keywords). Returns the formatted text; it never saves a cell.",
  schema: z.object({ sql: z.string().max(MAX_FORMAT_SQL_BYTES) }).strict(),
  outputSchema: z
    .object({ formattedSource: z.string(), changed: z.boolean() })
    .strict(),
  errors,
  readOnly: true,
  retrySafe: true,
  http: { method: "POST" },
  run: async ({ sql }) => {
    try {
      const result = await formatSqlWithConfig({
        config: NOTEBOOK_FORMAT_CONFIG,
        source: sql,
      });
      return {
        formattedSource: result.formattedSource,
        changed: result.changed,
      };
    } catch (error) {
      const code = (error as { code?: string }).code;
      if (code === "parse_error" || code === "template_error") {
        fail("This SQL could not be parsed, so it was left as written.", {
          statusCode: 422,
          errorCode: "sql_format_unparseable",
        });
      }
      fail("The SQL formatter is unavailable. Your SQL was not changed.", {
        statusCode: 503,
        errorCode: "sql_format_failed",
      });
    }
  },
});
