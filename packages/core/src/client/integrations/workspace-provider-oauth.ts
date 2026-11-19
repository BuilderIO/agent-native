import { FRAMEWORK_INTERNAL_ROUTE_PREFIX } from "../../shared/framework-route-prefix.js";
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
  /** Let the invoking surface explain how to retry when popups are blocked. */
  onPopupBlocked?: () => void;
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
 * The completion route the OAuth popup returns to. Written in the
 * mount-relative, internal `/_agent-native` form: the app's server joins it to
 * its own mount (see `getAppUrl`), so a path-mounted deployment does not double
 * the prefix. The completion page posts the workspace-connection message back
 * to the opener.
 */
export const WORKSPACE_CONNECTION_COMPLETION_RETURN = `${FRAMEWORK_INTERNAL_ROUTE_PREFIX}/oauth/popup?complete=workspace-connection`;

/** The origin that will serve the completion page and post the message. */
function completionOrigin(startUrl: string): string | undefined {
  if (!URL.canParse(startUrl, window.location.href)) return undefined;
  return new URL(startUrl, window.location.href).origin;
}

/**
 * The start URL for a popup that returns to the framework completion page, so
 * an embedded app can learn the flow finished instead of navigating its frame
 * to the provider (which providers refuse to be framed). The caller's own
 * `returnPath` is preserved in the options and applied on completion.
 */
export function workspaceProviderOAuthPopupStartUrl(
  provider: string,
  options: WorkspaceProviderOAuthOptions,
): string {
  return workspaceProviderOAuthUrl(provider, {
    ...options,
    serverReturnPath: WORKSPACE_CONNECTION_COMPLETION_RETURN,
  });
}

/**
 * Resolve when the popup posts the framework completion message, or when it is
 * closed without one. Accepts the completion page's origin, which can be a
 * configured API origin distinct from the embedded UI origin, while still
 * binding to the exact popup window. Returns a stop function.
 */
export function watchWorkspaceConnectionCompletion(
  popup: Window,
  onComplete: () => void,
  expectedOrigin?: string,
): () => void {
  let closedTicks = 0;
  const stop = () => {
    window.removeEventListener("message", onMessage);
    window.clearInterval(closedTimer);
  };
  const onMessage = (event: MessageEvent<unknown>) => {
    const originAccepted =
      event.origin === window.location.origin ||
      (expectedOrigin !== undefined && event.origin === expectedOrigin);
    if (!originAccepted || event.source !== popup) return;
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

/**
 * Apply the caller's return target on completion, so resume state carried in
 * `returnPath` survives an embedded flow. Falls back to a reload.
 */
function applyReturnPath(options: WorkspaceProviderOAuthOptions): void {
  if (options.returnPath) {
    window.location.assign(options.returnPath);
    return;
  }
  window.location.reload();
}

export function startWorkspaceProviderOAuth(
  provider: string,
  options: WorkspaceProviderOAuthOptions,
): void {
  if (isFramedContext()) {
    // Providers refuse to be framed (X-Frame-Options / frame-ancestors), so a
    // same-window navigation inside Dispatch's iframe is refused. Leave the
    // frame: run the flow in a popup whose completion page posts back.
    const startUrl = workspaceProviderOAuthPopupStartUrl(provider, options);
    const popup = openOAuthPopup({
      initialUrl: startUrl,
      features: "width=640,height=760",
    });
    if (popup) {
      watchWorkspaceConnectionCompletion(
        popup,
        () => applyReturnPath(options),
        completionOrigin(startUrl),
      );
      return;
    }
    // Popup blocked while embedded. Never navigate this frame into the
    // provider — the frame refuses it and the user cannot connect at all.
    // Surface the recovery; the caller retries once popups are allowed.
    console.warn(
      "[agent-native] OAuth popup was blocked while embedded in another page; allow popups for this site to connect the provider.",
    );
    options.onPopupBlocked?.();
    return;
  }
  window.location.assign(workspaceProviderOAuthUrl(provider, options));
}
