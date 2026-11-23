import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import { cancelProjectQuery } from "../server/model/project-query.js";

export default defineAction({
  description:
    "Request cancellation of a running SQL cell or check its provider outcome.",
  schema: z
    .object({
      projectId: z.string().min(1),
      cellId: z.string().min(1),
      requestId: z.string().uuid(),
      operation: z.literal("status").optional(),
    })
    .strict(),
  outputSchema: z.object({
    status: z.enum(["cancelling", "cancelled", "running", "error"]),
  }),
  mcpAnnotations: {
    readOnlyHint: false,
    destructiveHint: false,
    openWorldHint: false,
  },
  run: (input, context) =>
    cancelProjectQuery(input, context?.caller ?? "unknown"),
});
