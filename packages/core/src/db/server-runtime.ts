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

export function isServerRuntimeStarted(): boolean {
  return (
    (globalThis as ServerRuntimeGlobal).__AGENT_NATIVE_SERVER_RUNTIME__ === true
  );
}

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

export function hasCloudflareRuntime(): boolean {
  const runtime = globalThis as typeof globalThis & {
    __cf_env?: unknown;
    __env__?: unknown;
  };
  return runtime.__cf_env !== undefined || runtime.__env__ !== undefined;
}

/**
 * Local emulators that set the same markers as a deploy: `netlify dev` /
 * `netlify serve` set `NETLIFY_LOCAL=true` next to `NETLIFY_FUNCTION_NAME`,
 * `vercel dev` reports region `dev1`, and `sam local` sets `AWS_SAM_LOCAL`
 * next to `AWS_LAMBDA_FUNCTION_NAME`.
 *
 * Deliberately not `NODE_ENV=test`: a function deployed with that value still
 * loses every PGlite write, and a marker is proof of a real invocation that a
 * user-set `NODE_ENV` cannot outrank. Specs that stub a marker restore it.
 */
export function isLocalPlatformEmulator(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return (
    env.NETLIFY_LOCAL === "true" ||
    env.VERCEL_REGION === "dev1" ||
    env.AWS_SAM_LOCAL === "true"
  );
}

export function isHostedFunctionInvocationRuntime(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  if (hasCloudflareRuntime()) return true;
  if (isLocalPlatformEmulator(env)) return false;

  return Boolean(
    env.NETLIFY_FUNCTION_NAME ||
    env.AWS_LAMBDA_FUNCTION_NAME ||
    env.LAMBDA_TASK_ROOT ||
    env.AWS_EXECUTION_ENV?.startsWith("AWS_Lambda") === true ||
    env.VERCEL_FUNCTION_ID ||
    env.VERCEL_REGION,
  );
}

/**
 * True when a marker proves this process serves a deployment: a hosted
 * function invocation, or a started production server build. `NODE_ENV`
 * never outranks a marker. The database refusal, the auth secret refusal, and
 * the A2A processor all decide through this, so a deploy cannot refuse one
 * and not another.
 */
export function isDeployedServerRuntime(): boolean {
  if (isHostedFunctionInvocationRuntime()) return true;
  if (isLocalPlatformEmulator(process.env)) return false;
  return isProductionServerBuild() && isServerRuntimeStarted();
}
