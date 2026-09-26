import { getMethod, setResponseStatus } from "h3";

import { autoMountAuth } from "./auth.js";
import { getSession } from "./auth.js";
import type { AuthOptions } from "./auth.js";
import { runBetterAuthMigrations } from "./better-auth-migrations.js";
import {
  FRAMEWORK_AUTH_EARLY_PATHS,
  getH3App,
  markDefaultPluginProvided,
  markFrameworkRoutesReadyBeforeBootstrap,
  trackPluginInit,
} from "./framework-request-handler.js";

type NitroPluginDef = (nitroApp: any) => void | Promise<void>;

export function createAuthPlugin(options?: AuthOptions): NitroPluginDef {
  return (nitroApp: any) => {
    markDefaultPluginProvided(nitroApp, "auth");
    const isByoa = Boolean(options?.getSession);
    const app = getH3App(nitroApp);
    const sessionPath = "/_agent-native/auth/session";

    if (!isByoa) {
      markFrameworkRoutesReadyBeforeBootstrap(nitroApp, [sessionPath]);
      app.use(sessionPath, async (event: any) => {
        const method = getMethod(event);
        if (method !== "GET" && method !== "HEAD") {
          setResponseStatus(event, 405);
          return { error: "Method not allowed" };
        }
        const session = await getSession(event);
        return session ?? { error: "Not authenticated" };
      });
    }
    const initPromise = (async () => {
      if (isByoa) {
        const mountPromise = autoMountAuth(app, options);
        markFrameworkRoutesReadyBeforeBootstrap(
          nitroApp,
          FRAMEWORK_AUTH_EARLY_PATHS,
        );
        await mountPromise;
        return;
      }
      // guard:allow-boot-data-work — local/long-lived runtimes provision auth
      const mountPromise = runBetterAuthMigrations(nitroApp).then(() =>
        autoMountAuth(app, options),
      );
      markFrameworkRoutesReadyBeforeBootstrap(
        nitroApp,
        FRAMEWORK_AUTH_EARLY_PATHS,
      );
      await mountPromise;
    })();
    trackPluginInit(nitroApp, initPromise, {
      paths: [...FRAMEWORK_AUTH_EARLY_PATHS],
      ...(isByoa ? {} : { excludedPaths: [sessionPath] }),
    });
  };
}

export const defaultAuthPlugin: NitroPluginDef = async (nitroApp: any) => {
  return createAuthPlugin()(nitroApp);
};
