import { createAuthPlugin } from "./auth-plugin.js";
import type { AuthOptions } from "./auth.js";

type NitroPluginDef = (nitroApp: any) => void | Promise<void>;

export interface GoogleAuthPluginOptions extends Pick<
  AuthOptions,
  | "publicPaths"
  | "googleAuthMode"
  | "renderSignInPage"
  | "renderResetPasswordPage"
> {}

// The sign-in page renders for each request that shows it, so a renderer that
// loads after startup (the toolkit's does) still reaches the page.
export function createGoogleAuthPlugin(
  options?: GoogleAuthPluginOptions,
): NitroPluginDef {
  return createAuthPlugin({
    ...options,
    publicPaths: [
      "/_agent-native/google/callback",
      "/_agent-native/google/auth-url",
      "/_agent-native/auth/ba",
      ...(options?.publicPaths ?? []),
    ],
    googleOnly: true,
    rootAuth: true,
  });
}
