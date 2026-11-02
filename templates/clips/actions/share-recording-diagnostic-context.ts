import { defineAction } from "@agent-native/core/action";
import { isOrgMember } from "@agent-native/core/org";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import {
  diagnosticFailure,
  diagnosticPrincipal,
  requireDiagnosticOwner,
} from "../server/lib/diagnostic-context.js";
export default defineAction({
  agentTool: false,
  audit: { recordInputs: false },
  description:
    "Manage explicit named private-context readers in the same organization. Recording roles and organization visibility confer no diagnostic access.",
  schema: z.object({
    contextId: z.string(),
    email: z.string().trim().toLowerCase().pipe(z.email()),
  }),
  outputSchema: z.object({ shared: z.literal(true) }),
  run: async ({ contextId, email }) => {
    await requireDiagnosticOwner(contextId);
    const principal = diagnosticPrincipal();
    if (!(await isOrgMember(principal.orgId, email)))
      diagnosticFailure("recipient_membership_required");
    await getDb()
      .insert(schema.recordingDiagnosticContextShares)
      .values({
        id: crypto.randomUUID(),
        resourceId: contextId,
        principalType: "user",
        principalId: email,
        role: "viewer",
        createdBy: principal.ownerEmail,
      })
      .onConflictDoNothing();
    return { shared: true as const };
  },
});
