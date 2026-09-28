import { createAuthPlugin } from "./auth-plugin.js";
import { type GoogleAuthMode } from "./google-auth-mode.js";
import { getOnboardingHtml } from "./onboarding-html.js";

type NitroPluginDef = (nitroApp: any) => void | Promise<void>;

export interface GoogleAuthPluginOptions {
  publicPaths?: string[];
  googleAuthMode?: GoogleAuthMode;
}

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
    loginHtml: getOnboardingHtml({
      googleOnly: true,
      googleAuthMode: options?.googleAuthMode,
    }),
  });
}
