import { autoMountAuth } from "./auth.js";
import type { AuthOptions } from "./auth.js";
import {
  getH3App,
  awaitBootstrap,
  markDefaultPluginProvided,
  trackPluginInit,
} from "./framework-request-handler.js";

type NitroPluginDef = (nitroApp: any) => void | Promise<void>;

export function createAuthPlugin(options?: AuthOptions): NitroPluginDef {
  return async (nitroApp: any) => {
    markDefaultPluginProvided(nitroApp, "auth");
    // Nitro v3 does not await async plugin return values. Register auth init
    // with the request-time readiness gate before waiting for bootstrap so a
    // cold request cannot reach session or sign-in before those routes exist.
    let resolveInit: () => void = () => {};
    let rejectInit: (error: unknown) => void = () => {};
    const initPromise = new Promise<void>((resolve, reject) => {
      resolveInit = resolve;
      rejectInit = reject;
    });
    trackPluginInit(nitroApp, initPromise, {
      paths: [
        "/_agent-native/auth",
        "/_agent-native/sign-in",
        "/_agent-native/google",
        "/_agent-native/identity",
        "/mcp/oauth",
        "/login",
        "/signup",
      ],
    });

    try {
      // Wait for any other default plugins to finish mounting first.
      await awaitBootstrap(nitroApp);
      await autoMountAuth(getH3App(nitroApp), options);
      resolveInit();
    } catch (error) {
      rejectInit(error);
      throw error;
    }
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
