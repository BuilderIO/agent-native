export class NativeSimulationTimelineError extends Error {
  constructor(
    readonly code:
      | "simulation-time-invalid"
      | "simulation-step-invalid"
      | "simulation-seek-budget-exceeded",
    message: string,
  ) {
    super(message);
    this.name = "NativeSimulationTimelineError";
  }
}

export interface NativeSimulationStepPlan {
  reset: boolean;
  steps: number[];
  targetStep: number;
  completedStep: number;
  caughtUp: boolean;
}

export function planNativeSimulationSteps(input: {
  lastCompletedStep: number;
  targetTime: number;
  fixedDt: number;
  mode: "interactive" | "deterministic";
  maxInteractiveSteps: number;
  maxDeterministicSteps: number;
}): NativeSimulationStepPlan {
  const {
    lastCompletedStep,
    targetTime,
    fixedDt,
    mode,
    maxInteractiveSteps,
    maxDeterministicSteps,
  } = input;
  if (
    !Number.isFinite(targetTime) ||
    targetTime < 0 ||
    !Number.isFinite(fixedDt) ||
    fixedDt <= 0
  )
    throw new NativeSimulationTimelineError(
      "simulation-time-invalid",
      "Simulation time and fixed step must be finite, positive values.",
    );
  if (
    !Number.isSafeInteger(lastCompletedStep) ||
    lastCompletedStep < -1 ||
    !Number.isSafeInteger(maxInteractiveSteps) ||
    maxInteractiveSteps < 1 ||
    !Number.isSafeInteger(maxDeterministicSteps) ||
    maxDeterministicSteps < 1
  )
    throw new NativeSimulationTimelineError(
      "simulation-step-invalid",
      "Simulation step state or execution limits are invalid.",
    );
  const exactStep = targetTime / fixedDt;
  const targetStep = Math.floor(exactStep + 1e-9);
  if (!Number.isSafeInteger(targetStep))
    throw new NativeSimulationTimelineError(
      "simulation-time-invalid",
      "Simulation time exceeds the supported fixed-step range.",
    );
  const reset = targetStep < lastCompletedStep;
  const firstStep = reset ? 0 : lastCompletedStep + 1;
  const pending = Math.max(0, targetStep - firstStep + 1);
  if (mode === "deterministic" && pending > maxDeterministicSteps)
    throw new NativeSimulationTimelineError(
      "simulation-seek-budget-exceeded",
      "Deterministic simulation seek exceeds the bounded step budget.",
    );
  const count =
    mode === "interactive" ? Math.min(pending, maxInteractiveSteps) : pending;
  const steps = Array.from({ length: count }, (_, index) => firstStep + index);
  const completedStep = count ? steps[count - 1] : lastCompletedStep;
  return {
    reset,
    steps,
    targetStep,
    completedStep,
    caughtUp: completedStep >= targetStep,
  };
}
