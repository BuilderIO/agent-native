import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import { readPromptVersion } from "../server/lib/factory-automation-config.js";
import {
  getFactoryAutomationVersionRow,
  resolveFactoryAutomationForHistory,
  snapshotFromAutomationResource,
} from "../server/lib/factory-automation-history.js";
import {
  requireWorkspaceMember,
  workspaceMemberIdentityFromContext,
} from "../server/lib/require-workspace-member.js";

export default defineAction({
  description:
    "Read one saved Factory automation prompt/config version for history preview or as the source to restore. Scoped to the active workspace and does not change the current automation.",
  schema: z.object({
    automationId: z.string().trim().min(1),
    versionId: z.string().trim().min(1).max(240),
  }),
  http: { method: "GET" },
  readOnly: true,
  parallelSafe: true,
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
    const currentVersion = readPromptVersion(resolved.resource.content);
    const snapshot = snapshotFromAutomationResource(
      row.rawContent,
      resolved.name,
      row.factoryId,
    );

    return {
      id: row.id,
      automationId: row.automationId,
      factoryId: row.factoryId,
      version: row.version,
      rawContent: row.rawContent,
      userPrompt: snapshot.userPrompt,
      displayName: snapshot.displayName,
      config: snapshot.config,
      promptVersion: snapshot.promptVersion,
      configSavedAt: snapshot.configSavedAt,
      source: row.source,
      summary: row.summary,
      createdAt: row.createdAt,
      createdBy: row.createdBy,
      isCurrent: currentVersion === row.version,
    };
  },
});
