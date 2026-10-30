import { eq, inArray } from "drizzle-orm";
import { z } from "zod";

import { defineAction } from "../../action.js";
import { getAppConfig } from "../../app-config/index.js";
import { organizations } from "../../org/schema.js";
import { getRequestOrgId } from "../../server/request-context.js";
import { isEmailDerivedName } from "../../user-profile/shared.js";
import { getUserProfiles } from "../../user-profile/store.js";
import { listWorkspaceUserGroupsForOrg } from "../../workspace-connections/groups.js";
import { assertAccess, resolveAccess } from "../access.js";
import {
  listShareableAgents,
  orgAgentName,
  type ShareableAgent,
} from "../agent-principals.js";
import { requireShareableResource } from "../registry.js";
import { assertWidgetShareReadGrant } from "../widget-grant.js";

interface ShareRow {
  id: string;
  principalType: string;
  principalId: string;
  role: string;
  createdAt: string;
}

async function loadOrgDisplayNames(
  db: any,
  shares: Array<{ principalType: string; principalId: string }>,
): Promise<Map<string, string>> {
  const orgIds = Array.from(
    new Set(
      shares
        .filter((s) => s.principalType === "org" && s.principalId)
        .map((s) => s.principalId),
    ),
  );
  if (!orgIds.length) return new Map();

  try {
    const rows = await db
      .select({ id: organizations.id, name: organizations.name })
      .from(organizations)
      .where(inArray(organizations.id, orgIds));
    return new Map(
      rows.flatMap(
        (row: {
          id?: string | null;
          name?: string | null;
        }): Array<[string, string]> => {
          if (typeof row.id !== "string" || typeof row.name !== "string") {
            return [];
          }
          const name = row.name.trim();
          return name ? [[row.id, name]] : [];
        },
      ),
    );
  } catch {
    return new Map();
  }
}

async function loadGroupDisplayNames(
  orgId: string | null | undefined,
  shares: Array<{ principalType: string; principalId: string }>,
): Promise<Map<string, string>> {
  const groupIds = Array.from(
    new Set(
      shares
        .filter((share) => share.principalType === "group" && share.principalId)
        .map((share) => share.principalId),
    ),
  );
  if (!groupIds.length || !orgId) return new Map();
  try {
    const groups = await listWorkspaceUserGroupsForOrg(orgId, groupIds);
    return new Map(
      groups.flatMap((group): Array<[string, string]> => {
        const id = group.id;
        const name = group.name.trim();
        return id && name ? [[id, name]] : [];
      }),
    );
  } catch {
    return new Map();
  }
}

/** Profile names for people, so a row can show a name above the email. */
async function loadUserDisplayNames(
  emails: string[],
): Promise<Map<string, string>> {
  if (!emails.length) return new Map();
  try {
    const profiles = await getUserProfiles(emails);
    const names = new Map<string, string>();
    for (const [email, profile] of profiles) {
      const name = profile.name.trim();
      if (name && !isEmailDerivedName(name, email)) {
        names.set(email.toLowerCase(), name);
      }
    }
    return names;
  } catch (error) {
    // coercion-ok: names are decoration; each row still shows its email.
    console.error(
      "[list-resource-shares] Could not read profile names:",
      error,
    );
    return new Map();
  }
}

/**
 * The org's agents a manager can add, for the share field's suggestions. The
 * request org id is membership-derived, so an outside collaborator holding an
 * admin share never sees the org's service principals.
 */
async function loadShareableAgents(
  resourceOrgId: string | null | undefined,
  role: string,
): Promise<{ agents?: ShareableAgent[]; agentsUnavailable?: true }> {
  if (!resourceOrgId || (role !== "owner" && role !== "admin")) return {};
  if (getRequestOrgId() !== resourceOrgId) return {};
  try {
    return { agents: await listShareableAgents(resourceOrgId) };
  } catch (error) {
    console.error("[list-resource-shares] Could not list org agents:", error);
    return { agentsUnavailable: true };
  }
}

/**
 * What the share panel's agent prompt needs: which tool reads this resource
 * and a short noun for it. Absent when the type declares no read tool.
 */
function agentReadPrompt(reg: ReturnType<typeof requireShareableResource>) {
  if (!reg.agentRead) return {};
  const noun = reg.displayName.toLowerCase();
  const appName = getAppConfig().app.name?.trim();
  return {
    agentRead: {
      actions: [...reg.agentRead.actions],
      idParam: reg.agentRead.idParam ?? "id",
      label: appName ? `${appName} ${noun}` : noun,
    },
  };
}

export default defineAction({
  description:
    "List the current visibility and share grants on a shareable resource. Ordinary reads require resource access; widget reads require admin access. `agentRead` names the MCP tool that reads the resource, when the type declares one. Owners and admins inside the resource's org also get `agents`: the org's service principals they can share with as a user principal.",
  schema: z.object({
    resourceType: z.string(),
    resourceId: z.string(),
  }),
  http: { method: "GET" },
  run: async (args, context) => {
    assertWidgetShareReadGrant(context, args);
    const reg = requireShareableResource(args.resourceType);
    const policy: {
      allowPublic: boolean;
      requireOrgMemberForUserShares: boolean;
      supportsGroupShares?: boolean;
    } = {
      allowPublic: reg.allowPublic !== false,
      requireOrgMemberForUserShares: reg.requireOrgMemberForUserShares === true,
      ...(reg.supportsGroupShares === true
        ? { supportsGroupShares: true }
        : {}),
    };
    const access = context?.mcpDirectoryWidgetReadOnly
      ? await assertAccess(
          args.resourceType,
          args.resourceId,
          "admin",
          undefined,
          { skipResourceBody: true },
        )
      : await resolveAccess(args.resourceType, args.resourceId, undefined, {
          skipResourceBody: true,
        });
    if (!access)
      return { ownerEmail: null, visibility: null, shares: [], policy };

    const db = reg.getDb() as any;
    const shares: ShareRow[] = await db
      .select({
        id: reg.sharesTable.id,
        principalType: reg.sharesTable.principalType,
        principalId: reg.sharesTable.principalId,
        role: reg.sharesTable.role,
        createdAt: reg.sharesTable.createdAt,
      })
      .from(reg.sharesTable)
      .where(eq(reg.sharesTable.resourceId, args.resourceId));
    const orgDisplayNames = await loadOrgDisplayNames(db, shares);
    const groupDisplayNames = await loadGroupDisplayNames(
      access.resource.orgId,
      shares,
    );
    const ownerEmail: string = access.resource.ownerEmail;
    const userDisplayNames = await loadUserDisplayNames(
      [
        ownerEmail,
        ...shares
          .filter(
            (s) =>
              s.principalType === "user" &&
              orgAgentName(s.principalId, access.resource.orgId) === null,
          )
          .map((s) => s.principalId),
      ].map((email) => email.trim().toLowerCase()),
    );
    const shareableAgents = context?.mcpDirectoryWidgetReadOnly
      ? {}
      : await loadShareableAgents(access.resource.orgId, access.role);

    return {
      ownerEmail,
      ownerDisplayName:
        userDisplayNames.get(ownerEmail.trim().toLowerCase()) ?? null,
      orgId: access.resource.orgId ?? null,
      visibility: access.resource.visibility ?? "private",
      role: access.role,
      agentReadable: Boolean(reg.agentReadable),
      ...(context?.mcpDirectoryWidgetReadOnly ? {} : agentReadPrompt(reg)),
      shares: shares.map((s) => {
        const agentName =
          s.principalType === "user"
            ? orgAgentName(s.principalId, access.resource.orgId)
            : null;
        return {
          id: s.id,
          principalType: s.principalType,
          principalId: s.principalId,
          displayName:
            s.principalType === "org"
              ? orgDisplayNames.get(s.principalId)
              : s.principalType === "group"
                ? groupDisplayNames.get(s.principalId)
                : (agentName ??
                  userDisplayNames.get(s.principalId.trim().toLowerCase())),
          ...(agentName ? { agent: true } : {}),
          role: s.role,
          createdAt: s.createdAt,
        };
      }),
      policy,
      ...shareableAgents,
    };
  },
});
