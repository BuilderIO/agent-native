/**
 * Internal route used by platform schedulers to run one recurring-job sweep.
 * The route is intentionally narrow: it accepts no job or owner input and
 * authenticates the platform handoff with the deployment's internal token.
 */
export const RECURRING_JOBS_SWEEP_PATH = "/_agent-native/jobs/_process-sweep";

export const RECURRING_JOBS_SWEEP_TOKEN_SUBJECT =
  "agent-native-recurring-jobs-sweep";
