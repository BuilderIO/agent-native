import type { ActionRunContext } from "../action.js";
import type {
  ActionAccessConfig,
  ActionAccessDecision,
} from "./check-action.js";

export type {
  ActionAccessConfig,
  ActionAccessDecision,
} from "./check-action.js";

export type ActionAccessChecker = (
  config: ActionAccessConfig,
  args: unknown,
  ctx?: ActionRunContext,
) => Promise<ActionAccessDecision>;

const CHECKER_KEY = Symbol.for("@agent-native/core/action-access-checker");

type ActionAccessRuntime = {
  checker?: ActionAccessChecker;
};

function getRuntime(): ActionAccessRuntime {
  const globalState = globalThis as typeof globalThis & {
    [CHECKER_KEY]?: ActionAccessRuntime;
  };
  return (globalState[CHECKER_KEY] ??= {});
}

export function registerActionAccessChecker(
  checker: ActionAccessChecker,
): void {
  getRuntime().checker = checker;
}

export async function assertRegisteredActionAccess(
  config: ActionAccessConfig,
  args: unknown,
  ctx?: ActionRunContext,
): Promise<ActionAccessDecision> {
  const checker = getRuntime().checker;
  if (!checker) {
    throw new Error("Action authorization runtime is not available.");
  }
  return checker(config, args, ctx);
}
