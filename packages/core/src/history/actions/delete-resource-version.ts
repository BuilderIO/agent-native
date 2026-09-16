import { z } from "zod";

import { defineAction } from "../../action.js";
import { assertVersionedResourceAccess } from "../registry.js";
import {
  deleteResourceVersionById,
  getResourceVersionById,
  getResourceVersionByNumber,
} from "../store.js";
import type { ResourceVersion, VersionedResourceContext } from "../types.js";

const schema = z
  .object({
    id: z.string().optional(),
    resourceType: z.string().min(1).optional(),
    resourceId: z.string().min(1).optional(),
    versionNumber: z.number().int().positive().optional(),
  })
  .refine(
    (value) =>
      value.id ||
      (value.resourceType && value.resourceId && value.versionNumber),
    {
      message:
        "Provide either id or resourceType, resourceId, and versionNumber",
    },
  );

export default defineAction({
  description:
    "Permanently delete one version-history snapshot for a resource. " +
    "Irreversible: the snapshot cannot be recovered afterward. Only removes " +
    "that history entry — the resource's current, live content and other " +
    "versions are untouched. Confirm with the user before deleting anything " +
    "they did not explicitly ask to remove.",
  schema,
  run: async (args, ctx) => {
    const actionCtx = ctx as VersionedResourceContext | undefined;
    const scope = {
      userEmail: actionCtx?.userEmail ?? null,
      orgId: actionCtx?.orgId ?? null,
    };
    const version = args.id
      ? await getResourceVersionById(args.id, scope, { bypassScope: true })
      : await getResourceVersionByNumber(
          args.resourceType!,
          args.resourceId!,
          args.versionNumber!,
          scope,
          { bypassScope: true },
        );
    if (!version) {
      throw new Error("Resource version not found");
    }
    await assertVersionedResourceAccess(
      version.resourceType,
      version.resourceId,
      actionCtx,
      "editor",
    );
    const deleted = await deleteResourceVersionById(version.id, scope, {
      bypassScope: true,
    });
    if (!deleted) {
      throw new Error("Resource version was already deleted");
    }
    return { ok: true as const, version };
  },
  audit: {
    target: (_args, result) => {
      const deleted = result as { version: ResourceVersion };
      return {
        type: deleted.version.resourceType,
        id: deleted.version.resourceId,
        ownerEmail: deleted.version.ownerEmail,
        orgId: deleted.version.orgId,
        visibility: deleted.version.visibility,
      };
    },
  },
});
