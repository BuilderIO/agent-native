import { createAuthPlugin } from "./auth-plugin.js";
import type { AuthOptions } from "./auth.js";
import { getOnboardingHtml } from "./onboarding-html.js";

type NitroPluginDef = (nitroApp: any) => void | Promise<void>;

export interface GoogleAuthPluginOptions extends Pick<
  AuthOptions,
  | "publicPaths"
  | "googleAuthMode"
  | "renderSignInPage"
  | "renderResetPasswordPage"
> {}

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
    loginHtml: getOnboardingHtml({
      googleOnly: true,
      googleAuthMode: options?.googleAuthMode,
      renderSignInPage: options?.renderSignInPage,
    }),
  });
}
