export type RadarCheckStatus =
  | "clear"
  | "fired"
  | "insufficient"
  | "unavailable"
  | "observed";

export type RadarSeverity = "critical" | "warning" | "info";
export type RadarWindow = "hourly" | "daily" | "weekly";
export type ThresholdOperator = "lt" | "gt" | "drop_points";
export type EventChange = "first_seen" | "went_to_zero";
export const EVENT_WENT_TO_ZERO_MIN_N = 50;

export function classifyEventChange(input: {
  currentCount: number;
  previousSevenDayCount: number;
  previousThirtyDayCount: number;
  minN: number;
  minWentToZeroN?: number;
}): EventChange | null {
  if (input.currentCount >= input.minN && input.previousThirtyDayCount === 0) {
    return "first_seen";
  }
  if (
    input.currentCount === 0 &&
    input.previousSevenDayCount >= (input.minWentToZeroN ?? input.minN)
  ) {
    return "went_to_zero";
  }
  return null;
}

export interface RadarCheckDefinition {
  id: string;
  app: string;
  window: RadarWindow;
  baselineDays: number;
  minN: number;
  threshold: number | null;
  operator: ThresholdOperator | "signal";
  severity: RadarSeverity;
  message: string;
  query:
    | "events"
    | "funnel"
    | "trouble"
    | "upload"
    | "errors"
    | "campaign"
    | "slo";
}

export interface RadarCheckResult extends RadarCheckDefinition {
  status: RadarCheckStatus;
  value?: number | null;
  baseline?: number | null;
  numerator?: number | null;
  denominator?: number | null;
  firedMessage?: string;
  detail?: string;
}

export const RADAR_CHECKS: RadarCheckDefinition[] = [
  {
    id: "event-feed-coverage",
    app: "*",
    window: "daily",
    baselineDays: 30,
    minN: 1,
    threshold: null,
    operator: "signal",
    severity: "critical",
    message: "First-party event coverage is unavailable for an app.",
    query: "events",
  },
  {
    id: "builder-connect-success",
    app: "*",
    window: "hourly",
    baselineDays: 7,
    minN: 10,
    threshold: 0.6,
    operator: "lt",
    severity: "critical",
    message: "Builder connection success fell below 60%.",
    query: "events",
  },
  {
    id: "env-key-share",
    app: "*",
    window: "daily",
    baselineDays: 7,
    minN: 5,
    threshold: 0.05,
    operator: "gt",
    severity: "critical",
    message: "More than 5% of new user AI runs use a deploy environment key.",
    query: "events",
  },
  {
    id: "chat-setup-exposure",
    app: "*",
    window: "daily",
    baselineDays: 7,
    minN: 40,
    threshold: 0.2,
    operator: "lt",
    severity: "warning",
    message: "Connect AI setup exposure fell below 20% of its seven day rate.",
    query: "events",
  },
  {
    id: "ai-connection-none",
    app: "*",
    window: "daily",
    baselineDays: 7,
    minN: 1,
    threshold: 0,
    operator: "gt",
    severity: "warning",
    message: "A new user run started without an AI connection.",
    query: "events",
  },
  {
    id: "slides-empty-output-retry",
    app: "slides",
    window: "daily",
    baselineDays: 7,
    minN: 10,
    threshold: 0.15,
    operator: "gt",
    severity: "warning",
    message: "Empty output retries exceeded 15% of new deck prompts.",
    query: "events",
  },
  {
    id: "slides-generation-failure",
    app: "slides",
    window: "daily",
    baselineDays: 7,
    minN: 10,
    threshold: 0.4,
    operator: "gt",
    severity: "critical",
    message: "Slides generation failures exceeded 40% of started users.",
    query: "events",
  },
  {
    id: "design-prompt-output",
    app: "design",
    window: "daily",
    baselineDays: 7,
    minN: 10,
    threshold: 0.5,
    operator: "lt",
    severity: "critical",
    message: "Fewer than half of Design prompt users reached a ready output.",
    query: "events",
  },
  {
    id: "clips-local-saves",
    app: "clips",
    window: "daily",
    baselineDays: 7,
    minN: 1,
    threshold: 20,
    operator: "gt",
    severity: "info",
    message: "Clips local recording saves exceeded 20 today.",
    query: "events",
  },
  {
    id: "clips-ready-rate",
    app: "clips",
    window: "daily",
    baselineDays: 7,
    minN: 10,
    threshold: 0.5,
    operator: "lt",
    severity: "critical",
    message: "Fewer than half of Clips recording starts reached a ready clip.",
    query: "events",
  },
  {
    id: "session-trouble-pair",
    app: "*",
    window: "daily",
    baselineDays: 7,
    minN: 40,
    threshold: 0.05,
    operator: "gt",
    severity: "warning",
    message:
      "An action and status trouble pair affected more than 5% of sessions.",
    query: "trouble",
  },
  {
    id: "replay-upload-rejection",
    app: "*",
    window: "daily",
    baselineDays: 7,
    minN: 20,
    threshold: 0.05,
    operator: "gt",
    severity: "warning",
    message: "Replay upload rejection exceeded 5% of recorders.",
    query: "upload",
  },
  {
    id: "first-touch-funnel-drop",
    app: "*",
    window: "daily",
    baselineDays: 7,
    minN: 40,
    threshold: 0.15,
    operator: "drop_points",
    severity: "warning",
    message:
      "A first touch funnel step fell more than 15 percentage points below its seven day rate.",
    query: "funnel",
  },
  {
    id: "signup-volume-drop",
    app: "*",
    window: "daily",
    baselineDays: 7,
    minN: 0,
    threshold: 0.3,
    operator: "lt",
    severity: "warning",
    message: "Signups fell 70% below their seven day median.",
    query: "events",
  },
  {
    id: "event-first-seen-or-zero",
    app: "*",
    window: "daily",
    baselineDays: 30,
    minN: 10,
    threshold: null,
    operator: "signal",
    severity: "info",
    message:
      "A first party event appeared for the first time or a high-volume event went to zero.",
    query: "events",
  },
  {
    id: "action-success-rate",
    app: "*",
    window: "daily",
    baselineDays: 7,
    minN: 40,
    threshold: null,
    operator: "lt",
    severity: "warning",
    message: "Weighted action success fell below its calibrated app threshold.",
    query: "events",
  },
  {
    id: "prompt-output-p90",
    app: "*",
    window: "weekly",
    baselineDays: 7,
    minN: 10,
    threshold: null,
    operator: "gt",
    severity: "warning",
    message: "Prompt to first output p90 exceeded its weekly SLO.",
    query: "slo",
  },
  {
    id: "new-error-issues",
    app: "*",
    window: "daily",
    baselineDays: 7,
    minN: 1,
    threshold: 5,
    operator: "gt",
    severity: "warning",
    message: "A new error issue affected at least five users.",
    query: "errors",
  },
  {
    id: "campaign-followup",
    app: "*",
    window: "daily",
    baselineDays: 7,
    minN: 0,
    threshold: null,
    operator: "signal",
    severity: "info",
    message:
      "Outage recovery email follow up by recipient app and activity app.",
    query: "campaign",
  },
];

export function evaluateThreshold(input: {
  n: number;
  minN: number;
  value: number | null;
  operator: ThresholdOperator;
  threshold: number;
  baseline?: number | null;
}): RadarCheckStatus {
  if (input.n < input.minN) return "insufficient";
  if (input.value === null || !Number.isFinite(input.value))
    return "unavailable";
  if (input.operator === "lt") {
    return input.value < input.threshold ? "fired" : "clear";
  }
  if (input.operator === "gt") {
    return input.value > input.threshold ? "fired" : "clear";
  }
  if (input.baseline == null || !Number.isFinite(input.baseline)) {
    return "unavailable";
  }
  return input.baseline - input.value > input.threshold ? "fired" : "clear";
}

export function radarExitCode(results: readonly RadarCheckResult[]): 0 | 1 {
  if (
    results.some(
      (result) => result.status === "fired" || result.status === "unavailable",
    )
  )
    return 1;
  return 0;
}
