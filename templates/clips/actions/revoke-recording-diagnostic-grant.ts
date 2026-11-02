import { defineAction } from "@agent-native/core/action";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import {
  diagnosticFailure,
  requireDiagnosticOwner,
} from "../server/lib/diagnostic-context.js";
export default defineAction({
  audit: { recordInputs: false },
  description:
    "Revoke one diagnostic grant immediately without changing playback access. Previously downloaded external copies cannot be recalled.",
  schema: z.object({ grantId: z.string() }),
  outputSchema: z.object({ revoked: z.literal(true) }),
  run: async ({ grantId }) => {
    const grant = (
      await getDb()
        .select()
        .from(schema.recordingDiagnosticGrants)
        .where(eq(schema.recordingDiagnosticGrants.id, grantId))
        .limit(1)
    )
      .values()
      .next().value;
    if (!grant) diagnosticFailure("grant_missing", 404);
    await requireDiagnosticOwner(grant.contextId);
    await getDb()
      .update(schema.recordingDiagnosticGrants)
      .set({ revokedAt: new Date().toISOString() })
      .where(eq(schema.recordingDiagnosticGrants.id, grantId));
    return { revoked: true as const };
  },
});
