import { getAppConfig } from "../app-config/index.js";

export function resolveWorkspaceAccessAppId(targetAppId?: string): string {
  const app = getAppConfig().app;
  const identities = [
    app.id,
    app.legacyId,
    app.template,
    app.slug,
    app.packageName,
    app.workspaceId,
  ]
    .map((value) => value?.trim())
    .filter(Boolean);

  // Other apps still require their own workspace grant; only this deployment's
  // aliases resolve to the identity used by its HTTP access gate.
  const target = targetAppId?.trim();
  if (target && !identities.includes(target)) return target;

  const workspaceId = app.workspaceId?.trim();
  if (workspaceId) return workspaceId;
  return identities.some((value) => value?.toLowerCase() === "dispatch")
    ? "dispatch"
    : "";
}
