export type NativeFeedbackResumeClock = {
  requestedLocalSeconds: number;
  simulationLocalSeconds: number;
  droppedLocalSeconds: number;
};

export type NativeFeedbackPlaybackStatus = {
  mode: "interactive";
  disposition: "exact" | "clamped";
  requestedLocalSeconds: number;
  simulationLocalSeconds: number;
  droppedLocalSeconds: number;
};

export type NativeFeedbackResumePlan =
  | {
      ok: true;
      simulationTimeSeconds: number;
      nextClock: NativeFeedbackResumeClock;
      disposition: "exact" | "clamped";
      droppedThisFrameSeconds: number;
    }
  | {
      ok: false;
      code: "feedback-time-invalid" | "feedback-seek-backward";
    };

const MAX_CALLBACK_DELTA_SECONDS = 0.05;
const FLOAT_TOLERANCE_SECONDS = 1e-9;

export function planNativeFeedbackInteractiveResume(input: {
  requestedLocalSeconds: number;
  initialLocalSeconds: number;
  completedStep: number;
  speed: number;
  fixedDt: number;
  maxStepsPerCall: number;
  prior: NativeFeedbackResumeClock | null;
}): NativeFeedbackResumePlan {
  const {
    requestedLocalSeconds,
    initialLocalSeconds,
    completedStep,
    speed,
    fixedDt,
    maxStepsPerCall,
    prior,
  } = input;
  if (
    !Number.isFinite(requestedLocalSeconds) ||
    requestedLocalSeconds < 0 ||
    !Number.isFinite(initialLocalSeconds) ||
    initialLocalSeconds < 0 ||
    !Number.isSafeInteger(completedStep) ||
    completedStep < 0 ||
    !Number.isFinite(speed) ||
    speed < 0 ||
    !Number.isFinite(fixedDt) ||
    fixedDt <= 0 ||
    !Number.isSafeInteger(maxStepsPerCall) ||
    maxStepsPerCall < 1 ||
    (prior !== null &&
      (!Number.isFinite(prior.requestedLocalSeconds) ||
        !Number.isFinite(prior.simulationLocalSeconds) ||
        !Number.isFinite(prior.droppedLocalSeconds) ||
        prior.requestedLocalSeconds < 0 ||
        prior.simulationLocalSeconds < 0 ||
        prior.droppedLocalSeconds < 0))
  )
    return { ok: false, code: "feedback-time-invalid" };
  const callbackBudget = Math.min(
    MAX_CALLBACK_DELTA_SECONDS * speed,
    maxStepsPerCall * fixedDt,
  );
  if (prior === null) {
    const initialSimulationSeconds = Math.max(
      initialLocalSeconds,
      completedStep * fixedDt,
    );
    if (
      requestedLocalSeconds + FLOAT_TOLERANCE_SECONDS <
      initialSimulationSeconds
    )
      return { ok: false, code: "feedback-seek-backward" };
    const elapsedSeconds = Math.max(
      0,
      requestedLocalSeconds - initialSimulationSeconds,
    );
    const appliedSeconds = Math.min(elapsedSeconds, callbackBudget);
    const simulationTimeSeconds = initialSimulationSeconds + appliedSeconds;
    const droppedThisFrameSeconds = elapsedSeconds - appliedSeconds;
    if (
      !Number.isFinite(simulationTimeSeconds) ||
      !Number.isFinite(droppedThisFrameSeconds)
    )
      return { ok: false, code: "feedback-time-invalid" };
    return {
      ok: true,
      simulationTimeSeconds,
      nextClock: {
        requestedLocalSeconds,
        simulationLocalSeconds: simulationTimeSeconds,
        droppedLocalSeconds: droppedThisFrameSeconds,
      },
      disposition:
        droppedThisFrameSeconds > FLOAT_TOLERANCE_SECONDS ? "clamped" : "exact",
      droppedThisFrameSeconds,
    };
  }
  if (
    requestedLocalSeconds + FLOAT_TOLERANCE_SECONDS <
    prior.requestedLocalSeconds
  )
    return { ok: false, code: "feedback-seek-backward" };
  const observedDelta = Math.max(
    0,
    requestedLocalSeconds - prior.requestedLocalSeconds,
  );
  const appliedDelta = Math.min(observedDelta, callbackBudget);
  const droppedThisFrameSeconds = observedDelta - appliedDelta;
  const simulationTimeSeconds = prior.simulationLocalSeconds + appliedDelta;
  const droppedLocalSeconds =
    prior.droppedLocalSeconds + droppedThisFrameSeconds;
  if (
    !Number.isFinite(simulationTimeSeconds) ||
    !Number.isFinite(droppedLocalSeconds)
  )
    return { ok: false, code: "feedback-time-invalid" };
  return {
    ok: true,
    simulationTimeSeconds,
    nextClock: {
      requestedLocalSeconds,
      simulationLocalSeconds: simulationTimeSeconds,
      droppedLocalSeconds,
    },
    disposition:
      droppedLocalSeconds > FLOAT_TOLERANCE_SECONDS ? "clamped" : "exact",
    droppedThisFrameSeconds,
  };
}
