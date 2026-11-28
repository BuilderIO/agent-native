import { coerceGatewayStringifiedArgs as sharedCoerceGatewayStringifiedArgs } from "@agent-native/actions/contract";

import type { ActionTool } from "./agent/types.js";

/**
 * The repair a tool call's arguments get before schema validation: a gateway
 * that stringifies `true`, `3`, or a JSON array/object is undone per the
 * declared parameter type. Delegates to `@agent-native/actions/contract`.
 */
export function coerceGatewayStringifiedArgs(
  args: unknown,
  parameters?: ActionTool["parameters"],
): unknown {
  return sharedCoerceGatewayStringifiedArgs(args, parameters);
}
