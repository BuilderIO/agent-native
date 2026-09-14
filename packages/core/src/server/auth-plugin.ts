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

    // The built-in auth session check is safe to serve while unrelated
    // default plugins are still booting. ClientOnly app shells need this
    // read before they can leave their hydration fallback, and holding it
    // behind the full bootstrap turns an otherwise healthy local login into
    // an indefinite loading state. The normal auth mount below remains the
    // canonical route once initialization has completed.
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
    // Marking these paths early only skips the UNRELATED default-plugin
    // bootstrap wait above — it does not skip waiting for auth's own mount.
    // `trackPluginInit` registers `initPromise` scoped to these same paths,
    // so `awaitPluginsReady` still holds any request to them until this
    // promise resolves (which only happens after the handler above is
    // actually registered). Do not split "mark early" from this call, or a
    // request could fall through before Better Auth is mounted.
    trackPluginInit(nitroApp, initPromise, {
      paths: [...FRAMEWORK_AUTH_EARLY_PATHS],
      ...(isByoa ? {} : { excludedPaths: [sessionPath] }),
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
