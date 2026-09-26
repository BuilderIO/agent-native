import type { AgentActionScope } from "../agent/types.js";
import type { TrackingEventScope } from "../observability/tracing.js";
import type { SignupAttributionContext } from "./attribution.js";

type AsyncLocalStorageLike<T> = {
  getStore(): T | undefined;
  run<R>(store: T, callback: () => R): R;
};

type AsyncLocalStorageCtor = new <T>() => AsyncLocalStorageLike<T>;

class StackAsyncLocalStorage<T> implements AsyncLocalStorageLike<T> {
  private readonly stack: T[] = [];

  getStore(): T | undefined {
    return this.stack.at(-1);
  }

  run<R>(store: T, callback: () => R): R {
    this.stack.push(store);
    try {
      const result = callback();
      const maybePromise = result as unknown as
        | { finally?: (callback: () => void) => unknown }
        | undefined;
      if (maybePromise && typeof maybePromise.finally === "function") {
        return maybePromise.finally(() => {
          this.stack.pop();
        }) as R;
      }
      this.stack.pop();
      return result;
    } catch (error) {
      this.stack.pop();
      throw error;
    }
  }
}

function getAsyncLocalStorageCtor(): AsyncLocalStorageCtor | undefined {
  if (
    typeof window !== "undefined" ||
    typeof process === "undefined" ||
    !process.versions?.node ||
    typeof process.getBuiltinModule !== "function"
  ) {
    return undefined;
  }
  return process.getBuiltinModule("node:async_hooks")?.AsyncLocalStorage as
    | AsyncLocalStorageCtor
    | undefined;
}

const AsyncLocalStorageCtor = getAsyncLocalStorageCtor();

function processEnv(name: string): string | undefined {
  if (typeof process === "undefined") return undefined;
  return process.env?.[name];
}

export interface RequestRunContext {
  waitUntil?: (promise: Promise<unknown>) => void;
  requestOrigin?: string;
  browserTabId?: string;
  chatScope?: {
    type: string;
    id: string;
    label?: string;
  } | null;
  owner?: string;
  userApiKey?: string;
  userApiKeyEnvVar?: string;
  threadId?: string;
  runId?: string;
  systemPrompt?: string;
  engine?: import("../agent/engine/types.js").AgentEngine;
  model?: string;
  allowedActionNames?: readonly string[];
  actionScope?: Readonly<AgentActionScope>;
  appAuthorization?: {
    appId: string;
    roles: string[];
    permissions: Record<string, string[]>;
  } | null;
  hostedHarnessRuntime?: "claude-code" | "codex" | "pi" | "opencode";
  isBackgroundWorker?: boolean;
  analyticsJevPrefetch?: {
    preloadedReferenceCount: number;
  };
  toolCalls?: Array<{ name: string; input: unknown }>;
  toolResults?: Array<{ name: string; content: string; isError: boolean }>;
  extensionContentReads?: Record<string, string>;
  extensionExcerptReads?: Record<string, true>;
  toolSearchReads?: Record<
    string,
    { totalTools: number; resultNames: string[] }
  >;
}

export interface RequestContext {
  isSyntheticTraffic?: boolean;
  mcpRequestId?: string;
  userEmail?: string;
  authUserId?: string;
  userName?: string;
  orgId?: string;
  orgScope?: "personal";
  /**
   * Narrow authorization capability verified from an embed session. This is
   * deliberately separate from user identity: capability-only sessions must
   * not satisfy account-backed auth or inherit the ticket owner's privileges.
   */
  authCapability?: string;
  timezone?: string;
  /**
   * The caller's browser analytics session id, when the request came from a
   * page. Emitted as PostHog's `$session_id` so agent traces join to session
   * replay; never used for authorization.
   */
  browserSessionId?: string;
  trackingScope?: TrackingEventScope;
  /**
   * Browser attribution captured before a Better Auth signup crosses into its
   * async user-create hook. Analytics-only; never used for authorization.
   */
  signupAttribution?: SignupAttributionContext;
  signupOrigin?: import("./attribution.js").SignupOrigin;
  clientPlatform?: import("../shared/analytics-platform.js").AnalyticsClientPlatform;
  authContextAccessed?: boolean;
  requestOrigin?: string;
  federationMembershipValidated?: boolean;
  /**
   * True when the request's real socket peer is loopback, captured by the
   * action-route handler while the h3 event is still in scope (nothing below
   * that layer can see the event). Derived from `getRequestIP()` WITHOUT
   * `x-forwarded-for`, so a remote client cannot set it via headers.
   *
   * A local-dev gate only. A tunnel or reverse proxy that reaches the dev
   * server over loopback also presents as loopback, so this is necessary but
   * not sufficient on its own — pair it with something that scopes the blast
   * radius (a resource that is itself local-only, NODE_ENV, etc.).
   */
  isLoopbackRequest?: boolean;
  isIntegrationCaller?: boolean;
  integration?: {
    taskId: string;
    attempts?: number;
    incoming: import("../integrations/types.js").IncomingMessage;
    placeholderRef?: string;
    progressRef?: import("../integrations/types.js").PlatformRunProgressRef;
    installationId?: string;
    scopeId?: string;
    principalType?: "user" | "service";
    lineage?: {
      runId?: string;
      parentTaskId?: string;
      source?: {
        kind: string;
        platform?: string;
        id: string;
        url?: string;
      };
      network?: {
        protocol: "a2a" | "mcp" | "provider-api";
        id: string;
        peer?: string;
      };
    };
  };
  run?: RequestRunContext;
}

const EXPLICIT_PERSONAL_ORG_SCOPE_KEY = "__anExplicitPersonalOrgScope";

export function markExplicitPersonalOrgScope(event: {
  context?: Record<string, unknown>;
}): void {
  if (event.context) {
    event.context[EXPLICIT_PERSONAL_ORG_SCOPE_KEY] = true;
  }
}

export function hasExplicitPersonalOrgScope(event: {
  context?: Record<string, unknown>;
}): boolean {
  return event.context?.[EXPLICIT_PERSONAL_ORG_SCOPE_KEY] === true;
}

const GLOBAL_KEY = "__agentNativeRequestContextAls" as const;
const OBSERVERS_KEY = "__agentNativeRequestContextObservers" as const;
const BOUNDARY_KEY = "__agentNativeRequestBoundaryInstalled" as const;
const CONTINUATION_LOCAL_KEY =
  "__agentNativeRequestContextContinuationLocal" as const;
type RequestContextObserver = (ctx: RequestContext) => void;
type GlobalWithRequestContext = typeof globalThis & {
  [GLOBAL_KEY]?: AsyncLocalStorageLike<RequestContext>;
  [OBSERVERS_KEY]?: RequestContextObserver[];
  [BOUNDARY_KEY]?: boolean;
  [CONTINUATION_LOCAL_KEY]?: boolean;
};
const globalRef = globalThis as GlobalWithRequestContext;
if (!globalRef[GLOBAL_KEY]) {
  globalRef[CONTINUATION_LOCAL_KEY] = Boolean(AsyncLocalStorageCtor);
  globalRef[GLOBAL_KEY] = AsyncLocalStorageCtor
    ? new AsyncLocalStorageCtor<RequestContext>()
    : new StackAsyncLocalStorage<RequestContext>();
}
if (!globalRef[OBSERVERS_KEY]) {
  globalRef[OBSERVERS_KEY] = [];
}
const als = globalRef[GLOBAL_KEY]!;
const observers = globalRef[OBSERVERS_KEY]!;

/**
 * Authorization state must never use the shared-stack compatibility fallback:
 * overlapping async requests are only isolated by native AsyncLocalStorage.
 */
export function assertRequestActionSurfaceIsolation(): void {
  if (globalRef[CONTINUATION_LOCAL_KEY] === true) return;
  throw new Error(
    "Request-scoped action surfaces require continuation-local request context storage; " +
      "this runtime only provides the non-isolated fallback.",
  );
}

export function hasContinuationLocalRequestContext(): boolean {
  return globalRef[CONTINUATION_LOCAL_KEY] === true;
}

/**
 * Register a callback fired every time `runWithRequestContext` enters a new
 * scope. The hook runs INSIDE the AsyncLocalStorage scope, so observability
 * helpers that read the current isolation scope (e.g. Sentry) attach to the
 * right per-request context.
 *
 * Returned function unregisters the observer. Observers must never throw —
 * any error is swallowed so a misbehaving observer can't break the request
 * path.
 */
export function addRequestContextObserver(
  observer: RequestContextObserver,
): () => void {
  observers.push(observer);
  return () => {
    const i = observers.indexOf(observer);
    if (i !== -1) observers.splice(i, 1);
  };
}

export function runWithRequestContext<T>(
  ctx: RequestContext,
  fn: () => T | Promise<T>,
): T | Promise<T> {
  const inheritedContext = als.getStore();
  const inheritedSyntheticTraffic = inheritedContext?.isSyntheticTraffic;
  let context =
    ctx.isSyntheticTraffic === undefined &&
    inheritedSyntheticTraffic !== undefined
      ? { ...ctx, isSyntheticTraffic: inheritedSyntheticTraffic }
      : ctx;
  if (
    context.trackingScope === undefined &&
    inheritedContext?.trackingScope !== undefined
  ) {
    context = { ...context, trackingScope: inheritedContext.trackingScope };
  }
  if (
    context.run?.allowedActionNames !== undefined ||
    context.run?.actionScope !== undefined
  ) {
    assertRequestActionSurfaceIsolation();
  }
  return als.run(context, () => {
    if (observers.length > 0) {
      for (const obs of observers) {
        try {
          obs(ctx);
        } catch {
          // Observers must never break the request path.
        }
      }
    }
    return fn();
  });
}

export function getRequestContext(): RequestContext | undefined {
  const store = als.getStore();
  markAuthContextAccess(store);
  return store;
}

export function hasRequestContext(): boolean {
  return als.getStore() !== undefined;
}

export function markRequestBoundaryInstalled(): void {
  globalRef[BOUNDARY_KEY] = true;
}

export function hasRequestBoundary(): boolean {
  return globalRef[BOUNDARY_KEY] === true;
}

export function getAmbientUserEmail(): string | undefined {
  return processEnv("AGENT_USER_EMAIL");
}

export function getAmbientOrgId(): string | undefined {
  return processEnv("AGENT_ORG_ID");
}

const warnedAmbientIdentities = new Set<string>();

function warnAmbientIdentitySatisfiedRead(email: string): void {
  if (!hasRequestBoundary()) return;
  if (warnedAmbientIdentities.has(email)) return;
  warnedAmbientIdentities.add(email);
  console.warn(
    `[agent-native] getRequestUserEmail() found no request context and answered with the ambient ` +
      `AGENT_USER_EMAIL identity (${email}). This process serves HTTP requests, so a request-scoped ` +
      `read reaching the ambient identity is a bug: it authorizes the deploy env, not the signed-in ` +
      `user. Wrap the caller in runWithRequestContext({ userEmail }), or call getAmbientUserEmail() ` +
      `explicitly if the process identity really is what you mean.`,
  );
}

export function getRequestUserEmail(): string | undefined {
  const store = als.getStore();
  if (store !== undefined) {
    if (store.userEmail) markAuthContextAccess(store);
    return store.userEmail;
  }
  const ambient = processEnv("AGENT_USER_EMAIL");
  if (ambient) warnAmbientIdentitySatisfiedRead(ambient);
  return ambient;
}

export function getRequestUserName(): string | undefined {
  const store = als.getStore();
  if (store !== undefined) {
    if (store.userName) markAuthContextAccess(store);
    return store.userName;
  }
  return processEnv("AGENT_USER_NAME");
}

export function getRequestOrgId(): string | undefined {
  const store = als.getStore();
  if (store !== undefined) {
    if (store.orgId) markAuthContextAccess(store);
    return store.orgId;
  }
  return processEnv("AGENT_ORG_ID");
}

export function getRequestAuthCapability(): string | undefined {
  const store = als.getStore();
  if (!store) return undefined;
  if (store.authCapability) markAuthContextAccess(store);
  return store.authCapability;
}

export function getRequestIsLoopback(): boolean {
  return als.getStore()?.isLoopbackRequest === true;
}

function markAuthContextAccess(ctx: RequestContext | undefined) {
  if (!ctx) return;
  if (ctx.userEmail || ctx.userName || ctx.orgId || ctx.authCapability) {
    ctx.authContextAccessed = true;
  }
}

export function hasAuthContextAccess(ctx: RequestContext | undefined): boolean {
  return Boolean(ctx?.authContextAccessed);
}

export function getRequestTimezone(): string | undefined {
  const store = als.getStore();
  if (store !== undefined) return store.timezone;
  return processEnv("AGENT_USER_TIMEZONE");
}

export function isIntegrationCallerRequest(): boolean {
  return als.getStore()?.isIntegrationCaller === true;
}

export function getIntegrationRequestContext():
  | NonNullable<RequestContext["integration"]>
  | undefined {
  return als.getStore()?.integration;
}

export function getCredentialContext(): {
  userEmail: string;
  orgId: string | null;
} | null {
  const userEmail = getRequestUserEmail();
  if (!userEmail) return null;
  return { userEmail, orgId: getRequestOrgId() ?? null };
}

export function getRequestRunContext(): RequestRunContext | undefined {
  const store = als.getStore();
  if (!store) return undefined;
  return store.run;
}

export function ensureRequestRunContext(): RequestRunContext | undefined {
  const store = als.getStore();
  if (!store) return undefined;
  if (!store.run) store.run = {};
  return store.run;
}
