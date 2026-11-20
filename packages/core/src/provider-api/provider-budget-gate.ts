import {
  registerProviderCallGate,
  ProviderCallGateAdmissionTimeoutError,
  type ProviderCallGateRequest,
  type ProviderCallGateTarget,
} from "./call-gates.js";
import {
  ProviderBudgetUnavailableError,
  ProviderDeferredError,
  commitProviderBudgetReservation,
  releaseProviderBudgetReservation,
  recheckProviderBudgetReservation,
  reserveProviderBudget,
  type ProviderAdmission,
  type ProviderBudgetPolicy,
  type ProviderConnectionScope,
  type ProviderPause,
} from "./provider-budget.js";

interface ProviderBudgetGateOptions {
  id: string;
  matches: (target: ProviderCallGateTarget) => boolean;
  policy: ProviderBudgetPolicy;
  resolveScope: (
    request: ProviderCallGateRequest,
  ) => ProviderConnectionScope | Promise<ProviderConnectionScope>;
  /** Read-only switch lookup. This gate never changes an operator's setting. */
  readPause: () => Promise<ProviderPause | null>;
  cost?: (request: ProviderCallGateRequest) => number;
}

/** Shared admission for named requests, pages, retries, and gated direct transports. */
export function registerProviderBudgetGate(
  options: ProviderBudgetGateOptions,
): () => void {
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
  const assertLive = (request: ProviderCallGateRequest) => {
    request.signal?.throwIfAborted();
    if (Date.now() >= request.deadline)
      throw new ProviderCallGateAdmissionTimeoutError();
  };
  const checkLive = async (
    request: ProviderCallGateRequest,
    admission?: Extract<ProviderAdmission, { status: "ready" }>,
  ) => {
    try {
      assertLive(request);
    } catch (error) {
      if (admission) await releaseProviderBudgetReservation(admission);
      throw error;
    }
  };
  return registerProviderCallGate({
    id: options.id,
    matches: options.matches,
    precheck: checkPause,
    admission: "attempt",
    connectionBudget: true,
    prepare: (request) => async () => {
      assertLive(request);
      await checkPause();
      assertLive(request);
      if (request.accountIdError !== undefined)
        throw request.accountIdError instanceof Error
          ? request.accountIdError
          : new ProviderBudgetUnavailableError({
              cause: request.accountIdError,
            });
      const scope = await options.resolveScope(request);
      const cost = options.cost?.(request) ?? 1;
      assertLive(request);
      const admission = await reserveProviderBudget(
        scope,
        options.policy,
        cost,
      );
      if (admission.status === "paused") {
        assertLive(request);
        throw new ProviderDeferredError(admission);
      }
      const reservation = { scope, cost, admission };
      reservations.set(request, reservation);
      await checkLive(request, admission);
      return () => {
        try {
          assertLive(request);
        } catch (error) {
          void releaseProviderBudgetReservation(reservation.admission).catch(
            () => {
              // coercion-ok: refund failures are counted; this request is already refused and cannot dispatch.
            },
          );
          throw error;
        }
        commitProviderBudgetReservation(reservation.admission);
      };
    },
    recheck: async (request) => {
      const reservation = reservations.get(request);
      if (!reservation)
        throw new TypeError("Provider request has no budget reservation.");
      try {
        await checkLive(request, reservation.admission);
        await checkPause();
        await checkLive(request, reservation.admission);
        const admission = await recheckProviderBudgetReservation(
          reservation.scope,
          options.policy,
          reservation.cost,
          reservation.admission,
        );
        if (admission.status === "ready") reservation.admission = admission;
        await checkLive(request, reservation.admission);
        if (admission.status === "paused")
          throw new ProviderDeferredError(admission);
      } catch (error) {
        if (request.signal?.aborted || Date.now() >= request.deadline)
          await releaseProviderBudgetReservation(reservation.admission);
        throw error;
      }
    },
  });
}
