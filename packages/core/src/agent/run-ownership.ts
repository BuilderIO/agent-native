import { getThread, hasThreadAccess } from "../chat-threads/store.js";
import type { AccessContext } from "../sharing/access.js";
import type { ShareRole } from "../sharing/schema.js";
import { getRun } from "./run-manager.js";
import { getRunById } from "./run-store.js";

export interface RunAppScope {
  sourceAppId: string | null;
}

export async function threadMatchesRunApp(
  threadId: string | null | undefined,
  scope?: RunAppScope,
): Promise<boolean> {
  if (scope === undefined) return true;
  const appId = scope.sourceAppId?.trim();
  if (!appId || !threadId) return false;
  const thread = await getThread(threadId);
  return thread?.source?.appId === appId;
}

export async function resolveRunThreadId(
  runId: string,
): Promise<string | null> {
  const memRun = getRun(runId);
  if (memRun) return memRun.threadId;
  const row = await getRunById(runId);
  return row?.threadId ?? null;
}

export async function callerOwnsThread(
  owner: string,
  threadId: string | null | undefined,
): Promise<boolean> {
  if (!threadId) return false;
  const thread = await getThread(threadId);
  return !!thread && thread.ownerEmail === owner;
}

export async function callerHasThreadAccess(
  owner: string,
  threadId: string | null | undefined,
  role: ShareRole | "owner" = "viewer",
  ctx: Omit<AccessContext, "userEmail"> = {},
  appScope?: RunAppScope,
): Promise<boolean> {
  if (!threadId) return false;
  if (!(await threadMatchesRunApp(threadId, appScope))) return false;
  return hasThreadAccess(owner, threadId, role, ctx);
}

export async function callerOwnsRun(
  owner: string,
  runId: string,
): Promise<boolean> {
  return callerOwnsThread(owner, await resolveRunThreadId(runId));
}

export async function callerHasRunAccess(
  owner: string,
  runId: string,
  role: ShareRole | "owner" = "viewer",
  ctx: Omit<AccessContext, "userEmail"> = {},
  appScope?: RunAppScope,
): Promise<boolean> {
  return callerHasThreadAccess(
    owner,
    await resolveRunThreadId(runId),
    role,
    ctx,
    appScope,
  );
}
