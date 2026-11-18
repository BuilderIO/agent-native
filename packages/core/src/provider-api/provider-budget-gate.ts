import {
  registerProviderCallGate,
  type ProviderCallGateRequest,
  type ProviderCallGateTarget,
} from "./call-gates.js";
import {
  ProviderDeferredError,
  recheckProviderBudgetReservation,
  reserveProviderBudget,
  type ProviderAdmission,
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
  const reservations = new WeakMap<
    ProviderCallGateRequest,
    {
      scope: ProviderConnectionScope;
      cost: number;
      admission: Extract<ProviderAdmission, { status: "ready" }>;
    }
  >();
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
      const cost = options.cost?.(request) ?? 1;
      const admission = await reserveProviderBudget(
        scope,
        options.policy,
        cost,
      );
      if (admission.status === "paused")
        throw new ProviderDeferredError(admission);
      reservations.set(request, { scope, cost, admission });
    },
    recheck: async (request) => {
      await checkPause();
      const reservation = reservations.get(request);
      if (!reservation)
        throw new TypeError("Provider request has no budget reservation.");
      const admission = await recheckProviderBudgetReservation(
        reservation.scope,
        options.policy,
        reservation.cost,
        reservation.admission,
      );
      if (admission.status === "paused")
        throw new ProviderDeferredError(admission);
      reservation.admission = admission;
    },
  });
}
