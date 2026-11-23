import {
  defineAction,
  fail,
  isActionContractError,
} from "@agent-native/core/action";
import { z } from "zod";

import { cellOutputSchema } from "../app/lib/model/contracts.js";
import { requireReadableProject } from "../server/lib/project-action-access.js";
import { runPublishedProjectQuery } from "../server/model/project-query.js";
import { getReadableProjectDocument } from "../server/model/projects-store.js";

export default defineAction({
  description:
    "Run a SQL cell on a legacy published version with viewer-local input values. Open a private app session for current releases.",
  schema: z
    .object({
      projectId: z.string().min(1),
      version: z.string().min(1),
      cellId: z.string().min(1),
      point: z
        .object({ x: z.string().max(500), series: z.string().max(500) })
        .optional(),
      values: z.record(
        z.string(),
        z.union([z.string().max(500), z.array(z.string().max(500)).max(200)]),
      ),
    })
    .strict(),
  outputSchema: z.object({ output: cellOutputSchema }),
  readOnly: true,
  run: async ({ projectId, version, cellId, values, point }, context) => {
    const { scope, project } = await requireReadableProject(projectId);
    const document = await getReadableProjectDocument(
      scope,
      project.id,
      version,
      "published",
    );
    const versionId =
      version === "latest" ? document?.publishedVersionId : version;
    if (!document || !versionId)
      fail("That published version is not available.", {
        statusCode: 404,
        errorCode: "project_version_not_found",
      });
    if (document.publishedHead)
      fail("This release uses a private app session.", {
        statusCode: 409,
        errorCode: "app_session_required",
      });
    const cell = document.cells.find((entry) => entry.id === cellId);
    const chart =
      point && cell?.contents.kind === "chart" ? cell.contents : null;
    const sqlCell = chart
      ? document.cells.find(
          (entry) =>
            entry.contents.kind === "sql" &&
            entry.contents.resultVariable === chart.dataframe,
        )
      : cell;
    if (
      !sqlCell ||
      sqlCell.contents.kind !== "sql" ||
      (point && !chart?.drilldownSql)
    )
      fail("That SQL cell is not available.", {
        statusCode: 404,
        errorCode: "project_sql_cell_not_found",
      });
    try {
      return {
        output: await runPublishedProjectQuery({
          project: document,
          versionId,
          cellId: sqlCell.id,
          contents: sqlCell.contents,
          source: chart?.drilldownSql ?? sqlCell.contents.source,
          scope,
          caller: context?.caller ?? "unknown",
          values,
          point,
          ...(chart && cell ? { chartCellId: cell.id } : {}),
        }),
      };
    } catch (error) {
      if (!isActionContractError(error) || error.statusCode < 500) throw error;
      fail(error.message, {
        statusCode: 424,
        errorCode: error.errorCode,
        ...(error.details ? { details: error.details } : {}),
      });
    }
  },
});
