import { defineAction } from "@agent-native/core/action";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { requireDiagnosticOwner } from "../server/lib/diagnostic-context.js";
import { diagnosticScopeSchema } from "../shared/diagnostic-context.js";
export default defineAction({
  audit: { recordInputs: false },
  description:
    "List diagnostic grants without bearer credentials. Only the private context owner may manage grants.",
  schema: z.object({ contextId: z.string() }),
  readOnly: true,
  http: { method: "GET" },
  outputSchema: z.object({
    grants: z.array(
      z.object({
        id: z.string(),
        label: z.string(),
        scopes: z.array(diagnosticScopeSchema),
        fromMs: z.number().nullable(),
        toMs: z.number().nullable(),
        expiresAt: z.string(),
        revokedAt: z.string().nullable(),
      }),
    ),
  }),
  run: async ({ contextId }) => {
    await requireDiagnosticOwner(contextId);
    const rows = await getDb()
      .select()
      .from(schema.recordingDiagnosticGrants)
      .where(eq(schema.recordingDiagnosticGrants.contextId, contextId))
      .limit(100);
    return {
      grants: rows.map((row) => ({
        id: row.id,
        label: row.label,
        scopes: z
          .array(diagnosticScopeSchema)
          .parse(JSON.parse(row.scopesJson)),
        fromMs: row.fromMs,
        toMs: row.toMs,
        expiresAt: row.expiresAt,
        revokedAt: row.revokedAt,
      })),
    };
  },
});
