import { defineAction } from "@agent-native/core/action";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { requireDiagnosticOwner } from "../server/lib/diagnostic-context.js";
export default defineAction({
  audit: { recordInputs: false },
  description:
    "Manage explicit named private-context readers in the same organization. Recording roles and organization visibility confer no diagnostic access.",
  readOnly: true,
  http: { method: "GET" },
  schema: z.object({ contextId: z.string() }),
  outputSchema: z.object({ shares: z.array(z.object({ email: z.string() })) }),
  run: async ({ contextId }) => {
    await requireDiagnosticOwner(contextId);
    const rows = await getDb()
      .select({ email: schema.recordingDiagnosticContextShares.principalId })
      .from(schema.recordingDiagnosticContextShares)
      .where(
        and(
          eq(schema.recordingDiagnosticContextShares.resourceId, contextId),
          eq(schema.recordingDiagnosticContextShares.principalType, "user"),
        ),
      )
      .limit(100);
    return { shares: rows };
  },
});
