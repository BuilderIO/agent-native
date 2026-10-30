import type { ActionRunContext } from "@agent-native/core/action";
import { readOrgMemberRole } from "@agent-native/core/server";
import { ForbiddenError } from "@agent-native/core/sharing";
import {
  assertWorkspaceUserGroupManager,
  type WorkspaceConnection,
} from "@agent-native/core/workspace-connections";

import { dispatchAccess } from "../server/lib/app-roles.js";
import {
  findUngrantedVaultKeys,
  type VaultCredentialRef,
} from "../server/lib/vault-grants.js";

const DISPATCH_APP_ID = "dispatch";

function normalizeAppIds(appIds: string[] | undefined): string[] {
  return Array.from(
    new Set(
      (appIds ?? []).map((appId) => appId.trim().toLowerCase()).filter(Boolean),
    ),
  );
}

export function isDispatchOnlyConnectionScope(
  allowedApps: string[] | undefined,
): boolean {
  const normalized = normalizeAppIds(allowedApps);
  return normalized.length === 1 && normalized[0] === DISPATCH_APP_ID;
}

async function isDispatchAppAdmin(
  ctx: ActionRunContext | undefined,
): Promise<boolean> {
  if (ctx?.appId !== DISPATCH_APP_ID || !ctx.userEmail || !ctx.orgId) {
    return false;
  }
  try {
    await dispatchAccess.assertPermission(["administer"], {
      userEmail: ctx.userEmail,
      orgId: ctx.orgId,
    });
    return true;
  } catch (error) {
    if (error instanceof ForbiddenError) return false;
    throw error;
  }
}

async function isOrgOwnerOrAdmin(
  ctx: ActionRunContext | undefined,
): Promise<boolean> {
  if (!ctx?.orgId || !ctx.userEmail) return false;
  const role = await readOrgMemberRole(
    ctx.orgId,
    ctx.userEmail.trim().toLowerCase(),
  );
  return role === "owner" || role === "admin";
}

// In manual vault mode only org owners and admins may hand an app a vault key,
// so a Dispatch admin may not point a connection at a key Dispatch lacks.
async function assertDispatchAdminVaultRefs(
  ctx: ActionRunContext | undefined,
  credentialRefs: VaultCredentialRef[],
): Promise<void> {
  if (credentialRefs.length === 0 || !ctx?.orgId) return;
  if (await isOrgOwnerOrAdmin(ctx)) return;
  // raw-sql-ok: not SQL; the query lives in vault-grants.ts with bound values
  const ungranted = await findUngrantedVaultKeys(
    ctx.orgId,
    DISPATCH_APP_ID,
    credentialRefs,
  );
  if (ungranted.length > 0) {
    throw new ForbiddenError(
      "Only workspace admins can use vault keys that are not granted to Dispatch: " +
        ungranted.join(", ") +
        ".",
    );
  }
}

export async function assertWorkspaceConnectionManager(
  ctx: ActionRunContext | undefined,
  allowedApps: string[] | undefined,
  credentialRefs: VaultCredentialRef[] = [],
): Promise<void> {
  if (
    isDispatchOnlyConnectionScope(allowedApps) &&
    (await isDispatchAppAdmin(ctx))
  ) {
    await assertDispatchAdminVaultRefs(ctx, credentialRefs);
    return;
  }
  await assertWorkspaceUserGroupManager(ctx?.orgId, ctx?.userEmail);
}

export async function assertWorkspaceConnectionDeleteManager(
  ctx: ActionRunContext | undefined,
  connection: WorkspaceConnection,
): Promise<void> {
  await assertWorkspaceConnectionManager(ctx, connection.allowedApps);
}

export async function assertWorkspaceConnectionGrantManager(
  ctx: ActionRunContext | undefined,
  connection: WorkspaceConnection,
  appId: string | undefined,
  granted: boolean,
  accessMode: "all-apps" | "selected-apps" | undefined,
): Promise<void> {
  const normalizedAppId = appId?.trim().toLowerCase();
  const normalizedAllowedApps = normalizeAppIds(connection.allowedApps);
  const canEditOnlyDispatchGrant =
    normalizedAppId === DISPATCH_APP_ID &&
    accessMode !== "all-apps" &&
    normalizedAllowedApps.includes(DISPATCH_APP_ID) &&
    (granted || normalizedAllowedApps.length > 1);
  await assertWorkspaceConnectionManager(
    ctx,
    canEditOnlyDispatchGrant ? [DISPATCH_APP_ID] : [],
    granted ? connection.credentialRefs : [],
  );
}
