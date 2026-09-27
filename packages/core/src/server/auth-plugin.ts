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
      // Default (Better Auth) path: mount without waiting for unrelated
      // default-plugin bootstrap (agent-chat, org, integrations, ...) to
      // finish. Better Auth and the DB client are lazy singletons that only
      // need the database reachable when a route actually runs, not
      // anything the rest of bootstrap sets up — same precedent as the
      // early section of core-routes-plugin. Waiting on the whole chain
      // here serialized every session check behind whichever unrelated
      // plugin was slowest to cold-start.
      // guard:allow-boot-data-work — local/long-lived runtimes provision auth
      // before mounting routes; production functions are rejected by the
      // migration runner and use the release job instead.
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
