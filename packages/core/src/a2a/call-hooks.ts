/**
 * A2A action call hooks: deployment-owned additions to direct A2A action
 * calls (`actions/invoke`).
 *
 * A hook can attach extra JSON-RPC params to an outgoing call (for example a
 * signed proof that the call comes from a live user turn) and, on the
 * receiving app, refuse an incoming call or admit it as foreground work that
 * runs inside a provider-interactive scope. With no hook registered the client
 * and the handler behave exactly as without this module.
 */

/** The peer an outgoing call was resolved to, when it came through agent discovery. */
export interface A2AActionCallTarget {
  kind: "discovered" | "url";
  id?: string;
  url: string;
  /** Where discovery found the agent, e.g. "workspace". */
  source?: string;
}

/** One outgoing `actions/invoke` call, as a hook sees it before it is sent. */
export interface A2AOutgoingActionCall {
  /** The URL the caller passed. */
  url: string;
  /** The normalized audience of the endpoint the call is sent to. */
  audience: string;
  action: string;
  input: Record<string, unknown>;
  /** The user the caller asked to sign the call as, when it named one. */
  userEmail?: string;
  orgId?: string;
  target?: A2AActionCallTarget;
}

export interface A2AOutgoingActionCallAdditions {
  /**
   * Extra JSON-RPC params sent with the call. They may not reuse a key the
   * call already sends (`action`, `input`, `metadata`) or one another hook
   * added.
   */
  params?: Record<string, unknown>;
}

/** The verified caller of an incoming call. */
export interface A2AIncomingActionCaller {
  email: string;
  /** "user", "organization" or "org-member", when the token said which. */
  identityAssurance?: string;
  /** The organization the caller's token was verified against. */
  orgId?: string;
  /** The audiences the caller's token was verified for. */
  audiences: readonly string[];
}

/** One incoming `actions/invoke` call, after its identity is verified. */
export interface A2AIncomingActionCall {
  action: string;
  input: Record<string, unknown>;
  /** The call's JSON-RPC params as received, including any a peer hook added. */
  params: Readonly<Record<string, unknown>>;
  caller: A2AIncomingActionCaller;
  /** Whether the verified caller is a member of `orgId`. */
  isOrgMember(orgId: string): Promise<boolean>;
}

export type A2AIncomingActionCallDecision =
  | { status: "refused"; message: string; reason?: string }
  | {
      status: "admitted";
      /** Run the action as foreground work for the caller until `expiresAt`. */
      foreground?: { expiresAt: number };
      /**
       * Run the action in this organization instead of the caller's personal
       * scope. It must match the verified organization when the token carried
       * one; otherwise the caller must be a member of it.
       */
      orgId?: string;
    };

export interface A2AActionCallHook {
  /** Stable id; registering a different hook under the same id throws. */
  id: string;
  outgoing?(
    call: A2AOutgoingActionCall,
  ):
    | A2AOutgoingActionCallAdditions
    | undefined
    | Promise<A2AOutgoingActionCallAdditions | undefined>;
  /** Return undefined to leave the call as it is. */
  incoming?(
    call: A2AIncomingActionCall,
  ):
    | A2AIncomingActionCallDecision
    | undefined
    | Promise<A2AIncomingActionCallDecision | undefined>;
}

/** JSON-RPC `error.data.kind` of a call a hook refused. */
export const A2A_CALL_REFUSED_KIND = "agent-native/a2a-call-refused";

/** A peer refused an A2A action call through one of its call hooks. */
export class A2ACallRefusedError extends Error {
  readonly code: number;
  readonly hookId: string | undefined;
  readonly reason: string | undefined;

  constructor(
    message: string,
    options: { code: number; hookId?: string; reason?: string },
  ) {
    super(message);
    this.name = "A2ACallRefusedError";
    this.code = options.code;
    this.hookId = options.hookId;
    this.reason = options.reason;
  }
}

/** A call hook threw, or returned something the call cannot carry. */
/** How long one deployment hook may hold an A2A action call. */
export const A2A_CALL_HOOK_TIMEOUT_MS = 5_000;

async function runHookBounded<T>(
  hookId: string,
  direction: "incoming" | "outgoing",
  run: () => T | Promise<T>,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      Promise.resolve().then(run),
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () =>
            reject(
              new A2ACallHookError(
                hookId,
                `${direction} hook did not answer within ${A2A_CALL_HOOK_TIMEOUT_MS} ms`,
              ),
            ),
          A2A_CALL_HOOK_TIMEOUT_MS,
        );
      }),
    ]);
  } catch (cause) {
    if (cause instanceof A2ACallHookError && cause.hookId === hookId)
      throw cause;
    throw new A2ACallHookError(hookId, `${direction} hook failed`, { cause });
  } finally {
    clearTimeout(timer);
  }
}

export class A2ACallHookError extends Error {
  readonly hookId: string;

  constructor(hookId: string, message: string, options?: { cause?: unknown }) {
    super(`A2A call hook "${hookId}": ${message}`, options);
    this.name = "A2ACallHookError";
    this.hookId = hookId;
  }
}

interface A2AActionCallHookRegistry {
  hooks: A2AActionCallHook[];
}

const globals = globalThis as typeof globalThis & {
  __agentNativeA2AActionCallHooks?: A2AActionCallHookRegistry;
};
const registry: A2AActionCallHookRegistry =
  (globals.__agentNativeA2AActionCallHooks ??= { hooks: [] });

/**
 * Register an A2A action call hook. Every registered hook runs, in
 * registration order. Registering the same hook object again is a no-op.
 * Returns a function that removes it.
 */
export function registerA2AActionCallHook(hook: A2AActionCallHook): () => void {
  if (!hook.id) throw new Error("An A2A action call hook needs an id.");
  const existing = registry.hooks.find((entry) => entry.id === hook.id);
  if (existing && existing !== hook) {
    throw new Error(
      `A2A action call hook "${hook.id}" is already registered by another module.`,
    );
  }
  if (!existing) registry.hooks.push(hook);
  return () => {
    const index = registry.hooks.indexOf(hook);
    if (index >= 0) registry.hooks.splice(index, 1);
  };
}

export function listA2AActionCallHooks(): readonly A2AActionCallHook[] {
  return [...registry.hooks];
}

export function hasA2AActionCallHooks(): boolean {
  return registry.hooks.length > 0;
}

export function clearA2AActionCallHooksForTests(): void {
  registry.hooks.length = 0;
}

const RESERVED_OUTGOING_PARAMS = new Set(["action", "input", "metadata"]);

/** Collect the extra params every hook adds to an outgoing call. */
export async function collectOutgoingA2AActionCallParams(
  call: A2AOutgoingActionCall,
): Promise<Record<string, unknown>> {
  const params: Record<string, unknown> = {};
  for (const hook of listA2AActionCallHooks()) {
    if (!hook.outgoing) continue;
    let additions: A2AOutgoingActionCallAdditions | undefined;
    const outgoing = hook.outgoing;
    additions = await runHookBounded(hook.id, "outgoing", () => outgoing(call));
    for (const [key, value] of Object.entries(additions?.params ?? {})) {
      if (value === undefined) continue;
      if (RESERVED_OUTGOING_PARAMS.has(key) || Object.hasOwn(params, key)) {
        throw new A2ACallHookError(hook.id, `param "${key}" is already set`);
      }
      params[key] = value;
    }
  }
  return params;
}

export type A2AIncomingActionCallOutcome =
  | { status: "refused"; hookId: string; message: string; reason?: string }
  | {
      status: "admitted";
      foreground?: { expiresAt: number };
      orgId?: string;
    };

/**
 * Ask every hook about an incoming call. The first refusal wins. Admissions
 * combine: the earliest foreground expiry, and one organization at most.
 * Undefined when no hook had an opinion. A hook that throws throws
 * {@link A2ACallHookError}.
 */
export async function decideIncomingA2AActionCall(
  call: A2AIncomingActionCall,
): Promise<A2AIncomingActionCallOutcome | undefined> {
  let admitted: Extract<A2AIncomingActionCallOutcome, { status: "admitted" }> =
    { status: "admitted" };
  let decided = false;
  for (const hook of listA2AActionCallHooks()) {
    if (!hook.incoming) continue;
    let decision: A2AIncomingActionCallDecision | undefined;
    const incoming = hook.incoming;
    decision = await runHookBounded(hook.id, "incoming", () => incoming(call));
    if (decision === undefined) continue;
    decided = true;
    if (decision.status === "refused") {
      return {
        status: "refused",
        hookId: hook.id,
        message: decision.message,
        ...(decision.reason ? { reason: decision.reason } : {}),
      };
    }
    // Hooks are deployment code that may not be type-checked against this union.
    const status: string = decision.status;
    if (status !== "admitted") {
      throw new A2ACallHookError(hook.id, "returned an unknown decision");
    }
    if (decision.foreground) {
      const { expiresAt } = decision.foreground;
      if (!Number.isSafeInteger(expiresAt)) {
        throw new A2ACallHookError(hook.id, "foreground expiry is invalid");
      }
      admitted = {
        ...admitted,
        foreground: {
          expiresAt: Math.min(
            admitted.foreground?.expiresAt ?? expiresAt,
            expiresAt,
          ),
        },
      };
    }
    if (decision.orgId !== undefined) {
      if (admitted.orgId !== undefined && admitted.orgId !== decision.orgId) {
        return {
          status: "refused",
          hookId: hook.id,
          message: "A2A call hooks named different organizations",
          reason: "org-conflict",
        };
      }
      admitted = { ...admitted, orgId: decision.orgId };
    }
  }
  return decided ? admitted : undefined;
}
