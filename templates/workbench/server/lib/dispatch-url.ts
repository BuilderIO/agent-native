/**
 * Centralized resolver for the Dispatch app's integrations page URL.
 *
 * Every Workbench action that needs the user to grant a workspace
 * integration (GitHub today; Sentry once it ships in v1.1) routes them to
 * Dispatch's `/integrations` page. The URL shape varies by environment:
 *
 *   - **Dev** (`agent-native dev` running each app on its own port):
 *     `http://localhost:8092/integrations?provider=...&appId=...`
 *     (8092 is Dispatch's `devPort` from
 *     `packages/shared-app-config/templates.ts`.)
 *
 *   - **Workspace gateway** (`agent-native workspace-dev` or a deployed
 *     workspace at one origin): `/dispatch/integrations?...` — a same-origin
 *     relative URL because the gateway mounts every app under `/<app>/*`.
 *
 *   - **Prod / standalone** (Dispatch deployed at its own subdomain):
 *     `https://dispatch.agent-native.com/integrations?...` — the canonical
 *     `prodUrl` from `templates-meta.ts`.
 *
 * Detection mirrors the framework's own runtime env signals:
 *   - `WORKSPACE_GATEWAY=1` or `AGENT_NATIVE_WORKSPACE=1` → relative path,
 *     since the gateway proxies `/dispatch/*` for us.
 *   - `NODE_ENV !== "production"` → localhost:8092 (single-app dev).
 *   - Otherwise → prod URL.
 *
 * Kept dialect-agnostic and free of any framework imports so it can run
 * inside actions (server) without dragging extra bundle weight into the
 * client. Action responses already carry the URL down to the UI, so the
 * client never needs to recompute it.
 */

const DISPATCH_DEV_PORT = 8092;
const DISPATCH_PROD_URL = "https://dispatch.agent-native.com";

export interface GetDispatchIntegrationsUrlParams {
  /** Workspace provider id — e.g. "github", "sentry", "slack". */
  provider: string;
  /** Which app is requesting the grant (always "workbench" today). */
  appId: string;
}

/**
 * Returns the URL for Dispatch's integrations page where a user grants a
 * workspace provider to an app. Resolves to localhost in dev, a gateway-
 * relative path inside a workspace, and the canonical prod subdomain
 * otherwise.
 */
export function getDispatchIntegrationsUrl(
  params: GetDispatchIntegrationsUrlParams,
): string {
  const search = new URLSearchParams({
    provider: params.provider,
    appId: params.appId,
  }).toString();

  // Workspace gateway: same-origin relative URL. The gateway proxies
  // `/dispatch/*` to the Dispatch app, so a relative path stays inside the
  // current browser tab without a cross-origin redirect.
  if (
    process.env.WORKSPACE_GATEWAY === "1" ||
    process.env.AGENT_NATIVE_WORKSPACE === "1"
  ) {
    return `/dispatch/integrations?${search}`;
  }

  // Standalone dev: each app runs on its own port via `agent-native dev`.
  // Dispatch's devPort is 8092 (see packages/shared-app-config/templates.ts).
  if (process.env.NODE_ENV !== "production") {
    return `http://localhost:${DISPATCH_DEV_PORT}/integrations?${search}`;
  }

  // Standalone prod: the canonical Dispatch subdomain.
  return `${DISPATCH_PROD_URL}/integrations?${search}`;
}
