import { z } from "zod";

import { defineAction } from "../../action.js";
import {
  assertVersionedResourceAccess,
  getVersionedResource,
} from "../registry.js";
import {
  getResourceVersionById,
  getResourceVersionByNumber,
} from "../store.js";
import type { VersionedResourceContext } from "../types.js";

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
  description: "Restore a resource from a reusable version-history snapshot.",
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

    const access = await assertVersionedResourceAccess(
      version.resourceType,
      version.resourceId,
      actionCtx,
      "editor",
    );
    const registration = getVersionedResource(version.resourceType);
    if (!registration?.restoreSnapshot) {
      throw new Error(
        `${version.resourceType} has no restoreSnapshot history handler registered`,
      );
    }

    const result = await registration.restoreSnapshot({
      resourceType: version.resourceType,
      resourceId: version.resourceId,
      ctx: actionCtx,
      access,
      version,
      snapshot: version.snapshot,
    });
    return { version, result };
  },
  audit: {
    target: (_args, result) => {
      const restored = result as {
        version: {
          resourceType: string;
          resourceId: string;
          ownerEmail?: string | null;
          orgId?: string | null;
          visibility?: "private" | "org" | "public";
        };
      };
      return {
        type: restored.version.resourceType,
        id: restored.version.resourceId,
        ownerEmail: restored.version.ownerEmail,
        orgId: restored.version.orgId,
        visibility: restored.version.visibility,
      };
    },
  },
});
