import { createAuthPlugin, type AuthOptions } from "@agent-native/core/server";
import type {
  AuthPageProps,
  ResetPasswordPageProps,
} from "@agent-native/core/shared/auth-page-types";

type AuthPageRenderers = typeof import("./render-pages.js");

// The renderers bring React DOM's server renderer and the auth pages with
// their icon set, about 3 MB a fresh server would otherwise compile before
// answering anything. The plugin loads them before the first page navigation
// is handled, and a sign-in page served before then starts the load.
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
  req: { method: string; headers: { get(name: string): string | null } };
};

type RequestHooks = {
  hook(
    name: "request",
    hook: (event: RequestHookEvent) => Promise<void>,
  ): unknown;
};

// A browser navigation, including a form post, names a document or iframe
// destination or accepts HTML. `fetch()` calls send `*/*` and never load the
// renderers; a sign-in page served to such a request gets core's fallback
// markup, kept out of shared caches.
function isPageNavigation(event: RequestHookEvent): boolean {
  const fetchDest = event.req.headers.get("sec-fetch-dest")?.toLowerCase();
  if (fetchDest === "document" || fetchDest === "iframe") return true;
  return (
    event.req.headers.get("accept")?.toLowerCase().includes("text/html") ??
    false
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
      if (!renderers && isPageNavigation(event)) await loadAuthPageRenderers();
    });
    return plugin(nitroApp);
  };
}
