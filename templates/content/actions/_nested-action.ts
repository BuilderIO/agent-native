import {
  ActionExecutionDeniedError,
  createActionInvocationDescriptor,
  runActionEntry,
  type ActionEntry,
} from "@agent-native/core";
import type { ActionRunContext } from "@agent-native/core/action";

/**
 * Dispatch an action from another action without bypassing protected-resource
 * placement. Transport identity, capabilities, and the request-scoped resolver
 * are inherited; a context-free direct/test call receives a sealed CLI origin.
 *
 * A queued nested action cannot be represented honestly by the outer action's
 * ordinary success result, so it fails closed instead of reporting a mutation
 * that has not happened yet. Protected outer actions should route as a whole.
 */
export async function runInheritedActionEntry<TResult>(options: {
  entry: ActionEntry;
  actionName: string;
  args: unknown;
  parentContext?: ActionRunContext;
}): Promise<TResult> {
  const caller = options.parentContext?.caller ?? "cli";
  const invocation =
    options.parentContext?.invocation ??
    createActionInvocationDescriptor(caller);
  const context: ActionRunContext = {
    ...options.parentContext,
    caller,
    actionName: options.actionName,
    invocation,
    executionResolver: options.parentContext?.executionResolver,
  };
  const result = await runActionEntry<TResult>({
    entry: options.entry,
    actionName: options.actionName,
    args: options.args,
    context,
    resolver: options.parentContext?.executionResolver,
    invocation,
  });
  if (
    result &&
    typeof result === "object" &&
    "execution" in result &&
    result.execution === "queued"
  ) {
    throw new ActionExecutionDeniedError(
      "nested_action_queued",
      `Nested action '${options.actionName}' queued instead of executing; the outer action cannot report success.`,
    );
  }
  return result as TResult;
}
