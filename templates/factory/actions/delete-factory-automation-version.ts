import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import {
  deleteFactoryAutomationVersionRow,
  getFactoryAutomationVersionRow,
  resolveFactoryAutomationForHistory,
} from "../server/lib/factory-automation-history.js";
import {
  requireWorkspaceMember,
  workspaceMemberIdentityFromContext,
} from "../server/lib/require-workspace-member.js";

export default defineAction({
  description:
    "Permanently delete one saved prompt/config version for a Factory automation. Irreversible: the version cannot be recovered afterward. Only removes that history entry — the automation's current, live content and other versions are untouched. Confirm with the user before deleting anything they did not explicitly ask to remove.",
  schema: z.object({
    automationId: z.string().trim().min(1),
    versionId: z.string().trim().min(1).max(240),
  }),
  run: async ({ automationId, versionId }, context) => {
    const { orgId } = await requireWorkspaceMember(
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
    const deleted = await deleteFactoryAutomationVersionRow({
      id: versionId,
      orgId,
    });
    if (!deleted) {
      throw new Error("Factory automation version was already deleted.");
    }
    return {
      ok: true as const,
      automationId,
      versionId,
      version: row.version,
    };
  },
});
