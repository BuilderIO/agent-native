import crypto from "node:crypto";
import { and, desc, eq, isNull, or } from "drizzle-orm";
import { discoverAgents } from "@agent-native/core/server/agent-discovery";
import { getDb, schema } from "../db/index.js";
import {
  currentOwnerEmail,
  currentOrgId,
  recordAudit,
} from "./dispatch-store.js";
import { recordVaultAudit } from "./vault-store.js";

/**
 * Caller-supplied access context for workspace-resource operations.
 * Same shape and semantics as VaultCtx — looking up a row by id alone is
 * unsafe because UUIDs are not authorization. A row matches the ctx if
 * either the caller owns it or it lives in the caller's active org.
 */
export interface WorkspaceResourceCtx {
  ownerEmail: string;
  orgId: string | null;
}

export function requireWorkspaceResourceCtx(): WorkspaceResourceCtx {
  const ownerEmail = currentOwnerEmail();
  return { ownerEmail, orgId: currentOrgId() };
}

/** WHERE clause that limits a workspace-resource row to the caller's scope. */
function ctxScope(
  table: {
    ownerEmail: typeof schema.workspaceResources.ownerEmail;
    orgId: typeof schema.workspaceResources.orgId;
  },
  ctx: WorkspaceResourceCtx,
) {
  return or(
    eq(table.ownerEmail, ctx.ownerEmail),
    ctx.orgId ? eq(table.orgId, ctx.orgId) : isNull(table.orgId),
  );
}

function id() {
  return crypto.randomUUID();
}

function now() {
  return Date.now();
}

function orgFilter<T extends { ownerEmail: any; orgId: any }>(table: T) {
  const orgId = currentOrgId();
  return and(
    eq(table.ownerEmail, currentOwnerEmail()),
    orgId ? eq(table.orgId, orgId) : isNull(table.orgId),
  );
}

// ─── Workspace Resources CRUD ──────────────────────────────────

export type WorkspaceResourceKind = "skill" | "instruction" | "agent";
export type WorkspaceResourceScope = "all" | "selected";

export interface WorkspaceResourceInput {
  kind: WorkspaceResourceKind;
  name: string;
  description?: string | null;
  path: string;
  content: string;
  scope: WorkspaceResourceScope;
}

export async function listWorkspaceResources(filter?: { kind?: string }) {
  const db = getDb();
  const conditions = [orgFilter(schema.workspaceResources)];
  if (filter?.kind) {
    conditions.push(eq(schema.workspaceResources.kind, filter.kind) as any);
  }
  return db
    .select()
    .from(schema.workspaceResources)
    .where(and(...conditions))
    .orderBy(desc(schema.workspaceResources.updatedAt));
}

export async function getWorkspaceResource(resourceId: string) {
  const db = getDb();
  const [row] = await db
    .select()
    .from(schema.workspaceResources)
    .where(eq(schema.workspaceResources.id, resourceId))
    .limit(1);
  return row ?? null;
}

export async function createWorkspaceResource(input: WorkspaceResourceInput) {
  const db = getDb();
  const timestamp = now();
  const resourceId = id();
  const actor = currentOwnerEmail();

  await db.insert(schema.workspaceResources).values({
    id: resourceId,
    ownerEmail: actor,
    orgId: currentOrgId(),
    kind: input.kind,
    name: input.name,
    description: input.description || null,
    path: input.path,
    content: input.content,
    scope: input.scope,
    createdBy: actor,
    createdAt: timestamp,
    updatedAt: timestamp,
  });

  await recordAudit({
    action: `workspace.${input.kind}.created`,
    targetType: `workspace-${input.kind}`,
    targetId: resourceId,
    summary: `Created workspace ${input.kind} "${input.name}" (${input.path})`,
  });

  return getWorkspaceResource(resourceId);
}

export async function updateWorkspaceResource(
  resourceId: string,
  input: Partial<
    Pick<WorkspaceResourceInput, "name" | "description" | "content" | "scope">
  >,
) {
  const db = getDb();
  const existing = await getWorkspaceResource(resourceId);
  if (!existing) throw new Error("Workspace resource not found");

  const updates: Record<string, unknown> = { updatedAt: now() };
  if (input.name !== undefined) updates.name = input.name;
  if (input.description !== undefined)
    updates.description = input.description || null;
  if (input.content !== undefined) updates.content = input.content;
  if (input.scope !== undefined) updates.scope = input.scope;

  await db
    .update(schema.workspaceResources)
    .set(updates)
    .where(eq(schema.workspaceResources.id, resourceId));

  await recordAudit({
    action: `workspace.${existing.kind}.updated`,
    targetType: `workspace-${existing.kind}`,
    targetId: resourceId,
    summary: `Updated workspace ${existing.kind} "${input.name || existing.name}"`,
  });

  return getWorkspaceResource(resourceId);
}

export async function deleteWorkspaceResource(resourceId: string) {
  const db = getDb();
  const existing = await getWorkspaceResource(resourceId);
  if (!existing) throw new Error("Workspace resource not found");

  // Revoke all grants
  const grants = await listResourceGrants({ resourceId });
  for (const grant of grants) {
    if (grant.status === "active") {
      await revokeResourceGrant(grant.id);
    }
  }

  await db
    .delete(schema.workspaceResources)
    .where(eq(schema.workspaceResources.id, resourceId));

  await recordAudit({
    action: `workspace.${existing.kind}.deleted`,
    targetType: `workspace-${existing.kind}`,
    targetId: resourceId,
    summary: `Deleted workspace ${existing.kind} "${existing.name}" (${existing.path})`,
  });

  return existing;
}

// ─── Grants ──────────────────────────────────────────────────────

export async function listResourceGrants(filter?: {
  resourceId?: string;
  appId?: string;
}) {
  const db = getDb();
  const conditions = [orgFilter(schema.workspaceResourceGrants)];
  if (filter?.resourceId) {
    conditions.push(
      eq(schema.workspaceResourceGrants.resourceId, filter.resourceId) as any,
    );
  }
  if (filter?.appId) {
    conditions.push(
      eq(schema.workspaceResourceGrants.appId, filter.appId) as any,
    );
  }
  return db
    .select()
    .from(schema.workspaceResourceGrants)
    .where(and(...conditions))
    .orderBy(desc(schema.workspaceResourceGrants.updatedAt));
}

export async function getResourceGrant(
  grantId: string,
  ctx: WorkspaceResourceCtx = requireWorkspaceResourceCtx(),
) {
  const db = getDb();
  const [row] = await db
    .select()
    .from(schema.workspaceResourceGrants)
    .where(
      and(
        eq(schema.workspaceResourceGrants.id, grantId),
        ctxScope(schema.workspaceResourceGrants, ctx),
      ),
    )
    .limit(1);
  return row ?? null;
}

export async function createResourceGrant(resourceId: string, appId: string) {
  const db = getDb();
  const resource = await getWorkspaceResource(resourceId);
  if (!resource) throw new Error("Workspace resource not found");

  const timestamp = now();
  const grantId = id();
  const actor = currentOwnerEmail();

  await db.insert(schema.workspaceResourceGrants).values({
    id: grantId,
    ownerEmail: actor,
    orgId: currentOrgId(),
    resourceId,
    appId,
    status: "active",
    syncedAt: null,
    createdAt: timestamp,
    updatedAt: timestamp,
  });

  await recordAudit({
    action: `workspace.${resource.kind}.granted`,
    targetType: `workspace-${resource.kind}-grant`,
    targetId: grantId,
    summary: `Granted workspace ${resource.kind} "${resource.name}" to ${appId}`,
  });

  return getResourceGrant(grantId);
}

export async function revokeResourceGrant(
  grantId: string,
  ctx: WorkspaceResourceCtx = requireWorkspaceResourceCtx(),
) {
  const db = getDb();
  const grant = await getResourceGrant(grantId, ctx);
  if (!grant) throw new Error("Grant not found");

  const resource = await getWorkspaceResource(grant.resourceId);

  await db
    .update(schema.workspaceResourceGrants)
    .set({ status: "revoked", updatedAt: now() })
    .where(
      and(
        eq(schema.workspaceResourceGrants.id, grantId),
        ctxScope(schema.workspaceResourceGrants, ctx),
      ),
    );

  await recordAudit({
    action: `workspace.${resource?.kind || "resource"}.grant-revoked`,
    targetType: "workspace-resource-grant",
    targetId: grantId,
    summary: `Revoked workspace ${resource?.kind || "resource"} "${resource?.name || grant.resourceId}" from ${grant.appId}`,
  });

  return getResourceGrant(grantId, ctx);
}

// ─── Sync ──────────────────────────────────────────────────────

/**
 * Push workspace resources to an app via its /_agent-native/resources endpoint.
 * Resources with scope="all" are always pushed. Resources with scope="selected"
 * are only pushed if there's an active grant for that app.
 */
export async function syncResourcesToApp(appId: string) {
  const agents = await discoverAgents("dispatch");
  const agent = agents.find((a) => a.id === appId);
  if (!agent) throw new Error(`App "${appId}" not found in agent registry`);

  const allResources = await listWorkspaceResources();
  const grants = await listResourceGrants({ appId });
  const activeGrantResourceIds = new Set(
    grants.filter((g) => g.status === "active").map((g) => g.resourceId),
  );

  // Determine which resources to push
  const toPush = allResources.filter(
    (r) =>
      r.scope === "all" ||
      (r.scope === "selected" && activeGrantResourceIds.has(r.id)),
  );

  if (toPush.length === 0) {
    return { appId, synced: 0, resources: [] };
  }

  const syncedPaths: string[] = [];
  const db = getDb();
  const timestamp = now();

  for (const resource of toPush) {
    try {
      // Push via the resources API — create as shared resource
      const res = await fetch(`${agent.url}/_agent-native/resources`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          path: resource.path,
          content: resource.content,
          shared: true,
          mimeType: "text/markdown",
        }),
      });

      if (res.ok || res.status === 409) {
        // 409 = already exists, try updating
        if (res.status === 409) {
          // Fetch existing to get ID, then update
          const listRes = await fetch(
            `${agent.url}/_agent-native/resources?scope=shared&path=${encodeURIComponent(resource.path)}`,
          );
          if (listRes.ok) {
            const items = await listRes.json();
            const existing = Array.isArray(items)
              ? items.find((i: any) => i.path === resource.path)
              : null;
            if (existing) {
              await fetch(
                `${agent.url}/_agent-native/resources/${existing.id}`,
                {
                  method: "PUT",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ content: resource.content }),
                },
              );
            }
          }
        }
        syncedPaths.push(resource.path);

        // Update grant syncedAt if applicable
        const grant = grants.find(
          (g) => g.resourceId === resource.id && g.status === "active",
        );
        if (grant) {
          await db
            .update(schema.workspaceResourceGrants)
            .set({ syncedAt: timestamp, updatedAt: timestamp })
            .where(eq(schema.workspaceResourceGrants.id, grant.id));
        }
      }
    } catch {
      // Skip unreachable — don't fail the whole sync
    }
  }

  await recordAudit({
    action: "workspace.resources.synced",
    targetType: "workspace-resource-sync",
    targetId: appId,
    summary: `Synced ${syncedPaths.length} workspace resource(s) to ${appId}: ${syncedPaths.join(", ")}`,
  });

  return { appId, synced: syncedPaths.length, resources: syncedPaths };
}

/**
 * Sync all workspace resources to all apps that have grants or scope="all" resources.
 */
export async function syncResourcesToAllApps() {
  const agents = await discoverAgents("dispatch");
  const results: Array<{ appId: string; synced: number }> = [];

  for (const agent of agents) {
    try {
      const result = await syncResourcesToApp(agent.id);
      results.push({ appId: result.appId, synced: result.synced });
    } catch {
      results.push({ appId: agent.id, synced: 0 });
    }
  }

  return results;
}

// ─── Overview ──────────────────────────────────────────────────────

export async function listWorkspaceResourcesOverview() {
  const [resources, grants] = await Promise.all([
    listWorkspaceResources(),
    listResourceGrants(),
  ]);

  const skills = resources.filter((r) => r.kind === "skill");
  const instructions = resources.filter((r) => r.kind === "instruction");
  const agents = resources.filter((r) => r.kind === "agent");
  const activeGrants = grants.filter((g) => g.status === "active");

  return {
    skillCount: skills.length,
    instructionCount: instructions.length,
    agentCount: agents.length,
    totalResources: resources.length,
    activeGrantCount: activeGrants.length,
  };
}
