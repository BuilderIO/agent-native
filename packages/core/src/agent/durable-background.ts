/**
 * Durable background agent-chat runs (Netlify background functions).
 *
 * Off by default. When enabled, a long in-app agent-chat turn is dispatched
 * into a Netlify *background* function (15-min budget) instead of completing
 * synchronously under the ~40s soft-timeout. The foreground POST claims the
 * run slot, inserts the run row, fires an HMAC-signed self-dispatch to
 * `AGENT_CHAT_PROCESS_RUN_PATH`, and returns the existing SSE subscription so
 * the client streams the same events (via the cross-isolate SQL-poll path)
 * with no client change.
 *
 * This module owns ONLY the gating decision + shared constants so both the
 * HTTP handler (`production-agent.ts`) and the processor route
 * (`agent-chat-plugin.ts`) agree on when the path is active without a circular
 * import. The actual run machinery is reused verbatim from run-manager /
 * run-store / self-dispatch / internal-token.
 *
 * GUARDRAIL: when `isAgentChatDurableBackgroundEnabled()` returns false, the
 * agent-chat handler must behave byte-for-byte like the current synchronous
 * path. The gate is true only when ALL of these hold:
 *   1. `AGENT_CHAT_DURABLE_BACKGROUND` env is explicitly enabled, or a
 *      workspace app's agent-chat plugin opts in with `durableBackgroundRuns`
 *      where the workspace deploy emits a per-app background function by
 *      default. Single-template Netlify deploys must set the env flag because
 *      that same flag controls whether `server-agent-background` is emitted.
 *   2. The runtime is hosted/serverless (local dev keeps the inline path so SSE
 *      stays a single live stream and no second function is needed).
 *   3. `A2A_SECRET` is configured (the HMAC handoff is required to authenticate
 *      the background dispatch; without it the dispatch can't be trusted).
 *
 * Opt-in keeps the blast radius small while the worker path is still being
 * proven. And even when enabled, a *dispatch failure degrades to an inline run*:
 * if the self-dispatch self-POST can't be delivered (fast connection error or
 * fast non-2xx), the foreground handler runs the turn synchronously instead of
 * erroring (see `production-agent.ts` — the inline fallback claims the run row
 * atomically so a delayed delivery can never double-execute). So an app where
 * durable dispatch happens to fail still gets a working chat, just without the
 * 15-min budget.
 */
import {
  hasConfiguredA2ASecret,
  isA2AProductionRuntime,
} from "../a2a/auth-policy.js";
import {
  extractBearerToken,
  verifyInternalToken,
} from "../integrations/internal-token.js";

/**
 * Framework route the background function actually runs — sibling to
 * `AGENT_TEAM_PROCESS_RUN_PATH`. Reached *through* the Netlify background
 * function, so it inherits the 15-min budget.
 */
export const AGENT_CHAT_PROCESS_RUN_PATH =
  "/_agent-native/agent-chat/_process-run";

/**
 * Name of the standalone Netlify background function the build emits (see
 * `emitSingleTemplateNetlifyBackgroundFunction` in deploy/build.ts). Shared so
 * the emit and the dispatch-path helper below can never drift on the name.
 *
 * MUST end in `-background` — both because that is the conventional Netlify
 * async-function suffix and because `isInBackgroundFunctionRuntime()` reads the
 * `AWS_LAMBDA_FUNCTION_NAME` `-background` suffix as a secondary runtime signal.
 */
export const AGENT_BACKGROUND_FUNCTION_NAME = "server-agent-background";

/**
 * Default function URL of the background function on Netlify. Every Netlify
 * function is reachable at `/.netlify/functions/<name>` BY DEFAULT; that default
 * url is removed ONLY if the function declares a custom `config.path`. The
 * emitted background function declares NO custom `config.path` (it sets
 * `background: true` and nothing else routing-related), so it KEEPS this default
 * url — and the Nitro `server` function already excludes `/.netlify/*` from its
 * `/*` catch-all, so this namespace is never shadowed. The foreground therefore
 * dispatches HERE on hosted Netlify (see `resolveAgentChatProcessRunDispatchPath`).
 */
export const AGENT_BACKGROUND_FUNCTION_URL_PATH = `/.netlify/functions/${AGENT_BACKGROUND_FUNCTION_NAME}`;

/**
 * The per-app workspace background function URL path. Workspace deploy emits one
 * background function per app named `<app>-agent-background`, reachable at its
 * DEFAULT url `/.netlify/functions/<app>-agent-background` (no custom
 * `config.path`). The foreground resolves the current workspace app id from
 * `AGENT_NATIVE_WORKSPACE_APP_ID` (set by the workspace function entry) so it can
 * dispatch to the right per-app function url. Returns `null` when no workspace
 * app id is configured (single-template deploy).
 */
function resolveWorkspaceBackgroundFunctionUrlPath(): string | null {
  const raw = process.env.AGENT_NATIVE_WORKSPACE_APP_ID;
  if (typeof raw !== "string") return null;
  // Mirror the workspace app-id normalization (resources/store.ts): take the
  // first path segment and accept only the safe slug shape used for function
  // names. Anything else falls back to the single-template name.
  const candidate = raw.trim().replace(/^\/+/, "").split("/")[0] ?? "";
  if (!/^[a-z0-9][a-z0-9-]{0,127}$/.test(candidate)) return null;
  return `/.netlify/functions/${candidate}-agent-background`;
}

function isNetlifyHostedRuntimeForDispatch(): boolean {
  if (process.env.NETLIFY_LOCAL === "true") return false;
  if (process.env.NETLIFY === "false") return false;
  if (process.env.NETLIFY && process.env.NETLIFY !== "false") return true;
  // Netlify sets AWS Lambda runtime env on deployed Functions, but the build-time
  // NETLIFY flag is not always present in the runtime isolate. Treat Lambda as
  // Netlify here unless Netlify was explicitly disabled above; non-Netlify AWS
  // falls back inline if the /.netlify/functions dispatch fast-fails.
  return Boolean(process.env.AWS_LAMBDA_FUNCTION_NAME);
}

/**
 * Resolve the path the foreground POST should self-dispatch the chat background
 * worker to.
 *
 * GROUNDED IN THE REAL NETLIFY BUILD OUTPUT + THE NETLIFY DOCS DEFAULT-URL RULE:
 * the background function is emitted INTO the scanned dir
 * (`.netlify/functions-internal/server-agent-background`, or per-app
 * `<app>-agent-background` for workspaces) with `export const config = {
 * background: true, ... }` and NO custom `config.path`. Because it has no custom
 * path, Netlify keeps its DEFAULT function url `/.netlify/functions/<name>`, and
 * `background: true` makes any invocation of that url ASYNC (immediate 202,
 * 15-min budget). The Nitro `server` function already excludes `/.netlify/*`
 * from its `/*` catch-all, so the default-url namespace is NEVER shadowed by the
 * synchronous function.
 *
 * Therefore on hosted Netlify the foreground dispatches to the function's DEFAULT
 * url (`/.netlify/functions/<name>`); the function entry then rewrites the
 * incoming pathname to `AGENT_CHAT_PROCESS_RUN_PATH` (base-path-prefixed for
 * workspaces) before delegating to the Nitro router, so the `_process-run`
 * plugin runs with the async 15-min budget. Everywhere else (local dev, `netlify
 * dev`, non-Netlify hosts where no second function exists) there is no second
 * function, so the foreground dispatches to the framework route
 * `AGENT_CHAT_PROCESS_RUN_PATH` and the same in-process catch-all handles it
 * inline. The HMAC token (signed over the runId) is unchanged either way.
 *
 * NOTE: this is the DOC-CORRECT approach. An earlier attempt gave the function a
 * custom `config.path` + a catch-all `excludedPath` patch; the custom path was
 * NOT honored as a route in prod (probe → 404). Using the default function url
 * (no custom path) is what Netlify documents and is simpler — there is nothing
 * to shadow because `/.netlify/*` is already excluded from the `server` catch-all.
 */
export function resolveAgentChatProcessRunDispatchPath(): string {
  if (isNetlifyHostedRuntimeForDispatch()) {
    return (
      resolveWorkspaceBackgroundFunctionUrlPath() ??
      AGENT_BACKGROUND_FUNCTION_URL_PATH
    );
  }
  return AGENT_CHAT_PROCESS_RUN_PATH;
}

export function dispatchPathTargetsNetlifyBackgroundFunction(
  dispatchPath: string,
): boolean {
  return dispatchPath.startsWith("/.netlify/functions/");
}

/**
 * Env flag for durable background runs. DEFAULT-OFF (opt-in): unset means
 * disabled; an app opts IN with an explicit truthy value (`true`/`1`/`yes`/`on`).
 */
export const AGENT_CHAT_DURABLE_BACKGROUND_ENV =
  "AGENT_CHAT_DURABLE_BACKGROUND";

/**
 * Body field the foreground handler injects when self-dispatching to the
 * background processor. Its presence is how the re-entered handler knows it is
 * the background worker (run inline with the background soft-timeout; do NOT
 * re-claim the slot or re-dispatch). Untrusted on its own — the route also
 * verifies the HMAC token before invoking the handler.
 */
export const AGENT_CHAT_BACKGROUND_RUN_FIELD = "__backgroundRun";

/**
 * Mirror of run-manager's private `isHostedRuntime`. Kept in sync deliberately:
 * the durable-background gate must agree with the soft-timeout regime about
 * what "hosted" means.
 */
export function isHostedRuntimeForDurableBackground(): boolean {
  if (
    process.env.NETLIFY &&
    process.env.NETLIFY !== "false" &&
    process.env.NETLIFY_LOCAL !== "true"
  ) {
    return true;
  }
  if (
    process.env.AWS_LAMBDA_FUNCTION_NAME &&
    process.env.NETLIFY_LOCAL !== "true"
  ) {
    return true;
  }
  return Boolean(
    process.env.CF_PAGES ||
    process.env.VERCEL ||
    process.env.VERCEL_ENV ||
    process.env.RENDER ||
    process.env.FLY_APP_NAME ||
    process.env.K_SERVICE,
  );
}

/**
 * True when THIS process is actually executing inside a Netlify *background*
 * function (the long, 15-min-budget async function whose deployed name ends in
 * `-background`). Netlify runs functions on AWS Lambda and sets
 * `AWS_LAMBDA_FUNCTION_NAME` to the function's name, so a `-background` suffix is
 * the runtime proof that the ~60s synchronous wall does NOT apply here.
 *
 * This is the SAFETY GUARD for the soft-timeout regime. The `_process-run`
 * self-dispatch worker (`isBackgroundWorker`) is NOT enough on its own: if the
 * `-background` function was never emitted (deploy gate off, or Netlify routed
 * the path to the synchronous function), the self-POST lands on the regular
 * ~60s `server` function. A worker there MUST use the 40s soft-timeout and
 * checkpoint before the 60s wall — using the ~13min budget would overshoot the
 * hard wall and get killed at 60s, then re-dispatch/resume in a wasteful loop.
 * So the 13-min budget is taken ONLY when this returns true.
 *
 * The PRIMARY signal is a `globalThis` marker the emitted background function's
 * entry sets at cold start — the deployed Lambda name is not guaranteed to end
 * in `-background` on Netlify, so the entry marks its own runtime. A `globalThis`
 * flag (not `process.env`) keeps the no-env-mutation guard satisfied and carries
 * no cross-request state (set once per isolate). The `AWS_LAMBDA_FUNCTION_NAME`
 * suffix and the explicit `AGENT_CHAT_FORCE_BACKGROUND_RUNTIME` env (truthy) are
 * additional signals — the latter an operator escape hatch. Off by default.
 */
export function isInBackgroundFunctionRuntime(): boolean {
  // Set by the emitted `-background` function entry at cold start (the primary,
  // most reliable signal — see the emit in deploy/build.ts).
  if (
    (globalThis as Record<string, unknown>)
      .__AGENT_NATIVE_BACKGROUND_RUNTIME__ === true
  ) {
    return true;
  }
  const lambdaName = process.env.AWS_LAMBDA_FUNCTION_NAME;
  if (
    typeof lambdaName === "string" &&
    lambdaName.toLowerCase().endsWith("-background")
  ) {
    return true;
  }
  const forced = process.env.AGENT_CHAT_FORCE_BACKGROUND_RUNTIME;
  if (forced != null) {
    const v = forced.trim().toLowerCase();
    return v === "1" || v === "true" || v === "yes" || v === "on";
  }
  return false;
}

export function backgroundRunMarkerExpectsBackgroundRuntime(
  marker: unknown,
): boolean {
  return (
    typeof marker === "object" &&
    marker !== null &&
    (marker as { backgroundFunctionRuntimeExpected?: unknown })
      .backgroundFunctionRuntimeExpected === true
  );
}

export function shouldUseBackgroundFunctionTimeoutForWorker(
  marker: unknown,
): boolean {
  return (
    isInBackgroundFunctionRuntime() ||
    backgroundRunMarkerExpectsBackgroundRuntime(marker)
  );
}

export function backgroundRuntimeDiagnosticDetail(marker: unknown): string {
  return [
    `markerExpected=${backgroundRunMarkerExpectsBackgroundRuntime(marker)}`,
    `runtimeDetected=${isInBackgroundFunctionRuntime()}`,
    `globalMarker=${(globalThis as Record<string, unknown>).__AGENT_NATIVE_BACKGROUND_RUNTIME__ === true}`,
    `lambdaNameEndsBackground=${typeof process.env.AWS_LAMBDA_FUNCTION_NAME === "string" && process.env.AWS_LAMBDA_FUNCTION_NAME.toLowerCase().endsWith("-background")}`,
    `forceEnv=${typeof process.env.AGENT_CHAT_FORCE_BACKGROUND_RUNTIME === "string" && process.env.AGENT_CHAT_FORCE_BACKGROUND_RUNTIME.trim().length > 0}`,
  ].join(" ");
}

function isFlagEnabled(): boolean {
  // Read the literal key (not `process.env[CONST]`) so guard:no-env-credentials
  // can statically verify it against the allowlisted `AGENT_*` prefix. Keep this
  // in sync with AGENT_CHAT_DURABLE_BACKGROUND_ENV.
  //
  // DEFAULT-OFF (opt-in): durable background runs are still being hardened. A
  // premature fleet-wide default-on caused real-user incidents (Assets/Analytics
  // hit "Failed to dispatch" + stalls, 2026-06-24) because the async background
  // worker path is not yet proven end-to-end and the deploy-time env opt-out is
  // not reliably baked into a given deploy. So an unset/empty/unknown flag means
  // OFF; an app opts IN only with an explicit truthy value
  // (AGENT_CHAT_DURABLE_BACKGROUND=true). This still composes with the hosted +
  // A2A_SECRET gates below. Flip back to default-on only after the 15-min
  // background-function worker is verified live in production (see the
  // project_durable_bg_prod_verified memory).
  const raw = process.env.AGENT_CHAT_DURABLE_BACKGROUND;
  if (raw == null) return false;
  const normalized = raw.trim().toLowerCase();
  return (
    normalized === "1" ||
    normalized === "true" ||
    normalized === "yes" ||
    normalized === "on"
  );
}

function isFlagExplicitlyDisabled(): boolean {
  const raw = process.env.AGENT_CHAT_DURABLE_BACKGROUND;
  if (raw == null) return false;
  const normalized = raw.trim().toLowerCase();
  return (
    normalized === "0" ||
    normalized === "false" ||
    normalized === "no" ||
    normalized === "off"
  );
}

/**
 * The single gate. True when the env flag is explicitly enabled, or a workspace
 * app opted in and has a per-app background-function target, AND the runtime is
 * hosted AND A2A_SECRET is configured. False otherwise — and false means the
 * current synchronous behavior is used unchanged. Single-template Netlify app
 * opt-ins deliberately require the env flag too because that flag controls
 * whether the `server-agent-background` function exists in the deploy output.
 */
export function isAgentChatDurableBackgroundEnabled(options?: {
  appOptIn?: boolean;
}): boolean {
  const envOptIn = isFlagEnabled();
  const workspaceAppOptIn =
    options?.appOptIn === true &&
    !isFlagExplicitlyDisabled() &&
    resolveWorkspaceBackgroundFunctionUrlPath() !== null;
  return (
    (envOptIn || workspaceAppOptIn) &&
    isHostedRuntimeForDurableBackground() &&
    hasConfiguredA2ASecret()
  );
}

/**
 * Env flag for the FOREGROUND server-driven self-chain. DEFAULT-OFF (opt-in):
 * unset means disabled; an app opts IN with an explicit truthy value
 * (`true`/`1`/`yes`/`on`) — same parsing convention as
 * `AGENT_CHAT_DURABLE_BACKGROUND`, deliberately kept as a separate flag so
 * this narrower capability can be enabled/disabled independently of the full
 * durable-background worker path.
 */
export const AGENT_CHAT_FOREGROUND_SELF_CHAIN_ENV =
  "AGENT_CHAT_FOREGROUND_SELF_CHAIN";

function isForegroundSelfChainFlagEnabled(): boolean {
  // Read the literal key (not `process.env[CONST]`) so guard:no-env-credentials
  // can statically verify it against the allowlisted `AGENT_*` prefix. Keep this
  // in sync with AGENT_CHAT_FOREGROUND_SELF_CHAIN_ENV.
  const raw = process.env.AGENT_CHAT_FOREGROUND_SELF_CHAIN;
  if (raw == null) return false;
  const normalized = raw.trim().toLowerCase();
  return (
    normalized === "1" ||
    normalized === "true" ||
    normalized === "yes" ||
    normalized === "on"
  );
}

/**
 * Gate for the OPT-IN foreground self-chain: a normal (non-durable-background)
 * agent-chat turn that hits its soft-timeout chunk boundary continues via a
 * server-side self-dispatch on the REGULAR function (not a Netlify
 * `-background` function) instead of depending on the client to re-POST
 * `auto_continue`. Composes exactly like `isAgentChatDurableBackgroundEnabled`:
 * true only when the env flag is explicitly truthy AND the runtime is hosted
 * AND `A2A_SECRET` is configured (the HMAC handoff authenticates the
 * self-dispatch). False otherwise — and false means the existing
 * client-driven `auto_continue` re-POST path is used unchanged, byte-for-byte.
 *
 * Deliberately independent of `isAgentChatDurableBackgroundEnabled`: an app can
 * enable this narrower capability without opting into the full 15-min
 * background-function worker path, and the two gates never need to agree.
 * When BOTH would be true for a given run, the durable-background dispatch
 * decision in `production-agent.ts` is evaluated first and takes precedence —
 * a run already dispatched to the durable background worker chains via the
 * existing `isBackgroundWorker` path, not this one.
 */
export function isAgentChatForegroundSelfChainEnabled(): boolean {
  return (
    isForegroundSelfChainFlagEnabled() &&
    isHostedRuntimeForDurableBackground() &&
    hasConfiguredA2ASecret()
  );
}

/** Decision returned by `prepareProcessRunRequest`. */
export type ProcessRunPreparation =
  | {
      ok: true;
      /** The pre-claimed run id the background worker must reuse. */
      runId: string;
      /** Body to stash for the re-entered handler (marker guaranteed present). */
      body: Record<string, unknown>;
    }
  | {
      ok: false;
      /** HTTP status the route should return. */
      status: number;
      /** Error payload. */
      error: string;
      /**
       * The run id parsed from the body, when present. Carried even on failure
       * so the route can RECORD the auth/validation failure ONTO the run
       * (diag_stage) before returning the error status — otherwise a 401/503 in
       * the unreadable Netlify background function would leave the run to time
       * out with no clue why. Null when no run id could be parsed.
       */
      runId: string | null;
    };

/**
 * Parse the run id from a `_process-run` request body without authenticating.
 * Mirrors the precedence in `prepareProcessRunRequest` (marker.runId, then
 * top-level taskId). Returns null when neither is a usable string. Used so the
 * route can attach a diagnostic to the run even on an auth/validation failure.
 */
export function extractProcessRunId(body: unknown): string | null {
  if (!body || typeof body !== "object") return null;
  const record = body as Record<string, unknown>;
  const marker = record[AGENT_CHAT_BACKGROUND_RUN_FIELD] as
    | { runId?: unknown }
    | undefined;
  if (marker && typeof marker.runId === "string" && marker.runId) {
    return marker.runId;
  }
  if (typeof record.taskId === "string" && record.taskId) {
    return record.taskId;
  }
  return null;
}

/**
 * Pure, transport-agnostic core of the `_process-run` route: validate the body,
 * authenticate the HMAC self-dispatch, and produce the body the re-entered
 * agent-chat handler should run as the background worker.
 *
 * Auth policy mirrors the agent-teams processor exactly:
 *   - `A2A_SECRET` set → require a valid `verifyInternalToken(runId, token)`.
 *   - no secret but a production runtime → refuse (503) — never run unsigned in
 *     prod.
 *   - no secret + non-prod (local dev) → allow unsigned; the SQL atomic claim
 *     in the worker still prevents double-processing.
 *
 * Extracted from the route handler so the auth + marker-prep decision is unit
 * testable without booting the whole Nitro plugin. The route only adds body
 * reading and the final handler invocation around this.
 */
export function prepareProcessRunRequest(
  body: unknown,
  authHeader: string | undefined,
): ProcessRunPreparation {
  if (!body || typeof body !== "object") {
    return {
      ok: false,
      status: 400,
      error: "Invalid request body",
      runId: null,
    };
  }
  const record = body as Record<string, unknown>;
  const marker = record[AGENT_CHAT_BACKGROUND_RUN_FIELD] as
    | { runId?: unknown }
    | undefined;
  const runId =
    marker && typeof marker.runId === "string"
      ? marker.runId
      : typeof record.taskId === "string"
        ? (record.taskId as string)
        : "";
  if (!runId) {
    return { ok: false, status: 400, error: "runId required", runId: null };
  }

  if (hasConfiguredA2ASecret()) {
    const token = extractBearerToken(authHeader);
    if (!verifyInternalToken(runId, token ?? "")) {
      return {
        ok: false,
        status: 401,
        error: "Invalid or expired processor token",
        runId,
      };
    }
  } else if (isA2AProductionRuntime()) {
    return {
      ok: false,
      status: 503,
      error:
        "Agent chat background processor not configured — set A2A_SECRET on this deployment.",
      runId,
    };
  }

  // Ensure the marker is present so the re-entered handler runs as the
  // background worker (reuses runId/turnId, no re-claim, no re-dispatch).
  if (!marker || typeof marker.runId !== "string") {
    record[AGENT_CHAT_BACKGROUND_RUN_FIELD] = { runId };
  }
  return { ok: true, runId, body: record };
}
