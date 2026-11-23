import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import { listDataEndorsed } from "../server/model/data-endorsed.js";
import { endorsedListSchema } from "../shared/qa-keyscreen-fixture.js";

export default defineAction({
  description:
    "List the workspace's endorsed data (models, tables and schemas) shown on the Data page's Recommended panel. Empty when nothing is endorsed.",
  schema: z.object({}).strict(),
  outputSchema: endorsedListSchema,
  http: { method: "GET" },
  readOnly: true,
  persistInBrowser: false,
  run: () => listDataEndorsed(),
});
