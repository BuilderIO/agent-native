import { agentNativePath } from "../api-path.js";
import { openOAuthPopup } from "../oauth-popup.js";
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
  requestedScopes?: readonly string[];
  optionalScopes?: readonly string[];
  targetAccountEmail?: string;
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
  if (options.requestedScopes?.length) {
    params.set("requestedScopes", options.requestedScopes.join(" "));
  }
  if (options.optionalScopes?.length) {
    params.set("optionalScopes", options.optionalScopes.join(" "));
  }
  if (options.targetAccountEmail) {
    params.set("targetAccountEmail", options.targetAccountEmail);
  }
  return agentNativePath(
    `/_agent-native/connections/oauth/${provider}/start?${params.toString()}`,
  );
}

/** True when this app runs inside another page's iframe (for example Dispatch). */
export function isFramedContext(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.top !== window.self;
  } catch {
    // A cross-origin ancestor makes `window.top` throw; that means framed.
    return true;
  }
}

/**
 * The start URL for a popup that returns to the framework completion page, so
 * an embedded app can learn the flow finished instead of navigating its frame
 * to the provider (which providers refuse to be framed).
 */
export function workspaceProviderOAuthPopupStartUrl(
  provider: string,
  options: WorkspaceProviderOAuthOptions,
): string {
  const startUrl = new URL(
    workspaceProviderOAuthUrl(provider, options),
    window.location.href,
  );
  const completionUrl = new URL(
    agentNativePath("/_agent-native/oauth/popup"),
    window.location.href,
  );
  completionUrl.searchParams.set("complete", "workspace-connection");
  startUrl.searchParams.set(
    "return",
    `${completionUrl.pathname}${completionUrl.search}`,
  );
  return startUrl.href;
}

/**
 * Resolve when the popup posts the framework completion message, or when it is
 * closed without one. Returns a stop function for the caller to clean up.
 */
export function watchWorkspaceConnectionCompletion(
  popup: Window,
  onComplete: () => void,
): () => void {
  let closedTicks = 0;
  const stop = () => {
    window.removeEventListener("message", onMessage);
    window.clearInterval(closedTimer);
  };
  const onMessage = (event: MessageEvent<unknown>) => {
    if (event.origin !== window.location.origin || event.source !== popup)
      return;
    const data = event.data;
    if (
      typeof data !== "object" ||
      data === null ||
      (data as { type?: unknown }).type !==
        "agent-native:workspace-connection-complete"
    )
      return;
    stop();
    onComplete();
  };
  // The completion message is posted just before the popup closes; wait one
  // extra tick so a close never wins the race against it.
  const closedTimer = window.setInterval(() => {
    if (!popup.closed) {
      closedTicks = 0;
      return;
    }
    closedTicks += 1;
    if (closedTicks > 1) stop();
  }, 500);
  window.addEventListener("message", onMessage);
  return stop;
}

export function startWorkspaceProviderOAuth(
  provider: string,
  options: WorkspaceProviderOAuthOptions,
): void {
  if (isFramedContext()) {
    // Providers refuse to be framed (X-Frame-Options / frame-ancestors), so a
    // same-window navigation inside Dispatch's iframe shows "refused to
    // connect". Leave the frame: run the flow in a popup that returns to the
    // completion page, then reload this app so the new connection appears.
    const popup = openOAuthPopup({
      initialUrl: workspaceProviderOAuthPopupStartUrl(provider, options),
      features: "width=640,height=760",
    });
    if (popup) {
      watchWorkspaceConnectionCompletion(popup, () => window.location.reload());
      return;
    }
  }
  window.location.assign(workspaceProviderOAuthUrl(provider, options));
}
