import { defineAction, type ActionRunContext } from "@agent-native/core/action";
import { z } from "zod";

import type { ContentDatabaseViewConfig } from "../shared/api.js";
import {
  OPENING_DATABASE_ROW_LIMIT,
  openingDatabaseTableQuery,
} from "../shared/database-open-table-query.js";
import getContentDatabasePersonalView from "./get-content-database-personal-view.js";
import getContentDatabase from "./get-content-database.js";
import getDocument from "./get-document.js";
import queryContentDatabaseItems from "./query-content-database-items.js";

// Each part is the answer its own action gives this caller, so the page shows
// exactly what those reads would. A collection part that fails is left out:
// the page then sends that read itself, and its own request reports the error.
async function readOpeningCollection(
  documentId: string,
  database: { id: string; viewConfig: ContentDatabaseViewConfig },
  requestedViewId: string | undefined,
  ctx: ActionRunContext | undefined,
) {
  const base = getContentDatabase.run(
    { documentId, limit: OPENING_DATABASE_ROW_LIMIT },
    ctx,
  );
  const personalView = ctx?.userEmail
    ? (async () =>
        getContentDatabasePersonalView.run({ databaseId: database.id }, ctx))()
    : null;
  const rows = (async () => {
    if (!personalView) return null;
    const tableQuery = openingDatabaseTableQuery({
      viewConfig: database.viewConfig,
      overrides: (await personalView).overrides,
      requestedViewId,
    });
    if (!tableQuery) return null;
    return {
      tableQuery,
      page: await queryContentDatabaseItems.run(
        { documentId, limit: OPENING_DATABASE_ROW_LIMIT, tableQuery },
        ctx,
      ),
    };
  })();
  const [baseRead, personalViewRead, rowsRead] = await Promise.allSettled([
    base,
    personalView,
    rows,
  ]);
  return {
    // coercion-ok: a part left out is read again by the page, which reports it.
    ...(baseRead.status === "fulfilled" ? { database: baseRead.value } : {}),
    ...(personalViewRead.status === "fulfilled" && personalViewRead.value
      ? { personalView: personalViewRead.value }
      : {}),
    ...(rowsRead.status === "fulfilled" && rowsRead.value
      ? { rows: rowsRead.value }
      : {}),
  };
}

// It returns get-document's answer and the collection reads' own answers.
// guard:allow-no-output-schema — none of the reads it returns declares one.
export default defineAction({
  description:
    "Read what opening one page shows first: the page as get-document returns it with the reader's unsaved draft and, for a collection page, its first rows and the reader's personal view. The page editor sends this when it opens a page.",
  schema: z.object({
    id: z.string().describe("Stable document ID of the page being opened."),
    databaseId: z
      .string()
      .optional()
      .describe("Exact collection ID the page is opened in, as get-document."),
    databaseDocumentId: z
      .string()
      .optional()
      .describe("Backing collection document ID, as get-document."),
    databaseViewId: z
      .string()
      .optional()
      .describe("Collection view the page's address selects, if any."),
  }),
  http: { method: "GET" },
  readOnly: true,
  agentTool: false,
  run: async (args, ctx) => {
    const document = await getDocument.run(
      {
        id: args.id,
        ...(args.databaseId ? { databaseId: args.databaseId } : {}),
        ...(args.databaseDocumentId
          ? { databaseDocumentId: args.databaseDocumentId }
          : {}),
        includePreviewDraft: true,
      },
      ctx,
    );
    // Only a collection's own page shows its table; a row opened in a
    // collection shows the row.
    if (!document.database || args.databaseId) return { document };
    return {
      document,
      collection: await readOpeningCollection(
        document.id,
        document.database,
        args.databaseViewId,
        ctx,
      ),
    };
  },
});
