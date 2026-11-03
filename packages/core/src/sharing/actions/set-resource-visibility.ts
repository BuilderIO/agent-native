import { eq } from "drizzle-orm";
import { z } from "zod";

import type { ActionChange } from "../../action-ui.js";
import { defineAction, fail } from "../../action.js";
import { getAppConfig } from "../../app-config/index.js";
import { invalidateCollabAccessCache } from "../../server/poll.js";
import { track } from "../../tracking/registry.js";
import {
  assertAccess,
  currentAccess,
  ForbiddenError,
  resolveRegisteredAccessContext,
} from "../access.js";
import {
  requireShareableResource,
  type ShareableResourceRegistration,
} from "../registry.js";
import { assertWidgetShareWriteGrant } from "../widget-grant.js";
import { resourceSharingChange } from "./change-result.js";
import {
  getExtensionShareChangeTargets,
  notifyExtensionShareChanged,
} from "./extension-change.js";

type Visibility = "private" | "org" | "public";

/** The most resources one call may change, so a batch stays one bounded request. */
const MAX_VISIBILITY_BATCH = 100;

const schema = z
  .object({
    resourceType: z.string(),
    resourceId: z
      .string()
      .min(1)
      .optional()
      .describe("One resource to change. Use resourceIds for several."),
    resourceIds: z
      .array(z.string().min(1))
      .min(1)
      .max(MAX_VISIBILITY_BATCH)
      .optional()
      .describe(
        `Up to ${MAX_VISIBILITY_BATCH} resources of this type to change in one call. Every one is checked before any changes, so if one can't change, none do.`,
      ),
    visibility: z.enum(["private", "org", "public"]),
  })
  .refine((args) => Boolean(args.resourceId) || Boolean(args.resourceIds), {
    message: "Provide resourceId or resourceIds.",
  });

type Args = z.infer<typeof schema>;

function requestedIds(args: Args): string[] {
  const ids = [
    ...new Set([
      ...(args.resourceId ? [args.resourceId] : []),
      ...(args.resourceIds ?? []),
    ]),
  ];
  if (!ids.length) {
    fail("Provide resourceId or resourceIds.", {
      errorCode: "resource_ids_required",
      statusCode: 400,
    });
  }
  if (ids.length > MAX_VISIBILITY_BATCH) {
    fail(
      `Change at most ${MAX_VISIBILITY_BATCH} resources per call; this one named ${ids.length}.`,
      { errorCode: "too_many_resources", statusCode: 400 },
    );
  }
  return ids;
}

type Access = Awaited<ReturnType<typeof assertAccess>>;

interface PreparedChange {
  resourceId: string;
  access: Access;
  update: Record<string, unknown>;
  visibilityChanged: boolean;
  resourceChanged: boolean;
}

export default defineAction({
  description:
    "Change the coarse visibility of one or more shareable resources: 'private' keeps them owner-only, 'org' shares them with all members of the owner's organization, 'public' makes them accessible to anyone with the link. Visibility changes require owner or admin role. To change several resources of the same type, pass resourceIds instead of calling once per resource: every resource is checked before any changes, and the result lists each one as changed or unchanged.",
  toolCallable: false,
  mcpApp: {
    compactCatalog: true,
  },
  schema,
  needsApproval: async (args) => {
    if (args.visibility !== "public") return false;
    const reg = requireShareableResource(args.resourceType);
    if (reg.allowPublic === false) return false;
    // One approval covers the whole call; it is needed when any resource in it
    // would become public.
    for (const resourceId of requestedIds(args)) {
      const access = await assertAccess(
        args.resourceType,
        resourceId,
        "admin",
        undefined,
        { skipResourceBody: true },
      );
      if (access.resource.visibility !== "public") return true;
    }
    return false;
  },
  mcpAnnotations: {
    readOnlyHint: false,
    destructiveHint: true,
    openWorldHint: true,
  },
  run: async (args, ctx) => {
    const ids = requestedIds(args);
    // A widget grant names one resource, so a batch reaching more than that
    // one fails here.
    for (const resourceId of ids) {
      assertWidgetShareWriteGrant(ctx, "set-resource-visibility", {
        ...args,
        resourceId,
      });
    }
    const reg = requireShareableResource(args.resourceType);
    if (args.visibility === "public" && reg.allowPublic === false) {
      throw new ForbiddenError(
        `${reg.displayName} cannot be made public — share with specific people or your organization instead.`,
      );
    }
    const db = reg.getDb() as any;
    const rawAccess = currentAccess();
    const currentOrgId = resolveRegisteredAccessContext(reg, rawAccess).orgId;

    const prepare = async (resourceId: string): Promise<PreparedChange> => {
      const access = await assertAccess(args.resourceType, resourceId, "admin");
      const visibilityChanged = access.resource?.visibility !== args.visibility;
      const update: Record<string, unknown> = { visibility: args.visibility };
      if (args.visibility === "org" && !access.resource?.orgId) {
        if (!currentOrgId) {
          const canKeepResourceUnscoped =
            !!rawAccess.orgId &&
            !!reg.resolveAccessContext &&
            access.role === "owner";
          if (!canKeepResourceUnscoped) {
            throw new ForbiddenError(
              `${reg.displayName} cannot be shared with your organization because no active organization is selected.`,
            );
          }
        } else {
          if (access.role !== "owner") {
            throw new ForbiddenError(
              `${reg.displayName} can only be attached to an organization by its owner.`,
            );
          }
          update.orgId = currentOrgId;
        }
      }
      if (visibilityChanged) {
        await reg.assertSharingChange?.({
          resource: access.resource,
          change: { kind: "visibility", visibility: args.visibility },
        });
      }
      return {
        resourceId,
        access,
        update,
        visibilityChanged,
        resourceChanged: visibilityChanged || update.orgId !== undefined,
      };
    };

    // Check every resource before changing any.
    const prepared: PreparedChange[] = [];
    if (args.resourceIds) {
      const failures: { resourceId: string; error: unknown }[] = [];
      for (const resourceId of ids) {
        try {
          prepared.push(await prepare(resourceId));
        } catch (error) {
          failures.push({ resourceId, error });
        }
      }
      if (failures.length) throw batchRefusal(ids.length, failures);
    } else {
      for (const resourceId of ids) prepared.push(await prepare(resourceId));
    }

    // Used for the write and for its undo, so a registration's own
    // persistence (for example, a reserved name) runs both ways.
    const persistVisibility = async (
      change: PreparedChange,
      visibility: Visibility,
      values: Record<string, unknown>,
    ) => {
      if (reg.persistVisibilityChange) {
        await reg.persistVisibilityChange({
          resource: change.access.resource,
          resourceId: change.resourceId,
          visibility,
          update: values,
          userEmail: rawAccess.userEmail,
          orgId: currentOrgId,
        });
      } else {
        const updated = await db
          .update(reg.resourceTable)
          .set(values)
          .where(eq(reg.resourceTable.id, change.resourceId))
          .returning({ id: reg.resourceTable.id });
        // Another request deleted it after the checks.
        if (!updated.length) {
          fail(`${reg.displayName} ${change.resourceId} no longer exists.`, {
            errorCode: "resource_not_found",
            statusCode: 404,
          });
        }
      }
    };
    // Returns the part of this call's change it leaves in place, if any.
    const restore = async (
      change: PreparedChange,
    ): Promise<"visibility" | "organization" | null> => {
      // Another request may have changed the resource since this call wrote
      // it; keep that newer value rather than putting back an older one.
      // Reading first narrows that window without closing it, since a
      // registration's own persistence can't take a condition. When this call
      // also attached the resource to an organization and another request
      // has since moved it to a different one, the resource holds both
      // requests' changes; it is left as it is and reported rather than
      // half undone.
      const attachedOrg =
        change.update.orgId !== undefined && !!reg.resourceTable.orgId;
      const [current] = await db
        .select({
          visibility: reg.resourceTable.visibility,
          ...(attachedOrg ? { orgId: reg.resourceTable.orgId } : {}),
        })
        .from(reg.resourceTable)
        .where(eq(reg.resourceTable.id, change.resourceId));
      const ours = current?.visibility === args.visibility;
      const movedOrg = attachedOrg && current?.orgId !== change.update.orgId;
      if (ours && !movedOrg) {
        const previous: Record<string, unknown> = {
          visibility: change.access.resource.visibility,
        };
        if (change.update.orgId !== undefined) {
          previous.orgId = change.access.resource.orgId ?? null;
        }
        await persistVisibility(
          change,
          change.access.resource.visibility,
          previous,
        );
      }
      invalidateCollabAccessCache(args.resourceType, change.resourceId);
      if (ours) return movedOrg ? "visibility" : null;
      // Another request changed the visibility, and the organization this
      // call attached is still on the resource under that newer change.
      return attachedOrg && !movedOrg ? "organization" : null;
    };

    const beforeExtensionTargets = new Map<
      string,
      Awaited<ReturnType<typeof getExtensionShareChangeTargets>>
    >();
    for (const change of prepared) {
      beforeExtensionTargets.set(
        change.resourceId,
        await getExtensionShareChangeTargets(
          args.resourceType,
          change.resourceId,
        ),
      );
    }

    // A failure part-way puts back every resource already written, so a
    // batch changes all of its resources or none. If putting one back fails
    // too, the error names it rather than claiming nothing changed.
    const written: PreparedChange[] = [];
    let failing: PreparedChange | undefined;
    try {
      for (const change of prepared) {
        // A batch leaves resources already in this state alone, so a no-op
        // can't trip a registration's own checks; a single call writes as
        // it always has.
        if (args.resourceIds && !change.resourceChanged) continue;
        failing = change;
        await persistVisibility(change, args.visibility, change.update);
        written.push(change);
        if (change.visibilityChanged) {
          // The check above runs before the write, so a context item that
          // commits in between is missed by it. This one runs after the write
          // and sees it.
          await reg.assertSharingChange?.({
            resource: { ...change.access.resource, ...change.update },
            change: { kind: "visibility", visibility: args.visibility },
          });
        }
      }
    } catch (error) {
      const stillVisible: string[] = [];
      const stillAttached: string[] = [];
      for (const change of written.reverse()) {
        try {
          const left = await restore(change);
          if (left === "visibility") stillVisible.push(change.resourceId);
          if (left === "organization") stillAttached.push(change.resourceId);
        } catch (restoreError) {
          console.error(
            `[sharing] Could not restore the visibility of ${args.resourceType} ${change.resourceId}:`,
            restoreError,
          );
          stillVisible.push(change.resourceId);
        }
      }
      if (stillVisible.length || stillAttached.length) {
        const reason = error instanceof Error ? error.message : String(error);
        const left: string[] = [];
        if (stillVisible.length) {
          left.push(
            `these still have visibility "${args.visibility}": ${stillVisible.join(", ")}`,
          );
        }
        if (stillAttached.length) {
          left.push(
            `these are still attached to your organization: ${stillAttached.join(", ")}`,
          );
        }
        fail(
          `${reason} Not every earlier change could be put back, so ${left.join("; and ")}.`,
          { errorCode: "visibility_rollback_incomplete", statusCode: 500 },
        );
      }
      // A registration can refuse inside its own persistence (Forms checks a
      // permission there), which the check-first pass can't see. Report it
      // the same way as a refusal found up front.
      if (args.resourceIds && failing && error instanceof ForbiddenError) {
        throw batchRefusal(ids.length, [
          { resourceId: failing.resourceId, error },
        ]);
      }
      throw error;
    }

    const app = getAppConfig().app.slug ?? "unknown";
    for (const change of prepared) {
      invalidateCollabAccessCache(args.resourceType, change.resourceId);
      // The writes have committed, so a notice that fails is logged rather
      // than reported as a failed change, and the rest still go out.
      try {
        await notifyExtensionShareChanged(
          args.resourceType,
          change.resourceId,
          beforeExtensionTargets.get(change.resourceId) ?? [],
        );
      } catch (error) {
        console.error(
          `[sharing] Could not send the change notice for ${args.resourceType} ${change.resourceId}:`,
          error,
        );
      }
      if (change.visibilityChanged) {
        track(
          "share_visibility_change",
          {
            app,
            template: app,
            resource_type: args.resourceType,
            resource_id: change.resourceId,
            visibility: args.visibility,
            is_public: args.visibility === "public",
          },
          rawAccess.userEmail ? { userId: rawAccess.userEmail } : undefined,
        );
      }
    }

    const changed = prepared.filter((change) => change.resourceChanged);
    const firstChanged = changed.at(0);
    const card = firstChanged
      ? sharingChangeFor(reg, firstChanged, changed.length, args.visibility)
      : undefined;
    if (!args.resourceIds) {
      return {
        ok: true,
        visibility: args.visibility,
        ...(card ? { change: card } : {}),
      };
    }
    return {
      ok: true,
      visibility: args.visibility,
      results: prepared.map((change) => ({
        resourceId: change.resourceId,
        status: change.resourceChanged
          ? ("changed" as const)
          : ("unchanged" as const),
      })),
      changedCount: changed.length,
      unchangedCount: prepared.length - changed.length,
      ...(card ? { change: card } : {}),
    };
  },
});

/** One card for the whole call: the first resource's title, then how many more. */
function sharingChangeFor(
  reg: ShareableResourceRegistration,
  firstChanged: PreparedChange,
  changedCount: number,
  visibility: Visibility,
): ActionChange {
  const first = resourceSharingChange(
    reg,
    firstChanged.access.resource,
    "updated",
    visibility,
  ).change;
  if (changedCount === 1) return first;
  const suffix = ` and ${changedCount - 1} more`;
  const room = 180 - suffix.length;
  const title =
    first.title.length <= room
      ? first.title
      : `${first.title.slice(0, room - 1).trimEnd()}…`;
  return { ...first, title: `${title}${suffix}` };
}

function batchRefusal(
  total: number,
  failures: { resourceId: string; error: unknown }[],
): Error {
  const reasons = failures
    .map(({ resourceId, error }) => {
      const reason = error instanceof Error ? error.message : String(error);
      return `${resourceId}: ${reason}`;
    })
    .join("; ");
  const message = `Nothing was changed: ${failures.length} of ${total} can't change visibility. ${reasons}`;
  return failures.every(({ error }) => error instanceof ForbiddenError)
    ? new ForbiddenError(message)
    : new Error(message);
}
