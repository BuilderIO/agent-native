import { defineAction } from "@agent-native/core";
import { buildDeepLink } from "@agent-native/core/server";

import type { ContentDatabaseBlocksReadResult } from "../shared/database-block-actions.js";
import {
  listDatabaseBlocks,
  listDatabaseBlocksSchema,
} from "./_database-block-actions.js";

export default defineAction({
  description:
    "List stable blocks in one exact Content database row and Blocks property. Returns schema, row, and field revisions plus each block's supported individual operations.",
  schema: listDatabaseBlocksSchema,
  http: { method: "GET" },
  readOnly: true,
  run: listDatabaseBlocks,
  link: ({ result }) => {
    const documentId = (result as ContentDatabaseBlocksReadResult | null)
      ?.target.rowDocumentId;
    if (!documentId) return null;
    return {
      url: buildDeepLink({
        app: "content",
        view: "editor",
        params: { documentId },
      }),
      label: "Open database row",
      view: "editor",
    };
  },
});
