import { and, eq, ne } from "drizzle-orm";
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
import {
  LINK_PRINCIPAL_ID,
  LINK_PRINCIPAL_TYPE,
  LINK_ROLES,
  type ShareRole,
} from "../schema.js";
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
    role: z
      .enum(["viewer", "commenter", "editor"])
      .optional()
      .describe(
        "What the people this visibility opens to can do. With 'org', everyone in the organization: 'viewer' can read, 'commenter' can also comment, 'editor' can edit. With 'public', signed-in people with the link: 'viewer' or 'commenter'. Omit to keep the current role.",
      ),
    expectedVisibility: z
      .enum(["private", "org", "public"])
      .optional()
      .describe(
        "The visibility the caller last saw. When set, a resource that has since changed is refused with a conflict instead of moved, so a role change made from a stale view can't change who can open it.",
      ),
  })
  .refine((args) => Boolean(args.resourceId) || Boolean(args.resourceIds), {
    message: "Provide resourceId or resourceIds.",
  })
  .refine((args) => !args.role || args.visibility !== "private", {
    message: "role applies only to visibility 'org' or 'public'.",
    path: ["role"],
  })
  .refine(
    (args) =>
      args.visibility !== "public" ||
      !args.role ||
      (LINK_ROLES as readonly string[]).includes(args.role),
    {
      message: "Anyone with the link can only view or comment.",
      path: ["role"],
    },
  );

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

type GeneralAccessPrincipal = "org" | typeof LINK_PRINCIPAL_TYPE;

interface GrantRow {
  id: string;
  resourceId: string;
  principalType: GeneralAccessPrincipal;
  principalId: string;
  role: ShareRole;
  createdBy: string;
  createdAt: string;
  notifiedAt: string | null;
}

/**
 * General access keeps its role as a share grant: to the resource's own
 * organization for "Anyone at <org>", to the link principal for "Anyone with
 * the link". Each lives and dies with its visibility: a grant left behind
 * after leaving it would keep those people in while the panel says only
 * invited people are.
 */
interface GeneralAccessGrantChange {
  principalType: GeneralAccessPrincipal;
  principalId: string;
  /** Every row this principal had, all of which the write replaces. */
  before: GrantRow[];
  /** null removes the grant, leaving the visibility's viewer role. */
  role: ShareRole | null;
  /** Marks this call's write, so its rollback touches no newer one. */
  stamp: string;
  written: boolean;
}

/** One row per resource and principal, so concurrent writes upsert it. */
function generalAccessShareId(
  principalType: GeneralAccessPrincipal,
  resourceId: string,
): string {
  return `${principalType}:${resourceId}`;
}

interface PreparedChange {
  resourceId: string;
  access: Access;
  update: Record<string, unknown>;
  visibilityChanged: boolean;
  resourceChanged: boolean;
  grants: GeneralAccessGrantChange[];
}

async function readGrants(
  reg: ShareableResourceRegistration,
  resourceId: string,
  principalType: GeneralAccessPrincipal,
  principalId: string,
): Promise<GrantRow[]> {
  const rows = await reg
    .getDb()
    .select()
    .from(reg.sharesTable)
    .where(
      and(
        eq(reg.sharesTable.resourceId, resourceId),
        eq(reg.sharesTable.principalType, principalType),
        eq(reg.sharesTable.principalId, principalId),
      ),
    );
  return rows as GrantRow[];
}

export default defineAction({
  description:
    "Change the coarse visibility of one or more shareable resources: 'private' keeps them owner-only, 'org' shares them with all members of the owner's organization, 'public' makes them accessible to anyone with the link. Pass role to choose what those people can do: with 'org', view, comment, or edit; with 'public', view or comment. Leaving 'org' or 'public' removes its role. Visibility changes require owner or admin role. To change several resources of the same type, pass resourceIds instead of calling once per resource: every resource is checked before any changes, and the result lists each one as changed or unchanged.",
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
    // would become public, or would let anyone with its link do more.
    for (const resourceId of requestedIds(args)) {
      const access = await assertAccess(
        args.resourceType,
        resourceId,
        "admin",
        undefined,
        { skipResourceBody: true },
      );
      if (access.resource.visibility !== "public") return true;
      if (args.role && args.role !== "viewer") {
        const current = await readGrants(
          reg,
          resourceId,
          LINK_PRINCIPAL_TYPE,
          LINK_PRINCIPAL_ID,
        );
        if (current.length !== 1 || current[0]?.role !== args.role) {
          return true;
        }
      }
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
      if (
        args.expectedVisibility &&
        access.resource.visibility !== args.expectedVisibility
      ) {
        fail(
          `${reg.displayName} ${resourceId} is now ${access.resource.visibility}, not ${args.expectedVisibility}. Reload its sharing and try again.`,
          { errorCode: "visibility_conflict", statusCode: 409 },
        );
      }
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
      const grants = await planGrants(resourceId, access, update);
      return {
        resourceId,
        access,
        update,
        visibilityChanged,
        resourceChanged:
          visibilityChanged ||
          update.orgId !== undefined ||
          grants.some(
            (grant) => grant.role !== null || grant.before.length > 0,
          ),
        grants,
      };
    };

    const planGrants = async (
      resourceId: string,
      access: Access,
      update: Record<string, unknown>,
    ): Promise<GeneralAccessGrantChange[]> => {
      const from = access.resource.visibility as Visibility;
      const wanted: Array<{
        principalType: GeneralAccessPrincipal;
        principalId: string;
        role: ShareRole | null;
      }> = [];
      const resourceOrgId =
        (access.resource.orgId as string | null | undefined) ?? null;
      if (from === "org" && args.visibility !== "org" && resourceOrgId) {
        wanted.push({
          principalType: "org",
          principalId: resourceOrgId,
          role: null,
        });
      }
      if (from === "public" && args.visibility !== "public") {
        wanted.push({
          principalType: LINK_PRINCIPAL_TYPE,
          principalId: LINK_PRINCIPAL_ID,
          role: null,
        });
      }
      if (args.role) {
        const role: ShareRole | null =
          args.role === "viewer" ? null : args.role;
        if (args.visibility === "public") {
          wanted.push({
            principalType: LINK_PRINCIPAL_TYPE,
            principalId: LINK_PRINCIPAL_ID,
            role,
          });
        } else {
          const grantOrgId =
            (update.orgId as string | undefined) ?? resourceOrgId;
          if (grantOrgId) {
            wanted.push({
              principalType: "org",
              principalId: grantOrgId,
              role,
            });
          } else if (role) {
            throw new ForbiddenError(
              `${reg.displayName} has no organization, so its members can only view it.`,
            );
          }
        }
      }
      const stamp = new Date().toISOString();
      const changes: GeneralAccessGrantChange[] = [];
      for (const target of wanted) {
        const before = await readGrants(
          reg,
          resourceId,
          target.principalType,
          target.principalId,
        );
        // A removal still runs with nothing read here: a grant another
        // request writes before this call's own write must go too.
        if (
          target.role !== null &&
          before.length === 1 &&
          before[0]?.role === target.role
        ) {
          continue;
        }
        changes.push({ ...target, before, stamp, written: false });
      }
      return changes;
    };

    const grantRows = (
      change: PreparedChange,
      grant: GeneralAccessGrantChange,
    ) =>
      and(
        eq(reg.sharesTable.resourceId, change.resourceId),
        eq(reg.sharesTable.principalType, grant.principalType),
        eq(reg.sharesTable.principalId, grant.principalId),
      );

    const writeGrant = async (
      change: PreparedChange,
      grant: GeneralAccessGrantChange,
    ) => {
      if (!grant.role) {
        await db.delete(reg.sharesTable).where(grantRows(change, grant));
        grant.written = true;
        return;
      }
      const resource = {
        ...change.access.resource,
        ...change.update,
        visibility: args.visibility,
      };
      await reg.assertSharingChange?.({ resource, change: { kind: "grant" } });
      const id = generalAccessShareId(grant.principalType, change.resourceId);
      await db
        .insert(reg.sharesTable)
        .values({
          id,
          resourceId: change.resourceId,
          principalType: grant.principalType,
          principalId: grant.principalId,
          role: grant.role,
          createdBy: rawAccess.userEmail ?? "",
          createdAt: grant.stamp,
        })
        .onConflictDoUpdate({
          target: reg.sharesTable.id,
          set: {
            role: grant.role,
            createdBy: rawAccess.userEmail ?? "",
            createdAt: grant.stamp,
          },
        });
      grant.written = true;
      // A grant to the same principal made another way would sit beside this
      // one, and the stronger of the two would keep counting.
      await db
        .delete(reg.sharesTable)
        .where(and(grantRows(change, grant), ne(reg.sharesTable.id, id)));
      // The checks before the write miss a change that commits in between; a
      // refusal or a newer visibility here is undone by the rollback.
      await reg.assertSharingChange?.({ resource, change: { kind: "grant" } });
      const [current] = await db
        .select({ visibility: reg.resourceTable.visibility })
        .from(reg.resourceTable)
        .where(eq(reg.resourceTable.id, change.resourceId));
      if (current?.visibility !== args.visibility) {
        await db
          .delete(reg.sharesTable)
          .where(
            and(
              eq(reg.sharesTable.id, id),
              eq(reg.sharesTable.createdAt, grant.stamp),
            ),
          );
        fail(
          `${reg.displayName} ${change.resourceId} changed visibility while its role was being saved. Try again.`,
          { errorCode: "visibility_conflict", statusCode: 409 },
        );
      }
    };

    // Puts back each grant this call replaced. A row this call wrote goes
    // only while it is still this call's, so a newer request's is kept.
    const restoreGrants = async (change: PreparedChange) => {
      for (const grant of [...change.grants].reverse()) {
        if (!grant.written) continue;
        if (grant.role) {
          const removed = await db
            .delete(reg.sharesTable)
            .where(
              and(
                eq(
                  reg.sharesTable.id,
                  generalAccessShareId(grant.principalType, change.resourceId),
                ),
                eq(reg.sharesTable.createdAt, grant.stamp),
              ),
            )
            .returning({ id: reg.sharesTable.id });
          if (!removed.length) continue;
        }
        if (grant.before.length) {
          await db
            .insert(reg.sharesTable)
            .values(grant.before)
            .onConflictDoNothing();
        }
      }
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
        // Grants go back only while this call's visibility stands; a newer
        // visibility removed or kept them on its own terms.
        await restoreGrants(change);
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

    // A batch leaves resources already in this state alone, so a no-op can't
    // trip a registration's own checks or send a change notice; a single
    // call writes as it always has.
    const toWrite = args.resourceIds
      ? prepared.filter((change) => change.resourceChanged)
      : prepared;

    const beforeExtensionTargets = new Map<
      string,
      Awaited<ReturnType<typeof getExtensionShareChangeTargets>>
    >();
    for (const change of toWrite) {
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
      for (const change of toWrite) {
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
        for (const grant of change.grants) await writeGrant(change, grant);
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
    for (const change of toWrite) {
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
      ? sharingChangeFor(
          reg,
          firstChanged,
          changed.length,
          args.role ? `${args.visibility} · ${args.role}` : args.visibility,
        )
      : undefined;
    const roleResult = args.role ? { role: args.role } : {};
    if (!args.resourceIds) {
      return {
        ok: true,
        visibility: args.visibility,
        ...roleResult,
        ...(card ? { change: card } : {}),
      };
    }
    return {
      ok: true,
      visibility: args.visibility,
      ...roleResult,
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
  detail: string,
): ActionChange {
  const first = resourceSharingChange(
    reg,
    firstChanged.access.resource,
    "updated",
    detail,
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
