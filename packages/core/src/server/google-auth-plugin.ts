import { createAuthPlugin } from "./auth-plugin.js";
import { type GoogleAuthMode } from "./google-auth-mode.js";
import { getOnboardingHtml } from "./onboarding-html.js";

type NitroPluginDef = (nitroApp: any) => void | Promise<void>;

export interface GoogleAuthPluginOptions {
  /** Additional paths accessible without authentication */
  publicPaths?: string[];
  /**
   * Google sign-in flow: `'popup'`, `'redirect'`, or `'auto'` (default).
   * Falls back to `GOOGLE_AUTH_MODE` env var, then `'auto'`. Builder
   * iframes use popup; top-level Builder preview/editor surfaces use
   * redirect.
   */
  googleAuthMode?: GoogleAuthMode;
}

/**
 * Create an auth plugin that uses Google OAuth for authentication.
 *
 * When a user visits the app unauthenticated, they see a "Sign in with Google"
 * page. The Google OAuth callback (handled by the template) creates a session
 * tied to the user's Google email. `getSession()` then returns `{ email }` for
 * all subsequent requests.
 *
 * Better Auth handles Google OAuth internally when GOOGLE_CLIENT_ID and
 * GOOGLE_CLIENT_SECRET are set. The template's callback route at
 * /_agent-native/google/callback handles mobile deep linking.
 *
 * Usage in a template's `server/plugins/auth.ts`:
 * ```ts
 * import { createGoogleAuthPlugin } from "@agent-native/core/server";
 * export default createGoogleAuthPlugin();
 * ```
 */
export function createGoogleAuthPlugin(
  options?: GoogleAuthPluginOptions,
): NitroPluginDef {
  return createAuthPlugin({
    publicPaths: [
      "/_agent-native/google/callback",
      "/_agent-native/google/auth-url",
      "/_agent-native/auth/ba",
      ...(options?.publicPaths ?? []),
    ],
    // The framework has exactly ONE login document. This plugin used to ship
    // a second, near-verbatim copy that had drifted: no already-signed-in
    // bounce, no stuck-button recovery, no i18n, and a completion of
    // `window.location.href = ret || '/'` where `ret` was the sign-in page
    // itself — sign in, land back on the sign-in page, click sign in again.
    // Every anti-loop fix ever shipped landed on whichever copy the ticket
    // named. Do not reintroduce a second producer of `loginHtml`. Keeping this
    // producer shared also keeps the verifier-bound desktop OAuth POST
    // bootstrap in Google-only plugin pages.
    loginHtml: getOnboardingHtml({
      googleOnly: true,
      googleAuthMode: options?.googleAuthMode,
    }),
  });
}
