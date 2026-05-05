export const DISPATCH_WORKSPACE_ROOT_REDIRECTS = [
  ["overview", "overview"],
  ["login", "login"],
  ["signup", "signup"],
  ["apps", "apps"],
  ["apps/new-app", "new-app"],
  ["new-app", "new-app"],
  ["vault", "vault"],
  ["integrations", "integrations"],
  ["agents", "agents"],
  ["workspace", "workspace"],
  ["messaging", "messaging"],
  ["extensions", "extensions"],
  ["destinations", "destinations"],
  ["identities", "identities"],
  ["approval", "approval"],
  ["approvals", "approvals"],
  ["audit", "audit"],
  ["team", "team"],
] as const;

export const RESERVED_WORKSPACE_APP_IDS = new Set([
  "_agent-native",
  "_workspace_static",
  "api",
  "auth",
  "dispatch",
  "netlify",
  // Legacy alias — `tools` was the previous name for `extensions`. Keep it
  // reserved so a user can't create a workspace app whose mount path collides
  // with the legacy `/tools` redirect (still served by core-routes-plugin).
  "tools",
  ...DISPATCH_WORKSPACE_ROOT_REDIRECTS.map(([from]) => from),
]);

export function isValidWorkspaceAppIdFormat(appId: string): boolean {
  return /^[a-z][a-z0-9-]*$/.test(appId);
}

export function getWorkspaceAppIdValidationError(appId: string): string | null {
  if (RESERVED_WORKSPACE_APP_IDS.has(appId)) {
    return `App name "${appId}" conflicts with a reserved workspace route. Choose a different name.`;
  }
  if (!isValidWorkspaceAppIdFormat(appId)) {
    return `Invalid app name "${appId}". Use lowercase letters, numbers, and hyphens.`;
  }
  return null;
}

export function assertValidWorkspaceAppId(appId: string): void {
  const error = getWorkspaceAppIdValidationError(appId);
  if (error) throw new Error(error);
}
