import { getRequestUserEmail } from "@agent-native/core/server/request-context";
import {
  getWorkflowRuntimeControls,
  setWorkflowRuntimeControl,
} from "@agent-native/core/workflow";

import {
  requireContentDatabaseAccess,
  requireContentDatabaseOwner,
} from "./_content-database-hooks.js";

export type ContentHookRuntimeControlScope = "global" | "database";

export interface ContentHookRuntimeControlValue {
  evaluatorPaused: boolean;
  effectsPaused: boolean;
}

export async function getContentHookRuntimeControls(databaseId: string) {
  const database = await requireContentDatabaseAccess(databaseId, "viewer");
  const controls = await getWorkflowRuntimeControls({
    ownerEmail: database.ownerEmail,
    orgId: database.orgId,
    domain: "content",
    resourceId: databaseId,
  });
  return {
    databaseId,
    global: controls.global,
    database: controls.resource,
    effective: controls.effective,
    canManageGlobal: getRequestUserEmail() === database.ownerEmail,
  };
}

export async function resolveContentHookRuntimeControls(args: {
  ownerEmail: string;
  orgId?: string | null;
  databaseId: string;
}) {
  const controls = await getWorkflowRuntimeControls({
    ownerEmail: args.ownerEmail,
    orgId: args.orgId,
    domain: "content",
    resourceId: args.databaseId,
  });
  return controls.effective;
}

export async function setContentHookRuntimeControl(args: {
  databaseId: string;
  scope: ContentHookRuntimeControlScope;
  evaluatorPaused: boolean;
  effectsPaused: boolean;
}) {
  const database = await requireContentDatabaseOwner(args.databaseId);
  await setWorkflowRuntimeControl({
    ownerEmail: database.ownerEmail,
    orgId: database.orgId,
    domain: "content",
    scope: args.scope === "global" ? "global" : "resource",
    resourceId: args.databaseId,
    evaluatorPaused: args.evaluatorPaused,
    effectsPaused: args.effectsPaused,
  });
  return getContentHookRuntimeControls(args.databaseId);
}
