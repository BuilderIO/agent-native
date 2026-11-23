import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import {
  endorsedCatalogOutputSchema,
  listDataEndorsedCatalog,
} from "../server/model/data-endorsed-catalog.js";

export default defineAction({
  description:
    "List endorsed data catalog resources for the current workspace grouped by canonical item type (view, model, table, schema), alongside endorsed statuses and categories.",
  schema: z.object({}).strict(),
  outputSchema: endorsedCatalogOutputSchema,
  http: { method: "GET" },
  readOnly: true,
  persistInBrowser: false,
  run: (_input, context) => listDataEndorsedCatalog(context?.caller),
});
