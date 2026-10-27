import { actionExecutionStorage } from "../action-frame.js";
import type { ActionCaller } from "../action.js";

export function isMcpAutomationOrigin(caller?: ActionCaller): boolean {
  if (caller === "mcp") return true;
  for (
    let frame = actionExecutionStorage?.getStore()?.frame;
    frame;
    frame = frame.parent
  ) {
    if (frame.context?.caller === "mcp") return true;
  }
  return false;
}
