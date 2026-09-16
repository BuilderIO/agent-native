import { registerVersionedResource } from "@agent-native/core/history";
import { defineNitroPlugin } from "@agent-native/core/server";

import {
  FACTORY_AUTOMATION_RESOURCE_TYPE,
  restoreFactoryAutomationSnapshot,
  resolveFactoryAutomationForHistory,
  snapshotFromAutomationResource,
  type FactoryAutomationSnapshot,
} from "../lib/factory-automation-history.js";
import { requireWorkspaceMember } from "../lib/require-workspace-member.js";

export default defineNitroPlugin(() => {
  registerVersionedResource({
    type: FACTORY_AUTOMATION_RESOURCE_TYPE,
    async resolveAccess(resourceId, ctx) {
      const orgId = ctx?.orgId?.trim();
      const userEmail = ctx?.userEmail?.trim();
      if (!orgId || !userEmail) return null;
      try {
        await requireWorkspaceMember({ userEmail, orgId });
      } catch {
        // coercion-ok: non-members should resolve as null access, not throw through history APIs.
        return null;
      }
      const resolved = await resolveFactoryAutomationForHistory(
        orgId,
        resourceId,
      );
      if (!resolved) return null;
      return {
        role: "editor" as const,
        ownerEmail: userEmail,
        orgId,
        visibility: "org" as const,
      };
    },
    async getSnapshot({ resourceId, ctx }) {
      const orgId = ctx?.orgId?.trim();
      if (!orgId) return undefined;
      const resolved = await resolveFactoryAutomationForHistory(
        orgId,
        resourceId,
      );
      if (!resolved) return undefined;
      return snapshotFromAutomationResource(
        resolved.resource.content,
        resolved.name,
        resolved.factoryId,
      );
    },
    async restoreSnapshot({ resourceId, ctx, version, snapshot }) {
      const orgId = ctx?.orgId?.trim();
      const userEmail = ctx?.userEmail?.trim();
      if (!orgId || !userEmail) {
        throw new Error("Organization membership is required to restore.");
      }
      await requireWorkspaceMember({ userEmail, orgId });
      const resolved = await resolveFactoryAutomationForHistory(
        orgId,
        resourceId,
      );
      if (!resolved) {
        throw new Error("Factory automation not found.");
      }
      const restoredSnapshot = snapshot as FactoryAutomationSnapshot;
      const updated = await restoreFactoryAutomationSnapshot({
        resource: resolved.resource,
        automationName: resolved.name,
        factoryId: resolved.factoryId,
        snapshot: {
          ...restoredSnapshot,
          factoryId: restoredSnapshot.factoryId ?? resolved.factoryId,
        },
        userEmail,
        orgId,
      });
      return {
        ok: true,
        versionNumber: version.versionNumber,
        resourceId: updated.resource.id,
        promptVersion: updated.promptVersion,
        configSavedAt: updated.configSavedAt,
        displayName: updated.displayName,
        restoredFromSummary: version.summary,
      };
    },
  });
});
