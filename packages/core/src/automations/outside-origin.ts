import { isOutsideAgentCall } from "../action-caller.js";
import { actionExecutionStorage } from "../action-frame.js";
import type { ActionRunContext } from "../action.js";

export type AutomationOriginContext = Partial<
  Pick<ActionRunContext, "caller" | "networkProtocol" | "automation">
>;

/**
 * Whether an automation change or run trigger came from outside the app's own
 * UI and agent. Every enclosing action frame counts, so a trusted inner caller
 * cannot launder an outside ancestor. With no context at all the origin is
 * unknown, which is outside.
 */
export function isOutsideAutomationOrigin(
  ctx?: AutomationOriginContext,
): boolean {
  const origins: AutomationOriginContext[] = [];
  if (
    ctx?.caller !== undefined ||
    ctx?.networkProtocol !== undefined ||
    ctx?.automation !== undefined
  ) {
    origins.push(ctx);
  }
  for (
    let frame = actionExecutionStorage?.getStore()?.frame;
    frame;
    frame = frame.parent
  ) {
    if (frame.context) origins.push(frame.context);
  }
  if (!origins.length) return true;
  return origins.some((origin) =>
    isOutsideAgentCall(
      origin as Pick<
        ActionRunContext,
        "caller" | "networkProtocol" | "automation"
      >,
    ),
  );
}
