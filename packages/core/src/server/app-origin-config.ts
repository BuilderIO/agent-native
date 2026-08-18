import { getAppConfig } from "../app-config/index.js";

/**
 * Project this app's origins into the client shell.
 *
 * The browser needs these to build cross-frame and workspace-relative URLs.
 * Historically that was done by mirroring each key with a `VITE_` twin, because
 * Vite only inlines `VITE_`-prefixed variables into the bundle — so every
 * consumer ended up writing both spellings, and half of each chain was dead on
 * whichever side it happened to run.
 *
 * The mirror answered "how does this value reach the browser", never "what is
 * this value". This is that answer instead: one declared field on the server,
 * delivered through the same shell script Sentry and PostHog already use.
 *
 * Every value here is impersonal and identical for every visitor, which is what
 * makes it safe inside the CDN-cached SSR shell (`guard:ssr-cache-shell`).
 * Never add a per-user or per-request value to this object.
 */
export function resolvePublicAppOriginConfig(): {
  appUrl?: string;
  workspaceGatewayUrl?: string;
  workspaceOAuthOrigin?: string;
} | null {
  const config = getAppConfig();
  const resolved = {
    ...(config.app.url ? { appUrl: config.app.url } : {}),
    ...(config.workspace.gatewayUrl
      ? { workspaceGatewayUrl: config.workspace.gatewayUrl }
      : {}),
    ...(config.workspace.oauthOrigin
      ? { workspaceOAuthOrigin: config.workspace.oauthOrigin }
      : {}),
  };
  return Object.keys(resolved).length > 0 ? resolved : null;
}

export function getAppOriginClientConfigScript(): string | null {
  const config = resolvePublicAppOriginConfig();
  if (!config) return null;

  return [
    "<script data-agent-native-app-origin-config>",
    "window.__AGENT_NATIVE_CONFIG__=Object.assign({},window.__AGENT_NATIVE_CONFIG__,",
    JSON.stringify(config),
    ");",
    "</script>",
  ].join("");
}
