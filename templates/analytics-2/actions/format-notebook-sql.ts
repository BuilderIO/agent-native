import { defineAction, defineActionErrors } from "@agent-native/core/action";
import { z } from "zod";

import {
  formatSqlWithConfig,
  MAX_FORMAT_SQL_BYTES,
} from "../server/formatter/sqlfluff.js";
import {
  readWorkingCell,
  requireWritableProject,
} from "../server/lib/project-action-access.js";

const errors = defineActionErrors(
  "notebook_format_sql_required",
  "notebook_format_sql_failed",
);

export default defineAction({
  errors,
  description:
    "Format a notebook SQL draft without saving or running the cell.",
  schema: z.strictObject({
    projectId: z.string().min(1).describe("Project ID."),
    cellId: z.string().min(1).describe("SQL cell ID in the working notebook."),
    source: z.string().max(MAX_FORMAT_SQL_BYTES).describe("Current SQL draft."),
  }),
  readOnly: true,
  outputSchema: z.object({ formattedSource: z.string() }),
  run: async ({ projectId, cellId, source }) => {
    const { project } = await requireWritableProject(projectId);
    const cell = await readWorkingCell(project, cellId);
    if (cell.kind !== "sql")
      errors.fail("Choose a SQL cell.", "notebook_format_sql_required", {
        statusCode: 422,
      });

    try {
      const { formattedSource } = await formatSqlWithConfig({
        config: [
          "[sqlfluff]",
          "templater = raw",
          "rules = layout.spacing,layout.indent,layout.select_targets,layout.end_of_file,capitalisation.keywords",
          "[sqlfluff:indentation]",
          "tab_space_size = 4",
          "[sqlfluff:rules:capitalisation.keywords]",
          "capitalisation_policy = lower",
        ].join("\n"),
        source,
        fallbackDialect: "bigquery",
      });
      return { formattedSource };
    } catch {
      return errors.fail(
        "Could not format SQL.",
        "notebook_format_sql_failed",
        {
          statusCode: 422,
        },
      );
    }
  },
});
