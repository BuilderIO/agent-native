import { agentNativePath } from "../api-path.js";
import { serverMountReturnPath } from "../sign-in-return.js";

export type WorkspaceProviderOAuthScope = "user" | "organization" | "app";

export interface WorkspaceProviderOAuthOptions {
  appId: string;
  /** A UI page to land on once the connection completes. */
  returnPath?: string;
  /**
   * A route on the app's server to land on instead. The server joins it to
   * its own mount, so it is written mount-relative (for example its OAuth
   * popup completion page).
   */
  serverReturnPath?: string;
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
  const returnTarget =
    options.serverReturnPath ??
    (options.returnPath
      ? serverMountReturnPath(options.returnPath)
      : undefined);
  if (returnTarget) params.set("return", returnTarget);
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
