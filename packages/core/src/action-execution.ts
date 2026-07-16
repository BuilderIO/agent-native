import type { ActionRunContext } from "./action.js";
import type { ActionEntry } from "./agent/production-agent.js";

export type ActionInvocationOrigin =
  | ActionRunContext["caller"]
  | "agent-chat"
  | "agent-team"
  | "job"
  | "trigger"
  | "integration"
  | "voice"
  | "run-code"
  | "generated-edge";

export interface ActionInvocationDescriptor {
  readonly version: 1;
  readonly origin: ActionInvocationOrigin;
  readonly capabilities: readonly string[];
}

export type ProtectedActionPlacement = "trusted_endpoint" | "enrolled_broker";

/** Declarative policy for actions whose plaintext may never execute hosted. */
export interface ResourcePrivacyExecutionPolicy {
  readonly mode: "protected";
  readonly resourceType: string;
  readonly placement: ProtectedActionPlacement;
}

export type ActionExecutionPolicy = ResourcePrivacyExecutionPolicy;

export interface ActionExecutionRequest {
  readonly actionName: string;
  readonly args: unknown;
  readonly context: Readonly<ActionRunContext>;
  readonly invocation: ActionInvocationDescriptor;
  readonly policy: ActionExecutionPolicy | null;
}

export type ActionExecutionDecision<TResult = unknown> =
  | { readonly status: "execute-local" }
  | {
      readonly status: "executed";
      readonly result: TResult;
      readonly placement: ProtectedActionPlacement;
    }
  | {
      readonly status: "queued";
      readonly queueId: string;
      readonly placement: ProtectedActionPlacement;
    }
  | {
      readonly status: "denied";
      readonly code: string;
      readonly message: string;
    };

export interface ActionExecutionResolver {
  /** Placements this request/app-scoped resolver is eligible to serve. */
  readonly placements: readonly ProtectedActionPlacement[];
  resolve<TResult = unknown>(
    request: ActionExecutionRequest,
  ):
    | Promise<ActionExecutionDecision<TResult>>
    | ActionExecutionDecision<TResult>;
}

export type ActionExecutionOutcome<TResult = unknown> =
  | {
      readonly status: "executed";
      readonly result: TResult;
      readonly placement: "local" | ProtectedActionPlacement;
    }
  | {
      readonly status: "queued";
      readonly queueId: string;
      readonly placement: ProtectedActionPlacement;
    }
  | {
      readonly status: "denied";
      readonly code: string;
      readonly message: string;
    };

export class ActionExecutionDeniedError extends Error {
  readonly code: string;
  readonly statusCode: number;

  constructor(code: string, message: string) {
    super(message);
    this.name = "ActionExecutionDeniedError";
    this.code = code;
    this.statusCode = code === "protected_execution_unavailable" ? 503 : 403;
  }
}

export function isActionExecutionDeniedError(
  error: unknown,
): error is ActionExecutionDeniedError {
  return (
    error instanceof ActionExecutionDeniedError ||
    Boolean(
      error &&
      typeof error === "object" &&
      (error as { name?: unknown }).name === "ActionExecutionDeniedError" &&
      typeof (error as { code?: unknown }).code === "string",
    )
  );
}

function normalizedCapabilities(values: readonly string[] | undefined) {
  return Object.freeze(
    Array.from(
      new Set(
        (values ?? [])
          .filter((value): value is string => typeof value === "string")
          .map((value) => value.trim())
          .filter(Boolean),
      ),
    ).sort(),
  );
}

export function createActionInvocationDescriptor(
  origin: ActionInvocationOrigin,
  capabilities: readonly string[] = [],
): ActionInvocationDescriptor {
  return Object.freeze({
    version: 1 as const,
    origin,
    capabilities: normalizedCapabilities(capabilities),
  });
}

function canonicalInvocation(
  descriptor: ActionInvocationDescriptor,
  caller: ActionRunContext["caller"],
): ActionInvocationDescriptor | null {
  const origins: readonly ActionInvocationOrigin[] = [
    "tool",
    "http",
    "frontend",
    "cli",
    "mcp",
    "a2a",
    "agent-chat",
    "agent-team",
    "job",
    "trigger",
    "integration",
    "voice",
    "run-code",
    "generated-edge",
  ];
  const toolLoopOrigins: readonly ActionInvocationOrigin[] = [
    "tool",
    "mcp",
    "a2a",
    "agent-chat",
    "agent-team",
    "job",
    "trigger",
    "integration",
    "voice",
    "run-code",
  ];
  if (
    descriptor.version !== 1 ||
    !origins.includes(descriptor.origin) ||
    !Array.isArray(descriptor.capabilities) ||
    descriptor.capabilities.length > 128 ||
    descriptor.capabilities.some(
      (capability) =>
        typeof capability !== "string" ||
        capability.trim().length === 0 ||
        capability.length > 256,
    ) ||
    (caller === "tool"
      ? !toolLoopOrigins.includes(descriptor.origin)
      : descriptor.origin !== "run-code" &&
        descriptor.origin !== "generated-edge" &&
        descriptor.origin !== caller) ||
    (descriptor.origin === "generated-edge" && caller !== "http")
  ) {
    return null;
  }
  return createActionInvocationDescriptor(
    descriptor.origin,
    descriptor.capabilities,
  );
}

export interface ExecuteActionEntryOptions {
  entry: ActionEntry;
  actionName: string;
  args: unknown;
  context: ActionRunContext;
  resolver?: ActionExecutionResolver;
  invocation?: ActionInvocationDescriptor;
}

const PROTECTED_PLACEMENTS: readonly ProtectedActionPlacement[] = [
  "trusted_endpoint",
  "enrolled_broker",
];

function canonicalPolicy(value: unknown): ActionExecutionPolicy | null | false {
  if (value == null) return null;
  if (
    typeof value !== "object" ||
    Array.isArray(value) ||
    (value as { mode?: unknown }).mode !== "protected" ||
    typeof (value as { resourceType?: unknown }).resourceType !== "string" ||
    !(value as { resourceType: string }).resourceType.trim() ||
    !PROTECTED_PLACEMENTS.includes(
      (value as { placement?: unknown }).placement as ProtectedActionPlacement,
    )
  ) {
    return false;
  }
  return Object.freeze({
    mode: "protected" as const,
    resourceType: (value as { resourceType: string }).resourceType.trim(),
    placement: (value as { placement: ProtectedActionPlacement }).placement,
  });
}

function canonicalResolverDecision<TResult>(
  decision: unknown,
  policy: ActionExecutionPolicy | null,
): ActionExecutionDecision<TResult> | null {
  if (!decision || typeof decision !== "object" || Array.isArray(decision)) {
    return null;
  }
  const candidate = decision as Record<string, unknown>;
  if (candidate.status === "execute-local") return { status: "execute-local" };
  if (candidate.status === "executed") {
    if (
      !PROTECTED_PLACEMENTS.includes(
        candidate.placement as ProtectedActionPlacement,
      ) ||
      (policy && candidate.placement !== policy.placement)
    ) {
      return null;
    }
    return {
      status: "executed",
      result: candidate.result as TResult,
      placement: candidate.placement as ProtectedActionPlacement,
    };
  }
  if (candidate.status === "queued") {
    if (
      typeof candidate.queueId !== "string" ||
      !candidate.queueId.trim() ||
      !PROTECTED_PLACEMENTS.includes(
        candidate.placement as ProtectedActionPlacement,
      ) ||
      (policy && candidate.placement !== policy.placement)
    ) {
      return null;
    }
    return {
      status: "queued",
      queueId: candidate.queueId,
      placement: candidate.placement as ProtectedActionPlacement,
    };
  }
  if (
    candidate.status === "denied" &&
    typeof candidate.code === "string" &&
    candidate.code.trim() &&
    typeof candidate.message === "string" &&
    candidate.message.trim()
  ) {
    return {
      status: "denied",
      code: candidate.code,
      message: candidate.message,
    };
  }
  return null;
}

/**
 * The sole execution seam for direct action transports. Routing is decided
 * before `entry.run`, and local execution exists in exactly one branch.
 */
export async function executeActionEntry<TResult = unknown>(
  options: ExecuteActionEntryOptions,
): Promise<ActionExecutionOutcome<TResult>> {
  const invocationCandidate =
    options.invocation ??
    options.context.invocation ??
    createActionInvocationDescriptor(options.context.caller);
  const invocation = canonicalInvocation(
    invocationCandidate,
    options.context.caller,
  );
  if (!invocation) {
    return {
      status: "denied",
      code: "invalid_invocation_descriptor",
      message: `Action '${options.actionName}' received an invalid invocation descriptor.`,
    };
  }
  const context: ActionRunContext = {
    ...options.context,
    actionName: options.context.actionName ?? options.actionName,
    invocation,
  };
  const policy = canonicalPolicy(options.entry.resourcePrivacy);
  if (policy === false) {
    return {
      status: "denied",
      code: "invalid_resource_privacy_policy",
      message: `Action '${options.actionName}' has an invalid protected-resource execution policy.`,
    };
  }
  const resolver = options.resolver ?? context.executionResolver;

  // Operator authorization is established by the transport before any
  // resolver can observe arguments. Direct transports without that proof must
  // fail closed instead of turning a broker into an operator bypass.
  if (options.entry.operatorOnly && context.operatorAuthorized !== true) {
    return {
      status: "denied",
      code: "operator_authorization_required",
      message: `Operator authorization is required for action '${options.actionName}'.`,
    };
  }

  if (!resolver) {
    if (policy) {
      return {
        status: "denied",
        code: "protected_execution_unavailable",
        message: `Protected action '${options.actionName}' requires an eligible ${policy.placement} resolver.`,
      };
    }
    return {
      status: "executed",
      result: (await options.entry.run(options.args, context)) as TResult,
      placement: "local",
    };
  }

  if (policy && !resolver.placements.includes(policy.placement)) {
    return {
      status: "denied",
      code: "protected_execution_unavailable",
      message: `Protected action '${options.actionName}' requires an eligible ${policy.placement} resolver.`,
    };
  }

  const decision = canonicalResolverDecision<TResult>(
    await resolver.resolve<TResult>({
      actionName: options.actionName,
      args: options.args,
      context,
      invocation,
      policy,
    }),
    policy,
  );
  if (!decision) {
    return {
      status: "denied",
      code: "invalid_execution_decision",
      message: `Action '${options.actionName}' received an invalid execution decision.`,
    };
  }
  if (decision.status === "execute-local") {
    if (policy && policy.placement !== "trusted_endpoint") {
      return {
        status: "denied",
        code: "protected_local_execution_forbidden",
        message: `Protected action '${options.actionName}' cannot execute locally for ${policy.placement} placement.`,
      };
    }
    return {
      status: "executed",
      result: (await options.entry.run(options.args, context)) as TResult,
      placement: policy?.placement ?? "local",
    };
  }
  return decision;
}

/** Preserve legacy raw-result transports while exposing typed routing outcomes. */
export function unwrapActionExecutionOutcome<TResult>(
  outcome: ActionExecutionOutcome<TResult>,
):
  | TResult
  | {
      execution: "queued";
      queueId: string;
      placement: ProtectedActionPlacement;
    } {
  if (outcome.status === "executed") return outcome.result;
  if (outcome.status === "queued") {
    return {
      execution: "queued",
      queueId: outcome.queueId,
      placement: outcome.placement,
    };
  }
  throw new ActionExecutionDeniedError(outcome.code, outcome.message);
}

export async function runActionEntry<TResult = unknown>(
  options: ExecuteActionEntryOptions,
): Promise<
  | TResult
  | {
      execution: "queued";
      queueId: string;
      placement: ProtectedActionPlacement;
    }
> {
  return unwrapActionExecutionOutcome(
    await executeActionEntry<TResult>(options),
  );
}
