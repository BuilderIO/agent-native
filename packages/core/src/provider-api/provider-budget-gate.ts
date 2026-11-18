import {
  registerProviderCallGate,
  type ProviderCallGateRequest,
  type ProviderCallGateTarget,
} from "./call-gates.js";
import {
  ProviderDeferredError,
  reserveProviderBudget,
  type ProviderBudgetPolicy,
  type ProviderConnectionScope,
  type ProviderPause,
} from "./provider-budget.js";

/** Shared admission for named requests, pages, retries, and gated direct transports. */
export function registerProviderBudgetGate(options: {
  id: string;
  matches: (target: ProviderCallGateTarget) => boolean;
  policy: ProviderBudgetPolicy;
  resolveScope: (
    request: ProviderCallGateRequest,
  ) => ProviderConnectionScope | Promise<ProviderConnectionScope>;
  /** Read-only switch lookup. This gate never changes an operator's setting. */
  readPause: () => Promise<ProviderPause | null>;
  cost?: (request: ProviderCallGateRequest) => number;
}): () => void {
  const checkPause = async () => {
    const pause = await options.readPause();
    if (pause) throw new ProviderDeferredError(pause);
  };
  return registerProviderCallGate({
    id: options.id,
    matches: options.matches,
    precheck: checkPause,
    admission: "attempt",
    prepare: (request) => async () => {
      await checkPause();
      if (request.accountIdError) throw request.accountIdError;
      const scope = await options.resolveScope(request);
      const admission = await reserveProviderBudget(
        scope,
        options.policy,
        options.cost?.(request) ?? 1,
      );
      if (admission.status === "paused")
        throw new ProviderDeferredError(admission);
    },
    recheck: checkPause,
  });
}
