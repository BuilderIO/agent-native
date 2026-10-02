import {
  AGENT_TROUBLE_CAUSES,
  type AgentTroubleCause,
} from "@agent-native/core/shared/analytics-events";

export { AGENT_TROUBLE_CAUSES, type AgentTroubleCause };

/**
 * Replay signals come from a recording's own replay as its chunks arrive.
 * Event signals come from its session's tracked events. Every signal is a
 * filter and a sort.
 */
export const REPLAY_FRICTION_SIGNALS = [
  "error_then_leave",
  "http_5xx",
  "retry_loops",
  "error_toasts",
  "dead_clicks",
  "slow_requests",
  "http_4xx",
] as const;

export const EVENT_FRICTION_SIGNALS = [
  "agent_failures",
  "stuck_chats",
  "thumbs_down",
  "failed_actions",
  "quick_backs",
  "cancelled_runs",
] as const;

export const SESSION_FRICTION_SIGNALS = [
  ...REPLAY_FRICTION_SIGNALS,
  ...EVENT_FRICTION_SIGNALS,
] as const;

export type ReplayFrictionSignal = (typeof REPLAY_FRICTION_SIGNALS)[number];
export type EventFrictionSignal = (typeof EVENT_FRICTION_SIGNALS)[number];
export type SessionFrictionSignal = (typeof SESSION_FRICTION_SIGNALS)[number];

/** The score also weighs the error and rage-click counts every row shows. */
export type ScoredFrictionInput =
  | SessionFrictionSignal
  | "errors"
  | "rage_clicks";

export const REPLAY_FRICTION_SCORE_INPUTS: readonly ScoredFrictionInput[] = [
  ...REPLAY_FRICTION_SIGNALS,
  "errors",
  "rage_clicks",
];

export const EVENT_FRICTION_SCORE_INPUTS: readonly ScoredFrictionInput[] =
  EVENT_FRICTION_SIGNALS;

export const SESSION_FRICTION_WEIGHTS: Readonly<
  Record<ScoredFrictionInput, number>
> = {
  error_then_leave: 8,
  agent_failures: 5,
  stuck_chats: 5,
  thumbs_down: 5,
  http_5xx: 4,
  failed_actions: 4,
  retry_loops: 4,
  error_toasts: 3,
  rage_clicks: 3,
  errors: 2,
  quick_backs: 2,
  cancelled_runs: 2,
  dead_clicks: 1,
  slow_requests: 1,
  http_4xx: 1,
};

/** Occurrences past this add nothing, so one noisy signal cannot bury others. */
export const SESSION_FRICTION_SIGNAL_CAP = 5;

export type FrictionCounts = Partial<Record<ScoredFrictionInput, number>>;

function frictionContribution(
  input: ScoredFrictionInput,
  count: number | undefined,
): number {
  if (count === undefined || !Number.isFinite(count) || count <= 0) return 0;
  return (
    Math.min(Math.floor(count), SESSION_FRICTION_SIGNAL_CAP) *
    SESSION_FRICTION_WEIGHTS[input]
  );
}

export function sessionFrictionScore(
  counts: FrictionCounts,
  inputs: readonly ScoredFrictionInput[],
): number {
  return inputs.reduce(
    (score, input) => score + frictionContribution(input, counts[input]),
    0,
  );
}

export interface SessionFrictionSignalCount {
  signal: ScoredFrictionInput;
  count: number;
}

/** The signals that add most to a score, heaviest first. */
export function topSessionFrictionSignals(
  counts: FrictionCounts,
  limit = 3,
): SessionFrictionSignalCount[] {
  return (Object.keys(SESSION_FRICTION_WEIGHTS) as ScoredFrictionInput[])
    .map((signal) => ({
      signal,
      count: counts[signal] ?? 0,
      contribution: frictionContribution(signal, counts[signal]),
    }))
    .filter((entry) => entry.contribution > 0)
    .sort(
      (a, b) =>
        b.contribution - a.contribution ||
        SESSION_FRICTION_WEIGHTS[b.signal] - SESSION_FRICTION_WEIGHTS[a.signal],
    )
    .slice(0, limit)
    .map(({ signal, count }) => ({ signal, count }));
}

/** Sessions URL param for friction signal filters (repeatable). */
export const SESSION_FRICTION_SIGNAL_PARAM = "signal";

export const SESSION_FRICTION_SORTS = [
  "friction",
  ...SESSION_FRICTION_SIGNALS,
] as const;

export type SessionFrictionSort = (typeof SESSION_FRICTION_SORTS)[number];

export function isSessionFrictionSignal(
  value: unknown,
): value is SessionFrictionSignal {
  return (
    typeof value === "string" &&
    (SESSION_FRICTION_SIGNALS as readonly string[]).includes(value)
  );
}

export function isSessionFrictionSort(
  value: unknown,
): value is SessionFrictionSort {
  return (
    typeof value === "string" &&
    (SESSION_FRICTION_SORTS as readonly string[]).includes(value)
  );
}

export function readSessionFrictionSignals(
  params: URLSearchParams,
): SessionFrictionSignal[] {
  return [
    ...new Set(
      params
        .getAll(SESSION_FRICTION_SIGNAL_PARAM)
        .filter(isSessionFrictionSignal),
    ),
  ];
}

export interface SessionTroubleGroup {
  kind: "action" | "agent";
  /** Action name, or an agent failure's normalized message or cause id. */
  label: string;
  /** HTTP status or outcome for actions; the run error code for agents. */
  status: string | null;
  cause: AgentTroubleCause | null;
  count: number;
}

export interface SessionErrorIssueLink {
  id: string;
  title: string;
  count: number;
}

export interface SessionFriction {
  /** Null when neither the replay nor the session's events were measured. */
  score: number | null;
  /** Null when the recording's replay was not measured from its start. */
  replay: Record<ReplayFrictionSignal, number> | null;
  /** Null when the session's events were not measured completely. */
  events: Record<EventFrictionSignal, number> | null;
  topSignals: SessionFrictionSignalCount[];
  troubles: SessionTroubleGroup[];
  /** Null when the issue lookup did not run or could not cover this row. */
  errorIssues: SessionErrorIssueLink[] | null;
}
