/**
 * Server-serving duty: the process-local claim that a real Nitro server
 * instance has booted and is wiring its H3 app for real requests.
 *
 * Netlify/Lambda/Vercel each hand the process a platform env var that is only
 * ever set during a real function invocation, never during a build. Bare
 * Node/Docker has no such var — `NODE_ENV=production` alone is set by build
 * and prerender steps too (see the Cloudflare Pages static-shell script in
 * deploy/build.ts), so it cannot stand in for one. This flag is set from
 * {@link import("../server/framework-request-handler.js").getH3App}, the one
 * choke point every plugin — default or app-authored, on every preset —
 * calls to register routes, the first time any nitroApp instance actually
 * boots. A build never constructs a real nitroApp, so this never fires there.
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
