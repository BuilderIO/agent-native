import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import { getDataTableDetailsSchema } from "../app/lib/model/data-table-contracts.js";
import { getDataTablePreview } from "../server/model/data-table-preview.js";

export default defineAction({
  description:
    "Read up to 50 preview rows from an authorized table using its opaque data-browser ID. Respects connection preview settings and agent data policies.",
  schema: getDataTableDetailsSchema,
  outputSchema: z
    .object({
      connectionId: z.string(),
      tableId: z.string(),
      columns: z.array(z.string()),
      rows: z.array(z.array(z.unknown())).max(50),
    })
    .strict(),
  http: { method: "GET" },
  readOnly: true,
  persistInBrowser: false,
  run: (input, context) => getDataTablePreview(input, context?.caller),
});
