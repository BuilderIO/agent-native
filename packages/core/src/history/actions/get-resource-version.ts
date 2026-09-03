import { z } from "zod";

import { defineAction } from "../../action.js";
import { assertVersionedResourceAccess } from "../registry.js";
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
  description: "Read one version-history snapshot for a reusable resource.",
  schema,
  http: { method: "GET" },
  readOnly: true,
  parallelSafe: true,
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
      "viewer",
    );
    return { version };
  },
});
