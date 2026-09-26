/**
 * Durable background agent-chat runs (Netlify background functions).
 *
 * Enabled by default on deployed Netlify apps. When enabled, a long in-app
 * agent-chat turn is dispatched
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
 *   1. The runtime is a deployed Netlify app and
 *      `AGENT_CHAT_DURABLE_BACKGROUND` is not explicitly disabled, or the
 *      existing env/app opt-in path is used on another hosted platform. Netlify
 *      deploys emit the background function by default; `false`, `0`, `no`, or
 *      `off` disables it.
 *   2. The runtime is hosted/serverless (local dev keeps the inline path so SSE
 *      stays a single live stream and no second function is needed). An
 *      explicit truthy `AGENT_CHAT_DURABLE_BACKGROUND` skips this check, so a
 *      long-lived Node server can opt in.
 *   3. `A2A_SECRET` is configured (the HMAC handoff is required to authenticate
 *      the background dispatch; without it the dispatch can't be trusted).
 *
 * Even when enabled, a *dispatch failure degrades to an inline run*:
 * if the self-dispatch self-POST can't be delivered (fast connection error or
 * fast non-2xx), the foreground handler runs the turn synchronously instead of
 * erroring (see `production-agent.ts` — the inline fallback claims the run row
 * atomically so a delayed delivery can never double-execute). So an app where
 * durable dispatch happens to fail still gets a working chat, just without the
 * 15-min budget.
 */
import {
  hasConfiguredA2ASecret,
  isTrustedLocalRuntime,
} from "../a2a/auth-policy.js";
import { getAppConfig } from "../app-config/index.js";
import {
  extractBearerToken,
  verifyInternalToken,
} from "../integrations/internal-token.js";

export const AGENT_CHAT_PROCESS_RUN_PATH =
  "/_agent-native/agent-chat/_process-run";

export const AGENT_BACKGROUND_FUNCTION_NAME = "server-agent-background";

export const AGENT_BACKGROUND_FUNCTION_URL_PATH = `/.netlify/functions/${AGENT_BACKGROUND_FUNCTION_NAME}`;

export const AGENT_BACKGROUND_PROCESSOR_FIELD = "__agentNativeProcessor";
export const AGENT_BACKGROUND_PROCESSOR_A2A = "a2a";
export const AGENT_BACKGROUND_PROCESSOR_INTEGRATION = "integration";
export const AGENT_BACKGROUND_PROCESSOR_ROUTE = "route";
export const AGENT_BACKGROUND_PROCESSOR_ROUTE_FIELD =
  "__agentNativeProcessorRoute";

function resolveWorkspaceBackgroundFunctionUrlPath(): string | null {
  const raw = getAppConfig().app.workspaceId;
  if (raw === undefined) return null;
  const candidate = raw.trim().replace(/^\/+/, "").split("/")[0] ?? "";
  if (!/^[a-z0-9][a-z0-9-]{0,127}$/.test(candidate)) return null;
  return `/.netlify/functions/${candidate}-agent-background`;
}

function isNetlifyHostedRuntimeForDispatch(): boolean {
  if (process.env.NETLIFY_LOCAL === "true") return false;
  if (process.env.NETLIFY === "false") return false;
  if (process.env.NETLIFY && process.env.NETLIFY !== "false") return true;
  if (process.env.SITE_ID) return true; // guard:allow-env-credential - Netlify's read-only public site identifier is a runtime host marker, not a user credential.
  // Non-Netlify AWS falls back inline if the /.netlify/functions dispatch
  // fast-fails.
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

export function resolveDurableBackgroundDispatchPath(
  fallbackPath: string,
): string {
  if (isNetlifyHostedRuntimeForDispatch()) {
    return (
      resolveWorkspaceBackgroundFunctionUrlPath() ??
      AGENT_BACKGROUND_FUNCTION_URL_PATH
    );
  }
  return fallbackPath;
}

export function dispatchPathTargetsNetlifyBackgroundFunction(
  dispatchPath: string,
): boolean {
  return dispatchPath.startsWith("/.netlify/functions/");
}

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

export function isHostedRuntimeForDurableBackground(): boolean {
  if (process.env.NETLIFY_LOCAL === "true") return false;
  if (process.env.NETLIFY === "false") return false;
  if (process.env.SITE_ID) return true; // guard:allow-env-credential -- Netlify's read-only public site identifier is a runtime host marker, not a user credential.
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

export function isNetlifyHostedRuntimeForDurableBackground(): boolean {
  if (process.env.NETLIFY_LOCAL === "true") return false;
  if (process.env.NETLIFY === "false") return false;
  return Boolean(
    (process.env.NETLIFY && process.env.NETLIFY !== "false") ||
    process.env.SITE_ID, // guard:allow-env-credential - Netlify's read-only public site identifier is a runtime host marker, not a user credential.
  );
}

export function isInBackgroundFunctionRuntime(): boolean {
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
  _marker: unknown,
): boolean {
  return isInBackgroundFunctionRuntime();
}

export function backgroundRuntimeDiagnosticDetail(marker: unknown): string {
  const detail = [
    `markerExpected=${backgroundRunMarkerExpectsBackgroundRuntime(marker)}`,
    `runtimeDetected=${isInBackgroundFunctionRuntime()}`,
    `globalMarker=${(globalThis as Record<string, unknown>).__AGENT_NATIVE_BACKGROUND_RUNTIME__ === true}`,
    `lambdaNameEndsBackground=${typeof process.env.AWS_LAMBDA_FUNCTION_NAME === "string" && process.env.AWS_LAMBDA_FUNCTION_NAME.toLowerCase().endsWith("-background")}`,
    `forceEnv=${typeof process.env.AGENT_CHAT_FORCE_BACKGROUND_RUNTIME === "string" && process.env.AGENT_CHAT_FORCE_BACKGROUND_RUNTIME.trim().length > 0}`,
  ].join(" ");
  reportMissingBackgroundFunctionOnce(marker, detail);
  return detail;
}

export const BACKGROUND_FUNCTION_UNREACHABLE_NOTICE_KEY =
  "__AGENT_NATIVE_BACKGROUND_UNREACHABLE_NOTICE__";

function reportMissingBackgroundFunctionOnce(
  marker: unknown,
  detail: string,
): void {
  if (!backgroundRunMarkerExpectsBackgroundRuntime(marker)) return;
  if (isInBackgroundFunctionRuntime()) return;
  const scope = globalThis as Record<string, unknown>;
  if (scope[BACKGROUND_FUNCTION_UNREACHABLE_NOTICE_KEY] === true) return;
  scope[BACKGROUND_FUNCTION_UNREACHABLE_NOTICE_KEY] = true;
  console.error(
    `[agent-chat] durable background is enabled but the "${AGENT_BACKGROUND_FUNCTION_NAME}" ` +
      "function is unreachable — this worker is running on the synchronous function " +
      "with the 40s clamp instead of the 15-min budget. Check that the deploy emitted " +
      `it (build log: "Emitted durable-background function"). ${detail}`,
  );
}

export function isDurableBackgroundFlagEnabled(): boolean {
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

export function isDurableBackgroundFlagExplicitlyDisabled(): boolean {
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

export function isAgentChatDurableBackgroundEnabled(options?: {
  appOptIn?: boolean;
}): boolean {
  if (options?.appOptIn === false) return false;
  const envOptIn = isDurableBackgroundFlagEnabled();
  const netlifyDefaultOptIn =
    isNetlifyHostedRuntimeForDurableBackground() &&
    !isDurableBackgroundFlagExplicitlyDisabled();
  const workspaceAppOptIn =
    options?.appOptIn === true &&
    !isDurableBackgroundFlagExplicitlyDisabled() &&
    resolveWorkspaceBackgroundFunctionUrlPath() !== null;
  if (envOptIn && hasConfiguredA2ASecret()) return true;
  return (
    (envOptIn || netlifyDefaultOptIn || workspaceAppOptIn) &&
    isHostedRuntimeForDurableBackground() &&
    hasConfiguredA2ASecret()
  );
}

export const AGENT_CHAT_FOREGROUND_SELF_CHAIN_ENV =
  "AGENT_CHAT_FOREGROUND_SELF_CHAIN";

function isForegroundSelfChainExplicitlyEnabled(): boolean {
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

export function isAgentChatForegroundSelfChainEnabled(): boolean {
  return (
    isForegroundSelfChainExplicitlyEnabled() &&
    isHostedRuntimeForDurableBackground() &&
    hasConfiguredA2ASecret()
  );
}

export type ProcessRunPreparation =
  | {
      ok: true;
      runId: string;
      body: Record<string, unknown>;
    }
  | {
      ok: false;
      status: number;
      error: string;
      runId: string | null;
    };

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
 *   - no secret → require `isTrustedLocalRuntime({ loopback })` (see
 *     auth-policy.ts): refuse (503) unless `A2A_ALLOW_UNSIGNED_INTERNAL=1` is
 *     set. This function has no h3 `event` of its own, so callers that CAN
 *     see the inbound socket peer (the route handler, which has the event)
 *     should compute `loopback` from it and pass it through; callers that
 *     can't determine the peer address should omit it (defaults to `false`
 *     — never trust unsigned dispatch without an explicit opt-in).
 *
 * Extracted from the route handler so the auth + marker-prep decision is unit
 * testable without booting the whole Nitro plugin. The route only adds body
 * reading and the final handler invocation around this.
 */
export function prepareProcessRunRequest(
  body: unknown,
  authHeader: string | undefined,
  loopback: boolean = false,
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
  } else if (!isTrustedLocalRuntime({ loopback })) {
    return {
      ok: false,
      status: 503,
      error:
        "Agent chat background processor not configured — set A2A_SECRET on this deployment (or A2A_ALLOW_UNSIGNED_INTERNAL=1 for trusted local dev).",
      runId,
    };
  }

  if (!marker || typeof marker.runId !== "string") {
    record[AGENT_CHAT_BACKGROUND_RUN_FIELD] = { runId };
  }
  return { ok: true, runId, body: record };
}
