import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import { readPromptVersion } from "../server/lib/factory-automation-config.js";
import {
  listFactoryAutomationVersionRows,
  resolveFactoryAutomationForHistory,
} from "../server/lib/factory-automation-history.js";
import {
  requireWorkspaceMember,
  workspaceMemberIdentityFromContext,
} from "../server/lib/require-workspace-member.js";

export default defineAction({
  description:
    "List bounded saved prompt/config version metadata for a Factory automation, newest first. Use get-factory-automation-version to read one full snapshot for preview or restore.",
  schema: z.object({
    automationId: z.string().trim().min(1),
    limit: z.coerce.number().int().min(1).max(50).default(25),
    beforeVersion: z.coerce.number().int().positive().optional(),
  }),
  http: { method: "GET" },
  readOnly: true,
  parallelSafe: true,
  run: async ({ automationId, limit, beforeVersion }, context) => {
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
    const currentVersion = readPromptVersion(resolved.resource.content);
    const { rows, hasMore } = await listFactoryAutomationVersionRows({
      automationId,
      orgId,
      limit,
      beforeVersion,
    });

    return {
      automationId,
      factoryId: resolved.factoryId,
      currentVersion,
      hasMore,
      nextBeforeVersion:
        hasMore && rows.length > 0 ? rows[rows.length - 1].version : null,
      versions: rows.map((row) => ({
        id: row.id,
        automationId: row.automationId,
        factoryId: row.factoryId,
        version: row.version,
        displayName: row.displayName,
        source: row.source,
        summary: row.summary,
        createdAt: row.createdAt,
        createdBy: row.createdBy,
        isCurrent: currentVersion === row.version,
      })),
    };
  },
});
