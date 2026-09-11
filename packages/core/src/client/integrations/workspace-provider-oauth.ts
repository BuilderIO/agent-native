import { agentNativePath } from "../api-path.js";

export type WorkspaceProviderOAuthScope = "user" | "organization" | "app";

export interface WorkspaceProviderOAuthOptions {
  appId: string;
  returnPath?: string;
  scope?: WorkspaceProviderOAuthScope;
}

export function workspaceProviderOAuthUrl(
  provider: string,
  options: WorkspaceProviderOAuthOptions,
): string {
  const params = new URLSearchParams({
    appId: options.appId,
    scope: options.scope ?? "user",
  });
  if (options.returnPath) params.set("return", options.returnPath);
  return agentNativePath(
    `/_agent-native/connections/oauth/${provider}/start?${params.toString()}`,
  );
}

export function startWorkspaceProviderOAuth(
  provider: string,
  options: WorkspaceProviderOAuthOptions,
): void {
  window.location.assign(workspaceProviderOAuthUrl(provider, options));
}
