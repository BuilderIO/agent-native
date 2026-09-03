import { autoMountAuth } from "./auth.js";
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
    const initPromise = (async () => {
      // A BYOA provider owns its session lookup and login HTML. Mount it
      // immediately so a transient database outage in Better Auth or another
      // default plugin cannot make the custom sign-in document unavailable.
      if (isByoa) {
        // The guard is mounted synchronously by the BYOA branch above. Only
        // after that synchronous registration is it safe to let these paths
        // skip unrelated bootstrap work.
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
    });
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
