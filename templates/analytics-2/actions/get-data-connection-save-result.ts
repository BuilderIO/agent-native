import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import {
  dataConnectionOutput,
  getDataConnectionSaveResult,
} from "../server/model/data-connections.js";
export default defineAction({
  description:
    "Read the redacted result of this signed-in account's private connection save request.",
  schema: z.object({ requestId: z.string().uuid() }).strict(),
  outputSchema: z.object({ connection: dataConnectionOutput }),
  http: { method: "GET" },
  readOnly: true,
  persistInBrowser: false,
  run: async ({ requestId }) => ({
    connection: await getDataConnectionSaveResult(requestId),
  }),
});
