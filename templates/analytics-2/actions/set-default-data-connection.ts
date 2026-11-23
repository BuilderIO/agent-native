import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import { setDefaultDataConnection } from "../server/model/data-connections.js";
export default defineAction({
  description:
    "Set or clear the workspace default warehouse connection. Requires workspace management access and a shared live connection.",
  schema: z.object({ id: z.string().min(1).nullable() }).strict(),
  outputSchema: z.object({ id: z.string().nullable() }),
  http: { method: "POST" },
  mcpAnnotations: {
    readOnlyHint: false,
    destructiveHint: true,
    openWorldHint: false,
  },
  run: async ({ id }) => setDefaultDataConnection(id),
});
