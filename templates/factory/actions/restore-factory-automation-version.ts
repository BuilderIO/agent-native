import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import {
  getFactoryAutomationVersionRow,
  resolveFactoryAutomationForHistory,
  restoreFactoryAutomationVersion,
} from "../server/lib/factory-automation-history.js";
import {
  requireWorkspaceMember,
  workspaceMemberIdentityFromContext,
} from "../server/lib/require-workspace-member.js";

export default defineAction({
  description:
    "Restore a Factory automation to a saved prompt/config version. Restoring never deletes history: it writes the selected version's content back as a new save, preserving current schedule/run bookkeeping.",
  schema: z.object({
    automationId: z.string().trim().min(1),
    versionId: z.string().trim().min(1).max(240),
  }),
  run: async ({ automationId, versionId }, context) => {
    const { userEmail, orgId } = await requireWorkspaceMember(
      workspaceMemberIdentityFromContext(context),
    );
    const resolved = await resolveFactoryAutomationForHistory(
      orgId,
      automationId,
    );
    if (!resolved) {
      throw new Error("Factory automation not found.");
    }
    const row = await getFactoryAutomationVersionRow({
      id: versionId,
      orgId,
    });
    if (!row || row.automationId !== automationId) {
      throw new Error("Factory automation version not found.");
    }

    const result = await restoreFactoryAutomationVersion({
      resource: resolved.resource,
      automationId,
      automationName: resolved.name,
      factoryId: resolved.factoryId,
      historicalContent: row.rawContent,
      userEmail,
      orgId,
      summary: `Before restoring version ${row.version}`,
    });

    return {
      ok: true as const,
      automationId,
      factoryId: resolved.factoryId,
      restoredFromVersion: row.version,
      version: result.version,
      configSavedAt: result.configSavedAt,
      displayName: result.displayName,
    };
  },
});
