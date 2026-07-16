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
  return (nitroApp: any) => {
    markDefaultPluginProvided(nitroApp, "auth");
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
        "/login",
        "/signup",
      ],
    });

    void (async () => {
      // Wait for any other default plugins to finish mounting first.
      await awaitBootstrap(nitroApp);
      await autoMountAuth(getH3App(nitroApp), options);
    })().then(resolveInit, rejectInit);

    return initPromise;
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
