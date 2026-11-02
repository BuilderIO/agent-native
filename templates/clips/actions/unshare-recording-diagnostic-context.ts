import { defineAction } from "@agent-native/core/action";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { requireDiagnosticOwner } from "../server/lib/diagnostic-context.js";
export default defineAction({
  audit: { recordInputs: false },
  description:
    "Manage explicit named private-context readers in the same organization. Recording roles and organization visibility confer no diagnostic access.",
  schema: z.object({
    contextId: z.string(),
    email: z.string().trim().toLowerCase().pipe(z.email()),
  }),
  outputSchema: z.object({ removed: z.literal(true) }),
  run: async ({ contextId, email }) => {
    await requireDiagnosticOwner(contextId);
    await getDb()
      .delete(schema.recordingDiagnosticContextShares)
      .where(
        and(
          eq(schema.recordingDiagnosticContextShares.resourceId, contextId),
          eq(schema.recordingDiagnosticContextShares.principalType, "user"),
          eq(schema.recordingDiagnosticContextShares.principalId, email),
        ),
      );
    return { removed: true as const };
  },
});
