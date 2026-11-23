import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import {
  dataConnectionOutput,
  listDataConnections,
} from "../server/model/data-connections.js";
export default defineAction({
  description:
    "List the signed-in account's granted warehouse connections without credential values.",
  schema: z.object({}),
  outputSchema: z.object({ connections: z.array(dataConnectionOutput) }),
  http: { method: "GET" },
  readOnly: true,
  persistInBrowser: false,
  run: async (_args, context) => ({
    connections: await listDataConnections({
      forAgent: context?.caller !== "frontend",
    }),
  }),
});
