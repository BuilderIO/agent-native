import { getAppConfig } from "../app-config/index.js";
import { withConfiguredAppBasePath } from "../server/app-base-path.js";
import type { CaptureErrorContext } from "../server/capture-error.js";
import {
  resolveDeployEnvironment,
  resolveServerRelease,
} from "../server/deploy-environment.js";
import { getRequestContext } from "../server/request-context.js";
import {
  chatThreadUrl,
  compactFailureContext,
  type FailureContext,
} from "../shared/failure-report.js";
import { trackingIdentityProperties } from "./tracking-identity.js";

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

/**
 * The public address of this app, for links a person will open. The host the
 * request arrived on wins over the configured URL: a beta and a production
 * deployment share one config shape but not one host.
 */
function appBaseUrl(): string | undefined {
  const origin =
    text(getRequestContext()?.requestOrigin) ?? text(getAppConfig().app.url);
  return origin ? withConfiguredAppBasePath(origin) : undefined;
}

/**
 * A request that ran under an organization says `org`; any other signed-in
 * request is `personal`. No email is ever recorded here.
 */
function userScope(): FailureContext["userScope"] {
  const request = getRequestContext();
  if (request?.orgId && request.orgScope !== "personal") return "org";
  return request?.userEmail ? "personal" : undefined;
}

/**
 * Builds the packet for one failure. Explicit fields win; the run's thread and
 * run ids come from the ambient request context when the caller was inside a
 * chat run, so a capture made anywhere in the run still names its thread.
 */
export function buildFailureContext(
  input: Partial<FailureContext> = {},
): FailureContext {
  const explicit = compactFailureContext(input);
  const run = getRequestContext()?.run;
  const threadId = explicit.threadId ?? text(run?.threadId);
  const baseUrl = appBaseUrl();
  return compactFailureContext({
    appId: trackingIdentityProperties().app,
    environment: resolveDeployEnvironment(),
    release: resolveServerRelease(),
    userScope: userScope(),
    occurredAt: new Date().toISOString(),
    ...explicit,
    threadId,
    runId: explicit.runId ?? text(run?.runId),
    threadUrl:
      explicit.threadUrl ??
      (threadId && baseUrl ? chatThreadUrl(baseUrl, threadId) : undefined),
  });
}

/**
 * Returns `context` with the packet under `extra.failureContext`, which every
 * error provider forwards as additional data. The packet is derived from what
 * the call site already says (`tags.action`, `extra.runId`, `aiTraceId`, ...)
 * so no existing capture has to change to gain a thread link. A run id also
 * becomes `aiTraceId`, which joins the exception to the run's `$ai_trace`.
 */
export function withFailureContext(
  context: CaptureErrorContext,
  options: { errorCode?: string; failureClass?: string } = {},
): CaptureErrorContext {
  const { failure, ...rest } = context;
  const extra: Record<string, unknown> = rest.extra ?? {};
  const packet = buildFailureContext({
    route: text(rest.route),
    actionName: text(rest.tags?.action) ?? text(extra.actionName),
    automationName: text(extra.automationName),
    threadId: text(extra.threadId),
    runId: text(extra.runId) ?? text(rest.aiTraceId),
    requestId: text(extra.request_id) ?? text(extra.requestId),
    errorCode: text(rest.tags?.errorCode) ?? options.errorCode,
    failureClass: text(rest.tags?.failureClass) ?? options.failureClass,
    ...compactFailureContext(failure ?? {}),
  });
  const existing =
    extra.failureContext && typeof extra.failureContext === "object"
      ? (extra.failureContext as Record<string, unknown>)
      : {};
  return {
    ...rest,
    ...(rest.aiTraceId || !packet.runId ? {} : { aiTraceId: packet.runId }),
    extra: { ...extra, failureContext: { ...packet, ...existing } },
  };
}
