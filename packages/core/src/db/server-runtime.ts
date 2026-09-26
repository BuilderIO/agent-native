/**
 * Server-serving duty: the process-local claim that a real Nitro server
 * instance has booted and is wiring its H3 app for real requests, plus the
 * build-time proof that the code running is a production server bundle.
 *
 * Netlify/Lambda/Vercel each hand the process a platform env var that is only
 * ever set during a real function invocation, never during a build. Bare
 * Node/Docker has no such var, and `NODE_ENV` cannot stand in for one: build
 * steps set `NODE_ENV=production` too, while `node .output/server/index.mjs`
 * and `agent-native start` run without it. The two signals here replace it.
 *
 * The serving flag is set from
 * {@link import("../server/framework-request-handler.js").getH3App}, the one
 * choke point every plugin — default or app-authored, on every preset —
 * calls to register routes, the first time any nitroApp instance actually
 * boots. A build never constructs a real nitroApp, so it never fires there.
 * It does fire for `pnpm dev` and test suites that boot an H3 app, which is
 * why it only counts together with {@link isProductionServerBuild}.
 *
 * Its own module, mirroring `./migration-runtime.js`: `client.js` reads it,
 * and keeping it dependency-free avoids adding one more stub to every
 * `vi.mock("../db/client.js")` in the codebase.
 */

type ServerRuntimeGlobal = typeof globalThis & {
  __AGENT_NATIVE_SERVER_RUNTIME__?: boolean;
};

/** True once a real Nitro server instance has started wiring its H3 app. */
export function isServerRuntimeStarted(): boolean {
  return (
    (globalThis as ServerRuntimeGlobal).__AGENT_NATIVE_SERVER_RUNTIME__ === true
  );
}

/** Claim server-serving duty. Idempotent; never unset for the life of the process. */
export function markServerRuntimeStarted(): void {
  (globalThis as ServerRuntimeGlobal).__AGENT_NATIVE_SERVER_RUNTIME__ = true;
}

/**
 * Env name the production server build embeds its marker under. Written only
 * by `resolveNitroBuildReplacements()` in deploy/build.ts — never by the Vite
 * config, whose `define` and Nitro `replace` also apply to `pnpm dev`.
 */
export const PRODUCTION_SERVER_BUILD_MARKER_ENV_VAR =
  "AGENT_NATIVE_BUILD_PRODUCTION_SERVER";

/**
 * True only inside a server bundle produced by `agent-native build`, the
 * bundle `node .output/server/index.mjs`, `agent-native start`, Docker, and
 * every serverless preset run. `pnpm dev` never runs that bundle.
 */
export function isProductionServerBuild(): boolean {
  return (
    // config-ok: inlined at build time by Nitro's `replace`, which rewrites
    // this literal member expression and nothing else. Reading it through an
    // `env` parameter or `process.env[name]` would survive the build
    // unreplaced, and a production Node server would never be detected.
    process.env.AGENT_NATIVE_BUILD_PRODUCTION_SERVER === "true"
  );
}
