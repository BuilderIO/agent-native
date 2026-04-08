import { getH3App } from "./framework-request-handler.js";
import { autoMountAuth } from "./auth.js";
import type { AuthOptions } from "./auth.js";
import { createGoogleAuthPlugin } from "./google-auth-plugin.js";

type NitroPluginDef = (nitroApp: any) => void | Promise<void>;

export function createAuthPlugin(options?: AuthOptions): NitroPluginDef {
  return async (nitroApp: any) => {
    await autoMountAuth(getH3App(nitroApp), options);
  };
}

/**
 * Default auth plugin — auto-detects the auth strategy:
 * - If GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET are set → Google OAuth
 * - Otherwise → email/password or ACCESS_TOKEN auth
 */
export const defaultAuthPlugin: NitroPluginDef = async (nitroApp: any) => {
  if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) {
    return createGoogleAuthPlugin()(nitroApp);
  }
  return createAuthPlugin()(nitroApp);
};
