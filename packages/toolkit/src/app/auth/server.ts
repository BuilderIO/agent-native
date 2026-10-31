import { createAuthPlugin, type AuthOptions } from "@agent-native/core/server";
import type {
  AuthPageProps,
  ResetPasswordPageProps,
} from "@agent-native/core/shared/auth-page-types";
import { SIGN_IN_LEGACY_ENTRY_PATH } from "@agent-native/core/shared/sign-in-journey";

type AuthPageRenderers = typeof import("./render-pages.js");

// The renderers bring React DOM's server renderer and the auth pages with
// their icon set, about 3 MB a fresh server would otherwise compile before
// answering anything. The plugin loads them before the first page request is
// handled, and a sign-in page served before then starts the load.
let renderers: AuthPageRenderers | undefined;
let loading: Promise<AuthPageRenderers | undefined> | undefined;

/**
 * Load the sign-in and reset-password renderers. Settles to `undefined` when
 * the load fails, and a later call tries again.
 */
export function loadAuthPageRenderers(): Promise<
  AuthPageRenderers | undefined
> {
  loading ??= import("./render-pages.js").then(
    (module) => (renderers = module),
    (error: unknown) => {
      loading = undefined;
      console.warn(
        "[auth] Could not load the sign-in page renderer; the page renders in the browser:",
        error instanceof Error ? error.message : String(error),
      );
      return undefined;
    },
  );
  return loading;
}

/**
 * Server-render the sign-in page. Returns `undefined` until
 * `loadAuthPageRenderers()` has finished, and starts that load; core then
 * serves its fallback markup, which the auth client script replaces in the
 * browser.
 */
export function renderAuthPage(props: AuthPageProps): string | undefined {
  if (!renderers) void loadAuthPageRenderers();
  return renderers?.renderSignInPageMarkup(props);
}

export function renderAuthResetPasswordPage(
  props: ResetPasswordPageProps,
): string | undefined {
  if (!renderers) void loadAuthPageRenderers();
  return renderers?.renderResetPasswordPageMarkup(props);
}

type RequestHookEvent = {
  req: {
    method: string;
    url: string;
    headers: { get(name: string): string | null };
  };
};

type RequestHooks = {
  hook(
    name: "request",
    hook: (event: RequestHookEvent) => Promise<void>,
  ): unknown;
};

// The app's own API calls go to `/_agent-native/` and never load the
// renderers. Any read of a page outside it, or of the old sign-in path, loads
// them first, whatever the client (a browser, a link preview, the deploy's
// cache check), because the sign-in page it may get is cached for every
// visitor. So does a browser navigation, a form post included, which names a
// document or iframe destination or accepts HTML.
function needsRenderers(event: RequestHookEvent): boolean {
  const { method, url, headers } = event.req;
  const fetchDest = headers.get("sec-fetch-dest")?.toLowerCase();
  if (fetchDest === "document" || fetchDest === "iframe") return true;
  if (headers.get("accept")?.toLowerCase().includes("text/html")) return true;
  if (method !== "GET" && method !== "HEAD") return false;
  const { pathname } = new URL(url, "http://localhost");
  return (
    pathname.endsWith(SIGN_IN_LEGACY_ENTRY_PATH) ||
    !pathname.includes("/_agent-native/")
  );
}

export function createToolkitAuthPlugin(options: AuthOptions = {}) {
  const plugin = createAuthPlugin({
    ...options,
    renderSignInPage: options.renderSignInPage ?? renderAuthPage,
    renderResetPasswordPage:
      options.renderResetPasswordPage ?? renderAuthResetPasswordPage,
  });
  if (options.renderSignInPage && options.renderResetPasswordPage) {
    return plugin;
  }
  return (nitroApp: unknown) => {
    const hooks = (nitroApp as { hooks?: Partial<RequestHooks> } | null)?.hooks;
    hooks?.hook?.("request", async (event) => {
      if (!renderers && needsRenderers(event)) await loadAuthPageRenderers();
    });
    return plugin(nitroApp);
  };
}
