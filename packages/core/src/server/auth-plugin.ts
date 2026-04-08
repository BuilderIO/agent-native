import { getH3App } from "./framework-request-handler.js";
import { autoMountAuth } from "./auth.js";
import type { AuthOptions } from "./auth.js";

type NitroPluginDef = (nitroApp: any) => void | Promise<void>;

export function createAuthPlugin(options?: AuthOptions): NitroPluginDef {
  return async (nitroApp: any) => {
    await autoMountAuth(getH3App(nitroApp), options);
  };
}

/**
 * Default auth plugin — email/password auth with optional Google OAuth.
 * Google sign-in button appears automatically on the login page when
 * GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET env vars are set.
 */
export const defaultAuthPlugin: NitroPluginDef = async (nitroApp: any) => {
  return createAuthPlugin()(nitroApp);
};
