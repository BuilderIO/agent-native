import { getAppConfig } from "@agent-native/core/server";

export function isDispatchEnvironmentAdmin(email: string): boolean {
  const normalized = email.trim().toLowerCase();
  if (!normalized) return false;
  const config = getAppConfig().dispatch;
  return [
    ...config.adminEmails,
    ...config.workspaceOwnerEmails,
    ...(config.defaultOwnerEmail ? [config.defaultOwnerEmail] : []),
  ].some((candidate) => candidate.trim().toLowerCase() === normalized);
}

export function getDispatchDefaultOwnerEmail(): string | null {
  return getAppConfig().dispatch.defaultOwnerEmail?.trim() || null;
}
