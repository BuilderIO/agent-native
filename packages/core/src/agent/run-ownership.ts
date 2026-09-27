import { getThread, resolveThreadAccess } from "../chat-threads/store.js";
import type { AccessContext } from "../sharing/access.js";
import type { ShareRole } from "../sharing/schema.js";
import { getRun } from "./run-manager.js";
import { getRunById } from "./run-store.js";

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
): Promise<boolean> {
  if (!threadId) return false;
  return !!(await resolveThreadAccess(owner, threadId, role, ctx));
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
): Promise<boolean> {
  return callerHasThreadAccess(
    owner,
    await resolveRunThreadId(runId),
    role,
    ctx,
  );
}
