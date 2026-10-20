import type { ActionRunContext } from "@agent-native/core/action";
import { ForbiddenError } from "@agent-native/core/sharing";
import {
  assertWorkspaceUserGroupManager,
  type WorkspaceConnection,
} from "@agent-native/core/workspace-connections";

import { dispatchAccess } from "../server/lib/app-roles.js";

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

export async function assertWorkspaceConnectionManager(
  ctx: ActionRunContext | undefined,
  allowedApps: string[] | undefined,
): Promise<void> {
  if (
    isDispatchOnlyConnectionScope(allowedApps) &&
    (await isDispatchAppAdmin(ctx))
  ) {
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
  );
}
