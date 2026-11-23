import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import {
  dataRecentsSchema,
  listDataRecents,
} from "../server/model/data-recents.js";

export default defineAction({
  description:
    "List your recently opened tables for your user and current workspace in last-opened order. Missing connections are omitted; access and read failures are errors.",
  schema: z.object({}).strict(),
  outputSchema: dataRecentsSchema,
  http: { method: "GET" },
  readOnly: true,
  persistInBrowser: false,
  run: (_input, context) => listDataRecents(context?.caller),
});
